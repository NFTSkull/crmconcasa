from __future__ import annotations

import io
import os
import re
import time
import unicodedata
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
    longest = max(img.size)
    if longest > 2600:
        scale = 2600 / max(1, longest)
        img = img.resize(
            (max(1, round(img.width * scale)), max(1, round(img.height * scale))),
            Image.Resampling.LANCZOS,
        )
    elif longest < 1800:
        scale = min(3.0, 1800 / max(1, longest))
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
    if longest > 2800:
        scale = 2800 / max(1, longest)
        base = base.resize(
            (max(1, round(base.width * scale)), max(1, round(base.height * scale))),
            Image.Resampling.LANCZOS,
        )
    elif longest < 2400:
        scale = min(5.0, 2400 / max(1, longest))
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

def _clabe_checksum_valid(value: str) -> bool:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) != 18:
        return False
    weights = (3, 7, 1)
    total = sum((int(digits[idx]) * weights[idx % 3]) % 10 for idx in range(17))
    expected = (10 - (total % 10)) % 10
    return expected == int(digits[17])


def _valid_clabes_in_fragment(fragment: str) -> list[str]:
    source = fragment or ""
    pattern = re.compile(
        r"(?<!\d)(?:\d[\s.\-:/]*){17}\d(?![\s.\-:/]*\d)"
    )
    values: list[str] = []
    for match in pattern.finditer(source):
        digits = re.sub(r"\D", "", match.group(0))
        if len(digits) == 18 and _clabe_checksum_valid(digits) and digits not in values:
            values.append(digits)
    return values


_BANK_CODE_HINTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bBANORTE\b|BANCO\s+MERCANTIL\s+DEL\s+NORTE", re.I), "072"),
    (re.compile(r"\bBANREGIO\b|BANCO\s+REGIONAL", re.I), "058"),
    (re.compile(r"\bBBVA\b|BBVA\s+MEXICO|BBVA\s+BANCOMER", re.I), "012"),
    (re.compile(r"\bSANTANDER\b", re.I), "014"),
    (re.compile(r"\bHSBC\b", re.I), "021"),
    (re.compile(r"\bSCOTIABANK\b|SCOTIABANK\s+INVERLAT", re.I), "044"),
    (re.compile(r"\bBANAMEX\b|\bCITIBANAMEX\b", re.I), "002"),
    (re.compile(r"\bBAJIO\b|BANCO\s+DEL\s+BAJIO", re.I), "030"),
    (re.compile(r"\bINBURSA\b", re.I), "036"),
    (re.compile(r"\bMIFEL\b", re.I), "042"),
    (re.compile(r"\bAFIRME\b", re.I), "062"),
    (re.compile(r"\bAZTECA\b", re.I), "127"),
    (re.compile(r"\bCOMPARTAMOS\b", re.I), "130"),
    (re.compile(r"\bMULTIVA\b", re.I), "132"),
    (re.compile(r"\bACTINVER\b", re.I), "133"),
    (re.compile(r"\bINTERCAM\b", re.I), "136"),
    (re.compile(r"\bBANCOPPEL\b|BANCO\s+COPPEL", re.I), "137"),
    (re.compile(r"\bBBASE\b|BANCO\s+BASE", re.I), "145"),
    (re.compile(r"\bBANCREA\b", re.I), "152"),
    (re.compile(r"\bINVEX\b", re.I), "059"),
    (re.compile(r"\bBANSI\b", re.I), "060"),
)


def _bank_code_hints(text: str) -> list[str]:
    head = unicodedata.normalize("NFD", (text or "").upper())[:2800]
    head = "".join(ch for ch in head if unicodedata.category(ch) != "Mn")
    codes: list[str] = []
    for pattern, code in _BANK_CODE_HINTS:
        if pattern.search(head) and code not in codes:
            codes.append(code)
    return codes


