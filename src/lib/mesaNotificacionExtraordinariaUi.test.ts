import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAgendaAccordionSummary,
} from "@/components/mesa-control/MesaExpedienteDocumentosResumen";
import {
  buildNotificacionBandejaLine,
  buildNotificacionExtraordinariaAccordionSummary,
  notificacionBookingStatusLabel,
} from "@/lib/mesaNotificacionExtraordinariaUi";

describe("mesa notificación extraordinaria UI", () => {
  it("resumen acordeón independiente de agenda biométricos", () => {
    const summary = buildNotificacionExtraordinariaAccordionSummary({
      id: "b1",
      expedienteId: "e1",
      bookingDate: "2026-07-20",
      bookingTime: "12:00",
      locationId: "monterrey",
      status: "booked",
      note: null,
      createdById: "a1",
    });
    assert.match(summary, /2026/);
    assert.match(summary, /12:00 PM/);
    assert.match(summary, /Agendada/);
  });

  it("agenda / citas no mezcla notificación", () => {
    const summary = buildAgendaAccordionSummary({
      etapaActual: 3,
      biometricBooking: null,
      hasActiveNotificacionBooking: true,
      firmasBooking: null,
      fechaCita: "2026-07-20T18:00:00.000Z",
    });
    assert.doesNotMatch(summary, /Notificación/);
    assert.equal(summary, "Sin citas registradas");
  });

  it("línea bandeja incluye fecha, hora, estado y roles", () => {
    const line = buildNotificacionBandejaLine({
      booking: {
        id: "b1",
        expedienteId: "e1",
        bookingDate: "2026-07-20",
        bookingTime: "12:00",
        locationId: "apodaca",
        status: "booked",
        note: null,
        createdById: "a1",
      },
      agendadoPorLabel: "Ana Asesor",
      asesorDueñoLabel: "Luis Dueño",
    });
    assert.match(line, /12:00 PM/);
    assert.match(line, /Agendada por Ana Asesor/);
    assert.match(line, /Asesor Luis Dueño/);
    assert.equal(notificacionBookingStatusLabel("booked"), "Agendada");
  });
});
