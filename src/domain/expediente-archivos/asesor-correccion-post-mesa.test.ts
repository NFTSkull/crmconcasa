import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asesorDebeUsarCorreccionClienteDatos,
  asesorDebeUsarCorreccionDocumento,
  asesorDocumentoUploadMode,
  asesorPuedeCorregirDocumentoRechazado,
  asesorPuedeEditarClienteDatos,
  asesorPuedeSubirDocumentoPreMesa,
  asesorPuedeSubirOCorregirDocumento,
} from "./asesor-correccion-post-mesa";

describe("asesor corrección post-Mesa (helpers UI)", () => {
  it("pre-Mesa permite upload normal de cualquier documento", () => {
    assert.equal(asesorPuedeSubirDocumentoPreMesa(false), true);
    assert.equal(asesorDocumentoUploadMode(false, "subido"), "normal");
    assert.equal(asesorPuedeSubirOCorregirDocumento(false, "validado"), true);
    assert.equal(asesorDebeUsarCorreccionDocumento(false, "rechazado"), false);
  });

  it("post-envío solo permite upload en documentos rechazados", () => {
    assert.equal(asesorPuedeSubirDocumentoPreMesa(true), false);
    assert.equal(asesorPuedeCorregirDocumentoRechazado(true, "rechazado"), true);
    assert.equal(asesorPuedeCorregirDocumentoRechazado(true, "validado"), false);
    assert.equal(asesorPuedeCorregirDocumentoRechazado(true, "subido"), false);
    assert.equal(asesorPuedeCorregirDocumentoRechazado(true, "resubido"), false);
    assert.equal(asesorPuedeSubirOCorregirDocumento(true, "rechazado"), true);
    assert.equal(asesorPuedeSubirOCorregirDocumento(true, "subido"), false);
    assert.equal(asesorDocumentoUploadMode(true, "rechazado"), "correccion");
    assert.equal(asesorDocumentoUploadMode(true, "validado"), null);
  });

  it("datos generales editables solo si rechazados post-envío", () => {
    assert.equal(asesorPuedeEditarClienteDatos(false, "completo"), true);
    assert.equal(asesorPuedeEditarClienteDatos(true, "completo"), false);
    assert.equal(asesorPuedeEditarClienteDatos(true, "validado"), false);
    assert.equal(asesorPuedeEditarClienteDatos(true, "rechazado"), true);
    assert.equal(asesorDebeUsarCorreccionClienteDatos(true, "rechazado"), true);
    assert.equal(asesorDebeUsarCorreccionClienteDatos(true, "completo"), false);
  });
});
