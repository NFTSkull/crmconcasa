import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ui = readFileSync(
  join(process.cwd(), "src/components/mesa-control/MesaAgendaHojaOperativaClient.tsx"),
  "utf8",
);
const repo = readFileSync(
  join(process.cwd(), "src/domain/agenda-hoja-crm/mesa.repo.ts"),
  "utf8",
);
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260908183000_agenda_hoja_crm.sql"),
  "utf8",
);

describe("Hoja operativa CRM — Drive sigue activo", () => {
  it("monta vista tipo Drive con las columnas operativas", () => {
    assert.match(ui, /Vista tipo Drive/);
    assert.match(ui, /Biométricos/);
    assert.match(ui, /Notificación/);
    assert.match(ui, /Firma/);
    assert.match(ui, /Notas/);
    assert.match(ui, /Captura manual/);
  });

  it("usa RPCs dedicadas para listar, editar y ocupar manualmente", () => {
    assert.match(repo, /agenda_hoja_crm_list/);
    assert.match(repo, /agenda_hoja_crm_save_result/);
    assert.match(repo, /agenda_hoja_crm_add_manual/);
    assert.match(repo, /agenda_hoja_crm_cancel_manual/);
  });

  it("las escrituras operativas no llaman RPCs de avance ni mutan agenda_bookings", () => {
    assert.doesNotMatch(repo, /avanzar_etapa|mesa_mover_etapa|update.*expediente/i);
    const saveBlock = migration.slice(
      migration.indexOf("agenda_hoja_crm_save_result"),
      migration.indexOf("agenda_hoja_crm_add_manual"),
    );
    assert.doesNotMatch(saveBlock, /UPDATE public\.expedientes/i);
    assert.doesNotMatch(saveBlock, /UPDATE public\.agenda_bookings/i);
    assert.match(saveBlock, /mutates_stage/);
  });

  it("la captura manual resta disponibilidad sin crear booking falso", () => {
    assert.match(migration, /agenda_crm_manual_slot_count/);
    assert.match(migration, /agenda_sheet_inventory_available_count/);
    const manualBlock = migration.slice(
      migration.indexOf("agenda_hoja_crm_add_manual"),
      migration.indexOf("agenda_hoja_crm_cancel_manual"),
    );
    assert.doesNotMatch(manualBlock, /INSERT INTO public\.agenda_bookings/i);
    assert.match(manualBlock, /creates_booking/);
  });
});
