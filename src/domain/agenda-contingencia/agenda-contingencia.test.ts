import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  APPLY_OUTCOME_SKIPPED_CONTINGENCY,
  EXTRAORDINARY_REBOOK_PRIORITY,
  EXTRAORDINARY_REBOOK_TASK_KIND,
  agendarCitaExtraordinariaInputSchema,
  declararContingenciaInputSchema,
  isExtraordinaryRebookPending,
} from "./types";
import {
  mapAgendarExtraordinariaRpcError,
  mapDeclararContingenciaRpcError,
} from "./rpc-errors";
import {
  CONTINGENCY_ADVANCE_LIMITATION,
  contingencyOriginalBlockedActions,
  isContingencyOriginalBooking,
} from "./ui-contract";
import { mapContingenciaPendienteToDashboardNotification } from "./notification-map";


describe("P172 agenda-contingencia contract", () => {
  it("valida input declarar (reason trim + límites)", () => {
    const ok = declararContingenciaInputSchema.parse({
      affected_date: "2026-08-12",
      kind: "biometricos",
      location_id: null,
      reason: "  Tormenta  ",
    });
    assert.equal(ok.reason, "Tormenta");
    assert.throws(() =>
      declararContingenciaInputSchema.parse({
        affected_date: "2026-08-12",
        kind: "biometricos",
        reason: "   ",
      }),
    );
    assert.throws(() =>
      declararContingenciaInputSchema.parse({
        affected_date: "2026-08-12",
        kind: "notificacion",
        reason: "x",
      }),
    );
  });

  it("valida input extraordinaria", () => {
    const ok = agendarCitaExtraordinariaInputSchema.parse({
      contingency_item_id: "00000000-0000-4000-8000-000000000001",
      booking_date: "2026-08-15",
      booking_time: "08:30",
      location_id: "monterrey",
    });
    assert.equal(ok.location_id, "monterrey");
  });

  it("tarea persistente solo pending_rebook + active", () => {
    assert.equal(
      isExtraordinaryRebookPending("pending_rebook", "active"),
      true,
    );
    assert.equal(isExtraordinaryRebookPending("rebooked", "active"), false);
    assert.equal(isExtraordinaryRebookPending("pending_rebook", "closed"), false);
    assert.equal(EXTRAORDINARY_REBOOK_TASK_KIND, "extraordinary_rebook_required");
  });

  it("mapea errores RPC", () => {
    const d = mapDeclararContingenciaRpcError({
      message: "CONTINGENCY_NO_AFFECTED_BOOKINGS",
    });
    assert.equal(d.code, "NO_AFFECTED");
    const a = mapAgendarExtraordinariaRpcError({
      message: "EXTRAORDINARY_FORBIDDEN: no es dueño",
    });
    assert.equal(a.code, "FORBIDDEN");
  });

  it("mig 171 declara SKIPPED_CONTINGENCY y aísla outbox", () => {
    const mig = readFileSync(
      resolve(process.cwd(), "supabase/migrations/171_agenda_contingencia_extraordinaria.sql"),
      "utf8",
    );
    assert.match(mig, /agenda_contingencias/);
    assert.match(mig, /agenda_extraordinary_bookings/);
    assert.match(mig, /agenda_declarar_contingencia/);
    assert.match(mig, /asesor_agendar_cita_extraordinaria/);
    assert.match(mig, /SKIPPED_CONTINGENCY/);
    assert.match(mig, /agenda_booking_has_contingency/);
    assert.match(mig, /status IN \('active', 'closed'\)/);
    assert.match(mig, /BOOKING_UNDER_CONTINGENCY/);
    assert.match(mig, /agenda_bookings_guard_contingency/);
    assert.match(mig, /AGENDA_CONTINGENCY_DECLARED/);
    assert.match(mig, /AGENDA_EXTRAORDINARY_REBOOKED/);
    assert.match(mig, /agenda_sheet_sync_outbox/);
    assert.match(mig, /agenda_preview_contingencia/);
    assert.match(mig, /mesa_list_contingencia_items/);
    assert.match(mig, /asesor_list_contingencia_expediente/);
    assert.doesNotMatch(mig, /book_biometricos\(/);
    assert.doesNotMatch(mig, /cancel_biometricos\(/);
    assert.doesNotMatch(mig, /reagendar_firmas\(/);
    assert.equal(APPLY_OUTCOME_SKIPPED_CONTINGENCY, "SKIPPED_CONTINGENCY");
  });

  it("B1.1 UI contract bloquea acciones normales sin render", () => {
    assert.equal(isContingencyOriginalBooking(null), false);
    assert.equal(
      isContingencyOriginalBooking({ underContingency: true }),
      true,
    );
    const blocked = contingencyOriginalBlockedActions({
      underContingency: true,
      contingencyStatus: "closed",
    });
    assert.equal(blocked.cancel, true);
    assert.equal(blocked.reagendar, true);
    assert.equal(blocked.driveValidation, true);
    assert.equal(blocked.bulkSelect, true);
    assert.match(CONTINGENCY_ADVANCE_LIMITATION, /booking_id/);
  });

  it("extraordinary_rebook_required no degrada a pendiente_revision", () => {
    const n = mapContingenciaPendienteToDashboardNotification({
      contingency_item_id: "00000000-0000-4000-8000-000000000001",
      contingency_id: "00000000-0000-4000-8000-000000000002",
      expediente_id: "00000000-0000-4000-8000-000000000003",
      original_booking_id: "00000000-0000-4000-8000-000000000004",
      item_status: "pending_rebook",
      affected_date: "2026-08-12",
      kind: "biometricos",
      contingency_location_id: null,
      reason: "Tormenta",
      task_kind: EXTRAORDINARY_REBOOK_TASK_KIND,
    }, { clienteNombre: "Ana" });
    assert.equal(n.kind, EXTRAORDINARY_REBOOK_TASK_KIND);
    assert.equal(n.prioridad, EXTRAORDINARY_REBOOK_PRIORITY);
    assert.equal(n.prioridad < 7, true); // encima de cita_programada
    assert.equal(n.prioridad > 2, true); // debajo de rechazo crítico
    assert.equal(n.expedienteId, "00000000-0000-4000-8000-000000000003");
    assert.match(n.href, /\/asesor\/expediente\//);
    assert.match(n.mensaje, /Contingencia/);
    assert.equal(n.clienteNombre, "Ana");
    assert.match(n.id, /extraordinary_rebook_required/);
  });

  it("no toca Code.gs / worker / webhook en B1", () => {
    // Contrato: archivos Edge de sync no se modifican en este bloque.
    const worker = readFileSync(
      resolve(
        process.cwd(),
        "supabase/functions/agenda-sheet-sync-worker/index.ts",
      ),
      "utf8",
    );
    assert.doesNotMatch(worker, /agenda_contingencias/);
  });
});
