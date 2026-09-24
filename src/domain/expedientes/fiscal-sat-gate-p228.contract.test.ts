import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

const root = process.cwd();

describe("P228 fiscal sat gate migration contract", () => {
  const mig = readFileSync(
    join(root, "supabase/migrations/228_fiscal_sat_gate_server_write.sql"),
    "utf8",
  );
  const rollback = readFileSync(
    join(root, "supabase/rollback/228_fiscal_sat_gate_server_write_ROLLBACK.sql"),
    "utf8",
  );

  it("incluye piloto + binding RFC hashes + core/wrapper", () => {
    assert.match(mig, /fiscal_sat_gate_pilot_asesores/);
    assert.match(mig, /fiscal_sat_gate_applies_to_expediente/);
    assert.match(mig, /rfc_datos_sha256/);
    assert.match(mig, /rfc_infonavit_sha256/);
    assert.match(mig, /enviar_a_mesa_core/);
    assert.match(mig, /server_registrar_validacion_fiscal_sat/);
    assert.match(mig, /RFC_VALIDACION_SAT_APROBADO_ADMIN/);
    assert.match(mig, /unchanged/);
    assert.match(mig, /solo super_admin/);
    assert.match(mig, /REVOKE ALL ON TABLE public\.app_settings FROM authenticated/);
    assert.match(mig, /extensions\.digest\(/);
    assert.doesNotMatch(mig, /v_role <> 'admin'/);
    assert.doesNotMatch(mig, /app_role = 'admin'/);
  });

  it("asesor_registrar solo agrega guards PENDIENTE sobre p208", () => {
    assert.match(mig, /asesor_can_operate_expediente_as/);
    assert.match(mig, /rfc_validacion_sat solo PENDIENTE desde cliente/);
    assert.match(mig, /RFC_VALIDACION_SAT_REVISION_MANUAL/);
    assert.match(rollback, /asesor_can_operate_expediente_as/);
  });

  it("rollback restaura enviar_a_mesa y dropea helpers nuevos", () => {
    assert.match(rollback, /CREATE OR REPLACE FUNCTION public\.enviar_a_mesa/);
    assert.match(rollback, /DROP FUNCTION IF EXISTS public\.enviar_a_mesa_core/);
    assert.match(rollback, /DROP FUNCTION IF EXISTS public\.fiscal_sat_gate_allows_envio/);
    assert.match(rollback, /DROP FUNCTION IF EXISTS public\.fiscal_sat_gate_applies_to_expediente/);
  });
});
