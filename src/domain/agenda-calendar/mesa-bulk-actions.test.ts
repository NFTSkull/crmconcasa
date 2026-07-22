import test from "node:test";
import assert from "node:assert/strict";

import type { MesaAgendaBookingEntry } from "./mesa.types";
import {
  MESA_BULK_SELECTION_LIMIT,
  buildBulkSelectionSummary,
  executeBulkDriveValidation,
  executeBulkStageAdvance,
  formatBulkNotSelectableReason,
  getBulkAdvanceEligibility,
  getBulkDriveEligibility,
  groupBulkAdvancePlanByTransition,
  isBulkSelectable,
  listEligibleVisibleBookingIds,
  mapBulkAdvanceFailureReason,
  mesaAgendaKindBulkLabel,
  planBulkDriveValidation,
  planBulkStageAdvance,
  reconcileBulkSelection,
  removeSuccessfulBookingsFromSelection,
  removeSuccessfulExpedientesFromSelection,
  runWithConcurrencyLimit,
  selectAllEligibleVisible,
  toggleBookingInSelection,
} from "./mesa-bulk-actions";

const NOW = Date.parse("2026-07-20T18:00:00.000Z");

function entry(
  partial: Partial<MesaAgendaBookingEntry> & Pick<MesaAgendaBookingEntry, "bookingId">,
): MesaAgendaBookingEntry {
  return {
    bookingId: partial.bookingId,
    expedienteId: partial.expedienteId ?? "exp-1",
    bookingDate: partial.bookingDate ?? "2026-07-15",
    bookingTime: partial.bookingTime ?? "10:00",
    kind: partial.kind ?? "biometricos",
    status: partial.status ?? "booked",
    locationId: partial.locationId ?? "mty",
    note: partial.note ?? null,
    createdAt: partial.createdAt ?? "2026-07-10T12:00:00.000Z",
    cancelledAt: partial.cancelledAt ?? null,
    clienteNombre: partial.clienteNombre ?? "Cliente",
    nss: partial.nss ?? null,
    etapaActual: partial.etapaActual ?? 4,
    subestado: partial.subestado ?? "en_proceso",
    submittedToMesa: partial.submittedToMesa ?? true,
    asesor: partial.asesor ?? { id: "a1", fullName: "Asesor", email: "a@x.com" },
    createdBy: partial.createdBy ?? { id: "c1", fullName: "Mesa", email: "m@x.com" },
    driveValidated: partial.driveValidated ?? false,
    driveValidatedAt: partial.driveValidatedAt ?? null,
    driveValidatedBy: partial.driveValidatedBy ?? null,
    reportGroup: partial.reportGroup ?? null,
  };
}

const ROLE = "mesa_interno";

test("Drive — elegible booked + no validado + rol", () => {
  const e = entry({ bookingId: "b1", driveValidated: false, status: "booked" });
  assert.equal(getBulkDriveEligibility(e, ROLE).eligible, true);
});

test("Drive — ya validado no elegible", () => {
  const r = getBulkDriveEligibility(
    entry({ bookingId: "b1", driveValidated: true }),
    ROLE,
  );
  assert.equal(r.eligible, false);
  assert.equal(r.reason, "Drive ya validado");
});

test("Drive — cancelado no elegible", () => {
  const r = getBulkDriveEligibility(
    entry({ bookingId: "b1", status: "cancelled" }),
    ROLE,
  );
  assert.equal(r.eligible, false);
  assert.equal(r.reason, "La cita no está activa");
});

test("Drive — rol no permitido", () => {
  const r = getBulkDriveEligibility(entry({ bookingId: "b1" }), "asesor");
  assert.equal(r.eligible, false);
  assert.equal(r.reason, "Sin permisos");
});

test("Drive — sin bookingId", () => {
  const r = getBulkDriveEligibility(entry({ bookingId: "   " }), ROLE);
  assert.equal(r.eligible, false);
  assert.equal(r.reason, "Cita sin identificador");
});

