import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNombrePersonaMx } from "./parse-nombre-persona-mx.ts";

describe("parseNombrePersonaMx", () => {
  it("3 tokens: RUBEN CASTRO QUIÑONES", () => {
    const p = parseNombrePersonaMx("RUBEN CASTRO QUIÑONES");
    assert.equal(p.parsed, true);
    assert.equal(p.confidence, "high");
    assert.equal(p.nombres, "RUBEN");
    assert.equal(p.apellidoPaterno, "CASTRO");
    assert.equal(p.apellidoMaterno, "QUIÑONES");
  });

  it("4 tokens: DEBANHI ABIGAIL CASTRO JUAREZ", () => {
    const p = parseNombrePersonaMx("DEBANHI ABIGAIL CASTRO JUAREZ");
    assert.equal(p.parsed, true);
    assert.equal(p.nombres, "DEBANHI ABIGAIL");
    assert.equal(p.apellidoPaterno, "CASTRO");
    assert.equal(p.apellidoMaterno, "JUAREZ");
  });

  it("4 tokens: MAYRA ELIZABETH JUAREZ CASTAÑEDA", () => {
    const p = parseNombrePersonaMx("MAYRA ELIZABETH JUAREZ CASTAÑEDA");
    assert.equal(p.parsed, true);
    assert.equal(p.nombres, "MAYRA ELIZABETH");
    assert.equal(p.apellidoPaterno, "JUAREZ");
    assert.equal(p.apellidoMaterno, "CASTAÑEDA");
  });

  it("NALLELY BERENICE CASTRO JUAREZ", () => {
    const p = parseNombrePersonaMx("NALLELY BERENICE CASTRO JUAREZ");
    assert.equal(p.nombres, "NALLELY BERENICE");
    assert.equal(p.apellidoPaterno, "CASTRO");
    assert.equal(p.apellidoMaterno, "JUAREZ");
  });

  it("conserva partículas DE LA en apellido paterno", () => {
    const p = parseNombrePersonaMx("JUAN DE LA CRUZ PEREZ");
    assert.equal(p.parsed, true);
    assert.equal(p.nombres, "JUAN");
    assert.equal(p.apellidoPaterno, "DE LA CRUZ");
    assert.equal(p.apellidoMaterno, "PEREZ");
  });

  it("5 tokens con DEL en nombres: MARIA DEL CARMEN LOPEZ HERNANDEZ", () => {
    const p = parseNombrePersonaMx("MARIA DEL CARMEN LOPEZ HERNANDEZ");
    assert.equal(p.parsed, true);
    assert.equal(p.nombres, "MARIA DEL CARMEN");
    assert.equal(p.apellidoPaterno, "LOPEZ");
    assert.equal(p.apellidoMaterno, "HERNANDEZ");
  });

  it("normaliza espacios y uppercase sin perder Ñ", () => {
    const p = parseNombrePersonaMx("  ruben   castro   quiñones  ");
    assert.equal(p.nombres, "RUBEN");
    assert.equal(p.apellidoPaterno, "CASTRO");
    assert.equal(p.apellidoMaterno, "QUIÑONES");
  });

  it("2 tokens: no inventa apellido", () => {
    const p = parseNombrePersonaMx("JOSE PEREZ");
    assert.equal(p.parsed, false);
    assert.equal(p.confidence, "none");
    assert.equal(p.nombres, "JOSE PEREZ");
    assert.equal(p.apellidoPaterno, "");
    assert.equal(p.apellidoMaterno, "");
  });

  it("1 token: nombre completo en NOMBRE(S)", () => {
    const p = parseNombrePersonaMx("RUBEN");
    assert.equal(p.parsed, false);
    assert.equal(p.nombres, "RUBEN");
    assert.equal(p.apellidoPaterno, "");
  });

  it("vacío", () => {
    const p = parseNombrePersonaMx("   ");
    assert.equal(p.parsed, false);
    assert.equal(p.nombres, "");
  });

  it("partícula DE: 5 tokens high", () => {
    const p = parseNombrePersonaMx("ANA MARIA DE LEON GARCIA");
    assert.equal(p.confidence, "high");
    assert.equal(p.nombres, "ANA MARIA");
    assert.equal(p.apellidoPaterno, "DE LEON");
    assert.equal(p.apellidoMaterno, "GARCIA");
  });

  it("partícula DEL: 4 tokens → none (ambiguo con nombre compuesto)", () => {
    const p = parseNombrePersonaMx("MARIA DEL CARMEN LOPEZ");
    assert.equal(p.confidence, "none");
    assert.equal(p.nombres, "MARIA DEL CARMEN LOPEZ");
    assert.equal(p.apellidoPaterno, "");
    assert.equal(p.apellidoMaterno, "");
  });

  it("partícula DE LA: 5 tokens high", () => {
    const p = parseNombrePersonaMx("JUAN DE LA CRUZ PEREZ");
    assert.equal(p.confidence, "high");
    assert.equal(p.apellidoPaterno, "DE LA CRUZ");
  });

  it("partícula DE LAS: 5 tokens high", () => {
    const p = parseNombrePersonaMx("ANA DE LAS CASAS RUIZ");
    assert.equal(p.confidence, "high");
    assert.equal(p.nombres, "ANA");
    assert.equal(p.apellidoPaterno, "DE LAS CASAS");
    assert.equal(p.apellidoMaterno, "RUIZ");
  });

  it("partícula DE LOS: 5 tokens high", () => {
    const p = parseNombrePersonaMx("LUIS DE LOS SANTOS MORA");
    assert.equal(p.confidence, "high");
    assert.equal(p.apellidoPaterno, "DE LOS SANTOS");
  });

  it("partícula LA/LAS/LOS en 4 tokens → none", () => {
    assert.equal(parseNombrePersonaMx("ROSA LA MADRID").confidence, "none");
    assert.equal(parseNombrePersonaMx("ANA LAS ROSAS").confidence, "none");
    assert.equal(parseNombrePersonaMx("JUAN LOS PINOS").confidence, "none");
  });

  it("partícula SAN 4 tokens → none; 5 tokens high", () => {
    const four = parseNombrePersonaMx("JOSE SAN JUAN PEREZ");
    assert.equal(four.confidence, "none");
    const five = parseNombrePersonaMx("JOSE LUIS SAN JUAN PEREZ");
    assert.equal(five.confidence, "high");
    assert.equal(five.apellidoPaterno, "SAN JUAN");
  });

  it("partícula SANTA 4 tokens → none", () => {
    const p = parseNombrePersonaMx("PEDRO SANTA CRUZ");
    assert.equal(p.confidence, "none");
    assert.equal(p.nombres, "PEDRO SANTA CRUZ");
  });
});
