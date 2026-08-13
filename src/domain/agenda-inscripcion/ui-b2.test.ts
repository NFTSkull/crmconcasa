/**
 * P175 B2 — UI/domain contracts (asesor card visibility, Mesa, Admin KPI, Excel).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canMesaSolicitarInscripcion,
  formatInscripcionCupoLabel,
  formatInscripcionFixedTimeDisplay,
  INSCRIPCION_FIXED_TIME,
  INSCRIPCION_FIXED_TIME_DISPLAY,
  INSCRIPCION_REBOOK_TASK_KIND,
  isInscripcionAgendarCtaVisible,
  isInscripcionManageVisible,
  isInscripcionRequirementOpen,
  mapInscripcionRequirementToDashboardNotification,
  mergeInscripcionBellNotifications,
  type AgendaInscripcionRequirement,
} from "@/domain/agenda-inscripcion";
import { fallbackReportGroupFromKind } from "@/domain/agenda-calendar/mesa-report-group";
import {
  deriveMesaAgendaSummary,
  formatMesaAgendaKind,
  formatMesaAgendaTime,
  mesaAgendaKindBadgeClass,
} from "@/lib/mesaAgendaCitasUi";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";

function req(
  status: AgendaInscripcionRequirement["status"],
): AgendaInscripcionRequirement {
  return {
    id: "r1",
    organizationId: "o1",
    expedienteId: "e1",
    sourceBookingId: null,
    sourceKind: null,
    sourceType: "mesa",
    status,
    requestedBy: null,
    requestedAt: "2026-08-13T12:00:00Z",
    bookedBookingId: null,
    completedAt: null,
    cancelledAt: null,
    reason: "Falla sistema",
    sourceSheetId: null,
    sourceSheetRow: null,
    createdAt: "2026-08-13T12:00:00Z",
    updatedAt: "2026-08-13T12:00:00Z",
  };
}

function entry(
  kind: MesaAgendaBookingEntry["kind"],
  overrides: Partial<MesaAgendaBookingEntry> = {},
): MesaAgendaBookingEntry {
  return {
    bookingId: "b1",
    expedienteId: "e1",
    kind,
    status: "booked",
    bookingDate: "2026-08-20",
    bookingTime: kind === "inscripcion" ? "11:00" : "10:00",
    locationId: "monterrey",
    clienteNombre: "Cliente",
    nss: null,
    etapaActual: 5,
    submittedToMesa: true,
    subestado: "en_proceso",
    asesor: { id: "a1", fullName: "Asesor", email: null },
    createdBy: { id: "a1", fullName: "Asesor", email: null },
    note: null,
    reportGroup: null,
    driveValidated: false,
    driveValidatedAt: null,
    driveValidatedBy: null,
    createdAt: "2026-08-13T12:00:00Z",
    cancelledAt: null,
    ...overrides,
  };
}

describe("P175 B2 asesor requirement UI gates", () => {
  it("sin requirement abierto → no CTA card states", () => {
    assert.equal(isInscripcionRequirementOpen("completed"), false);
    assert.equal(isInscripcionRequirementOpen("cancelled"), false);
    assert.equal(isInscripcionAgendarCtaVisible("completed"), false);
  });

  it("pending/rebook → Agendar; booked → manage", () => {
    assert.equal(isInscripcionAgendarCtaVisible("pending_booking"), true);
    assert.equal(isInscripcionAgendarCtaVisible("rebook_required"), true);
    assert.equal(isInscripcionManageVisible("booked"), true);
    assert.equal(isInscripcionManageVisible("pending_booking"), false);
  });

  it("hora display fija 11:00 AM", () => {
    assert.equal(formatInscripcionFixedTimeDisplay("11:00"), INSCRIPCION_FIXED_TIME_DISPLAY);
    assert.equal(formatInscripcionFixedTimeDisplay("12:00"), INSCRIPCION_FIXED_TIME_DISPLAY);
    assert.equal(INSCRIPCION_FIXED_TIME, "11:00");
  });

  it("cupo 0 → mensaje sin fallback bio", () => {
    assert.match(formatInscripcionCupoLabel(0, 0), /No hay cupo/);
    assert.match(formatInscripcionCupoLabel(3, 3), /3 lugares/);
  });

  it("task notification kind", () => {
    const n = mapInscripcionRequirementToDashboardNotification(req("pending_booking"));
    assert.equal(n.kind, INSCRIPCION_REBOOK_TASK_KIND);
    assert.match(n.tipoLabel, /inscripción/i);
    const merged = mergeInscripcionBellNotifications([], [req("pending_booking")]);
    assert.equal(merged.length, 1);
    assert.equal(
      mergeInscripcionBellNotifications(merged, [req("booked")]).length,
      0,
    );
  });
});

describe("P175 B2 Mesa", () => {
  it("solicitar solo si elegible y sin requirement abierto", () => {
    assert.equal(
      canMesaSolicitarInscripcion({
        etapaActual: 5,
        submittedToMesa: true,
        cicloActivo: true,
        subestado: "en_proceso",
        openRequirement: null,
      }),
      true,
    );
    assert.equal(
      canMesaSolicitarInscripcion({
        etapaActual: 5,
        submittedToMesa: true,
        cicloActivo: true,
        subestado: "en_proceso",
        openRequirement: req("pending_booking"),
      }),
      false,
    );
    assert.equal(
      canMesaSolicitarInscripcion({
        etapaActual: 2,
        submittedToMesa: true,
        cicloActivo: true,
        subestado: "en_proceso",
        openRequirement: null,
      }),
      false,
    );
  });

  it("summary + badge + hora inscripción", () => {
    const rows = [
      entry("biometricos"),
      entry("inscripcion", { bookingId: "b2" }),
      entry("notificacion", { bookingId: "b3", bookingTime: "12:00" }),
    ];
    const summary = deriveMesaAgendaSummary(rows);
    assert.equal(summary.inscripcion, 1);
    assert.equal(summary.biometricos, 1);
    assert.equal(summary.notificacion, 1);
    assert.equal(formatMesaAgendaKind("inscripcion"), "Inscripción");
    assert.match(mesaAgendaKindBadgeClass("inscripcion"), /teal/);
    assert.equal(formatMesaAgendaTime(entry("inscripcion")), "11:00 AM");
    assert.notEqual(
      mesaAgendaKindBadgeClass("inscripcion"),
      mesaAgendaKindBadgeClass("notificacion"),
    );
    const onlyInsc = rows.filter((r) => r.kind === "inscripcion");
    assert.equal(onlyInsc.length, 1);
  });
});

describe("P175 B2 Excel / report_group", () => {
  it("kind inscripcion → bloque INSCRIPCIÓN; histórico preservado", () => {
    assert.equal(fallbackReportGroupFromKind("inscripcion"), "inscripcion");
  });
});
