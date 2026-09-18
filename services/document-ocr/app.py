from __future__ import annotations

import io
import os
import re
import time
from functools import lru_cache
from typing import Literal

import fitz
import jwt
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

app = FastAPI(title="ConCasa Document OCR", version="1.0.0")
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


def ocr_image(image: Image.Image, document_type: str) -> str:
    img = preprocess_image(image)
    psm = "6" if document_type != "cliente_ine_reverso" else "11"
    return pytesseract.image_to_string(
        img,
        lang="spa+eng",
        config=f"--oem 1 --psm {psm} preserve_interword_spaces=1",
    ).strip()


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
    return {"ok": True, "service": "document-ocr", "version": "1.0.0"}


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
