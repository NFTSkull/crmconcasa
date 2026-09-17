import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRfc,
  rfcShape,
  selectEstadoCuentaRfc,
  resolveFiscalRfc,
} from "./rfc";

const CLIENT = "JUAN PEREZ GARCIA";

test("normaliza RFC sin alterar Ñ/&", () => {
  assert.equal(normalizeRfc(" abcd-010101-9a1 "), "ABCD0101019A1");
  assert.equal(rfcShape("ABCD0101019A1"), "full13");
  assert.equal(rfcShape("ABCD010101"), "base10");
});

test("Bansefi sin homoclave + EDC completo con misma base usa EDC", () => {
  const edc = selectEstadoCuentaRfc({
    text: "TITULAR JUAN PEREZ GARCIA RFC: ABCD0101019A1 CLABE 012345678901234567",
    rfcInfonavit: "ABCD010101",
    clienteNombre: CLIENT,
  });
  const r = resolveFiscalRfc({ rfcInfonavit: "ABCD010101", estadoCuenta: edc });
  assert.equal(edc.rfc, "ABCD0101019A1");
  assert.equal(r.status, "ready_for_sat");
  assert.equal(r.fiscalRfc, "ABCD0101019A1");
  assert.equal(r.infonavitRelation, "base_match_missing_homoclave");
});

test("RFC completo Bansefi y EDC iguales marca exact", () => {
  const edc = selectEstadoCuentaRfc({
    text: "CLIENTE JUAN PEREZ GARCIA RFC ABCD0101019A1",
    rfcInfonavit: "ABCD0101019A1",
    clienteNombre: CLIENT,
  });
  const r = resolveFiscalRfc({ rfcInfonavit: "ABCD0101019A1", estadoCuenta: edc });
  assert.equal(r.infonavitRelation, "exact");
});

test("si Bansefi completo difiere, EDC sigue siendo candidato fiscal y registra diferencia", () => {
  const edc = selectEstadoCuentaRfc({
    text: "TITULAR JUAN PEREZ GARCIA RFC: WXYZ020202ABC CLABE 012345678901234567",
    rfcInfonavit: "ABCD0101019A1",
    clienteNombre: CLIENT,
  });
  const r = resolveFiscalRfc({ rfcInfonavit: "ABCD0101019A1", estadoCuenta: edc });
  assert.equal(r.fiscalRfc, "WXYZ020202ABC");
  assert.equal(r.infonavitRelation, "different");
  assert.equal(r.status, "ready_for_sat");
});

test("si DG difiere del EDC, exige actualización solo después de SAT PASS", () => {
  const edc = selectEstadoCuentaRfc({
    text: "RFC DEL CLIENTE: WXYZ020202ABC NOMBRE JUAN PEREZ GARCIA",
    rfcDatosGenerales: "ABCD0101019A1",
    clienteNombre: CLIENT,
  });
  const r = resolveFiscalRfc({
    rfcDatosGenerales: "ABCD0101019A1",
    estadoCuenta: edc,
  });
  assert.equal(r.fiscalRfc, "WXYZ020202ABC");
  assert.equal(r.datosGeneralesRelation, "different");
  assert.equal(r.shouldUpdateDatosGeneralesAfterSatPass, true);
});

test("descarta RFC del banco si existe candidato del titular con contexto fuerte", () => {
  const edc = selectEstadoCuentaRfc({
    text: [
      "BANCO EJEMPLO SA RFC DEL BANCO BANC010101AAA",
      "TITULAR JUAN PEREZ GARCIA RFC: ABCD0101019A1 CLABE 012345678901234567",
    ].join(" | "),
    rfcInfonavit: "ABCD010101",
    clienteNombre: CLIENT,
  });
  assert.equal(edc.status, "selected");
  assert.equal(edc.rfc, "ABCD0101019A1");
});

test("dos candidatos sin contexto suficiente quedan UNKNOWN, nunca rechazo", () => {
  const edc = selectEstadoCuentaRfc({
    text: "REFERENCIAS ABCD0101019A1 WXYZ020202ABC",
  });
  assert.equal(edc.status, "unknown");
  assert.equal(edc.reason, "ambiguous_candidates");
});

test("PDF sin RFC completo queda UNKNOWN", () => {
  const edc = selectEstadoCuentaRfc({
    text: "ESTADO DE CUENTA SIN CAPA FISCAL. CLIENTE JUAN PEREZ.",
    rfcInfonavit: "ABCD010101",
  });
  const r = resolveFiscalRfc({ rfcInfonavit: "ABCD010101", estadoCuenta: edc });
  assert.equal(edc.status, "unknown");
  assert.equal(r.status, "unknown");
});
