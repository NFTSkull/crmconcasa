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

app = FastAPI(title="ConCasa Document OCR", version="1.4.0")
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


def _has_clabe_like_candidate(text: str) -> bool:
    source = (text or "").upper()
    for label in re.finditer(r"\bCLABE\b", source):
        window = source[label.end():label.end() + 140]
        for match in re.finditer(r"(?:\d[\s.\-:/]*){18}", window):
            digits = re.sub(r"\D", "", match.group(0))
            if len(digits) == 18:
                return True
    return False


def _bank_statement_clabe_focus_text(image: Image.Image) -> str:
    """
    Segundo pase solo cuando el OCR general no encontró una CLABE usable.
    No asume banco/layout: usa la página completa en modo sparse text.
    """
    focused = adaptive_binary_variant(image)
    return pytesseract.image_to_string(
        focused,
        lang="spa+eng",
        config="--oem 1 --psm 11 preserve_interword_spaces=1",
    ).strip()


def _ine_front_name_block_looks_complete(text: str) -> bool:
    lines = [
        re.sub(r"\s+", " ", line.strip().upper())
        for line in (text or "").splitlines()
        if line.strip()
    ]
    stops = re.compile(
        r"^(DOMICILIO|CURP|SEXO|CLAVE\s+DE\s+ELECTOR|VIGENCIA|SECCI[OÓ]N|FECHA\s+DE\s+NACIMIENTO)"
    )
    for idx, line in enumerate(lines):
        if not re.match(r"^NOMBRE(?:S)?\b", line):
            continue
        values: list[str] = []
        inline = re.sub(r"^NOMBRE(?:S)?\s*:?-?\s*", "", line).strip()
        if inline:
            inline_words = re.findall(r"[A-ZÁÉÍÓÚÜÑ]{2,}", inline)
            if len(inline_words) >= 3:
                return True
            values.append(inline)
        for candidate in lines[idx + 1:idx + 7]:
            if stops.match(candidate):
                break
            letters = re.sub(r"[^A-ZÁÉÍÓÚÜÑ]", "", candidate)
            if len(letters) >= 3:
                values.append(candidate)
            if len(values) >= 3:
                return True
    return False


def _ine_front_name_focus_text(image: Image.Image) -> str:
    """
    Relectura del bloque NOMBRE. Las INE actuales mantienen ese bloque en la
    zona central-superior; se usa solo si la lectura general quedó incompleta.
    """
    base = ImageOps.exif_transpose(image).convert("RGB")
    width, height = base.size
    if width < 8 or height < 8:
        return ""
    region = base.crop(
        (
            round(width * 0.24),
            round(height * 0.20),
            round(width * 0.84),
            round(height * 0.62),
        )
    )
    focused = preprocess_image(region)
    return pytesseract.image_to_string(
        focused,
        lang="spa+eng",
        config="--oem 1 --psm 6 preserve_interword_spaces=1",
    ).strip()


def _ine_reverse_mrz_focus_text(image: Image.Image) -> str:
    """
    Pase final del MRZ/T7 con whitelist para recuperar los 13 dígitos después
    de << y la línea de fecha/sexo, sin volver a procesar toda la foto.
    """
    crop = _ine_reverse_mrz_crop(image)
    focused = adaptive_binary_variant(crop)
    return pytesseract.image_to_string(
        focused,
        lang="eng",
        config="--oem 1 --psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
    ).strip()


def _has_readable_ine_validity(text: str) -> bool:
    normalized = (text or "").upper().replace("O", "0")
    if "VIGENCIA" not in normalized:
        return False
    block = normalized[normalized.index("VIGENCIA"):normalized.index("VIGENCIA") + 120]
    return re.search(r"20\d{2}", block) is not None


