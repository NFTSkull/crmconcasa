import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { canManageAgendaConfig } from "@/lib/canManageAgendaConfig";

describe("P121 montaje AgendaSlotCapacitiesPanel en /mesa-control", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/mesa-control/page.tsx"),
    "utf8",
  );
  const panel = readFileSync(
    join(process.cwd(), "src/components/mesa-control/AgendaBiometricosConfigPanel.tsx"),
    "utf8",
  );
  const cupos = readFileSync(
    join(process.cwd(), "src/components/mesa-control/AgendaSlotCapacitiesPanel.tsx"),
    "utf8",
  );

  it("gate usa rol de sesión (no solo mock)", () => {
    assert.match(page, /agendaConfigRole/);
    assert.match(page, /canManageAgenda/);
    assert.match(page, /mesaMockRole \?\? currentUser\?\.role/);
    assert.doesNotMatch(
      page,
      /canManageAgendaConfig\(mesaMockRole\)\s*\?\s*\(\s*<AgendaBiometricosConfigPanel/,
    );
  });

  it("panel montado bajo configs semanales (Sedes) en modo Supabase", () => {
    assert.match(panel, /AgendaBiometricosWeeklySupabaseSection/);
    assert.match(panel, /AgendaFirmasWeeklySupabaseSection/);
    assert.match(panel, /AgendaSlotCapacitiesPanel/);
    const idxBio = panel.indexOf("AgendaBiometricosWeeklySupabaseSection");
    const idxFirmas = panel.indexOf("AgendaFirmasWeeklySupabaseSection");
    const idxCupos = panel.indexOf("<AgendaSlotCapacitiesPanel");
    assert.ok(idxBio >= 0 && idxFirmas > idxBio && idxCupos > idxFirmas);
  });

  it("formulario Fecha/Sede/Tipo/Hora/Capacidad presente", () => {
    assert.match(cupos, /Fecha/);
    assert.match(cupos, /Sede/);
    assert.match(cupos, /Tipo/);
    assert.match(cupos, /Hora/);
    assert.match(cupos, /Capacidad/);
    assert.match(cupos, /Guardar cupo|Cupo guardado|guardar/i);
  });

  it("roles admin ven config; operativo/asesor no", () => {
    assert.equal(canManageAgendaConfig("mesa_admin"), true);
    assert.equal(canManageAgendaConfig("mesa_control_admin"), true);
    assert.equal(canManageAgendaConfig("super_admin"), true);
    assert.equal(canManageAgendaConfig("mesa_interno"), false);
    assert.equal(canManageAgendaConfig("asesor"), false);
  });
});
