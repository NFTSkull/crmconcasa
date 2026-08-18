import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PARSE_DIRECCION_MX_FIXTURES,
  toParityFields,
} from "./parse-direccion-mx.fixtures.ts";
import { parseDireccionMxParaSolicitud } from "./parse-direccion-mx.ts";

describe("parseDireccionMxParaSolicitud — 18 fixtures", () => {
  for (const fx of PARSE_DIRECCION_MX_FIXTURES) {
    it(fx.id, () => {
      const got = toParityFields(parseDireccionMxParaSolicitud(fx.raw));
      assert.deepEqual(got, fx.expected);
    });
  }

  it("1 confidence: CP/colonia high; interior/lote/manzana none", () => {
    const d = parseDireccionMxParaSolicitud(
      "CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ N.L.",
    );
    assert.equal(d.confidence.codigoPostal, "high");
    assert.equal(d.confidence.colonia, "high");
    assert.equal(d.confidence.numeroInterior, "none");
    assert.equal(d.confidence.lote, "none");
    assert.equal(d.confidence.manzana, "none");
  });

  it("7 noExt alfanumérico confidence high", () => {
    const d = parseDireccionMxParaSolicitud(
      "CALLE PRUEBA 309A COL CENTRO 67250 JUAREZ N.L.",
    );
    assert.equal(d.confidence.numeroExterior, "high");
  });

  it("8 sin CP: codigoPostal none; municipio none", () => {
    const d = parseDireccionMxParaSolicitud("CALLE SOL 10 COL CENTRO N.L.");
    assert.equal(d.confidence.codigoPostal, "none");
    assert.equal(d.confidence.municipio, "none");
  });

  it("9 sin COL: colonia none", () => {
    const d = parseDireccionMxParaSolicitud(
      "CALLE SOL 10 64000 MONTERREY N.L.",
    );
    assert.equal(d.confidence.colonia, "none");
  });

  it("10 sin número: noExt none", () => {
    const d = parseDireccionMxParaSolicitud("DOMICILIO SIN ESTRUCTURA CLARA");
    assert.equal(d.confidence.numeroExterior, "none");
  });

  it("INT etiquetado → noInt high; lote/manzana vacíos", () => {
    const d = parseDireccionMxParaSolicitud(
      "CALLE SOL 10 INT 2 COL CENTRO 64000 MONTERREY N.L.",
    );
    assert.equal(d.confidence.numeroInterior, "high");
    assert.equal(d.lote, "");
    assert.equal(d.manzana, "");
  });

  it("c27 sintético: colonia no absorbe CP/municipio; entidad none", () => {
    const d = parseDireccionMxParaSolicitud(
      "AV SIEMPRE VIVA # 214. COL. LOMAS DEL VALLE APODACA C.P. 66635",
    );
    assert.equal(d.confidence.entidad, "none");
    assert.doesNotMatch(d.colonia, /C\.P|66635|APODACA/i);
  });
});
