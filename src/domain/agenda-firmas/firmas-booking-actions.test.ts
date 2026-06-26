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
  it("manage actions solo etapa 9 con booking", () => {
    assert.equal(canShowFirmasManageActions({ etapaActual: 9, hasActiveBooking: true }), true);
    assert.equal(canShowFirmasManageActions({ etapaActual: 10, hasActiveBooking: true }), false);
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

  it("etapa 10 sin cancelación previa no muestra card", () => {
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

  it("etapa 10 con booking activo no muestra card", () => {
    assert.equal(
      canShowAsesorFirmasSupabaseCard({
        submittedToMesa: true,
        etapaActual: 10,
        hasActiveBooking: true,
        hasLastCancelledBooking: true,
      }),
      false,
    );
  });
});