test("Avance — notificación 3→5", () => {
  const r = getBulkAdvanceEligibility(
    entry({
      bookingId: "n1",
      kind: "notificacion",
      etapaActual: 3,
      subestado: "en_proceso",
    }),
    ROLE,
    NOW,
  );
  assert.equal(r.eligible, true);
  assert.deepEqual(r.transition, { fromStage: 3, toStage: 5, kind: "notificacion" });
});

test("Avance — biométricos 4→5", () => {
  const r = getBulkAdvanceEligibility(
    entry({ bookingId: "b1", kind: "biometricos", etapaActual: 4 }),
    ROLE,
    NOW,
  );
  assert.equal(r.eligible, true);
  assert.deepEqual(r.transition, { fromStage: 4, toStage: 5, kind: "biometricos" });
});

test("Avance — biométricos 5→6 con cita ocurrida", () => {
  const r = getBulkAdvanceEligibility(
    entry({
      bookingId: "b1",
      kind: "biometricos",
      etapaActual: 5,
      bookingDate: "2026-07-19",
      bookingTime: "09:00",
      subestado: "en_proceso",
    }),
    ROLE,
    NOW,
  );
  assert.equal(r.eligible, true);
  assert.equal(r.transition?.toStage, 6);
});

test("Avance — biométricos 5 sin cita ocurrida", () => {
  const r = getBulkAdvanceEligibility(
    entry({
      bookingId: "b1",
      kind: "biometricos",
      etapaActual: 5,
      bookingDate: "2026-07-21",
      bookingTime: "09:00",
      subestado: "en_proceso",
    }),
    ROLE,
    NOW,
  );
  assert.equal(r.eligible, false);
  assert.equal(r.reason, "La cita todavía no ocurre");
});

test("Avance — firmas 9→10", () => {
  const r = getBulkAdvanceEligibility(
    entry({
      bookingId: "f1",
      kind: "firmas",
      etapaActual: 9,
      subestado: "en_proceso",
    }),
    ROLE,
    NOW,
  );
  assert.equal(r.eligible, true);
  assert.deepEqual(r.transition, { fromStage: 9, toStage: 10, kind: "firmas" });
});

test("Avance — etapa incompatible", () => {
  const r = getBulkAdvanceEligibility(
    entry({ bookingId: "b1", kind: "biometricos", etapaActual: 6 }),
    ROLE,
    NOW,
  );
  assert.equal(r.eligible, false);
  assert.equal(r.reason, "Etapa no compatible");
});

test("Avance — booking cancelado", () => {
  const r = getBulkAdvanceEligibility(
    entry({ bookingId: "b1", status: "cancelled", etapaActual: 4 }),
    ROLE,
    NOW,
  );
  assert.equal(r.eligible, false);
  assert.equal(r.reason, "La cita no está activa");
});

test("Avance — Drive pendiente no bloquea", () => {
  const r = getBulkAdvanceEligibility(
    entry({
      bookingId: "b1",
      kind: "biometricos",
      etapaActual: 4,
      driveValidated: false,
    }),
    ROLE,
    NOW,
  );
  assert.equal(r.eligible, true);
});

test("Avance — rol no permitido", () => {
  const r = getBulkAdvanceEligibility(
    entry({ bookingId: "b1", etapaActual: 4 }),
    "editor",
    NOW,
  );
  assert.equal(r.eligible, false);
  assert.equal(r.reason, "Sin permisos");
});

test("isBulkSelectable — Drive o avance", () => {
  const driveOnly = entry({
    bookingId: "d1",
    etapaActual: 1,
    driveValidated: false,
    status: "booked",
  });
  assert.equal(isBulkSelectable(driveOnly, ROLE, NOW), true);

  const advanceOnly = entry({
    bookingId: "a1",
    etapaActual: 4,
    driveValidated: true,
  });
  assert.equal(getBulkDriveEligibility(advanceOnly, ROLE).eligible, false);
  assert.equal(isBulkSelectable(advanceOnly, ROLE, NOW), true);

  const none = entry({
    bookingId: "x1",
    status: "cancelled",
    driveValidated: true,
    etapaActual: 1,
  });
  assert.equal(isBulkSelectable(none, ROLE, NOW), false);
  assert.match(formatBulkNotSelectableReason(none, ROLE, NOW), /No disponible/);
});

