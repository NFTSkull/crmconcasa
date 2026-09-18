import io

from PIL import Image

from app import (
    enough_embedded_text,
    extract_document_text,
    normalize_mime,
    ocr_image,
    orient_ine_image,
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


def test_ine_runs_second_adaptive_sparse_pass(monkeypatch):
    image = Image.new("RGB", (900, 600), "white")
    calls = []

    def fake_ocr(*args, **kwargs):
        calls.append(kwargs.get("config", ""))
        return "NOMBRE ZAMUDIO CAMPOS GERARDO" if len(calls) == 1 else "SEXO H\nVIGENCIA\n2023 2033"

    monkeypatch.setattr("app.orient_ine_image", lambda source, document_type: source)
    monkeypatch.setattr("app.pytesseract.image_to_string", fake_ocr)
    text = ocr_image(image, "cliente_ine_frente")

    assert len(calls) == 2
    assert "psm 6" in calls[0]
    assert "psm 11" in calls[1]
    assert "SEXO H" in text
    assert "2033" in text


def test_ine_orientation_keeps_upright_image_with_fast_exit(monkeypatch):
    image = Image.new("RGB", (900, 600), "white")
    calls = []

    def fake_ocr(probe, *args, **kwargs):
        calls.append(probe.size)
        return "INSTITUTO NACIONAL ELECTORAL NOMBRE CURP VIGENCIA"

    monkeypatch.setattr("app.pytesseract.image_to_string", fake_ocr)
    out = orient_ine_image(image, "cliente_ine_frente")

    assert out.size == image.size
    assert len(calls) == 1


def test_ine_orientation_recovers_physically_rotated_image(monkeypatch):
    image = Image.new("RGB", (900, 600), "white")
    calls = []

    def fake_ocr(probe, *args, **kwargs):
        calls.append(probe.size)
        if probe.height > probe.width:
            return "INSTITUTO NACIONAL ELECTORAL NOMBRE CURP VIGENCIA"
        return "ruido"

    monkeypatch.setattr("app.pytesseract.image_to_string", fake_ocr)
    out = orient_ine_image(image, "cliente_ine_frente")

    assert out.height > out.width
    assert len(calls) == 4


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
