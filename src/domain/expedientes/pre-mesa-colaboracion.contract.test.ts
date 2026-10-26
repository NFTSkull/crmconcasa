import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function migration(name: string): string {
  return readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
}

describe("Colaboración pre-Mesa por asesores activos (misma organización)", () => {
  const operate = migration("20261026123000_pre_mesa_colaboracion_operar.sql");
  const see = migration("20261026123100_pre_mesa_colaboracion_visibilidad.sql");
  const gate = migration("20261026205000_pre_mesa_no_ambiguous_nss_guard.sql");
  const page = readFileSync(join(process.cwd(), "src/app/asesor/nueva/page.tsx"), "utf8");

  it("solo asesor activo y de la misma organización opera pre-Mesa", () => {
    assert.match(operate, /p\.active=true/);
    assert.match(operate, /app_role<>'asesor'/);
    assert.match(operate, /organization_id IS DISTINCT FROM v_actor\.organization_id/);
    assert.match(operate, /submitted_to_mesa IS NOT TRUE AND v_exp\.ciclo_estado='activo'/);
    assert.match(operate, /integrate_for_any_advisor/);
    assert.match(operate, /asesor_comparten_equipo_activo/);
  });
  it("la lectura exige JWT + perfil activo + misma organización", () => {
    assert.match(see, /auth\.uid\(\) IS NULL/);
    assert.match(see, /p\.active=true/);
    assert.match(see, /organization_id IS DISTINCT FROM v_org_id/);
    assert.match(see, /submitted_to_mesa IS NOT TRUE AND v_exp\.ciclo_estado='activo'/);
    assert.match(see, /WHEN 'mesa_admin' THEN RETURN v_exp\.submitted_to_mesa=true/);
  });
  it("NSS ajeno pre-Mesa admite nueva precalificacion; post-Mesa sigue bloqueado", () => {
    assert.match(gate, /v_block_same = 1/);
    assert.match(gate, /'status', 'blocked_other_asesor'/);
    assert.match(gate, /'status', 'ok_create'/);
    assert.doesNotMatch(gate, /v_pre_other_count/);
    assert.match(gate, /e\.submitted_to_mesa = true/);
    assert.match(page, /existingDecision\.action === "open_existing"/);
    assert.match(page, /decision\.action === "open_existing"/);
    assert.match(page, /Abrir expediente existente/);
  });
});