def _strict_labeled_clabe_candidates(text: str) -> list[str]:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    values: list[str] = []

    def add(fragment: str) -> None:
        for value in _valid_clabes_in_fragment(fragment):
            if value not in values:
                values.append(value)

    for idx, line in enumerate(lines):
        label = re.search(r"\bCLABE\b", line, re.I)
        if not label:
            continue

        tail = line[label.end():].strip()
        direct = _valid_clabes_in_fragment(tail)
        if direct:
            for value in direct:
                if value not in values:
                    values.append(value)
            continue

        # Algunos PDF/OCR reordenan columnas y dejan la etiqueta CLABE
        # separada 1–3 renglones del valor visible. Solo ampliamos ese
        # vecindario corto y nos detenemos en el primer nivel con una CLABE
        # válida de 18 dígitos + checksum.
        neighborhood = [tail]
        for offset in range(1, 4):
            if idx + offset >= len(lines):
                break
            neighborhood.append(lines[idx + offset])
            found = _valid_clabes_in_fragment(" ".join(neighborhood))
            if not found:
                continue
            for value in found:
                if value not in values:
                    values.append(value)
            break

    return values


def _reliable_clabe_candidates(text: str) -> list[str]:
    strict = _strict_labeled_clabe_candidates(text)
    bank_codes = _bank_code_hints(text)
    if len(bank_codes) == 1:
        matching = [value for value in strict if value.startswith(bank_codes[0])]
        return matching
    return strict


def _has_clabe_like_candidate(text: str) -> bool:
    return len(_reliable_clabe_candidates(text)) == 1