test("selección — toggle y deseleccionar", () => {
  let sel = new Set<string>();
  sel = new Set(toggleBookingInSelection(sel, "b1", true));
  assert.deepEqual([...sel], ["b1"]);
  sel = new Set(toggleBookingInSelection(sel, "b2", true));
  assert.equal(sel.size, 2);
  sel = new Set(toggleBookingInSelection(sel, "b1", false));
  assert.deepEqual([...sel], ["b2"]);
});

test("selección — seleccionar todos elegibles; no deshabilitados", () => {
  const rows = [
    entry({ bookingId: "ok1", etapaActual: 4 }),
    entry({ bookingId: "ok2", etapaActual: 4 }),
    entry({ bookingId: "bad", status: "cancelled", driveValidated: true, etapaActual: 1 }),
  ];
  const result = selectAllEligibleVisible(rows, ROLE, NOW);
  assert.equal(result.eligibleTotal, 2);
  assert.equal(result.selectedCount, 2);
  assert.equal(result.limitCapped, false);
  assert.ok(result.nextSelected.has("ok1"));
  assert.ok(result.nextSelected.has("ok2"));
  assert.equal(result.nextSelected.has("bad"), false);
});

test("selección — máximo 100 y aviso 100 de N", () => {
  const rows = Array.from({ length: 105 }, (_, i) =>
    entry({ bookingId: `b${i}`, etapaActual: 4 }),
  );
  const result = selectAllEligibleVisible(rows, ROLE, NOW);
  assert.equal(result.eligibleTotal, 105);
  assert.equal(result.selectedCount, MESA_BULK_SELECTION_LIMIT);
  assert.equal(result.limitCapped, true);
  assert.match(result.limitNotice ?? "", /100 de 105/);
  assert.equal(result.nextSelected.size, 100);
  assert.ok(result.nextSelected.has("b0"));
  assert.equal(result.nextSelected.has("b100"), false);
});

test("selección — Día solo toma el día visible (orden renderizado)", () => {
  const dayVisible = [
    entry({ bookingId: "d1", bookingDate: "2026-07-20", etapaActual: 4 }),
    entry({ bookingId: "d2", bookingDate: "2026-07-20", etapaActual: 4 }),
  ];
  const weekOther = entry({
    bookingId: "w1",
    bookingDate: "2026-07-21",
    etapaActual: 4,
  });
  const result = selectAllEligibleVisible(dayVisible, ROLE, NOW);
  assert.equal(result.nextSelected.has("d1"), true);
  assert.equal(result.nextSelected.has("w1"), false);
  assert.equal(listEligibleVisibleBookingIds([weekOther], ROLE, NOW).includes("w1"), true);
});

test("headerState indeterminado / all / none", () => {
  const rows = [
    entry({ bookingId: "a", etapaActual: 4 }),
    entry({ bookingId: "b", etapaActual: 4 }),
    entry({ bookingId: "c", etapaActual: 4 }),
  ];
  const none = buildBulkSelectionSummary(rows, new Set(), ROLE, NOW);
  assert.equal(none.headerState, "none");

  const some = buildBulkSelectionSummary(rows, new Set(["a"]), ROLE, NOW);
  assert.equal(some.headerState, "some");

  const all = buildBulkSelectionSummary(rows, new Set(["a", "b", "c"]), ROLE, NOW);
  assert.equal(all.headerState, "all");
});

test("refetch — elimina IDs ausentes e inelegibles", () => {
  const prev = new Set(["keep", "gone", "now-bad"]);
  const nextRows = [
    entry({ bookingId: "keep", etapaActual: 4 }),
    entry({
      bookingId: "now-bad",
      status: "cancelled",
      driveValidated: true,
      etapaActual: 1,
    }),
  ];
  const reconciled = reconcileBulkSelection(prev, nextRows, ROLE, NOW);
  assert.deepEqual([...reconciled].sort(), ["keep"]);
});

