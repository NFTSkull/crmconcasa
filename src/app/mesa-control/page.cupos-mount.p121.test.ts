import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { canManageAgendaConfig } from "@/lib/canManageAgendaConfig";

describe("P121/P123 montaje cupos en /mesa-control", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/mesa-control/page.tsx"),
    "utf8",
  );
  const panel = readFileSync(
    join(process.cwd(), "src/components/mesa-control/AgendaBiometricosConfigPanel.tsx"),
    "utf8",
  );
  const bioWeekly = readFileSync(
    join(process.cwd(), "src/components/mesa-control/AgendaBiometricosWeeklySupabaseSection.tsx"),
    "utf8",
  );
  const firmasWeekly = readFileSync(
    join(process.cwd(), "src/components/mesa-control/AgendaFirmasWeeklySupabaseSection.tsx"),
    "utf8",
  );
  const form = readFileSync(
    join(process.cwd(), "src/components/mesa-control/AgendaWeeklyConfigForm.tsx"),
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

  it("P123: sin panel principal duplicado; excepciones dentro de cada weekly", () => {
    assert.match(panel, /AgendaBiometricosWeeklySupabaseSection/);
    assert.match(panel, /AgendaFirmasWeeklySupabaseSection/);
    assert.doesNotMatch(panel, /<AgendaSlotCapacitiesPanel/);
    assert.match(bioWeekly, /lockedKind="biometricos"/);
    assert.match(firmasWeekly, /lockedKind="firmas"/);
    assert.match(bioWeekly, /collapsible/);
    assert.match(firmasWeekly, /collapsible/);
  });

  it("Horarios seleccionados integra cupos + Guardar horarios y cupos", () => {
    assert.match(form, /Horarios seleccionados/);
    assert.match(form, /Guardar horarios y cupos/);
    assert.match(form, /El asesor verá los lugares restantes/);
    assert.match(form, /resolveSedeSlotCapacityDraft/);
    assert.match(form, /exceptionsPanel/);
  });

  it("formulario excepciones Fecha/Sede/Hora/Capacidad presente", () => {
    assert.match(cupos, /Fecha/);
    assert.match(cupos, /Sede/);
    assert.match(cupos, /Hora/);
    assert.match(cupos, /Capacidad/);
    assert.match(cupos, /Excepciones por fecha/);
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