def _bank_statement_clabe_focus_text(image: Image.Image) -> str:
    """
    Pase reforzado solo después de que las páginas rápidas no encontraron
    una CLABE estructuralmente confiable.

    Primero prueba la página binarizada. Si falla, conserva estructura mediante
    TSV en escala de grises y localiza la etiqueta CLABE. Solo entonces amplía
    una franja corta alrededor/debajo de esa etiqueta para leer los 18 dígitos
    con mayor resolución. Evita volver a OCR toda la hoja a máxima resolución.
    """
    base = ImageOps.exif_transpose(image).convert("RGB")
    focused = adaptive_binary_variant(base)
    primary = pytesseract.image_to_string(
        focused,
        lang="spa+eng",
        config="--oem 1 --psm 11 preserve_interword_spaces=1",
    ).strip()
    if _has_clabe_like_candidate(primary):
        return primary

    gray = preprocess_image(base)
    token_config = "--oem 1 --psm 11 preserve_interword_spaces=1"
    tokens = _ocr_tokens(gray, token_config)
    gray_text = _ocr_tokens_to_text(tokens)
    parts = [part for part in (primary, gray_text) if part]

    combined = "\n".join(parts).strip()
    if _has_clabe_like_candidate(combined):
        return combined

    anchors = []
    for token in tokens:
        normalized = re.sub(r"[^A-Z]", "", str(token.get("text", "")).upper())
        if normalized.startswith("CLAB"):
            anchors.append(token)

    for anchor in anchors[:4]:
        token_left = int(anchor.get("left", 0))
        token_top = int(anchor.get("top", 0))
        token_width = max(1, int(anchor.get("width", 1)))
        token_height = max(1, int(anchor.get("height", 1)))

        left = max(0, token_left - round(gray.width * 0.20))
        right = min(
            gray.width,
            token_left + token_width + round(gray.width * 0.38),
        )
        top = max(0, token_top - token_height * 2)
        bottom = min(gray.height, token_top + token_height * 9)
        if right - left < 20 or bottom - top < 10:
            continue

        region = gray.crop((left, top, right, bottom))
        longest = max(region.size)
        if longest < 2200:
            scale = min(6.0, 2200 / max(1, longest))
            region = region.resize(
                (
                    max(1, round(region.width * scale)),
                    max(1, round(region.height * scale)),
                ),
                Image.Resampling.LANCZOS,
            )
        region = ImageOps.autocontrast(region, cutoff=1)
        region = ImageEnhance.Contrast(region).enhance(1.45)
        region = region.filter(ImageFilter.SHARPEN)

        structured = pytesseract.image_to_string(
            region,
            lang="spa+eng",
            config="--oem 1 --psm 6 preserve_interword_spaces=1",
        ).strip()
        digits = pytesseract.image_to_string(
            region,
            lang="eng",
            config="--oem 1 --psm 6 -c tessedit_char_whitelist=0123456789 ",
        ).strip()

        if structured:
            parts.append(structured)
        if digits:
            # Anclamos explícitamente la microlectura a CLABE para que el parser
            # pueda separar No. de Cuenta (10 dígitos) de la CLABE (18).
            parts.append(f"CLABE {digits}")

        combined = "\n".join(parts).strip()
        if _has_clabe_like_candidate(combined):
            return combined

    return "\n".join(parts).strip()


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
    Pase final del MRZ/T7 con whitelist. Si la credencial ocupa solo una parte
    de la foto, primero la aísla para que los 13 dígitos no se pierdan entre
    fondo/piso/hoja; después limita el OCR a la franja MRZ.

    La primera lectura usa escala de grises/alto contraste. En fotos reales de
    celular la binarización adaptativa puede comerse los signos << o transformar
    dígitos finos; solo se usa como respaldo si la lectura gris no entrega T7.
    """
    card = _ine_card_crop(image)
    crop = _ine_reverse_mrz_crop(card)

    gray = crop.convert("L")
    longest = max(gray.size)
    if longest > 2600:
        scale = 2600 / max(1, longest)
        gray = gray.resize(
            (max(1, round(gray.width * scale)), max(1, round(gray.height * scale))),
            Image.Resampling.LANCZOS,
        )
    elif longest < 2200:
        scale = min(5.0, 2200 / max(1, longest))
        gray = gray.resize(
            (max(1, round(gray.width * scale)), max(1, round(gray.height * scale))),
            Image.Resampling.LANCZOS,
        )
    gray = ImageOps.autocontrast(gray, cutoff=1)
    gray = ImageEnhance.Contrast(gray).enhance(1.45)
    gray = gray.filter(ImageFilter.SHARPEN)

    config_gray = (
        "--oem 1 --psm 11 "
        "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
    )
    gray_text = pytesseract.image_to_string(
        gray,
        lang="eng",
        config=config_gray,
    ).strip()
    if _ine_reverse_has_t7(gray_text):
        return gray_text

    focused = adaptive_binary_variant(crop)
    binary_text = pytesseract.image_to_string(
        focused,
        lang="eng",
        config="--oem 1 --psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
    ).strip()

    return "\n".join(
        part for part in (gray_text, binary_text) if part
    ).strip()


def _ine_vigencia_years(text: str) -> list[int]:
    """Años 20xx anclados al bloque VIGENCIA (no de todo el documento)."""
    normalized = (text or "").upper().replace("O", "0")
    if "VIGENCIA" not in normalized:
        return []
    start = normalized.index("VIGENCIA")
    block = normalized[start : start + 120]
    years: list[int] = []
    for match in re.findall(r"20\d{2}", block):
        year = int(match)
        if 2020 <= year <= 2050 and year not in years:
            years.append(year)
    return years


def _has_readable_ine_validity(text: str) -> bool:
    """Hay al menos un año legible tras VIGENCIA (puede ser incompleto)."""
    return len(_ine_vigencia_years(text)) >= 1


def _needs_ine_validity_enrichment(text: str) -> bool:
    """
    Si el bloque VIGENCIA trae 0 años, o solo 1 (p. ej. OCR leyó 2024 de
    '2024 - 2034' y perdió el final), intentamos un pase/hint focalizado.
    Con 2+ años ya tenemos rango y no hace falta martillar Tesseract.
    """
    return len(_ine_vigencia_years(text)) < 2


def _ine_front_validity_year_hint(image: Image.Image) -> str:
    """
    Último recurso seguro para frentes donde se ve VIGENCIA pero Tesseract
    pierde la etiqueta o parte de los años. Primero intenta reconstruir
    emisión+vigencia desde un recorte amplio. Si eso falla, hace una microlectura
    únicamente del extremo inferior derecho, donde INE imprime VIGENCIA, para
    aceptar un solo año final sin confundir fecha de nacimiento/sección.
    """
    base = ImageOps.exif_transpose(image).convert("L")
    width, height = base.size
    if width < 8 or height < 8:
        return ""

    def prepare(region: Image.Image) -> Image.Image:
        longest = max(region.size)
        if longest > 2600:
            scale = 2600 / max(1, longest)
            region = region.resize(
                (
                    max(1, round(region.width * scale)),
                    max(1, round(region.height * scale)),
                ),
                Image.Resampling.LANCZOS,
            )
        elif longest < 2200:
            scale = min(6.0, 2200 / max(1, longest))
            region = region.resize(
                (
                    max(1, round(region.width * scale)),
                    max(1, round(region.height * scale)),
                ),
                Image.Resampling.LANCZOS,
            )
        region = ImageOps.autocontrast(region, cutoff=1)
        region = ImageEnhance.Contrast(region).enhance(1.55)
        return region.filter(ImageFilter.SHARPEN)

    broad = prepare(
        base.crop(
            (
                round(width * 0.45),
                round(height * 0.50),
                width,
                height,
            )
        )
    )
    raw = pytesseract.image_to_string(
        broad,
        lang="eng",
        config="--oem 1 --psm 11 -c tessedit_char_whitelist=0123456789-/ ",
    )

    years: list[int] = []
    for match in re.findall(r"20\d{2}", raw):
        year = int(match)
        if 2000 <= year <= 2050 and year not in years:
            years.append(year)

    # Caso normal: emisión/inicio + vigencia final.
    for idx, first in enumerate(years[:-1]):
        for second in years[idx + 1:]:
            if (
                2020 <= second <= 2050
                and second >= first
                and second - first <= 15
            ):
                return f"VIGENCIA {first} {second}"

    # Respaldo para credenciales pequeñas en fotos grandes: aislamos solo la
    # celda inferior derecha de VIGENCIA. Aquí un único 20xx es suficientemente
    # específico; no usamos un 20xx único del recorte amplio porque podría ser
    # EMISIÓN.
    tight = prepare(
        base.crop(
            (
                round(width * 0.68),
                round(height * 0.62),
                width,
                height,
            )
        )
    )
    tight_raw = pytesseract.image_to_string(
        tight,
        lang="eng",
        config="--oem 1 --psm 11 -c tessedit_char_whitelist=0123456789-/ ",
    )
    tight_years = []
    for match in re.findall(r"20\d{2}", tight_raw):
        year = int(match)
        if 2020 <= year <= 2050 and year not in tight_years:
            tight_years.append(year)

    if len(tight_years) == 1:
        return f"VIGENCIA {tight_years[0]}"

    # Si el microrecorte trae dos años, el último es la vigencia (año final).
    if len(tight_years) >= 2:
        for first in tight_years[:-1]:
            for second in tight_years[1:]:
                if second >= first and second - first <= 15:
                    return f"VIGENCIA {first} {second}"
        # Sin par válido por delta, devolvemos primer+último del bloque.
        return f"VIGENCIA {tight_years[0]} {tight_years[-1]}"

    return ""


def _ine_front_validity_focus_text(image: Image.Image) -> str:
    """
    Pase dirigido a la zona donde INE imprime VIGENCIA.
    Trabaja sobre copia normalizada; nunca modifica el archivo original.
    """
    base = _ine_card_crop(image).convert("RGB")
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
        if longest > 2600:
            scale = 2600 / max(1, longest)
            gray = gray.resize(
                (max(1, round(gray.width * scale)), max(1, round(gray.height * scale))),
                Image.Resampling.LANCZOS,
            )
        elif longest < 2200:
            scale = min(5.0, 2200 / max(1, longest))
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
        # Con 2 años en el bloque VIGENCIA ya tenemos rango; paramos.
        if not _needs_ine_validity_enrichment("\n".join(parts)):
            break

    combined = "\n".join(parts).strip()
    if _needs_ine_validity_enrichment(combined):
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
        return not re.search(r"\b(?:OCR|0CR|CIC)\b|IDMEX|<<", normalized)
    # No rotar todo el frente solo porque el texto pequeño de VIGENCIA faltó.
    # Si hay marcadores claros de frente, la orientación ya es correcta y se
    # usa el crop focalizado de vigencia.
    return not any(
        marker in normalized
        for marker in ("INSTITUTO", "ELECTORAL", "NOMBRE", "CURP", "DOMICILIO")
    )

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


def _ine_reverse_has_t7(text: str) -> bool:
    compact = re.sub(r"[^A-Z0-9<>]+", "", (text or "").upper())
    compact = compact.replace(">", "<")
    numeric = r"[0-9OQILZSBG]"
    # Cuando OCR parte la primera línea MRZ en varios renglones, al compactar
    # el T7 queda seguido inmediatamente por la segunda línea. IDMEX + 9-12
    # caracteres de documento + << es un anclaje suficiente para aceptar los
    # 13 dígitos sin exigir frontera posterior.
    if re.search(
        rf"(?:[I1T]?DMEX){numeric}{{9,12}}<<+{numeric}{{13}}",
        compact,
    ):
        return True
    return bool(re.search(rf"<<+{numeric}{{13}}(?:<|$)", compact))


def _ine_reverse_has_structured_mrz(text: str) -> bool:
    compact = re.sub(r"[^A-Z0-9<>]+", "", (text or "").upper())
    compact = compact.replace(">", "<")
    numeric = r"[0-9OQILZSBG]"
    has_t7 = bool(
        re.search(
            rf"(?:[I1T]?DMEX){numeric}{{9,12}}<<+{numeric}{{13}}",
            compact,
        )
        or re.search(rf"<<+{numeric}{{13}}(?:<|$)", compact)
    )
    has_expiry = bool(
        re.search(
            rf"{numeric}{{6}}[0-9A-Z]?[MHF]{numeric}{{6}}[0-9A-Z]?(?:MEX|<)",
            compact,
        )
    )
    return has_t7 and has_expiry


def _ine_needs_adaptive_pass(text: str, document_type: str) -> bool:
    if document_type == "cliente_ine_reverso":
        return not _ine_reverse_has_t7(text)
    if document_type == "cliente_ine_frente":
        # También enriquecer cuando solo hay un año (rango incompleto).
        return _needs_ine_validity_enrichment(text)
    return False

def _ine_card_crop(image: Image.Image) -> Image.Image:
    """
    Recorta conservadoramente una credencial pequeña fotografiada sobre una
    superficie grande. Solo acepta rectángulos con proporción cercana a una
    tarjeta y área intermedia; si no hay señal fuerte, conserva la foto completa.
    """
    base = ImageOps.exif_transpose(image).convert("RGB")
    width, height = base.size
    if width < 120 or height < 80:
        return base

    arr = np.array(base)
    longest = max(width, height)
    scale = min(1.0, 1400 / max(1, longest))
    if scale < 1.0:
        small = cv2.resize(
            arr,
            (max(1, round(width * scale)), max(1, round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    else:
        small = arr

    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape
    masks: list[np.ndarray] = []

    _, otsu = cv2.threshold(
        gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
    )
    _, otsu_inv = cv2.threshold(
        gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )
    masks.extend((otsu, otsu_inv))

    for percentile in (60, 70, 80):
        threshold = float(np.percentile(gray, percentile))
        masks.append((gray >= threshold).astype(np.uint8) * 255)
        masks.append((gray <= threshold).astype(np.uint8) * 255)

    kernel_size = max(5, round(min(h, w) * 0.018))
    if kernel_size % 2 == 0:
        kernel_size += 1
    kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT, (kernel_size, kernel_size)
    )

    best: tuple[float, tuple[int, int, int, int]] | None = None
    frame_area = max(1, w * h)

    for mask in masks:
        closed = cv2.morphologyEx(
            mask, cv2.MORPH_CLOSE, kernel, iterations=2
        )
        contours, _ = cv2.findContours(
            closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        for contour in contours:
            x, y, box_w, box_h = cv2.boundingRect(contour)
            if box_w <= 0 or box_h <= 0:
                continue

            box_area = box_w * box_h
            area_ratio = box_area / frame_area
            aspect = max(box_w, box_h) / max(1, min(box_w, box_h))
            fill = cv2.contourArea(contour) / max(1, box_area)
            if not (
                0.06 <= area_ratio <= 0.62
                and 1.28 <= aspect <= 1.90
                and fill >= 0.52
            ):
                continue

            touches = sum(
                (
                    x <= 2,
                    y <= 2,
                    x + box_w >= w - 2,
                    y + box_h >= h - 2,
                )
            )
            if touches >= 2:
                continue

            score = (
                area_ratio * fill
                - abs(aspect - 1.58) * 0.04
                - touches * 0.02
            )
            if best is None or score > best[0]:
                best = (score, (x, y, box_w, box_h))

    if best is None:
        return base

    _, (x, y, box_w, box_h) = best
    inv = 1.0 / max(scale, 1e-9)
    margin_x = box_w * 0.04
    margin_y = box_h * 0.04
    left = max(0, round((x - margin_x) * inv))
    top = max(0, round((y - margin_y) * inv))
    right = min(width, round((x + box_w + margin_x) * inv))
    bottom = min(height, round((y + box_h + margin_y) * inv))

    if right - left < 80 or bottom - top < 50:
        return base
    return base.crop((left, top, right, bottom))


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

    # Una credencial físicamente vertical solo necesita probar 90/270.
    # Una ya horizontal únicamente puede estar al revés (180). Evitamos tres
    # Tesseract probes por caso.
    candidates = (90, 270) if base.height > base.width * 1.05 else (180,)

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
        if score >= 10:
            break

    if best_degrees == 0:
        return base, 0
    return base.rotate(best_degrees, expand=True), best_degrees

def ocr_image(image: Image.Image, document_type: str) -> str:
    working = ImageOps.exif_transpose(image)

    if document_type.startswith("cliente_ine_"):
        # Fotos de celular suelen incluir mucha mesa/pared/sombra alrededor de
        # la credencial. Aislamos primero la tarjeta para dedicar la resolución
        # OCR a sus textos pequeños (VIGENCIA y MRZ/T7).
        working = _ine_card_crop(working)

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

    # Solo corregimos orientación si la lectura parece realmente girada, no
    # simplemente porque falte un campo pequeño.
    if (
        document_type.startswith("cliente_ine_")
        and _ine_orientation_needs_retry(primary_text, document_type)
        and _ine_orientation_score(primary_text, document_type) < 5
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

    if document_type == "cliente_ine_frente":
        combined = "\n".join(part for part in parts if part).strip()
        # Con un solo año tras VIGENCIA (p. ej. "2024" de "2024 - 2034")
        # todavía intentamos el pase focalizado para recuperar el año final.
        if _needs_ine_validity_enrichment(combined):
            focused = _ine_front_validity_focus_text(working)
            if focused:
                parts.append(focused)

    if document_type == "cliente_ine_reverso":
        combined = "\n".join(part for part in parts if part).strip()
        if not _ine_reverse_has_t7(combined):
            focused_mrz = _ine_reverse_mrz_focus_text(working)
            if focused_mrz:
                parts.append(focused_mrz)

    return "\n".join(part for part in parts if part).strip()

def render_pdf_page(page: fitz.Page, dpi: int = 300) -> Image.Image:
    zoom = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    return Image.open(io.BytesIO(pix.tobytes("png")))


def ocr_pdf(data: bytes, document_type: str) -> tuple[str, int]:
    doc = fitz.open(stream=data, filetype="pdf")
    max_pages = 2 if document_type.startswith("cliente_ine_") else min(3, len(doc))

    if document_type == "cliente_estado_cuenta":
        parts: list[str] = []
        processed = 0

        # Primera pasada: una sola lectura por página y corte temprano.
        for idx in range(min(len(doc), max_pages)):
            image = render_pdf_page(doc[idx], dpi=260)
            page_text = ocr_image(image, document_type)
            parts.append(page_text)
            processed = idx + 1
            combined = "\n".join(part for part in parts if part).strip()
            if _has_clabe_like_candidate(combined):
                return combined, processed

        # Solo si ninguna página rápida fue suficiente hacemos el OCR reforzado.
        for idx in range(min(len(doc), max_pages)):
            image = render_pdf_page(doc[idx], dpi=260)
            focused = _bank_statement_clabe_focus_text(image)
            if focused:
                parts.append(focused)
            combined = "\n".join(part for part in parts if part).strip()
            if _has_clabe_like_candidate(combined):
                return combined, max(processed, idx + 1)

        return "\n".join(part for part in parts if part).strip(), processed

    parts: list[str] = []
    for idx in range(min(len(doc), max_pages)):
        parts.append(ocr_image(render_pdf_page(doc[idx]), document_type))
    return "\n".join(parts).strip(), min(len(doc), max_pages)

def extract_document_text(data: bytes, mime: str, document_type: str) -> tuple[str, str, int]:
    if mime in {"application/pdf", "application/x-pdf"}:
        embedded, embedded_pages = extract_embedded_pdf_text(
            data,
            max_pages=3 if document_type == "cliente_estado_cuenta" else 4,
        )
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
        if (
            document_type == "cliente_estado_cuenta"
            and not _has_clabe_like_candidate(text)
        ):
            focused = _bank_statement_clabe_focus_text(image)
            if focused:
                text = "\n".join(part for part in (text, focused) if part)
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