test("bookings duplicados — un expediente único para avance", () => {
  const rows = [
    entry({
      bookingId: "b1",
      expedienteId: "exp-same",
      kind: "biometricos",
      etapaActual: 4,
      driveValidated: true,
    }),
    entry({
      bookingId: "b2",
      expedienteId: "exp-same",
      kind: "biometricos",
      etapaActual: 4,
      driveValidated: true,
    }),
  ];
  const summary = buildBulkSelectionSummary(rows, new Set(["b1", "b2"]), ROLE, NOW);
  assert.equal(summary.selectedBookingCount, 2);
  assert.equal(summary.uniqueExpedienteCount, 1);
  assert.equal(summary.eligibleAdvanceExpedienteCount, 1);
  assert.equal(summary.eligibleDriveCount, 0);
});

test("toggle respeta límite 100", () => {
  const ids = Array.from({ length: 100 }, (_, i) => `b${i}`);
  let sel: ReadonlySet<string> = new Set(ids);
  sel = toggleBookingInSelection(sel, "extra", true);
  assert.equal(sel.has("extra"), false);
  assert.equal(sel.size, 100);
});

test("planBulkDriveValidation — mezcla elegibles/omitidos y dedupe", () => {
  const rows = [
    entry({ bookingId: "ok1", driveValidated: false }),
    entry({ bookingId: "ok2", driveValidated: false }),
    entry({ bookingId: "done", driveValidated: true }),
    entry({ bookingId: "cancel", status: "cancelled" }),
  ];
  const plan = planBulkDriveValidation(
    new Set(["ok1", "ok1", "ok2", "done", "cancel", "missing"]),
    rows,
    ROLE,
  );
  assert.equal(plan.requested, 5);
  assert.equal(plan.eligibleEntries.length, 2);
  assert.equal(plan.skipped.length, 3);
  assert.ok(plan.skipped.some((s) => s.reason === "Drive ya validado"));
  assert.ok(plan.skipped.some((s) => s.reason === "La cita no está activa"));
  assert.ok(plan.skipped.some((s) => s.reason === "Cita no encontrada en el listado"));
});

test("runWithConcurrencyLimit — máximo 5 en vuelo", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 12 }, (_, i) => i);
  await runWithConcurrencyLimit(items, 5, async (n) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n * 2;
  });
  assert.ok(maxInFlight <= 5);
  assert.ok(maxInFlight >= 2);
});

test("executeBulkDriveValidation — parcial, no reintenta, p_validated vía wrapper", async () => {
  const rows = [
    entry({ bookingId: "ok", driveValidated: false, clienteNombre: "A" }),
    entry({ bookingId: "fail", driveValidated: false, clienteNombre: "B" }),
    entry({ bookingId: "skip", driveValidated: true, clienteNombre: "C" }),
  ];
  const calls: string[] = [];
  const summary = await executeBulkDriveValidation({
    selectedBookingIds: new Set(["ok", "fail", "skip"]),
    loadedEntries: rows,
    role: ROLE,
    concurrency: 5,
    validate: async (id) => {
      calls.push(id);
      if (id === "fail") throw new Error("Solo se puede validar una cita agendada (activa).");
    },
  });
  assert.deepEqual(calls.sort(), ["fail", "ok"]);
  assert.equal(summary.requested, 3);
  assert.equal(summary.eligible, 2);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 1);
  assert.equal(calls.filter((c) => c === "ok").length, 1);

  const nextSel = removeSuccessfulBookingsFromSelection(
    new Set(["ok", "fail", "skip"]),
    summary,
  );
  assert.equal(nextSel.has("ok"), false);
  assert.equal(nextSel.has("fail"), true);
  assert.equal(nextSel.has("skip"), true);
});

