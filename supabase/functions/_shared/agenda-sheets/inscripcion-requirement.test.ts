/**
 * Deno tests — maybeCreateInscripcionRequirement (RPC mock).
 * Run: deno test --allow-env supabase/functions/_shared/agenda-sheets/inscripcion-requirement.test.ts
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  accumulateInscripcionRequirementMetric,
  emptyInscripcionRequirementMetrics,
  evaluateInscripcionRequirementGate,
  getInscripcionRequirementsConfig,
  maybeCreateInscripcionRequirement,
  type InscripcionRequirementsConfig,
} from "./inscripcion-requirement.ts";

const ON: InscripcionRequirementsConfig = {
  enabled: true,
  fromDate: "2026-08-13",
};

const ROW = {
  kind: "biometricos",
  biometric_result_class: "COMPLETED",
  inscripcion_rebook_required: true,
  inscripcion_rebook_reason_raw: "REAGENDA INSCRIPCION, FALLA SISTEMA",
  booking_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  expediente_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  organization_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  booking_date: "2026-08-13",
  sheet_id: 7,
  sheet_row: 19,
};

Deno.test("config fail-closed ausente", () => {
  const c = getInscripcionRequirementsConfig({});
  assertEquals(c.enabled, false);
  assertEquals(c.fromDate, null);
});

Deno.test("histórico 07 AGO → BEFORE_CUTOVER sin RPC", async () => {
  let calls = 0;
  const res = await maybeCreateInscripcionRequirement(
    {
      rpc: async () => {
        calls += 1;
        return { data: null, error: null };
      },
    },
    { ...ROW, booking_date: "2026-08-07" },
    ON,
  );
  assertEquals(res.outcome, "BEFORE_CUTOVER");
  assertEquals(res.attempted, false);
  assertEquals(calls, 0);
});

Deno.test("CREATABLE → CREATED", async () => {
  let args: Record<string, unknown> | null = null;
  const res = await maybeCreateInscripcionRequirement(
    {
      rpc: async (_fn: string, a: Record<string, unknown>) => {
        args = a;
        return {
          data: {
            ok: true,
            idempotent: false,
            requirement_id: "req-1",
          },
          error: null,
        };
      },
    },
    ROW,
    ON,
  );
  assertEquals(res.outcome, "CREATED");
  assertEquals(res.created, true);
  assertEquals(res.attempted, true);
  assertEquals(res.requirementId, "req-1");
  assertEquals(args!["p_source_booking_id"], ROW.booking_id);
  assertEquals(args!["p_reason"], ROW.inscripcion_rebook_reason_raw);
});

Deno.test("segunda llamada → IDEMPOTENT", async () => {
  const res = await maybeCreateInscripcionRequirement(
    {
      rpc: async () => ({
        data: { ok: true, idempotent: true, requirement_id: "req-1" },
        error: null,
      }),
    },
    ROW,
    ON,
  );
  assertEquals(res.outcome, "IDEMPOTENT");
  assertEquals(res.idempotent, true);
  assertEquals(res.created, false);
});

Deno.test("RPC error no fatal", async () => {
  const res = await maybeCreateInscripcionRequirement(
    {
      rpc: async () => ({
        data: null,
        error: {
          message:
            "agenda_inscripcion_require_from_sheet: evidencia ops inválida",
        },
      }),
    },
    ROW,
    ON,
  );
  assertEquals(res.outcome, "RPC_ERROR");
  assertEquals(res.ok, false);
  assertEquals(res.attempted, true);
});

Deno.test("métricas accumulate", () => {
  const m = emptyInscripcionRequirementMetrics(ON);
  accumulateInscripcionRequirementMetric(m, {
    ok: true,
    outcome: "BEFORE_CUTOVER",
    attempted: false,
    created: false,
    idempotent: false,
    enabled: true,
    fromDate: "2026-08-13",
  });
  accumulateInscripcionRequirementMetric(m, {
    ok: true,
    outcome: "CREATED",
    attempted: true,
    created: true,
    idempotent: false,
    enabled: true,
    fromDate: "2026-08-13",
  });
  assertEquals(m.inscripcion_requirements_before_cutover, 1);
  assertEquals(m.inscripcion_requirements_skipped, 1);
  assertEquals(m.inscripcion_requirements_created, 1);
  assertEquals(m.inscripcion_requirements_attempted, 1);
});

Deno.test("gate firmas NOT_REQUIRED", () => {
  assertEquals(
    evaluateInscripcionRequirementGate({
      config: ON,
      row: { ...ROW, kind: "firmas" },
    }).outcome,
    "NOT_REQUIRED",
  );
});
