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


def _has_readable_ine_validity(text: str) -> bool:
    normalized = (text or "").upper().replace("O", "0")
    if "VIGENCIA" not in normalized:
        return False
    block = normalized[normalized.index("VIGENCIA"):normalized.index("VIGENCIA") + 120]
    return re.search(r"20\d{2}", block) is not None


def _ine_front_validity_focus_text(image: Image.Image) -> str:
    """
    Pase dirigido a la zona donde INE imprime VIGENCIA.
    Trabaja sobre copia normalizada; nunca modifica el archivo original.
    """
    base = ImageOps.exif_transpose(image).convert("RGB")
    width, height = base.size
    if width <= 0 or height <= 0:
        return ""

    regions = [
        base.crop((0, round(height * 0.48), width, height)),
        base.crop((round(width * 0.42), round(height * 0.38), width, height)),
    ]

    parts: list[str] = []
    for region in regions:
        gray = region.convert("L")
        longest = max(gray.size)
        if longest < 3000:
            scale = min(6.0, 3000 / max(1, longest))
            gray = gray.resize(
                (max(1, round(gray.width * scale)), max(1, round(gray.height * scale))),
                Image.Resampling.LANCZOS,
            )
        gray = ImageOps.autocontrast(gray, cutoff=1)
        gray = ImageEnhance.Contrast(gray).enhance(1.45)
        gray = gray.filter(ImageFilter.SHARPEN)
        text = pytesseract.image_to_string(
            gray,
            lang="spa+eng",
            config="--oem 1 --psm 11 preserve_interword_spaces=1",
        ).strip()
        if text:
            parts.append(text)
        if _has_readable_ine_validity("\n".join(parts)):
            break

    return "\n".join(parts).strip()


def _ine_orientation_score(text: str, document_type: str) -> int:
    normalized = re.sub(r"[^A-Z0-9<>]+", " ", (text or "").upper())
    if document_type == "cliente_ine_reverso":
        weighted = {
            "OCR": 7,
            "0CR": 7,
            "IDMEX": 7,
            "CIC": 4,
            "<<": 4,
            "MEX": 1,
            "INSTITUTO": 1,
            "ELECTORAL": 1,
        }
    else:
        weighted = {
            "VIGENCIA": 6,
            "CURP": 5,
            "SEXO": 5,
            "NOMBRE": 3,
            "DOMICILIO": 2,
            "CLAVE DE ELECTOR": 3,
            "INSTITUTO": 1,
            "NACIONAL": 1,
            "ELECTORAL": 1,
        }
    return sum(weight for marker, weight in weighted.items() if marker in normalized)


def _ine_orientation_needs_retry(text: str, document_type: str) -> bool:
    normalized = (text or "").upper()
    if document_type == "cliente_ine_reverso":
        return not re.search(r"\\b(?:OCR|0CR|CIC)\\b|IDMEX|<<", normalized)
    # Frente: si falta VIGENCIA o SEXO, una foto 90° puede haber producido
    # nombre/CURP parciales pero seguir perdiendo los campos pequeños.
    return "VIGENCIA" not in normalized or "SEXO" not in normalized


def _orientation_probe_image(image: Image.Image) -> Image.Image:
    probe = ImageOps.exif_transpose(image).convert("L")
    longest = max(probe.size)
    if longest > 1400:
        scale = 1400 / max(1, longest)
        probe = probe.resize(
            (max(1, round(probe.width * scale)), max(1, round(probe.height * scale))),
            Image.Resampling.BILINEAR,
        )
    probe = ImageOps.autocontrast(probe, cutoff=1)
    return probe


def _best_ine_orientation(
    image: Image.Image,
    document_type: str,
    current_text: str,
) -> tuple[Image.Image, int]:
    base = ImageOps.exif_transpose(image)
    current_score = _ine_orientation_score(current_text, document_type)
    best_score = current_score
    best_degrees = 0

    # Una INE es horizontal. En fotos verticales priorizamos 90/270; en una foto
    # horizontal probamos primero 180 para cubrir credenciales al revés.
    if base.height > base.width * 1.05:
        candidates = (90, 270, 180)
    else:
        candidates = (180, 90, 270)

    for degrees in candidates:
        rotated = base.rotate(degrees, expand=True)
        probe = _orientation_probe_image(rotated)
        probe_text = pytesseract.image_to_string(
            probe,
            lang="spa+eng",
            config="--oem 1 --psm 11 preserve_interword_spaces=1",
        ).strip()
        score = _ine_orientation_score(probe_text, document_type)
        if score > best_score:
            best_score = score
            best_degrees = degrees

    if best_degrees == 0:
        return base, 0
    return base.rotate(best_degrees, expand=True), best_degrees


def ocr_image(image: Image.Image, document_type: str) -> str:
    working = ImageOps.exif_transpose(image)
    primary = preprocess_image(working)
    primary_psm = "6" if document_type != "cliente_ine_reverso" else "11"
    primary_text = pytesseract.image_to_string(
        primary,
        lang="spa+eng",
        config=f"--oem 1 --psm {primary_psm} preserve_interword_spaces=1",
    ).strip()

    if document_type.startswith("cliente_ine_") and _ine_orientation_needs_retry(
        primary_text, document_type
    ):
        oriented, degrees = _best_ine_orientation(
            working, document_type, primary_text
        )
        if degrees:
            working = oriented
            primary = preprocess_image(working)
            primary_text = pytesseract.image_to_string(
                primary,
                lang="spa+eng",
                config=f"--oem 1 --psm {primary_psm} preserve_interword_spaces=1",
            ).strip()

    parts = [primary_text]

    # Las INE fotografiadas suelen tener texto pequeño sobre fondos de seguridad.
    # El pase adaptativo se ejecuta sobre la orientación ya corregida.
    if document_type.startswith("cliente_ine_"):
        adaptive = adaptive_binary_variant(working)
        parts.append(
            pytesseract.image_to_string(
                adaptive,
                lang="spa+eng",
                config="--oem 1 --psm 11 preserve_interword_spaces=1",
            ).strip()
        )

    if document_type == "cliente_ine_frente":
        combined = "\n".join(part for part in parts if part).strip()
        if not _has_readable_ine_validity(combined):
            focused = _ine_front_validity_focus_text(working)
            if focused:
                parts.append(focused)

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