test("executeBulkDriveValidation — un fallo no detiene las demás", async () => {
  const rows = [
    entry({ bookingId: "a", driveValidated: false }),
    entry({ bookingId: "b", driveValidated: false }),
    entry({ bookingId: "c", driveValidated: false }),
  ];
  const order: string[] = [];
  const summary = await executeBulkDriveValidation({
    selectedBookingIds: new Set(["a", "b", "c"]),
    loadedEntries: rows,
    role: ROLE,
    concurrency: 2,
    validate: async (id) => {
      order.push(id);
      if (id === "b") throw new Error("error b");
    },
  });
  assert.equal(summary.succeeded, 2);
  assert.equal(summary.failed, 1);
  assert.equal(order.length, 3);
});

test("planBulkStageAdvance — un booking un expediente", () => {
  const rows = [
    entry({
      bookingId: "n1",
      expedienteId: "exp-n",
      kind: "notificacion",
      etapaActual: 3,
    }),
  ];
  const plan = planBulkStageAdvance(new Set(["n1"]), rows, ROLE, NOW);
  assert.equal(plan.eligibleExpedientes, 1);
  assert.equal(plan.items[0]?.fromStage, 3);
  assert.equal(plan.items[0]?.toStage, 5);
  assert.equal(plan.items[0]?.kind, "notificacion");
});

test("planBulkStageAdvance — varios bookings mismo expediente → una vez", () => {
  const rows = [
    entry({ bookingId: "b1", expedienteId: "exp-a", etapaActual: 4, kind: "biometricos" }),
    entry({ bookingId: "b2", expedienteId: "exp-a", etapaActual: 4, kind: "biometricos" }),
  ];
  const plan = planBulkStageAdvance(new Set(["b1", "b2"]), rows, ROLE, NOW);
  assert.equal(plan.uniqueExpedientes, 1);
  assert.equal(plan.eligibleExpedientes, 1);
  assert.deepEqual(plan.items[0]?.bookingIds, ["b1", "b2"]);
  assert.equal(plan.items[0]?.representativeBookingId, "b1");
});

test("planBulkStageAdvance — transiciones distintas → omitido", () => {
  const rows = [
    entry({
      bookingId: "bio4",
      expedienteId: "exp-x",
      kind: "biometricos",
      etapaActual: 4,
    }),
    entry({
      bookingId: "bio5",
      expedienteId: "exp-x",
      kind: "biometricos",
      etapaActual: 5,
      bookingDate: "2026-07-10",
    }),
  ];
  const plan = planBulkStageAdvance(new Set(["bio4", "bio5"]), rows, ROLE, NOW);
  assert.equal(plan.eligibleExpedientes, 0);
  assert.equal(plan.skippedExpedientes, 1);
  assert.equal(
    plan.items[0]?.reason,
    "El expediente tiene citas seleccionadas con transiciones distintas",
  );
});

test("planBulkStageAdvance — Drive pendiente no bloquea", () => {
  const rows = [
    entry({
      bookingId: "b1",
      expedienteId: "exp-1",
      etapaActual: 4,
      driveValidated: false,
    }),
  ];
  const plan = planBulkStageAdvance(new Set(["b1"]), rows, ROLE, NOW);
  assert.equal(plan.eligibleExpedientes, 1);
});

test("planBulkStageAdvance — 5→6 antes de cita no elegible", () => {
  const rows = [
    entry({
      bookingId: "b1",
      expedienteId: "exp-1",
      kind: "biometricos",
      etapaActual: 5,
      bookingDate: "2026-07-25",
      bookingTime: "10:00",
    }),
  ];
  const plan = planBulkStageAdvance(new Set(["b1"]), rows, ROLE, NOW);
  assert.equal(plan.eligibleExpedientes, 0);
  assert.equal(plan.items[0]?.reason, "La cita todavía no ocurre");
});

