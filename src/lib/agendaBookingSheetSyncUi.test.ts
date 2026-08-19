import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agendaBookingCrmSuccessCopy,
  agendaBookingSyncConfirmedCopy,
  agendaBookingSyncFailedCopy,
  agendaBookingSyncPendingTimeoutCopy,
  nextAgendaBookingSheetSyncUi,
} from "./agendaBookingSheetSyncUi";

describe("agendaBookingSheetSyncUi", () => {
  it("C12: éxito CRM no afirma sync Drive/agenda completada", () => {
    const reagendar = agendaBookingCrmSuccessCopy("reagendar");
    const book = agendaBookingCrmSuccessCopy("book");
    assert.match(reagendar, /CRM/);
    assert.match(reagendar, /sincronizando/);
    assert.doesNotMatch(reagendar, /correctamente/);
    assert.doesNotMatch(reagendar, /Drive/);
    assert.doesNotMatch(book, /correctamente/);
  });

  it("C13: SYNCED afirma agenda confirmada", () => {
    const ui = nextAgendaBookingSheetSyncUi({
      kind: "reagendar",
      status: "SYNCED",
      attempts: 1,
    });
    assert.equal(ui.continuePolling, false);
    assert.equal(ui.message, agendaBookingSyncConfirmedCopy("reagendar"));
    assert.match(ui.message, /sincronizada con agenda/);
  });

  it("C14: pending timeout conserva cita CRM", () => {
    const ui = nextAgendaBookingSheetSyncUi({
      kind: "book",
      status: "PENDING",
      attempts: 8,
      maxAttempts: 8,
    });
    assert.equal(ui.continuePolling, false);
    assert.equal(ui.message, agendaBookingSyncPendingTimeoutCopy());
    assert.match(ui.message, /guardada en CRM/);
    assert.doesNotMatch(ui.message, /no existe/);
  });

  it("FAILED no niega el booking CRM", () => {
    const ui = nextAgendaBookingSheetSyncUi({
      kind: "reagendar",
      status: "FAILED",
      attempts: 2,
    });
    assert.equal(ui.continuePolling, false);
    assert.equal(ui.message, agendaBookingSyncFailedCopy());
    assert.match(ui.message, /guardada en CRM/);
  });
});

describe("AgendaBiometricosSupabaseCard — copy de sync", () => {
  const card = readFileSync(
    join(process.cwd(), "src/components/asesor/AgendaBiometricosSupabaseCard.tsx"),
    "utf8",
  );

  it("C12: card no usa 'reagendada correctamente' como éxito Drive", () => {
    assert.doesNotMatch(card, /reagendada correctamente/);
    assert.doesNotMatch(card, /agendada correctamente/);
    assert.match(card, /agendaBookingCrmSuccessCopy/);
    assert.match(card, /nextAgendaBookingSheetSyncUi/);
  });
});
