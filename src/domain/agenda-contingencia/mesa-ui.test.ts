import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExtraordinaryBellCopy,
  canDeclareAgendaContingencia,
  canDeclareContingenciaOnView,
  mergeExtraordinaryBellNotifications,
} from "./mesa-ui";
import { EXTRAORDINARY_REBOOK_TASK_KIND } from "./types";
import type { ContingenciaPendienteItem } from "./types";
import type { DashboardNotificationItem } from "@/lib/dashboardNotifications";

const pending: ContingenciaPendienteItem = {
  contingency_item_id: "00000000-0000-4000-8000-000000000001",
  contingency_id: "00000000-0000-4000-8000-000000000002",
  original_booking_id: "00000000-0000-4000-8000-000000000003",
  expediente_id: "00000000-0000-4000-8000-000000000004",
  kind: "biometricos",
  affected_date: "2026-08-12",
  contingency_location_id: null,
  reason: "Falla sistema",
  item_status: "pending_rebook",
  task_kind: EXTRAORDINARY_REBOOK_TASK_KIND,
};

describe("P172 B2 mesa-ui gates", () => {
  it("roles autorizados vs asesor/editor", () => {
    assert.equal(canDeclareAgendaContingencia("mesa_admin"), true);
    assert.equal(canDeclareAgendaContingencia("mesa_interno"), true);
    assert.equal(canDeclareAgendaContingencia("mesa_externo"), true);
    assert.equal(canDeclareAgendaContingencia("super_admin"), true);
    assert.equal(canDeclareAgendaContingencia("asesor"), false);
    assert.equal(canDeclareAgendaContingencia("editor"), false);
  });

  it("semana no permite declarar", () => {
    const g = canDeclareContingenciaOnView({
      viewMode: "semana",
      selectedDay: "2026-08-12",
      listaStartDate: "2026-08-12",
      listaEndDate: "2026-08-12",
    });
    assert.equal(g.allowed, false);
    assert.match(String(g.reason), /un solo día/i);
  });

  it("lista multi-día disabled", () => {
    const g = canDeclareContingenciaOnView({
      viewMode: "lista",
      selectedDay: "2026-08-12",
      listaStartDate: "2026-08-11",
      listaEndDate: "2026-08-12",
    });
    assert.equal(g.allowed, false);
  });

  it("día único lista aplicado OK", () => {
    const g = canDeclareContingenciaOnView({
      viewMode: "lista",
      selectedDay: "2026-08-12",
      listaStartDate: "2026-08-12",
      listaEndDate: "2026-08-12",
      appliedListaStart: "2026-08-12",
      appliedListaEnd: "2026-08-12",
    });
    assert.equal(g.allowed, true);
    assert.equal(g.dayYmd, "2026-08-12");
  });

  it("vista día usa selectedDay", () => {
    const g = canDeclareContingenciaOnView({
      viewMode: "dia",
      selectedDay: "2026-08-12",
      listaStartDate: "2026-08-01",
      listaEndDate: "2026-08-31",
    });
    assert.equal(g.allowed, true);
    assert.equal(g.dayYmd, "2026-08-12");
  });

  it("bell copy kind + fecha DD/MM + href contingencia", () => {
    const n = buildExtraordinaryBellCopy(pending);
    assert.equal(n.kind, EXTRAORDINARY_REBOOK_TASK_KIND);
    assert.equal(n.tipoLabel, "Reagenda extraordinaria");
    assert.match(n.mensaje, /Biométricos/);
    assert.match(n.mensaje, /12\/08\/2026/);
    assert.doesNotMatch(n.mensaje, /canceló|no asistió/i);
    assert.match(n.href, /\?contingencia=/);
  });

  it("merge reemplaza extras Cloud y conserva otras notifs", () => {
    const existing: DashboardNotificationItem[] = [
      {
        id: "other",
        expedienteId: "x",
        clienteNombre: "A",
        kind: "correccion_requerida",
        tipoLabel: "Corrección",
        mensaje: "x",
        fecha: "2026-08-01",
        prioridad: 1,
        href: "/asesor",
      },
      {
        id: "stale-extra",
        expedienteId: "y",
        clienteNombre: "B",
        kind: EXTRAORDINARY_REBOOK_TASK_KIND,
        tipoLabel: "old",
        mensaje: "old",
        fecha: "2026-08-01",
        prioridad: 4,
        href: "/asesor",
      },
    ];
    const merged = mergeExtraordinaryBellNotifications(existing, [pending]);
    assert.equal(merged.some((n) => n.id === "other"), true);
    assert.equal(merged.some((n) => n.id === "stale-extra"), false);
    assert.equal(
      merged.filter((n) => n.kind === EXTRAORDINARY_REBOOK_TASK_KIND).length,
      1,
    );
  });
});
