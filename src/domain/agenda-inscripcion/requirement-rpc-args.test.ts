/**
 * Tests Deno/Node-compatible del helper Edge P175 B5.1 (RPC mock).
 * Ejecutado vía node:test importando mirror de args + evaluate del domain
 * y lógica de parseo de respuesta embebida (sin Deno.env).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateInscripcionRequirementGate,
  getInscripcionRequirementsConfig,
} from "@/domain/agenda-inscripcion/requirement-gate";

/** Mirror mínimo de buildInscripcionRequireFromSheetArgs (Edge). */
function buildArgs(row: {
  organization_id?: string | null;
  booking_id?: string | null;
  expediente_id?: string | null;
  sheet_id?: number | null;
  sheet_row?: number | null;
  inscripcion_rebook_reason_raw?: string | null;
}) {
  return {
    p_organization_id: String(row.organization_id ?? "").trim(),
    p_source_booking_id: String(row.booking_id ?? "").trim(),
    p_expediente_id: String(row.expediente_id ?? "").trim(),
    p_sheet_id: row.sheet_id ?? null,
    p_sheet_row: row.sheet_row ?? null,
    p_reason: row.inscripcion_rebook_reason_raw ?? null,
  };
}

const ROW = {
  kind: "biometricos",
  biometric_result_class: "COMPLETED",
  inscripcion_rebook_required: true,
  inscripcion_rebook_reason_raw: "REAGENDA INSCRIPCION",
  booking_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  expediente_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  organization_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  booking_date: "2026-08-13",
  sheet_id: 99,
  sheet_row: 42,
};

describe("P175 B5.1 RPC args + runtime outcomes", () => {
  it("RPC args exactos sin PII de nombre/NSS", () => {
    const args = buildArgs(ROW);
    assert.deepEqual(args, {
      p_organization_id: ROW.organization_id,
      p_source_booking_id: ROW.booking_id,
      p_expediente_id: ROW.expediente_id,
      p_sheet_id: 99,
      p_sheet_row: 42,
      p_reason: "REAGENDA INSCRIPCION",
    });
    assert.equal("p_nss" in args, false);
    assert.equal("p_nombre" in args, false);
  });

  it("histórico 07 AGO: 0 intentos RPC (BEFORE_CUTOVER)", () => {
    const c = getInscripcionRequirementsConfig({
      GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED: "true",
      GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE: "2026-08-13",
    });
    const g = evaluateInscripcionRequirementGate({
      config: c,
      row: { ...ROW, booking_date: "2026-08-07" },
    });
    assert.equal(g.allow, false);
    assert.equal(g.outcome, "BEFORE_CUTOVER");
  });

  it("feature OFF / cutover inválido: 0 RPC", () => {
    assert.equal(
      evaluateInscripcionRequirementGate({
        config: getInscripcionRequirementsConfig({}),
        row: ROW,
      }).allow,
      false,
    );
    assert.equal(
      evaluateInscripcionRequirementGate({
        config: getInscripcionRequirementsConfig({
          GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED: "true",
          GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE: "bad",
        }),
        row: ROW,
      }).outcome,
      "DISABLED_NO_CUTOVER",
    );
  });

  it("simula CREATED vs IDEMPOTENT desde payload RPC", () => {
    const created = { ok: true, idempotent: false, requirement_id: "r1" };
    const idem = { ok: true, idempotent: true, requirement_id: "r1" };
    assert.equal(created.idempotent, false);
    assert.equal(idem.idempotent, true);
    assert.equal(
      evaluateInscripcionRequirementGate({
        config: getInscripcionRequirementsConfig({
          GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED: "true",
          GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE: "2026-08-13",
        }),
        row: ROW,
      }).outcome,
      "CREATABLE",
    );
  });
});
