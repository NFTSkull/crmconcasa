import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const migration = readFileSync(
  join(
    ROOT,
    "supabase/migrations/20260918173000_mesa_completar_cita_operativa.sql",
  ),
  "utf8",
);
const repoSource = readFileSync(
  join(ROOT, "src/domain/agenda-calendar/mesa.repo.ts"),
  "utf8",
);
const clientSource = readFileSync(
  join(ROOT, "src/components/mesa-control/MesaAgendaCitasClient.tsx"),
  "utf8",
);

describe("Mesa Citas — cierre operativo por booking", () => {
  it("expone RPC autenticada y no pública", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mesa_completar_cita_operativa/);
    assert.match(migration, /SECURITY DEFINER/);
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION public\.mesa_completar_cita_operativa\(UUID\) FROM PUBLIC/,
    );
    assert.match(
      migration,
      /GRANT EXECUTE ON FUNCTION public\.mesa_completar_cita_operativa\(UUID\) TO authenticated/,
    );
  });

  it("valida cita ocurrida y contingencia antes de avanzar", () => {
    assert.match(migration, /agenda_booking_has_contingency\(p_booking_id\)/);
    assert.match(migration, /la cita todavía no ocurre/);
  });

  it("biométricos termina en Acuse usando avanzar_etapa_operativa", () => {
    assert.match(migration, /v_book\.kind::TEXT = 'biometricos'/);
    assert.match(migration, /public\.avanzar_etapa_operativa/);
    assert.match(migration, /v_exp\.etapa_actual IS DISTINCT FROM 8/);
  });

  it("firma termina en Firmado usando avanzar_etapa_operativa", () => {
    assert.match(migration, /v_book\.kind::TEXT = 'firmas'/);
    assert.match(migration, /v_exp\.etapa_actual IS DISTINCT FROM 11/);
  });

  it("inscripción cierra requirement y termina en Acuse sin tocar agenda_bookings", () => {
    assert.match(migration, /agenda_inscripcion_requerimientos/);
    assert.match(migration, /status = 'completed'/);
    assert.match(migration, /etapa_actual = 8/);
    assert.doesNotMatch(migration, /UPDATE public\.agenda_bookings/);
  });

  it("frontend usa RPC por booking y conserva Notificación con avance genérico", () => {
    assert.match(repoSource, /mesa_completar_cita_operativa/);
    assert.match(clientSource, /completarMesaAgendaCitaOperativa/);
    assert.match(clientSource, /item\.kind === "notificacion"/);
    assert.match(clientSource, /expedientesRepo\.avanzarEtapaOperativa\(expedienteId\)/);
  });
});
