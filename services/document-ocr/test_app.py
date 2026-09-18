import io

from PIL import Image

from app import enough_embedded_text, extract_document_text, normalize_mime, preprocess_image


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
