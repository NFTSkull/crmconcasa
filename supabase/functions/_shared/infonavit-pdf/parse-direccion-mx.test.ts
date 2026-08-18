import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDireccionMxParaSolicitud } from "./parse-direccion-mx.ts";

describe("parseDireccionMxParaSolicitud — 10+ fixtures", () => {
  it("1 COL + CP + N.L.", () => {
    const d = parseDireccionMxParaSolicitud(
      "CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ N.L.",
    );
    assert.equal(d.codigoPostal, "67250");
    assert.equal(d.municipio, "JUAREZ");
    assert.equal(d.entidad, "NUEVO LEÓN");
    assert.equal(d.colonia, "CENTRO");
    assert.equal(d.numeroExterior, "309");
    assert.equal(d.calle, "CALLE PRUEBA");
    assert.equal(d.confidence.codigoPostal, "high");
    assert.equal(d.confidence.colonia, "high");
    assert.equal(d.confidence.numeroInterior, "none");
    assert.equal(d.confidence.lote, "none");
    assert.equal(d.confidence.manzana, "none");
  });

  it("2 COL. + coma + N.L. (patrón real sintético)", () => {
    const d = parseDireccionMxParaSolicitud(
      "C CERRO DEL TEPEYAC 309 COL. CERRO DE LA SILLA 67250 JUAREZ, N.L.",
    );
    assert.equal(d.calle, "C CERRO DEL TEPEYAC");
    assert.equal(d.numeroExterior, "309");
    assert.equal(d.colonia, "CERRO DE LA SILLA");
    assert.equal(d.codigoPostal, "67250");
    assert.equal(d.municipio, "JUAREZ");
    assert.equal(d.entidad, "NUEVO LEÓN");
    assert.equal(d.numeroInterior, "");
    assert.equal(d.lote, "");
    assert.equal(d.manzana, "");
  });

  it("3 COLONIA + NUEVO LEON", () => {
    const d = parseDireccionMxParaSolicitud(
      "AV REFORMA 100 COLONIA CENTRO 64000 MONTERREY NUEVO LEON",
    );
    assert.equal(d.colonia, "CENTRO");
    assert.equal(d.entidad, "NUEVO LEÓN");
    assert.equal(d.codigoPostal, "64000");
    assert.equal(d.municipio, "MONTERREY");
  });

  it("4 NUEVO LEÓN con acento", () => {
    const d = parseDireccionMxParaSolicitud(
      "CALLE SOL 10 COL CENTRO 64000 MONTERREY NUEVO LEÓN",
    );
    assert.equal(d.entidad, "NUEVO LEÓN");
  });

  it("5 NL sin puntos", () => {
    const d = parseDireccionMxParaSolicitud(
      "CALLE SOL 10 COL CENTRO 64000 MONTERREY NL",
    );
    assert.equal(d.entidad, "NUEVO LEÓN");
    assert.equal(d.colonia, "CENTRO");
  });

  it("6 sin coma", () => {
    const d = parseDireccionMxParaSolicitud(
      "C LOMA DEL TESORO 100 COL. LOMAS DEL SUR 64000 MONTERREY N.L.",
    );
    assert.equal(d.municipio, "MONTERREY");
    assert.equal(d.colonia, "LOMAS DEL SUR");
  });

  it("7 número exterior alfanumérico 309A", () => {
    const d = parseDireccionMxParaSolicitud(
      "CALLE PRUEBA 309A COL CENTRO 67250 JUAREZ N.L.",
    );
    assert.equal(d.numeroExterior, "309A");
    assert.equal(d.confidence.numeroExterior, "high");
    assert.equal(d.calle, "CALLE PRUEBA");
  });

  it("8 domicilio sin CP: colonia vía N.L., sin inventar municipio si no hay resto", () => {
    const d = parseDireccionMxParaSolicitud(
      "CALLE SOL 10 COL CENTRO N.L.",
    );
    assert.equal(d.codigoPostal, "");
    assert.equal(d.confidence.codigoPostal, "none");
    assert.equal(d.colonia, "CENTRO");
    assert.equal(d.entidad, "NUEVO LEÓN");
    assert.equal(d.calle, "CALLE SOL");
    assert.equal(d.numeroExterior, "10");
    assert.equal(d.municipio, "");
    assert.equal(d.confidence.municipio, "none");
  });

  it("9 sin COL: no inventa colonia", () => {
    const d = parseDireccionMxParaSolicitud(
      "CALLE SOL 10 64000 MONTERREY N.L.",
    );
    assert.equal(d.colonia, "");
    assert.equal(d.confidence.colonia, "none");
    assert.equal(d.codigoPostal, "64000");
    assert.equal(d.entidad, "NUEVO LEÓN");
    assert.equal(d.municipio, "MONTERREY");
    assert.equal(d.numeroExterior, "10");
  });

  it("10 sin número: calle = resto, noExt none", () => {
    const d = parseDireccionMxParaSolicitud("DOMICILIO SIN ESTRUCTURA CLARA");
    assert.equal(d.direccionCompleta, "DOMICILIO SIN ESTRUCTURA CLARA");
    assert.ok(d.calle.length > 0);
    assert.equal(d.numeroExterior, "");
    assert.equal(d.confidence.numeroExterior, "none");
  });

  it("INT etiquetado → noInt high; lote/manzana vacíos", () => {
    const d = parseDireccionMxParaSolicitud(
      "CALLE SOL 10 INT 2 COL CENTRO 64000 MONTERREY N.L.",
    );
    assert.equal(d.numeroInterior, "2");
    assert.equal(d.confidence.numeroInterior, "high");
    assert.equal(d.lote, "");
    assert.equal(d.manzana, "");
  });

  it("vacío no inventa domicilio", () => {
    const d = parseDireccionMxParaSolicitud("  ");
    assert.equal(d.direccionCompleta, "");
    assert.equal(d.calle, "");
  });
});
