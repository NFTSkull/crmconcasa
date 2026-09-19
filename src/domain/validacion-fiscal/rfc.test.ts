import test from "node:test";
import assert from "node:assert/strict";
import {
  curpRfcBase10,
  extractEstadoCuentaRfcCandidates,
  normalizeRfc,
  rfcShape,
  selectEstadoCuentaRfc,
  resolveFiscalRfc,
} from "./rfc";

const CLIENT = "JUAN PEREZ GARCIA";
const CURP_BADD = "BADD900101HDFMLN03";
const CURP_CADD = "CADD910202MDFPRN04";

test("normaliza RFC sin alterar Ñ/&", () => {
  assert.equal(normalizeRfc(" abcd-010101-9a1 "), "ABCD0101019A1");
  assert.equal(rfcShape("ABCD0101019A1"), "full13");
  assert.equal(rfcShape("ABCD010101"), "base10");
});

test("deriva base RFC solo desde CURP localmente válida", () => {
  assert.equal(curpRfcBase10(CURP_BADD), "BADD900101");
  assert.equal(curpRfcBase10("CURP-MAL"), null);
  assert.equal(curpRfcBase10(`${CURP_BADD.slice(0, 17)}9`), null);
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

test("DG vacío + RFC banco + RFC titular usa CURP validada para elegir al titular", () => {
  const edc = selectEstadoCuentaRfc({
    text: [
      "BANCO EJEMPLO RFC DEL BANCO BANC991231AAA",
      "TITULAR JUAN PEREZ GARCIA RFC BADD9001019A1",
      "CLABE 012345678901234567",
    ].join(" | "),
    curpValidadaLocalmente: CURP_BADD,
    clienteNombre: CLIENT,
  });
  assert.equal(edc.status, "selected");
  assert.equal(edc.rfc, "BADD9001019A1");
  assert.equal(edc.reason, "curp_base_match");
  assert.equal(edc.confidence, "high");
});

test("CURP validada en conflicto veta incluso un RFC exacto de DG", () => {
  const edc = selectEstadoCuentaRfc({
    text: "TITULAR JUAN PEREZ GARCIA RFC BADD9001019A1",
    rfcDatosGenerales: "BADD9001019A1",
    curpValidadaLocalmente: CURP_CADD,
    clienteNombre: CLIENT,
  });
  assert.equal(edc.status, "unknown");
  assert.equal(edc.rfc, null);
  assert.equal(edc.reason, "curp_base_conflict");
});

test("Bansefi base10 + CURP validada + EDC full conserva candidato fiscal completo", () => {
  const edc = selectEstadoCuentaRfc({
    text: "CUENTAHABIENTE JUAN PEREZ GARCIA RFC BADD9001019A1",
    rfcInfonavit: "BADD900101",
    curpValidadaLocalmente: CURP_BADD,
    clienteNombre: CLIENT,
  });
  assert.equal(edc.status, "selected");
  assert.equal(edc.rfc, "BADD9001019A1");
  assert.equal(edc.reason, "base_expected_match");
});

test("dos homoclaves de la misma base CURP quedan ambiguas sin evidencia exacta", () => {
  const edc = selectEstadoCuentaRfc({
    text: "RFC BADD9001019A1 RFC BADD900101ZZ9",
    curpValidadaLocalmente: CURP_BADD,
  });
  assert.equal(edc.status, "unknown");
  assert.equal(edc.reason, "ambiguous_candidates");
});

test("sin corroboración independiente no selecciona aunque el contexto parezca fuerte", () => {
  const edc = selectEstadoCuentaRfc({
    text: "TITULAR JUAN PEREZ GARCIA RFC ABCD0101019A1",
    curpValidadaLocalmente: "NO-VALIDA",
    clienteNombre: CLIENT,
  });
  assert.equal(edc.status, "unknown");
  assert.equal(edc.rfc, null);
  assert.equal(edc.reason, "insufficient_corroboration");
});

test("penaliza solo el RFC inmediatamente etiquetado como banco", () => {
  const candidates = extractEstadoCuentaRfcCandidates({
    text: [
      "RFC DEL BANCO BANC991231AAA",
      "TITULAR JUAN PEREZ GARCIA RFC BADD9001019A1",
    ].join(" | "),
    curpValidadaLocalmente: CURP_BADD,
    clienteNombre: CLIENT,
  });
  const bank = candidates.find((c) => c.rfc === "BANC991231AAA");
  const client = candidates.find((c) => c.rfc === "BADD9001019A1");
  assert.ok(bank);
  assert.ok(client);
  assert.equal(bank.reasons.includes("bank_rfc_context"), true);
  assert.equal(client.reasons.includes("bank_rfc_context"), false);
  assert.equal(client.reasons.includes("base_curp_match"), true);
});

test("descarta RFC del banco si existe candidato del titular corroborado", () => {
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

test("candidatos sin fuente independiente quedan UNKNOWN, nunca rechazo", () => {
  const edc = selectEstadoCuentaRfc({
    text: "REFERENCIAS ABCD0101019A1 WXYZ020202ABC",
  });
  assert.equal(edc.status, "unknown");
  assert.equal(edc.reason, "insufficient_corroboration");
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
