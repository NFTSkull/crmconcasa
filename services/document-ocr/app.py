from __future__ import annotations

import io
import os
import re
import time
from functools import lru_cache
from typing import Literal

import fitz
import jwt
import cv2
import numpy as np
import pytesseract
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from jwt import PyJWKClient

MAX_BYTES = 15 * 1024 * 1024
MAX_TEXT_CHARS = 30000
ALLOWED_TYPES = {
    "cliente_ine_frente",
    "cliente_ine_reverso",
    "cliente_comprobante_domicilio",
    "cliente_estado_cuenta",
}

app = FastAPI(title="ConCasa Document OCR", version="1.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["authorization", "content-type"],
)


def _supabase_url() -> str:
    return os.getenv("SUPABASE_URL", "").strip().rstrip("/")


@lru_cache(maxsize=1)
def _jwk_client() -> PyJWKClient:
    base = _supabase_url()
    if not base:
        raise RuntimeError("SUPABASE_URL missing")
    return PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json", cache_keys=True)


def verify_bearer(authorization: str | None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="auth_required")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="auth_required")

    base = _supabase_url()
    if not base:
        raise HTTPException(status_code=503, detail="auth_unconfigured")

    try:
        signing_key = _jwk_client().get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=f"{base}/auth/v1",
            options={"require": ["exp", "sub"]},
        )
    except Exception:
        raise HTTPException(status_code=401, detail="invalid_token")

    if payload.get("role") != "authenticated":
        raise HTTPException(status_code=403, detail="authenticated_role_required")
    return payload


def normalize_mime(raw: str | None, filename: str | None) -> str:
    mime = (raw or "").lower().strip().split(";")[0]
    if mime:
        return mime
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        return "application/pdf"
    if name.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if name.endswith(".png"):
        return "image/png"
    if name.endswith(".webp"):
        return "image/webp"
    return ""


def enough_embedded_text(text: str) -> bool:
    compact = re.sub(r"\s+", "", text or "")
    return len(compact) >= 80


def _orientation_probe(image: Image.Image) -> Image.Image:
    probe = ImageOps.exif_transpose(image).convert("L")
    longest = max(probe.size)
    if longest > 1200:
        scale = 1200 / max(1, longest)
        probe = probe.resize(
            (max(1, round(probe.width * scale)), max(1, round(probe.height * scale))),
            Image.Resampling.BILINEAR,
        )
    probe = ImageOps.autocontrast(probe, cutoff=1)
    return probe


def _ine_orientation_score(text: str, document_type: str) -> int:
    raw = (text or "").upper()
    markers = (
        "INSTITUTO",
        "NACIONAL",
        "ELECTORAL",
        "CREDENCIAL",
        "NOMBRE",
        "CURP",
        "VIGENCIA",
        "SEXO",
        "OCR",
        "0CR",
    )
    score = sum(2 for marker in markers if marker in raw)
    if document_type == "cliente_ine_reverso":
        score += 2 if "MEX" in raw else 0
        score += 2 if "<<" in raw else 0
        score += 2 if re.search(r"\d{6}.{0,3}[MHF]\d{6}", raw) else 0
    return score


def orient_ine_image(image: Image.Image, document_type: str) -> Image.Image:
    # Normalizamos modo para que rotate(fillcolor="white") sea estable también
    # con PNG/WebP que lleguen como P, LA o RGBA.
    base = ImageOps.exif_transpose(image).convert("RGB")
    best = base
    best_score = -1

    # Si ya está derecha y las etiquetas principales se leen bien, evitamos
    # tres OCR extra. Esto mantiene barato el caso normal.
    first_probe = pytesseract.image_to_string(
        _orientation_probe(base),
        lang="spa+eng",
        config="--oem 1 --psm 11 preserve_interword_spaces=1",
    )
    first_score = _ine_orientation_score(first_probe, document_type)
    if first_score >= 6:
        return base
    best_score = first_score

    for degrees in (90, 180, 270):
        candidate = base.rotate(degrees, expand=True, fillcolor="white")
        probe_text = pytesseract.image_to_string(
            _orientation_probe(candidate),
            lang="spa+eng",
            config="--oem 1 --psm 11 preserve_interword_spaces=1",
        )
        score = _ine_orientation_score(probe_text, document_type)
        if score > best_score:
            best_score = score
            best = candidate

    return best


def deskew_small_angle(image: Image.Image) -> Image.Image:
    gray = np.array(image.convert("L"))
    if gray.size == 0:
        return image

    _, binary = cv2.threshold(
        gray,
        0,
        255,
        cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU,
    )
    coords = np.column_stack(np.where(binary > 0))
    if len(coords) < 100:
        return image

    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle

    if abs(angle) < 0.35 or abs(angle) > 12:
        return image

    return image.rotate(
        angle,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor="white",
    )


def extract_embedded_pdf_text(data: bytes, max_pages: int = 4) -> tuple[str, int]:
    doc = fitz.open(stream=data, filetype="pdf")
    parts: list[str] = []
    pages = min(len(doc), max_pages)
    for idx in range(pages):
        parts.append(doc[idx].get_text("text") or "")
    return "\n".join(parts).strip(), pages