def _ine_front_validity_year_hint(image: Image.Image) -> str:
    """
    Último recurso seguro para frentes donde se ve VIGENCIA pero Tesseract
    pierde la etiqueta o los años. Solo emite un hint si detecta dos años
    plausibles 20xx en la zona inferior derecha de la credencial.
    """
    base = ImageOps.exif_transpose(image).convert("L")
    width, height = base.size
    if width < 8 or height < 8:
        return ""

    crop = base.crop(
        (
            round(width * 0.45),
            round(height * 0.50),
            width,
            height,
        )
    )
    longest = max(crop.size)
    if longest < 3200:
        scale = min(7.0, 3200 / max(1, longest))
        crop = crop.resize(
            (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
            Image.Resampling.LANCZOS,
        )
    crop = ImageOps.autocontrast(crop, cutoff=1)
    crop = ImageEnhance.Contrast(crop).enhance(1.55)
    crop = crop.filter(ImageFilter.SHARPEN)

    raw = pytesseract.image_to_string(
        crop,
        lang="eng",
        config="--oem 1 --psm 11 -c tessedit_char_whitelist=0123456789-/ ",
    )
    years = []
    for match in re.findall(r"20\d{2}", raw):
        year = int(match)
        if 2020 <= year <= 2050 and year not in years:
            years.append(year)

    if len(years) < 2:
        return ""

    # INE imprime emisión/inicio y fin de vigencia; el segundo no debe ser
    # anterior al primero ni absurdamente lejano.
    first, second = years[0], years[1]
    if second < first or second - first > 15:
        return ""
    return f"VIGENCIA {first} {second}"


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

    combined = "\n".join(parts).strip()
    if not _has_readable_ine_validity(combined):
        hint = _ine_front_validity_year_hint(base)
        if hint:
            parts.append(hint)

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


def _ocr_tokens_to_text(tokens: list[dict]) -> str:
    lines: dict[tuple[int, int, int, int], list[str]] = {}
    for token in tokens:
        key = token["line_key"]
        lines.setdefault(key, []).append(token["text"])
    return "\n".join(" ".join(parts) for parts in lines.values()).strip()


def _ocr_tokens(image: Image.Image, config: str) -> list[dict]:
    data = pytesseract.image_to_data(
        image,
        lang="spa+eng",
        config=config,
        output_type=pytesseract.Output.DICT,
    )
    tokens: list[dict] = []
    count = len(data.get("text", []))
    for idx in range(count):
        raw = str(data["text"][idx] or "").strip()
        if not raw:
            continue
        tokens.append(
            {
                "text": raw,
                "conf": float(data["conf"][idx]) if str(data["conf"][idx]).strip() else -1.0,
                "left": int(data["left"][idx]),
                "top": int(data["top"][idx]),
                "width": int(data["width"][idx]),
                "height": int(data["height"][idx]),
                "line_key": (
                    int(data["page_num"][idx]),
                    int(data["block_num"][idx]),
                    int(data["par_num"][idx]),
                    int(data["line_num"][idx]),
                ),
            }
        )
    return tokens


def _normalize_mrz_token(raw: str) -> str:
    return re.sub(
        r"[^A-Z0-9<]",
        "",
        (raw or "").upper().replace(">", "<").replace("«", "<").replace("‹", "<"),
    )


def _read_single_digit(image: Image.Image) -> str | None:
    if image.width < 2 or image.height < 2:
        return None
    gray = ImageOps.autocontrast(image.convert("L"), cutoff=1)
    target_height = 240
    if gray.height < target_height:
        scale = min(8.0, target_height / max(1, gray.height))
        gray = gray.resize(
            (max(1, round(gray.width * scale)), max(1, round(gray.height * scale))),
            Image.Resampling.LANCZOS,
        )

    arr = np.array(gray)
    _, binary = cv2.threshold(arr, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    config = "--oem 1 --psm 13 -c tessedit_char_whitelist=0123456789"
    candidates: list[str] = []
    for variant in (gray, Image.fromarray(binary)):
        value = re.sub(
            r"\D",
            "",
            pytesseract.image_to_string(
                variant,
                lang="eng",
                config=config,
            ),
        )
        if len(value) == 1:
            candidates.append(value)

    if len(candidates) >= 2 and len(set(candidates)) == 1:
        return candidates[0]
    return None


def _verify_t7_trailing_digit(image: Image.Image, tokens: list[dict]) -> None:
    numeric = r"[0-9OQILZSBG]"
    for token in tokens:
        cleaned = _normalize_mrz_token(token["text"])
        match = re.search(rf"<<+({numeric}{{13}})(?:<|$)", cleaned)
        if not match:
            continue

        width = max(1, int(token["width"]))
        height = max(1, int(token["height"]))
        char_count = max(1, len(cleaned))
        char_width = width / char_count
        char_index = match.start(1) + 12

        left = int(token["left"] + char_width * (char_index - 0.30))
        right = int(token["left"] + char_width * (char_index + 1.30))
        top = int(token["top"] - height * 0.20)
        bottom = int(token["top"] + height * 1.20)

        left = max(0, left)
        top = max(0, top)
        right = min(image.width, max(left + 2, right))
        bottom = min(image.height, max(top + 2, bottom))
        focused = image.crop((left, top, right, bottom))
        verified = _read_single_digit(focused)
        if not verified:
            continue

        current = cleaned[char_index]
        normalized_current = (
            current.replace("O", "0")
            .replace("Q", "0")
            .replace("I", "1")
            .replace("L", "1")
            .replace("Z", "2")
            .replace("S", "5")
            .replace("G", "6")
            .replace("B", "8")
        )
        if verified == normalized_current:
            return

        corrected = cleaned[:char_index] + verified + cleaned[char_index + 1 :]
        token["text"] = corrected
        return


def _primary_ocr_text(image: Image.Image, document_type: str, psm: str) -> str:
    config = f"--oem 1 --psm {psm} preserve_interword_spaces=1"
    if document_type != "cliente_ine_reverso":
        return pytesseract.image_to_string(
            image,
            lang="spa+eng",
            config=config,
        ).strip()

    # El reverso usa TSV para conservar la caja del primer renglón MRZ. El T7
    # queda al borde derecho y Tesseract puede confundir especialmente el último
    # dígito; una microlectura de esa celda verifica ese único carácter sin
    # volver a procesar toda la credencial.
    tokens = _ocr_tokens(image, config)
    _verify_t7_trailing_digit(image, tokens)
    return _ocr_tokens_to_text(tokens)


def _ine_reverse_has_structured_mrz(text: str) -> bool:
    compact = re.sub(r"[^A-Z0-9<>]+", "", (text or "").upper())
    compact = compact.replace(">", "<")
    numeric = r"[0-9OQILZSBG]"
    has_t7 = bool(re.search(rf"<<+{numeric}{{13}}(?:<|$)", compact))
    has_expiry = bool(
        re.search(
            rf"{numeric}{{6}}[0-9A-Z]?[MHF]{numeric}{{6}}[0-9A-Z]?(?:MEX|<)",
            compact,
        )
    )
    return has_t7 and has_expiry


def _ine_needs_adaptive_pass(text: str, document_type: str) -> bool:
    normalized = (text or "").upper()
    if document_type == "cliente_ine_reverso":
        return not _ine_reverse_has_structured_mrz(normalized)
    if document_type == "cliente_ine_frente":
        return "VIGENCIA" not in normalized or "SEXO" not in normalized
    return False


def _ine_reverse_mrz_crop(image: Image.Image) -> Image.Image:
    base = ImageOps.exif_transpose(image)
    if base.height < 4 or base.width < 4:
        return base
    top = max(0, round(base.height * 0.45))
    return base.crop((0, top, base.width, base.height))


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

    # Una foto vertical de INE casi siempre está físicamente a 90°. Resolver la
    # orientación con probes pequeños ANTES del OCR a resolución completa evita
    # gastar un pase caro que luego se descarta.
    if (
        document_type.startswith("cliente_ine_")
        and working.height > working.width * 1.05
    ):
        oriented, degrees = _best_ine_orientation(working, document_type, "")
        if degrees:
            working = oriented

    primary = preprocess_image(working)
    primary_psm = "6" if document_type != "cliente_ine_reverso" else "11"
    primary_text = _primary_ocr_text(primary, document_type, primary_psm)

    primary_orientation_score = _ine_orientation_score(
        primary_text, document_type
    )
    if (
        document_type.startswith("cliente_ine_")
        and _ine_orientation_needs_retry(primary_text, document_type)
        and primary_orientation_score < 6
    ):
        oriented, degrees = _best_ine_orientation(
            working, document_type, primary_text
        )
        if degrees:
            working = oriented
            primary = preprocess_image(working)
            primary_text = _primary_ocr_text(
                primary, document_type, primary_psm
            )

    parts = [primary_text]

    # No duplicar OCR cuando el primer pase ya encontró los campos críticos.
    # En reverso, el fallback se limita a la zona MRZ para ganar precisión y
    # reducir píxeles/latencia; en frente se conserva la imagen completa.
    if document_type.startswith("cliente_ine_") and _ine_needs_adaptive_pass(
        primary_text, document_type
    ):
        adaptive_source = (
            _ine_reverse_mrz_crop(working)
            if document_type == "cliente_ine_reverso"
            else working
        )
        adaptive = adaptive_binary_variant(adaptive_source)
        adaptive_psm = "6" if document_type == "cliente_ine_reverso" else "11"
        parts.append(
            pytesseract.image_to_string(
                adaptive,
                lang="spa+eng",
                config=f"--oem 1 --psm {adaptive_psm} preserve_interword_spaces=1",
            ).strip()
        )

    if document_type == "cliente_ine_frente":
        combined = "\n".join(part for part in parts if part).strip()
        if not _has_readable_ine_validity(combined):
            focused = _ine_front_validity_focus_text(working)
            if focused:
                parts.append(focused)
                combined = "\n".join(part for part in parts if part).strip()

        if not _ine_front_name_block_looks_complete(combined):
            focused_name = _ine_front_name_focus_text(working)
            if focused_name:
                parts.append(focused_name)

    if document_type == "cliente_ine_reverso":
        combined = "\n".join(part for part in parts if part).strip()
        if not _ine_reverse_has_structured_mrz(combined):
            focused_mrz = _ine_reverse_mrz_focus_text(working)
            if focused_mrz:
                parts.append(focused_mrz)

    if document_type == "cliente_estado_cuenta":
        combined = "\n".join(part for part in parts if part).strip()
        if not _has_clabe_like_candidate(combined):
            focused_clabe = _bank_statement_clabe_focus_text(working)
            if focused_clabe:
                parts.append(focused_clabe)

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
            if (
                document_type != "cliente_estado_cuenta"
                or _has_clabe_like_candidate(embedded)
            ):
                return embedded[:MAX_TEXT_CHARS], "embedded_text", embedded_pages

            # Algunos estados de cuenta traen una capa de texto parcial que
            # satisface el umbral general pero omite la tabla donde está CLABE.
            # En ese caso conservamos lo embebido y añadimos OCR de hasta 3 págs.
            ocr_text, ocr_pages = ocr_pdf(data, document_type)
            combined = "\n".join(
                part for part in (embedded, ocr_text) if part
            ).strip()
            return combined[:MAX_TEXT_CHARS], "embedded_text+tesseract", max(
                embedded_pages, ocr_pages
            )

        text, pages = ocr_pdf(data, document_type)
        return text[:MAX_TEXT_CHARS], "tesseract", pages

    if mime in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
        image = Image.open(io.BytesIO(data))
        text = ocr_image(image, document_type)
        return text[:MAX_TEXT_CHARS], "tesseract", 1

    raise HTTPException(status_code=415, detail="unsupported_mime")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "document-ocr", "version": "1.4.0"}


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
