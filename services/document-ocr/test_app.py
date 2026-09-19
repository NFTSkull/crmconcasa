import io

from PIL import Image

from app import (
    enough_embedded_text,
    extract_document_text,
    normalize_mime,
    ocr_image,
    preprocess_image,
    _verify_t7_trailing_digit,
    _ine_front_validity_focus_text,
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

    def fake_probe(img, *args, **kwargs):
        if img.width > img.height:
            return "IDMEX1234567890<<0852070785064"
        return "MEXICO"

    def fake_primary(img, document_type, psm):
        assert document_type == "cliente_ine_reverso"
        if img.width > img.height:
            return "IDMEX1234567890<<0852070785064\n8410308H3312315MEX"
        return "MEXICO"

    monkeypatch.setattr("app.pytesseract.image_to_string", fake_probe)
    monkeypatch.setattr("app._primary_ocr_text", fake_primary)
    text = ocr_image(image, "cliente_ine_reverso")

    assert "0852070785064" in text





def test_ine_reverse_skips_adaptive_when_t7_and_expiry_are_already_read(monkeypatch):
    image = Image.new("RGB", (1000, 600), "white")
    calls = []

    def fake_primary(*args, **kwargs):
        calls.append("primary")
        return (
            "IDMEX2840877688<<2653076233570<\n"
            "8801030M2512311MEX<02<<<<<<<<<<"
        )

    monkeypatch.setattr("app._primary_ocr_text", fake_primary)
    text = ocr_image(image, "cliente_ine_reverso")

    assert calls == ["primary"]
    assert "2653076233570" in text
    assert "251231" in text


def test_t7_microread_corrects_only_trailing_digit_when_two_variants_agree(monkeypatch):
    image = Image.new("L", (1200, 220), "white")
    tokens = [
        {
            "text": "IDMEX1788034184<<2732122056445",
            "conf": 46.0,
            "left": 80,
            "top": 60,
            "width": 1000,
            "height": 90,
            "line_key": (1, 1, 1, 1),
        }
    ]
    reads = iter(["3", "3"])

    monkeypatch.setattr(
        "app.pytesseract.image_to_string",
        lambda *args, **kwargs: next(reads),
    )

    _verify_t7_trailing_digit(image, tokens)

    assert tokens[0]["text"].endswith("2732122056443")


def test_t7_microread_keeps_original_when_verifiers_disagree(monkeypatch):
    image = Image.new("L", (1200, 220), "white")
    tokens = [
        {
            "text": "IDMEX1788034184<<2732122056445",
            "conf": 46.0,
            "left": 80,
            "top": 60,
            "width": 1000,
            "height": 90,
            "line_key": (1, 1, 1, 1),
        }
    ]
    reads = iter(["3", "5"])

    monkeypatch.setattr(
        "app.pytesseract.image_to_string",
        lambda *args, **kwargs: next(reads),
    )

    _verify_t7_trailing_digit(image, tokens)

    assert tokens[0]["text"].endswith("2732122056445")


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


def test_ine_front_runs_focused_validity_pass_when_general_ocr_misses_year(monkeypatch):
    image = Image.new("RGB", (1000, 630), "white")
    calls = []

    def fake_ocr(*args, **kwargs):
        calls.append(kwargs.get("config", ""))
        return "INSTITUTO NACIONAL ELECTORAL\nNOMBRE PRUEBA\nCURP ABCD000000HNLRRR00\nVIGENCIA"

    monkeypatch.setattr("app.pytesseract.image_to_string", fake_ocr)
    monkeypatch.setattr(
        "app._ine_front_validity_focus_text",
        lambda source: "VIGENCIA 2016 - 2026",
    )

    text = ocr_image(image, "cliente_ine_frente")

    assert "VIGENCIA 2016 - 2026" in text
    assert len(calls) >= 2


def test_ine_front_skips_focused_pass_when_year_is_already_readable(monkeypatch):
    image = Image.new("RGB", (1000, 630), "white")

    monkeypatch.setattr(
        "app.pytesseract.image_to_string",
        lambda *args, **kwargs: "SEXO H\nVIGENCIA 2016 - 2026",
    )

    def unexpected_focus(*args, **kwargs):
        raise AssertionError("focused pass should not run")

    monkeypatch.setattr("app._ine_front_validity_focus_text", unexpected_focus)

    text = ocr_image(image, "cliente_ine_frente")
    assert "2026" in text


def test_ine_validity_focus_recovers_two_years_when_label_pass_misses_numbers(monkeypatch):
    image = Image.new("RGB", (1200, 760), "white")
    reads = iter([
        "VIGENCIA",
        "SECCION 2157",
        "1991 03 2023 2033",
    ])

    monkeypatch.setattr(
        "app.pytesseract.image_to_string",
        lambda *args, **kwargs: next(reads),
    )

    text = _ine_front_validity_focus_text(image)

    assert "VIGENCIA 2023 2033" in text