test("planBulkStageAdvance — firmas 9→10 y cancelado omitido", () => {
  const rows = [
    entry({
      bookingId: "f1",
      expedienteId: "exp-f",
      kind: "firmas",
      etapaActual: 9,
    }),
    entry({
      bookingId: "c1",
      expedienteId: "exp-c",
      status: "cancelled",
      etapaActual: 4,
    }),
  ];
  const plan = planBulkStageAdvance(new Set(["f1", "c1"]), rows, ROLE, NOW);
  assert.equal(plan.eligibleExpedientes, 1);
  assert.equal(plan.skippedExpedientes, 1);
  assert.ok(plan.items.some((i) => i.eligible && i.toStage === 10));
});

test("planBulkStageAdvance — rol no permitido", () => {
  const rows = [entry({ bookingId: "b1", etapaActual: 4 })];
  const plan = planBulkStageAdvance(new Set(["b1"]), rows, "asesor", NOW);
  assert.equal(plan.eligibleExpedientes, 0);
  assert.equal(plan.items[0]?.reason, "Sin permisos");
});

test("groupBulkAdvancePlanByTransition — agrupa", () => {
  const rows = [
    entry({
      bookingId: "n1",
      expedienteId: "e1",
      kind: "notificacion",
      etapaActual: 3,
    }),
    entry({
      bookingId: "n2",
      expedienteId: "e2",
      kind: "notificacion",
      etapaActual: 3,
    }),
    entry({ bookingId: "b1", expedienteId: "e3", etapaActual: 4 }),
  ];
  const plan = planBulkStageAdvance(new Set(["n1", "n2", "b1"]), rows, ROLE, NOW);
  const groups = groupBulkAdvancePlanByTransition(plan);
  assert.equal(groups.length, 2);
  const notif = groups.find((g) => g.kind === "notificacion");
  assert.equal(notif?.expedienteCount, 2);
  assert.equal(notif?.fromStage, 3);
  assert.equal(notif?.toStage, 5);
});

test("executeBulkStageAdvance — una llamada por expediente, parcial, concurrencia", async () => {
  const rows = [
    entry({ bookingId: "a1", expedienteId: "ea", etapaActual: 4 }),
    entry({ bookingId: "a2", expedienteId: "ea", etapaActual: 4 }),
    entry({ bookingId: "b1", expedienteId: "eb", etapaActual: 4 }),
    entry({ bookingId: "c1", expedienteId: "ec", etapaActual: 4 }),
    entry({
      bookingId: "skip",
      expedienteId: "es",
      status: "cancelled",
      etapaActual: 4,
    }),
  ];
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const summary = await executeBulkStageAdvance({
    selectedBookingIds: new Set(["a1", "a2", "b1", "c1", "skip"]),
    loadedEntries: rows,
    role: ROLE,
    nowMs: NOW,
    concurrency: 2,
    advance: async (id) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push(id);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      if (id === "eb") throw new Error("No hay una transición de etapa disponible para el estado actual del expediente.");
    },
  });
  assert.deepEqual(calls.sort(), ["ea", "eb", "ec"]);
  assert.equal(calls.filter((c) => c === "ea").length, 1);
  assert.ok(maxInFlight <= 2);
  assert.equal(summary.succeeded, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skippedExpedientes, 1);
  const failed = summary.results.find((r) => r.expedienteId === "eb");
  assert.equal(failed?.reason, "El expediente cambió de etapa antes de procesarse.");

  const nextSel = removeSuccessfulExpedientesFromSelection(
    new Set(["a1", "a2", "b1", "c1", "skip"]),
    summary,
  );
  assert.equal(nextSel.has("a1"), false);
  assert.equal(nextSel.has("a2"), false);
  assert.equal(nextSel.has("b1"), true);
  assert.equal(nextSel.has("c1"), false);
  assert.equal(nextSel.has("skip"), true);
});

test("mapBulkAdvanceFailureReason y label kind", () => {
  assert.equal(
    mapBulkAdvanceFailureReason(
      new Error("No hay una transición de etapa disponible para el estado actual del expediente."),
    ),
    "El expediente cambió de etapa antes de procesarse.",
  );
  assert.equal(mesaAgendaKindBulkLabel("biometricos"), "biométricos");
});