def preprocess_image(image: Image.Image) -> Image.Image:
    img = ImageOps.exif_transpose(image).convert("L")
    if max(img.size) < 1800:
        scale = min(3.0, 1800 / max(1, max(img.size)))
        img = img.resize(
            (max(1, round(img.width * scale)), max(1, round(img.height * scale))),
            Image.Resampling.LANCZOS,
        )
    img = ImageOps.autocontrast(img, cutoff=1)
    img = ImageEnhance.Contrast(img).enhance(1.25)
    img = img.filter(ImageFilter.SHARPEN)
    return img


def adaptive_binary_variant(image: Image.Image) -> Image.Image:
    base = ImageOps.exif_transpose(image).convert("L")
    longest = max(base.size)
    if longest < 2600:
        scale = min(6.0, 2600 / max(1, longest))
        base = base.resize(
            (max(1, round(base.width * scale)), max(1, round(base.height * scale))),
            Image.Resampling.LANCZOS,
        )

    arr = np.array(base)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(arr)
    denoised = cv2.bilateralFilter(clahe, 7, 30, 30)
    binary = cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        9,
    )
    return Image.fromarray(binary)


def ocr_image(image: Image.Image, document_type: str) -> str:
    source = ImageOps.exif_transpose(image)
    if document_type.startswith("cliente_ine_"):
        source = orient_ine_image(source, document_type)
        source = deskew_small_angle(source)

    primary = preprocess_image(source)
    primary_psm = "6" if document_type != "cliente_ine_reverso" else "11"
    parts = [
        pytesseract.image_to_string(
            primary,
            lang="spa+eng",
            config=f"--oem 1 --psm {primary_psm} preserve_interword_spaces=1",
        ).strip()
    ]

    # Las INE fotografiadas suelen tener texto pequeño sobre fondos de seguridad.
    # Un pase binario sparse-text recupera etiquetas como SEXO/VIGENCIA que PSM 6
    # puede perder. Concatenamos resultados; el parser posterior sigue siendo
    # determinista y solo acepta valores explícitos de alta confianza.
    if document_type.startswith("cliente_ine_"):
        adaptive = adaptive_binary_variant(source)
        parts.append(
            pytesseract.image_to_string(
                adaptive,
                lang="spa+eng",
                config="--oem 1 --psm 11 preserve_interword_spaces=1",
            ).strip()
        )

    return "\n".join(part for part in parts if part).strip()


def render_pdf_page(page: fitz.Page, dpi: int = 300) -> Image.Image:
    zoom = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    return Image.open(io.BytesIO(pix.tobytes("png")))


def ocr_pdf(data: bytes, document_type: str) -> tuple[str, int]:
    doc = fitz.open(stream=data, filetype="pdf")
    max_pages = 2 if document_type.startswith("cliente_ine_") else min(3, len(doc))
    parts: list[str] = []
    for idx in range(min(len(doc), max_pages)):
        parts.append(ocr_image(render_pdf_page(doc[idx]), document_type))
    return "\n".join(parts).strip(), min(len(doc), max_pages)


def extract_document_text(data: bytes, mime: str, document_type: str) -> tuple[str, str, int]:
    if mime in {"application/pdf", "application/x-pdf"}:
        embedded, embedded_pages = extract_embedded_pdf_text(data)
        if enough_embedded_text(embedded):
            return embedded[:MAX_TEXT_CHARS], "embedded_text", embedded_pages
        text, pages = ocr_pdf(data, document_type)
        return text[:MAX_TEXT_CHARS], "tesseract", pages

    if mime in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
        image = Image.open(io.BytesIO(data))
        text = ocr_image(image, document_type)
        return text[:MAX_TEXT_CHARS], "tesseract", 1

    raise HTTPException(status_code=415, detail="unsupported_mime")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "document-ocr", "version": "1.2.0"}


@app.post("/v1/extract")
async def extract(
    file: UploadFile = File(...),
    document_type: Literal[
        "cliente_ine_frente",
        "cliente_ine_reverso",
        "cliente_comprobante_domicilio",
        "cliente_estado_cuenta",
    ] = Form(...),
    authorization: str | None = Header(default=None),
) -> dict:
    verify_bearer(authorization)

    if document_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=422, detail="document_type_not_allowed")

    data = await file.read(MAX_BYTES + 1)
    if not data:
        raise HTTPException(status_code=422, detail="empty_file")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="file_too_large")

    mime = normalize_mime(file.content_type, file.filename)
    started = time.monotonic()
    try:
        text, engine, pages = extract_document_text(data, mime, document_type)
    except HTTPException:
        raise
    except Exception:
        # Nunca incluir texto/PII ni excepción cruda en la respuesta.
        raise HTTPException(status_code=422, detail="ocr_failed")

    return {
        "ok": True,
        "documentType": document_type,
        "engine": engine,
        "pages": pages,
        "durationMs": round((time.monotonic() - started) * 1000),
        "text": text,
        "textLength": len(text),
    }
