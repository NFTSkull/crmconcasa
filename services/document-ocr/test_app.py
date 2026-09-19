import io

from PIL import Image

from app import (
    enough_embedded_text,
    extract_document_text,
    normalize_mime,
    ocr_image,
    preprocess_image,
)


def test_normalize_mime():
    assert normalize_mime("application/pdf; charset=binary", "x.pdf") == "application/pdf"
    assert normalize_mime("", "x.JPG") == "image/jpeg"


def test_embedded_text_threshold():
    assert enough_embedded_text("CLABE " + "1234567890 " * 10)
    assert not enough_embedded_text("INE")


def test_image_ocr_pipeline_shape(monkeypatch):
    image = Image.new("RGB", (800, 400), "white")
    buf = io.BytesIO()
    image.save(buf, format="JPEG")

    monkeypatch.setattr(
        "app.pytesseract.image_to_string",
        lambda *args, **kwargs: "NOMBRE\nPEREZ\nLOPEZ\nJUAN\nCURP PEPL900101HNLRPN09\nVIGENCIA 2032",
    )
    text, engine, pages = extract_document_text(
        buf.getvalue(), "image/jpeg", "cliente_ine_frente"
    )
    assert "PEPL900101HNLRPN09" in text
    assert engine == "tesseract"
    assert pages == 1


def test_preprocess_scales_small_image():
    image = Image.new("RGB", (600, 300), "white")
    out = preprocess_image(image)
    assert max(out.size) >= 1800


def test_ine_skips_adaptive_pass_when_critical_fields_are_present(monkeypatch):
    image = Image.new("RGB", (900, 600), "white")
    calls = []

    def fake_ocr(*args, **kwargs):
        calls.append(kwargs.get("config", ""))
        return (
            "NOMBRE ZAMUDIO CAMPOS GERARDO\nCURP ZACG900101HNLMPR09\n"
            "SEXO H\nVIGENCIA 2023 2033"
        )

    monkeypatch.setattr("app.pytesseract.image_to_string", fake_ocr)
    text = ocr_image(image, "cliente_ine_frente")

    assert len(calls) == 1
    assert "psm 6" in calls[0]
    assert "SEXO H" in text
    assert "2033" in text


def test_ine_runs_adaptive_pass_only_when_critical_fields_are_missing(monkeypatch):
    image = Image.new("RGB", (900, 600), "white")
    calls = []

    def fake_ocr(*args, **kwargs):
        calls.append(kwargs.get("config", ""))
        return (
            "NOMBRE ZAMUDIO CAMPOS GERARDO\nCURP ZACG900101HNLMPR09"
            if len(calls) == 1
            else "SEXO H\nVIGENCIA\n2023 2033"
        )

    monkeypatch.setattr("app.pytesseract.image_to_string", fake_ocr)
    text = ocr_image(image, "cliente_ine_frente")

    assert len(calls) == 2
    assert "psm 6" in calls[0]
    assert "psm 11" in calls[1]
    assert "SEXO H" in text
    assert "2033" in text


def test_ine_portrait_photo_auto_rotates_before_full_ocr(monkeypatch):
    image = Image.new("RGB", (600, 1000), "white")
    calls = []

    def fake_ocr(img, *args, **kwargs):
        calls.append((img.size, kwargs.get("config", "")))
        if img.width > img.height:
            return (
                "INSTITUTO NACIONAL ELECTORAL\n"
                "NOMBRE\nAYALA\nCAMARILLO\nJUAN PABLO\n"
                "CURP AACJ801018HNLYMN02\nSEXO H\nVIGENCIA 2025-2035"
            )
        return "NOMBRE\nAYALA\nCAMARILLO\nJUAN PABLO\nCURP AACJ801018HNLYMN02"

    monkeypatch.setattr("app.pytesseract.image_to_string", fake_ocr)
    text = ocr_image(image, "cliente_ine_frente")

    assert "VIGENCIA 2025-2035" in text
    assert any(width > height for (width, height), _ in calls)


def test_ine_reverse_portrait_recovers_ocr_marker_after_rotation(monkeypatch):
    image = Image.new("RGB", (600, 1000), "white")

    def fake_ocr(img, *args, **kwargs):
        if img.width > img.height:
            return "IDMEX1234567890\nOCR 0852070785064\nCIC 123456789"
        return "MEXICO"

    monkeypatch.setattr("app.pytesseract.image_to_string", fake_ocr)
    text = ocr_image(image, "cliente_ine_reverso")

    assert "OCR 0852070785064" in text





def test_ine_reverse_skips_adaptive_when_t7_and_expiry_are_already_read(monkeypatch):
    image = Image.new("RGB", (1000, 600), "white")
    calls = []

    def fake_ocr(*args, **kwargs):
        calls.append(kwargs.get("config", ""))
        return (
            "IDMEX2840877688<<2653076233570<\n"
            "8801030M2512311MEX<02<<<<<<<<<<"
        )

    monkeypatch.setattr("app.pytesseract.image_to_string", fake_ocr)
    text = ocr_image(image, "cliente_ine_reverso")

    assert len(calls) == 1
    assert "2653076233570" in text
    assert "251231" in text


def test_non_ine_keeps_single_pass(monkeypatch):
    image = Image.new("RGB", (900, 600), "white")
    calls = []

    def fake_ocr(*args, **kwargs):
        calls.append(kwargs.get("config", ""))
        return "CFE"

    monkeypatch.setattr("app.pytesseract.image_to_string", fake_ocr)
    text = ocr_image(image, "cliente_comprobante_domicilio")

    assert text == "CFE"
    assert len(calls) == 1
