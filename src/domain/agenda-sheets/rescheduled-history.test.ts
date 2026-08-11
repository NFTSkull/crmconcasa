/**
 * Contrato reagendado histórico CITAS 2026 (RESCHEDULED_HISTORY + replacement).
 * Cubre los 30 gates de aceptación a nivel dominio/parser (sin I/O Sheet).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RESCHEDULED_HISTORY_ORANGE_BG,
  RESCHEDULED_HISTORY_STATUS,
  RESCHEDULED_HISTORY_TECH_CONTRACT,
  RESCHEDULED_HISTORY_VISIBLE_LABEL,
  applyRescheduleHistoryOnGrid,
  buildInsertRowBelowRequests,
  buildOrangeHistoryFormatRequests,
  buildReplacementSlotTechRow,
  buildReplacementSlotVisibleRow,
  buildRescheduledHistoryTechRow,
  countActiveCapacityAfterReschedule,
  decideHistoryRollbackFromGrid,
  describeHistoryTechRow,
  inspectRescheduleHistoryState,
  isPriorSheetStillActivelyOwned,
  isRescheduleCancelContext,
  isRescheduledHistoryEstado,
  locateHistoryRowByBookingId,
  locateSheetRowByBookingId,
  planRowReindexAfterInsert,
  rescheduleHistoryIdempotencyKey,
  shiftSheetRowAfterInsert,
  shouldRollbackHistoryAfterCreateFailure,
  siblingCreateHasPriorCancelled,
  simulateSameTabReschedules,
  sortRescheduleJobsForTabSafety,
  tabMutationLockKey,
} from "./rescheduled-history";
import {
  classifyCancelRowClearance,
  inventoryStatusFromSheetRow,
} from "./cancel-row-clearance";
import {
  classifyInventoryReconcileRow,
  classifySheetRowOccupancy,
  countAvailableByPhysicalOccupancy,
  decideBookHardGate,
} from "./manual-occupancy";
import { parsePhysicalInventoryFromGrid } from "./sheet-inventory";
import {
  decidePriorCancelGate,
  sortOutboxForRescheduleMove,
} from "./reschedule-sheet-move";

const BOOKING_1 = "11111111-1111-4111-8111-111111111111";
const BOOKING_2 = "22222222-2222-4222-8222-222222222222";
const BOOKING_NEW = "33333333-3333-4333-8333-333333333333";
const EXP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function rowAU(partial: {
  hora?: string;
  nss?: string;
  nombre?: string;
  asesor?: string;
  estado?: string;
  bookingId?: string;
  expedienteId?: string;
}): string[] {
  const r = Array.from({ length: 21 }, () => "");
  r[0] = partial.hora ?? "";
  r[1] = partial.nss ?? "";
  r[2] = partial.nombre ?? "";
  r[3] = partial.asesor ?? "";
  r[14] = partial.estado ?? "";
  r[15] = partial.bookingId ?? "";
  r[16] = partial.expedienteId ?? "";
  r[18] = partial.bookingId ? "crm" : "";
  return r;
}

describe("rescheduled-history — marcador y contexto", () => {
  it("1-3. conserva datos + marca REAGENDADO + naranja definido", () => {
    const tech = buildRescheduledHistoryTechRow({
      priorBookingId: BOOKING_1,
      expedienteId: EXP,
      slotKey: "k",
      syncUpdatedAt: "2026-08-11T12:00:00Z",
    });
    assert.equal(tech[0], RESCHEDULED_HISTORY_VISIBLE_LABEL);
    assert.equal(tech[1], BOOKING_1);
    assert.equal(tech[2], EXP);
    assert.ok(isRescheduledHistoryEstado(tech[0]));
    assert.ok(isRescheduledHistoryEstado(RESCHEDULED_HISTORY_STATUS));
    assert.equal(typeof RESCHEDULED_HISTORY_ORANGE_BG.red, "number");
    const orangeReqs = buildOrangeHistoryFormatRequests({
      sheetId: 9,
      historyRow1Based: 10,
    });
    assert.equal(orangeReqs.length, 1);
    assert.ok(
      JSON.stringify(orangeReqs[0]).includes("backgroundColor"),
    );
  });

  it("4-6. replacement debajo misma hora sin PII", () => {
    const vis = buildReplacementSlotVisibleRow("9:00 AM");
    assert.deepEqual(vis, ["9:00 AM", "", "", ""]);
    const tech = buildReplacementSlotTechRow();
    assert.ok(tech.every((c) => c === ""));
    const insert = buildInsertRowBelowRequests({
      sheetId: 1,
      historyRow1Based: 10,
    });
    assert.deepEqual(
      (insert[0] as { insertDimension: { range: { startIndex: number } } })
        .insertDimension.range.startIndex,
      10,
    );
  });
});

describe("rescheduled-history — capacidad e inventario P162", () => {
  it("7-10. capacidad 3 → history disabled + replacement available = 3", () => {
    // Monterrey Firmas 9:00 x3; reagendar booking1
    const after = countActiveCapacityAfterReschedule({
      statuses: ["disabled", "available", "linked", "available"],
    });
    // disabled no cuenta; 3 activos; 1 linked → 2 available
    assert.equal(after.activePhysical, 3);
    assert.equal(after.occupied, 1);
    assert.equal(after.available, 2);

    assert.equal(
      inventoryStatusFromSheetRow({
        nss: "NSS1",
        name: "CLIENTE A",
        advisor: "ASESOR",
        techBookingId: BOOKING_1,
        techEstado: "REAGENDADO",
      }),
      "disabled",
    );
    assert.equal(
      classifySheetRowOccupancy({
        hora: "9:00 AM",
        nss: "NSS1",
        name: "CLIENTE A",
        advisor: "ASESOR",
        techBookingId: BOOKING_1,
        techEstado: "REAGENDADO",
      }),
      "RESCHEDULED_HISTORY",
    );
    assert.equal(
      classifySheetRowOccupancy({
        hora: "9:00 AM",
        nss: "",
        name: "",
        advisor: "",
      }),
      "FREE",
    );
    const c = countAvailableByPhysicalOccupancy(
      [
        { slotTime: "09:00", status: "disabled" },
        { slotTime: "09:00", status: "available" },
        { slotTime: "09:00", status: "linked" },
        { slotTime: "09:00", status: "available" },
      ],
      "09:00",
    );
    assert.equal(c.physicalTotal, 3);
    assert.equal(c.available, 2);
  });

  it("8. histórico NO occupied_external aunque tenga NSS/NOMBRE/ASESOR", () => {
    assert.notEqual(
      inventoryStatusFromSheetRow({
        nss: "X",
        name: "Y",
        advisor: "Z",
        techBookingId: BOOKING_1,
        techEstado: "REAGENDADO",
      }),
      "occupied_external",
    );
    assert.equal(
      classifyInventoryReconcileRow({
        sheetClass: "RESCHEDULED_HISTORY",
        inventoryStatus: "disabled",
        inventoryBookingId: null,
        sheetBookingId: BOOKING_1,
      }),
      "RESCHEDULED_HISTORY",
    );
  });
});

describe("rescheduled-history — idempotencia, reindex, rollback", () => {
  it("12-15. booking IDs y reindex tras insert", () => {
    const plan = planRowReindexAfterInsert({
      insertAfterRow1Based: 10,
      inventoryRows: [
        { id: "h", sheetRow: 10 },
        { id: "b2", sheetRow: 11 },
        { id: "free", sheetRow: 12 },
      ],
      linkRows: [
        { id: "l2", rowNumber: 11 },
      ],
    });
    assert.deepEqual(plan.inventoryUpdates, [
      { id: "b2", from: 11, to: 12 },
      { id: "free", from: 12, to: 13 },
    ]);
    assert.deepEqual(plan.linkUpdates, [
      { id: "l2", from: 11, to: 12 },
    ]);
    assert.equal(
      shiftSheetRowAfterInsert({ currentRow: 11, insertAfterRow1Based: 10 }),
      12,
    );
  });

  it("16-17. retry no duplica history/replacement", () => {
    const history = rowAU({
      hora: "9:00 AM",
      nss: "NSS1",
      nombre: "CLIENTE A",
      asesor: "ASESOR",
      estado: "REAGENDADO",
      bookingId: BOOKING_1,
      expedienteId: EXP,
    });
    const replacement = rowAU({ hora: "9:00 AM" });
    const once = inspectRescheduleHistoryState({
      historyRowNumber: 10,
      historyRow: history,
      nextRow: replacement,
      priorBookingId: BOOKING_1,
    });
    assert.equal(once.phase, "already_complete");
    const twice = inspectRescheduleHistoryState({
      historyRowNumber: 10,
      historyRow: history,
      nextRow: replacement,
      priorBookingId: BOOKING_1,
    });
    assert.equal(twice.phase, "already_complete");
    assert.equal(
      rescheduleHistoryIdempotencyKey({
        priorBookingId: BOOKING_1,
        newBookingId: BOOKING_NEW,
      }),
      `${BOOKING_1}>${BOOKING_NEW}:history:v1`,
    );
  });

  it("18. rollback seguro si create falla tras history", () => {
    assert.equal(
      shouldRollbackHistoryAfterCreateFailure({
        createFailed: true,
        historySnapshot: {
          mode: "history",
          bookingId: BOOKING_1,
          expedienteId: EXP,
          sheetTitle: "11 AGOSTO ",
          sheetId: 5,
          historyRow: 10,
          replacementRow: 11,
          techOUBefore: ["SINCRONIZADO", BOOKING_1, EXP, "k", "crm", "t", "1"],
          hora: "9:00 AM",
          insertedReplacement: true,
        },
      }),
      true,
    );
  });

  it("19. cancelación pura ≠ histórico", () => {
    assert.equal(
      isRescheduleCancelContext({
        payloadRescheduleMove: false,
        siblingCreateHasPrior: false,
        cancelNote: "Cliente canceló",
      }),
      false,
    );
    assert.equal(
      isRescheduleCancelContext({
        siblingCreateHasPrior: true,
      }),
      true,
    );
    assert.equal(
      siblingCreateHasPriorCancelled(
        [
          {
            event_type: "booking_created",
            payload: { prior_cancelled_booking_id: BOOKING_1 },
          },
        ],
        BOOKING_1,
      ),
      true,
    );
    // Cancelación pura sigue safe_to_clear
    const d = classifyCancelRowClearance({
      row: rowAU({
        hora: "9:00 AM",
        nss: "N",
        nombre: "C",
        asesor: "A",
        estado: "SINCRONIZADO",
        bookingId: BOOKING_1,
        expedienteId: EXP,
      }),
      cancelledBookingId: BOOKING_1,
      cancelledExpedienteId: EXP,
    });
    assert.equal(d.classification, "safe_to_clear");
    assert.equal(d.clearBtoD, true);
  });

  it("30. fila sin hora no genera replacement", () => {
    const r = inspectRescheduleHistoryState({
      historyRowNumber: 10,
      historyRow: rowAU({
        hora: "",
        nss: "N",
        nombre: "C",
        estado: "SINCRONIZADO",
        bookingId: BOOKING_1,
      }),
      priorBookingId: BOOKING_1,
    });
    assert.equal(r.phase, "no_hora");
  });
});

describe("rescheduled-history — fixture Monterrey Firmas + sedes", () => {
  it("18+20-23. parse grid: history disabled, capacity 3, sedes/kind", () => {
    const mkSection = (header: string, rows: string[][]) => [
      [header],
      ["HORA", "NSS", "NOMBRE", "ASESOR"],
      ...rows,
    ];

    const cases: Array<{
      header: string;
      kind: "biometricos" | "firmas";
      sede: "monterrey" | "apodaca";
      time: string;
    }> = [
      {
        header: "MONTERREY BIOMETRICOS",
        kind: "biometricos",
        sede: "monterrey",
        time: "09:00",
      },
      {
        header: "APODACA BIOMETRICOS",
        kind: "biometricos",
        sede: "apodaca",
        time: "09:00",
      },
      {
        header: "MONTERREY FIRMAS",
        kind: "firmas",
        sede: "monterrey",
        time: "09:00",
      },
      {
        header: "APODACA FIRMAS",
        kind: "firmas",
        sede: "apodaca",
        time: "10:00",
      },
    ];

    for (const c of cases) {
      const grid = mkSection(c.header, [
        rowAU({
          hora: c.time === "09:00" ? "9:00 AM" : "10:00 AM",
          nss: "NSS1",
          nombre: "CLIENTE A",
          asesor: "ASESOR",
          estado: "REAGENDADO",
          bookingId: BOOKING_1,
          expedienteId: EXP,
        }).slice(0, 4).concat(
          Array(10).fill(""),
          ["REAGENDADO", BOOKING_1, EXP, "", "crm", "", ""],
        ),
        rowAU({
          hora: c.time === "09:00" ? "9:00 AM" : "10:00 AM",
        }).slice(0, 4),
        rowAU({
          hora: c.time === "09:00" ? "9:00 AM" : "10:00 AM",
          nss: "NSS2",
          nombre: "CLIENTE B",
          asesor: "ASESOR",
          estado: "SINCRONIZADO",
          bookingId: BOOKING_2,
          expedienteId: EXP,
        }).slice(0, 4).concat(
          Array(10).fill(""),
          ["SINCRONIZADO", BOOKING_2, EXP, "", "crm", "", ""],
        ),
        rowAU({
          hora: c.time === "09:00" ? "9:00 AM" : "10:00 AM",
        }).slice(0, 4),
      ]);

      // Rebuild proper 21-col rows for parser
      const fullGrid: string[][] = [
        [c.header],
        ["HORA", "NSS", "NOMBRE", "ASESOR"],
        rowAU({
          hora: c.time === "09:00" ? "9:00 AM" : "10:00 AM",
          nss: "NSS1",
          nombre: "CLIENTE A",
          asesor: "ASESOR",
          estado: "REAGENDADO",
          bookingId: BOOKING_1,
          expedienteId: EXP,
        }),
        rowAU({
          hora: c.time === "09:00" ? "9:00 AM" : "10:00 AM",
        }),
        rowAU({
          hora: c.time === "09:00" ? "9:00 AM" : "10:00 AM",
          nss: "NSS2",
          nombre: "CLIENTE B",
          asesor: "ASESOR",
          estado: "SINCRONIZADO",
          bookingId: BOOKING_2,
          expedienteId: EXP,
        }),
        rowAU({
          hora: c.time === "09:00" ? "9:00 AM" : "10:00 AM",
        }),
      ];

      const parsed = parsePhysicalInventoryFromGrid({
        bookingDate: "2026-08-11",
        sheetTitle: "11 AGOSTO ",
        sheetId: 42,
        grid: fullGrid,
      });
      const slots = parsed.rows.filter((r) => r.locationId === c.sede && r.kind === c.kind);
      assert.ok(slots.length >= 4, `${c.header} slots`);
      const hist = slots.find((r) => r.disabledReason === "rescheduled_history");
      assert.ok(hist, `${c.header} history`);
      assert.equal(hist!.status, "disabled");
      assert.equal(hist!.techBookingId, null);
      const free = slots.filter((r) => r.status === "available");
      assert.ok(free.length >= 1, `${c.header} replacement available`);
      const linked = slots.find((r) => r.techBookingId === BOOKING_2);
      assert.ok(linked, `${c.header} booking2 intact`);
      void grid;
    }
  });

  it("11. destino booking normal + gate prior con history", () => {
    assert.deepEqual(
      decidePriorCancelGate({
        priorCancelledBookingId: BOOKING_1,
        priorCancelOutboxPending: false,
        priorActiveLinkExists: false,
        priorSheetRowStillOwned: isPriorSheetStillActivelyOwned({
          sheetBookingId: BOOKING_1,
          sheetEstado: "REAGENDADO",
          priorBookingId: BOOKING_1,
        }),
      }),
      { allowCreate: true, reason: "prior_cleared" },
    );
    assert.equal(
      isPriorSheetStillActivelyOwned({
        sheetBookingId: BOOKING_1,
        sheetEstado: "SINCRONIZADO",
        priorBookingId: BOOKING_1,
      }),
      true,
    );
  });

  it("24-29. P160/P162/book_gate/manual occupancy intactos", () => {
    // P160 orden
    const sorted = sortOutboxForRescheduleMove([
      { event_type: "booking_created", created_at: "2" },
      { event_type: "booking_cancelled", created_at: "1" },
    ]);
    assert.equal(sorted[0]?.event_type, "booking_cancelled");

    // P162 manual sigue ocupando
    assert.equal(
      classifySheetRowOccupancy({
        hora: "9:00 AM",
        nss: "MANUAL",
        name: "",
        advisor: "",
      }),
      "OCCUPIED_MANUAL",
    );

    // book hard gate
    assert.equal(
      decideBookHardGate({ liveAvailableForSlot: 0 }).allow,
      false,
    );
    assert.equal(
      decideBookHardGate({ liveAvailableForSlot: 1 }).allow,
      true,
    );

    // cross-location: parser no mezcla sedes (section headers)
    const parsed = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-11",
      sheetTitle: "11 AGOSTO ",
      sheetId: 1,
      grid: [
        ["MONTERREY FIRMAS"],
        ["HORA"],
        rowAU({ hora: "9:00 AM", estado: "REAGENDADO", bookingId: BOOKING_1 }),
        ["APODACA FIRMAS"],
        ["HORA"],
        rowAU({ hora: "10:00 AM" }),
      ],
    });
    const mty = parsed.rows.filter((r) => r.locationId === "monterrey");
    const apo = parsed.rows.filter((r) => r.locationId === "apodaca");
    assert.ok(mty.every((r) => r.kind === "firmas"));
    assert.ok(apo.every((r) => r.locationId === "apodaca"));
  });
});

describe("rescheduled-history — UUID P, concurrencia, rollback, Apodaca A1", () => {
  it("O:U history conserva P=prior y no es ACTIVE", () => {
    const tech = buildRescheduledHistoryTechRow({
      priorBookingId: BOOKING_1,
      expedienteId: EXP,
      slotKey: "firmas|2026-08-11|09:00|monterrey|sheet=09:00|sheetId=1|row=10",
      syncUpdatedAt: "2026-08-11T18:00:00Z",
    });
    const d = describeHistoryTechRow(tech);
    assert.equal(d.bookingId, BOOKING_1);
    assert.equal(d.estado, "REAGENDADO");
    assert.equal(d.isHistorical, true);
    assert.equal(d.isActiveSync, false);
    assert.equal(d.syncVersion, "rescheduled_history_v1");
    assert.equal(RESCHEDULED_HISTORY_TECH_CONTRACT.P_bookingId, "prior_booking_uuid");
    assert.equal(
      classifySheetRowOccupancy({
        hora: "9:00 AM",
        nss: "NSS1",
        name: "A",
        advisor: "X",
        techBookingId: BOOKING_1,
        techEstado: "REAGENDADO",
      }),
      "RESCHEDULED_HISTORY",
    );
  });

  it("clear de cancelación pura no borra fila ya REAGENDADO", () => {
    const d = classifyCancelRowClearance({
      row: rowAU({
        hora: "9:00 AM",
        nss: "NSS1",
        nombre: "A",
        asesor: "X",
        estado: "REAGENDADO",
        bookingId: BOOKING_1,
        expedienteId: EXP,
      }),
      cancelledBookingId: BOOKING_1,
      cancelledExpedienteId: EXP,
    });
    assert.equal(d.classification, "already_absent");
    assert.equal(d.clearBtoD, false);
    assert.equal(d.clearOU, false);
  });

  it("dos reagendos mismo tab: UUID relocate evita cruce + capacidad 3", () => {
    const initial = [
      {
        hora: "9:00 AM",
        nss: "NSS1",
        nombre: "CLIENTE A",
        asesor: "ASESOR",
        estado: "SINCRONIZADO",
        bookingId: BOOKING_1,
      },
      {
        hora: "9:00 AM",
        nss: "NSS2",
        nombre: "CLIENTE B",
        asesor: "ASESOR",
        estado: "SINCRONIZADO",
        bookingId: BOOKING_2,
      },
      {
        hora: "9:00 AM",
        nss: "",
        nombre: "",
        asesor: "",
        estado: "",
        bookingId: "",
      },
    ];
    const naiveAsc = simulateSameTabReschedules({
      initial,
      jobs: [
        { bookingId: BOOKING_1, staleSheetRow: 1 },
        { bookingId: BOOKING_2, staleSheetRow: 2 },
      ],
      relocateByUuid: false,
      processOrder: "stale_asc",
    });
    assert.equal(naiveAsc.crossedClients, true);

    const safe = simulateSameTabReschedules({
      initial,
      jobs: [
        { bookingId: BOOKING_1, staleSheetRow: 1 },
        { bookingId: BOOKING_2, staleSheetRow: 2 },
      ],
      relocateByUuid: true,
      processOrder: "stale_asc",
    });
    assert.equal(safe.crossedClients, false);
    assert.equal(safe.activeCapacity, 3);
    assert.equal(safe.historyCount, 2);
    assert.equal(locateHistoryRowByBookingId(safe.grid, BOOKING_1), 1);
    assert.ok(Number(locateHistoryRowByBookingId(safe.grid, BOOKING_2)) > 1);
    assert.equal(locateSheetRowByBookingId(safe.grid, BOOKING_2), locateHistoryRowByBookingId(safe.grid, BOOKING_2));

    const desc = simulateSameTabReschedules({
      initial,
      jobs: [
        { bookingId: BOOKING_1, staleSheetRow: 1 },
        { bookingId: BOOKING_2, staleSheetRow: 2 },
      ],
      relocateByUuid: true,
      processOrder: "stale_desc",
    });
    assert.equal(desc.crossedClients, false);
    assert.equal(desc.activeCapacity, 3);
  });

  it("sort mismo tab: fila inferior primero + lock key", () => {
    const sorted = sortRescheduleJobsForTabSafety([
      {
        event_type: "booking_cancelled",
        payload: { sheet_id: 9, sheet_row: 10 },
      },
      {
        event_type: "booking_cancelled",
        payload: { sheet_id: 9, sheet_row: 15 },
      },
    ]);
    assert.equal(sorted[0]?.payload?.sheet_row, 15);
    assert.equal(sorted[1]?.payload?.sheet_row, 10);
    assert.equal(tabMutationLockKey("ss", 9), "agenda-sheet-tab:ss:9");
  });

  it("rollback por UUID: no borra fila ajena; dest confirmado no revierte", () => {
    const afterA = applyRescheduleHistoryOnGrid({
      grid: [
        rowAU({
          hora: "9:00 AM",
          nss: "NSS1",
          nombre: "A",
          estado: "SINCRONIZADO",
          bookingId: BOOKING_1,
        }),
        rowAU({
          hora: "9:00 AM",
          nss: "NSS2",
          nombre: "B",
          estado: "SINCRONIZADO",
          bookingId: BOOKING_2,
        }),
      ],
      priorBookingId: BOOKING_1,
    });
    const rb = decideHistoryRollbackFromGrid({
      grid: afterA.grid,
      priorBookingId: BOOKING_1,
      destinationWriteConfirmed: false,
    });
    assert.equal(rb.action, "restore_active_and_delete_replacement");
    if (rb.action === "restore_active_and_delete_replacement") {
      assert.equal(rb.historyRow, 1);
      assert.equal(rb.replacementRow, 2);
    }
    const keep = decideHistoryRollbackFromGrid({
      grid: afterA.grid,
      priorBookingId: BOOKING_1,
      destinationWriteConfirmed: true,
    });
    assert.equal(keep.action, "noop_keep_history");
    const missing = decideHistoryRollbackFromGrid({
      grid: afterA.grid,
      priorBookingId: BOOKING_NEW,
      destinationWriteConfirmed: false,
    });
    assert.equal(missing.action, "noop");
  });

  it("retry timeout: already_complete no duplica replacement", () => {
    let grid = [
      rowAU({
        hora: "9:00 AM",
        nss: "NSS1",
        nombre: "A",
        estado: "SINCRONIZADO",
        bookingId: BOOKING_1,
      }),
      rowAU({ hora: "9:00 AM" }),
      rowAU({ hora: "9:00 AM" }),
    ];
    const first = applyRescheduleHistoryOnGrid({
      grid,
      priorBookingId: BOOKING_1,
    });
    grid = first.grid;
    const inspect1 = inspectRescheduleHistoryState({
      historyRowNumber: first.historyRow,
      historyRow: grid[first.historyRow - 1]!,
      nextRow: grid[first.historyRow]!,
      priorBookingId: BOOKING_1,
    });
    assert.equal(inspect1.phase, "already_complete");
    const inspect2 = inspectRescheduleHistoryState({
      historyRowNumber: first.historyRow,
      historyRow: grid[first.historyRow - 1]!,
      nextRow: grid[first.historyRow]!,
      priorBookingId: BOOKING_1,
    });
    assert.equal(inspect2.phase, "already_complete");
    assert.equal(
      grid.filter((r) => String(r[14]).toUpperCase() === "REAGENDADO").length,
      1,
    );
  });

  it("P113 Apodaca A1 vacío: insert no mezcla con Monterrey", () => {
    const grid = [
      [""],
      ["HORA", "NSS", "NOMBRE", "ASESOR"],
      rowAU({
        hora: "10:30 AM",
        nss: "NSS1",
        nombre: "CLIENTE A",
        asesor: "ASESOR",
        estado: "REAGENDADO",
        bookingId: BOOKING_1,
        expedienteId: EXP,
      }),
      rowAU({ hora: "10:30 AM" }),
      rowAU({
        hora: "10:30 AM",
        nss: "NSS2",
        nombre: "CLIENTE B",
        asesor: "ASESOR",
        estado: "SINCRONIZADO",
        bookingId: BOOKING_2,
        expedienteId: EXP,
      }),
      ["MONTERREY FIRMAS"],
      ["HORA", "NSS", "NOMBRE", "ASESOR"],
      rowAU({ hora: "8:30 AM" }),
    ];
    const parsed = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-12",
      sheetTitle: "12 AGOSTO ",
      sheetId: 7,
      grid,
    });
    const apo = parsed.rows.filter(
      (r) => r.locationId === "apodaca" && r.kind === "firmas",
    );
    const mty = parsed.rows.filter(
      (r) => r.locationId === "monterrey" && r.kind === "firmas",
    );
    assert.ok(apo.length >= 3, "apodaca slots");
    assert.equal(
      apo.filter((r) => r.status === "disabled").length,
      1,
    );
    assert.equal(
      apo.filter((r) => r.status === "available").length +
        apo.filter((r) => r.status === "linked").length,
      apo.length - 1,
    );
    assert.ok(mty.every((r) => r.sheetSlotTime.startsWith("08:30") || r.sheetSlotTime === "08:30"));
    assert.ok(apo.every((r) => r.locationId === "apodaca"));
    assert.ok(!parsed.issues.some((i) => i.code === "INVALID_OR_MISSING_SECTION_HEADER"));
  });
});
