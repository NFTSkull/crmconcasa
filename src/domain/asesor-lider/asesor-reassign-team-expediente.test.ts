import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("reasignación de expediente Equipo Silvia", () => {
  it("monta el control sin modificar la página grande del expediente", () => {
    const layout = read("src/app/asesor/expediente/[id]/layout.tsx");
    assert.match(layout, /AsesorReassignTeamExpedienteFloating/);
    assert.match(layout, /expedienteId/);
  });

  it("la UI se limita al usuario de Silvia y confirma preservación", () => {
    const component = read(
      "src/components/asesor/AsesorReassignTeamExpedienteFloating.tsx",
    );
    assert.match(component, /silvia\.reyes@concasa\.mx/);
    assert.match(component, /asesor_reassign_team_context/);
    assert.match(component, /asesor_reassign_team_expediente/);
    assert.match(component, /Se conservarán documentos, datos, etapa, citas e historial/);
  });

  it("el RPC exige liderazgo y las tres capabilities sin borrar relaciones", () => {
    const sql = read(
      "supabase/migrations/20260912170500_asesor_lider_reassign_team_expediente.sql",
    );
    assert.match(sql, /t\.leader_id = v_actor_id/);
    assert.match(sql, /team_dashboard_read/);
    assert.match(sql, /create_for_any_advisor/);
    assert.match(sql, /integrate_for_any_advisor/);
    assert.match(sql, /asesor_pertenece_equipo_activo\(v_team\.id, p_target_asesor_id\)/);
    assert.match(sql, /v_exp\.ciclo_estado IS DISTINCT FROM 'activo'/);
    assert.match(sql, /UPDATE public\.expedientes\s+SET asesor_id = p_target_asesor_id/);
    assert.match(sql, /origen_mesa = v_new_origen/);
    assert.match(sql, /UPDATE public\.agenda_manual_occupancies/);
    assert.match(sql, /UPDATE public\.agenda_sheet_slot_inventory/);
    assert.match(sql, /INSERT INTO public\.agenda_sheet_sync_outbox/);
    assert.match(sql, /event_type[\s\S]*'booking_updated'/);
    assert.match(sql, /status = 'borrador'/);
    assert.doesNotMatch(sql, /UPDATE public\.expediente_precalificacion_intentos/i);
    assert.doesNotMatch(sql, /DELETE FROM public\.expediente_documentos/i);
    assert.doesNotMatch(sql, /DELETE FROM public\.agenda_bookings/i);
    assert.match(sql, /expediente\.reassign_advisor/);
  });
});