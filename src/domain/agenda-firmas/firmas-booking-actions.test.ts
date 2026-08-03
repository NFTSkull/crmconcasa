import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapBookFirmasRpcError } from "./book-firmas-rpc-error";
import { canShowAsesorFirmasSupabaseCard, canShowFirmasManageActions } from "./firmas-booking-actions";

describe("mapBookFirmasRpcError", () => {
  it("mapea etapa incorrecta", () => {
    const err = mapBookFirmasRpcError({
      message: "book_firmas: solo se puede agendar en etapa 9 (actual: 8)",
    });
    assert.match(err.message, /etapa 9/i);
  });

  it("mapea asesor no dueño", () => {
    const err = mapBookFirmasRpcError({
      message: "book_firmas: solo el asesor dueño puede agendar firma",
    });
    assert.match(err.message, /asesor dueño/i);
  });
});

describe("firmas-booking-actions", () => {
  it("manage actions: etapa 9 u 10 con booking activo", () => {
    assert.equal(canShowFirmasManageActions({ etapaActual: 9, hasActiveBooking: true }), true);
    assert.equal(canShowFirmasManageActions({ etapaActual: 10, hasActiveBooking: true }), true);
    assert.equal(canShowFirmasManageActions({ etapaActual: 8, hasActiveBooking: true }), false);
    assert.equal(canShowFirmasManageActions({ etapaActual: 11, hasActiveBooking: true }), false);
    assert.equal(canShowFirmasManageActions({ etapaActual: 9, hasActiveBooking: false }), false);
    assert.equal(canShowFirmasManageActions({ etapaActual: 10, hasActiveBooking: false }), false);
  });

  it("card asesor etapa 9 enviado", () => {
    assert.equal(
      canShowAsesorFirmasSupabaseCard({ submittedToMesa: true, etapaActual: 9 }),
      true,
    );
    assert.equal(
      canShowAsesorFirmasSupabaseCard({ submittedToMesa: true, etapaActual: 8 }),
      false,
    );
  });

  it("post-Acuse: etapa 8 no monta card; tras transición 9 sí (Agendar)", () => {
    assert.equal(
      canShowAsesorFirmasSupabaseCard({ submittedToMesa: true, etapaActual: 8 }),
      false,
    );
    assert.equal(
      canShowAsesorFirmasSupabaseCard({ submittedToMesa: true, etapaActual: 9 }),
      true,
    );
    assert.equal(
      canShowFirmasManageActions({ etapaActual: 9, hasActiveBooking: false }),
      false,
    );
    assert.equal(
      canShowFirmasManageActions({ etapaActual: 9, hasActiveBooking: true }),
      true,
    );
  });

  it("card asesor etapa 10 con booking activo (reagendar post-Acuse)", () => {
    assert.equal(
      canShowAsesorFirmasSupabaseCard({
        submittedToMesa: true,
        etapaActual: 10,
        hasActiveBooking: true,
        hasLastCancelledBooking: false,
      }),
      true,
    );
  });

  it("card asesor etapa 10 tras cancelación Mesa sin booking activo", () => {
    assert.equal(
      canShowAsesorFirmasSupabaseCard({
        submittedToMesa: true,
        etapaActual: 10,
        hasActiveBooking: false,
        hasLastCancelledBooking: true,
      }),
      true,
    );
  });

  it("etapa 10 sin cancelación previa ni booking no muestra card", () => {
    assert.equal(
      canShowAsesorFirmasSupabaseCard({
        submittedToMesa: true,
        etapaActual: 10,
        hasActiveBooking: false,
        hasLastCancelledBooking: false,
      }),
      false,
    );
  });

  it("fecha_cita sin booking no habilita manage (solo hasActiveBooking)", () => {
    assert.equal(
      canShowFirmasManageActions({ etapaActual: 9, hasActiveBooking: false }),
      false,
    );
  });
});
