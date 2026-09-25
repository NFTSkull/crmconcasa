import test from "node:test";
import assert from "node:assert/strict";
import {
  backupReasonFromPdfGap,
  buildValidadoResumen,
  curpRfcBase10,
  extractEstadoCuentaRfcCandidates,
  FISCAL_MIN_BACKUP_ATTEMPT_MS,
  FISCAL_ROUTE_BUDGET_MS,
  homoclaveDiffers,
  maskFiscalId,
  normalizeRfc,
  pickCapturedBackupRfc,
  rfcShape,
  selectEstadoCuentaRfc,
  resolveFiscalRfc,
  resolveEstadoCuentaFiscalRfc,
  workerAttemptTimeoutMs,
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

test("pickCapturedBackupRfc: prioriza rfc_infonavit full13 con base CURP", () => {
  const pick = pickCapturedBackupRfc({
    rfcInfonavit: "BADD9001019A1",
    rfcDatosGenerales: "BADD900101ZZ9",
    curpValidadaLocalmente: CURP_BADD,
  });
  assert.deepEqual(pick, {
    ok: true,
    rfc: "BADD9001019A1",
    field: "rfc_infonavit",
  });
});

test("pickCapturedBackupRfc: si infonavit vacío usa DG con base CURP", () => {
  const pick = pickCapturedBackupRfc({
    rfcInfonavit: null,
    rfcDatosGenerales: "BADD9001019A1",
    curpValidadaLocalmente: CURP_BADD,
  });
  assert.equal(pick.ok, true);
  if (pick.ok) {
    assert.equal(pick.field, "rfc_datos_generales");
    assert.equal(pick.rfc, "BADD9001019A1");
  }
});

test("pickCapturedBackupRfc: base distinta a CURP no se usa (caso mismatch)", () => {
  const pick = pickCapturedBackupRfc({
    rfcInfonavit: "CADD9102029A1",
    rfcDatosGenerales: "BADD9001019A1",
    curpValidadaLocalmente: CURP_BADD,
  });
  assert.deepEqual(pick, { ok: false, reason: "curp_base_mismatch" });
});

test("caso 142-like: PDF homoclave distinta + respaldo válido; resumen marca diferencia", () => {
  const pdfRfc = "BADD9001011L8";
  const backup = pickCapturedBackupRfc({
    rfcInfonavit: "BADD900101I93",
    rfcDatosGenerales: "BADD900101I93",
    curpValidadaLocalmente: CURP_BADD,
  });
  assert.equal(backup.ok, true);
  assert.equal(homoclaveDiffers(pdfRfc, backup.ok ? backup.rfc : null), true);
  if (!backup.ok) throw new Error("expected backup");
  const resumen = buildValidadoResumen({
    fiscalRfc: backup.rfc,
    rfcSource: "respaldo_capturado",
    backupReason: "pdf_sat_invalid",
    backupField: backup.field,
    pdfRfc,
  });
  assert.equal(resumen.rfc_source, "respaldo_capturado");
  assert.equal(resumen.backup_reason, "pdf_sat_invalid");
  assert.equal(resumen.pdf_homoclave_differed, true);
  assert.equal(resumen.pdf_rfc_masked, maskFiscalId(pdfRfc));
  assert.equal(resumen.fiscal_rfc_masked, maskFiscalId(backup.rfc));
  assert.doesNotMatch(JSON.stringify(resumen), /BADD9001011L8|BADD900101I93/);
});

test("PDF ilegible → motivo de respaldo pdf_PDF_NO_LEGIBLE", () => {
  assert.equal(
    backupReasonFromPdfGap({ extractOk: false, extractReason: "PDF_NO_LEGIBLE" }),
    "pdf_PDF_NO_LEGIBLE",
  );
  assert.equal(
    backupReasonFromPdfGap({ extractOk: true, selectionReason: "no_full_rfc" }),
    "pdf_no_full_rfc",
  );
});

test("presupuesto: sin tiempo para respaldo (< MIN) → null timeout", () => {
  assert.equal(FISCAL_ROUTE_BUDGET_MS, 50_000);
  assert.equal(
    workerAttemptTimeoutMs(FISCAL_MIN_BACKUP_ATTEMPT_MS - 1),
    null,
  );
  assert.equal(workerAttemptTimeoutMs(12_000), 12_000);
  assert.equal(workerAttemptTimeoutMs(50_000, { minMs: 1_000 }), 50_000);
});

test("pass desde estado_cuenta no incluye campos de respaldo", () => {
  const r = buildValidadoResumen({
    fiscalRfc: "BADD9001019A1",
    rfcSource: "estado_cuenta",
  });
  assert.equal(r.rfc_source, "estado_cuenta");
  assert.equal(r.backup_reason, undefined);
  assert.equal(r.pdf_homoclave_differed, undefined);
});


test("Estado de Cuenta escaneado: usa OCR cacheado si no hay texto embebido", () => {
  const r = resolveEstadoCuentaFiscalRfc({
    embeddedText: "",
    ocrText: "TITULAR JUAN PEREZ GARCIA RFC BADD9001019A1",
    curpValidadaLocalmente: CURP_BADD,
    clienteNombre: CLIENT,
  });
  assert.equal(r.status, "ready_for_sat");
  if (r.status !== "ready_for_sat") throw new Error("expected ready");
  assert.equal(r.fiscalRfc, "BADD9001019A1");
  assert.equal(r.readSource, "ocr_cache");
});

test("Estado de Cuenta: texto embebido válido gana antes que OCR", () => {
  const r = resolveEstadoCuentaFiscalRfc({
    embeddedText: "TITULAR JUAN PEREZ GARCIA RFC BADD9001019A1",
    ocrText: "TITULAR JUAN PEREZ GARCIA RFC BADD900101ZZ9",
    curpValidadaLocalmente: CURP_BADD,
    clienteNombre: CLIENT,
  });
  assert.equal(r.status, "ready_for_sat");
  if (r.status !== "ready_for_sat") throw new Error("expected ready");
  assert.equal(r.fiscalRfc, "BADD9001019A1");
  assert.equal(r.readSource, "embedded_text");
});

test("Estado de Cuenta ambiguo en texto embebido puede resolverse con OCR de la misma versión", () => {
  const r = resolveEstadoCuentaFiscalRfc({
    embeddedText: "RFC BADD9001019A1 RFC BADD900101ZZ9",
    ocrText: "CUENTAHABIENTE JUAN PEREZ GARCIA RFC BADD9001019A1",
    curpValidadaLocalmente: CURP_BADD,
    clienteNombre: CLIENT,
  });
  assert.equal(r.status, "ready_for_sat");
  if (r.status !== "ready_for_sat") throw new Error("expected ready");
  assert.equal(r.fiscalRfc, "BADD9001019A1");
  assert.equal(r.readSource, "ocr_cache");
});

test("sin RFC visible en Estado de Cuenta no promueve el RFC capturado como fuente documental", () => {
  const r = resolveEstadoCuentaFiscalRfc({
    embeddedText: "ESTADO DE CUENTA SIN RFC DEL TITULAR",
    ocrText: "",
    rfcInfonavit: "BADD9001019A1",
    rfcDatosGenerales: "BADD9001019A1",
    curpValidadaLocalmente: CURP_BADD,
    clienteNombre: CLIENT,
  });
  assert.equal(r.status, "unknown");
  if (r.status !== "unknown") throw new Error("expected unknown");
  assert.equal(r.fiscalRfc, null);
});
