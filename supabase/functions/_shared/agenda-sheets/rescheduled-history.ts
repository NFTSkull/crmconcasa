/**
 * Reagendado CRM → Sheets: conserva fila histórica + replacement FREE.
 * Lógica pura (sin I/O). Identidad por booking UUID; color es solo UX.
 *
 * CANCELACIÓN pura sigue clear B:D+O:U (P160).
 * REAGENDADO usa este contrato (no vacía B:D).
 */

import { AGENDA_SHEET_COL_INDEX, buildTechWriteRow } from "./tech-columns.ts";

/** Marcador canónico estructurado (lógica / inventario / P162). */
export const RESCHEDULED_HISTORY_STATUS = "RESCHEDULED_HISTORY" as const;

/** Texto amigable en columna O (ESTADO CRM). */
export const RESCHEDULED_HISTORY_VISIBLE_LABEL = "REAGENDADO" as const;

/** Fondo naranja claro (UX; no usar para lógica). */
export const RESCHEDULED_HISTORY_ORANGE_BG = {
  red: 0.988,
  green: 0.851,
  blue: 0.698,
} as const; // ≈ #FCD9B2

export type RescheduledHistoryEstado =
  | typeof RESCHEDULED_HISTORY_VISIBLE_LABEL
  | typeof RESCHEDULED_HISTORY_STATUS;

export function isRescheduledHistoryEstado(
  estado: string | null | undefined,
): boolean {
  const e = String(estado ?? "").trim().toUpperCase();
  return (
    e === RESCHEDULED_HISTORY_VISIBLE_LABEL ||
    e === RESCHEDULED_HISTORY_STATUS
  );
}

/**
 * ¿Este cancel outbox es parte de un reagendo (vs cancelación pura)?
 * Preferir payload / siblings / nota CRM — nunca NSS/nombre.
 */
export function isRescheduleCancelContext(input: {
  payloadRescheduleMove?: unknown;
  payloadRescheduleHistory?: unknown;
  siblingCreateHasPrior?: boolean;
  cancelNote?: string | null;
}): boolean {
  if (
    input.payloadRescheduleMove === true ||
    input.payloadRescheduleMove === "true"
  ) {
    return true;
  }
  if (
    input.payloadRescheduleHistory === true ||
    input.payloadRescheduleHistory === "true"
  ) {
    return true;
  }
  if (input.siblingCreateHasPrior) return true;
  const note = String(input.cancelNote ?? "").trim().toLowerCase();
  if (note.includes("reagend")) return true;
  return false;
}

export function siblingCreateHasPriorCancelled(
  events: ReadonlyArray<{
    event_type?: unknown;
    payload?: Record<string, unknown> | null;
  }>,
  priorBookingId: string,
): boolean {
  const prior = String(priorBookingId ?? "").trim();
  if (!prior) return false;
  return events.some((ev) => {
    if (String(ev.event_type ?? "") !== "booking_created") return false;
    const p = ev.payload ?? {};
    return String(p.prior_cancelled_booking_id ?? "").trim() === prior;
  });
}

export type RescheduleHistoryPhase =
  | "need_full" // marcar historial + insertar replacement
  | "need_replacement_only" // historial ok; falta fila FREE debajo
  | "already_complete" // historial + replacement presentes (idempotente)
  | "not_applicable" // no es fila CRM del prior
  | "no_hora" // no inventar replacement sin hora
  | "anomaly";

export type RescheduleHistoryInspection = Readonly<{
  phase: RescheduleHistoryPhase;
  historyRow: number;
  replacementRow: number | null;
  hora: string;
  reason: string;
}>;

function cell(
  row: ReadonlyArray<string | null | undefined>,
  idx: number,
): string {
  return String(row[idx] ?? "").trim();
}

/**
 * Inspecciona fila histórica (+ fila inmediata debajo) para idempotencia.
 */
export function inspectRescheduleHistoryState(input: {
  historyRowNumber: number;
  historyRow: ReadonlyArray<string | null | undefined>;
  /** Fila 1-based historyRow+1 (si existe). */
  nextRow?: ReadonlyArray<string | null | undefined> | null;
  priorBookingId: string;
}): RescheduleHistoryInspection {
  const historyRow = Number(input.historyRowNumber);
  const prior = String(input.priorBookingId ?? "").trim();
  const row = input.historyRow ?? [];
  const hora = String(row[AGENDA_SHEET_COL_INDEX.hora] ?? "");
  const horaTrim = hora.trim();
  const estado = cell(row, AGENDA_SHEET_COL_INDEX.estado);
  const metaBooking = cell(row, AGENDA_SHEET_COL_INDEX.bookingId);

  if (!prior || !(historyRow > 0)) {
    return {
      phase: "anomaly",
      historyRow,
      replacementRow: null,
      hora,
      reason: "coords_or_prior_invalid",
    };
  }

  if (!horaTrim) {
    return {
      phase: "no_hora",
      historyRow,
      replacementRow: null,
      hora,
      reason: "history_row_without_slot_time",
    };
  }

  const historyMarked =
    isRescheduledHistoryEstado(estado) &&
    (!metaBooking || metaBooking === prior);

  if (historyMarked && metaBooking && metaBooking !== prior) {
    return {
      phase: "anomaly",
      historyRow,
      replacementRow: null,
      hora,
      reason: "history_marked_other_booking",
    };
  }

  const next = input.nextRow ?? null;
  const nextHora = next ? String(next[AGENDA_SHEET_COL_INDEX.hora] ?? "").trim() : "";
  const nextNss = next ? cell(next, AGENDA_SHEET_COL_INDEX.nss) : "";
  const nextNombre = next ? cell(next, AGENDA_SHEET_COL_INDEX.nombre) : "";
  const nextAsesor = next ? cell(next, AGENDA_SHEET_COL_INDEX.asesor) : "";
  const nextEstado = next ? cell(next, AGENDA_SHEET_COL_INDEX.estado) : "";
  const nextBooking = next ? cell(next, AGENDA_SHEET_COL_INDEX.bookingId) : "";

  const replacementLooksFree =
    Boolean(next) &&
    nextHora === horaTrim &&
    !nextNss &&
    !nextNombre &&
    !nextAsesor &&
    !nextBooking &&
    !isRescheduledHistoryEstado(nextEstado);

  if (historyMarked && replacementLooksFree) {
    return {
      phase: "already_complete",
      historyRow,
      replacementRow: historyRow + 1,
      hora,
      reason: "history_and_replacement_present",
    };
  }

  if (historyMarked && !replacementLooksFree) {
    return {
      phase: "need_replacement_only",
      historyRow,
      replacementRow: null,
      hora,
      reason: "history_present_missing_replacement",
    };
  }

  if (metaBooking && metaBooking !== prior) {
    return {
      phase: "not_applicable",
      historyRow,
      replacementRow: null,
      hora,
      reason: "row_owned_by_other_booking",
    };
  }

  if (!metaBooking && !isRescheduledHistoryEstado(estado)) {
    return {
      phase: "not_applicable",
      historyRow,
      replacementRow: null,
      hora,
      reason: "no_crm_booking_on_row",
    };
  }

  return {
    phase: "need_full",
    historyRow,
    replacementRow: null,
    hora,
    reason: "mark_history_and_insert_replacement",
  };
}

/** O:U para fila histórica (conserva P/Q; estado REAGENDADO). */
export function buildRescheduledHistoryTechRow(input: {
  priorBookingId: string;
  expedienteId: string;
  slotKey?: string | null;
  syncUpdatedAt: string;
  syncVersion?: string | number;
}): string[] {
  return buildTechWriteRow({
    estado: RESCHEDULED_HISTORY_VISIBLE_LABEL,
    bookingId: String(input.priorBookingId).trim(),
    expedienteId: String(input.expedienteId ?? "").trim(),
    slotKey: String(input.slotKey ?? "").trim(),
    syncSource: "crm",
    syncUpdatedAt: input.syncUpdatedAt,
    syncVersion: input.syncVersion ?? "rescheduled_history_v1",
  });
}

/** Fila replacement: misma hora, B:D vacíos, O:U vacíos. */
export function buildReplacementSlotVisibleRow(horaKeep: string): string[] {
  return [String(horaKeep ?? ""), "", "", ""];
}

export function buildReplacementSlotTechRow(): string[] {
  return ["", "", "", "", "", "", ""];
}

/**
 * Sheets API: insertar 1 fila debajo de historyRow (1-based).
 * startIndex 0-based = historyRow (inserta antes de la fila siguiente).
 */
export function buildInsertRowBelowRequests(input: {
  sheetId: number;
  historyRow1Based: number;
}): object[] {
  const startIndex = Number(input.historyRow1Based);
  if (!(startIndex > 0) || !Number.isFinite(input.sheetId)) return [];
  return [
    {
      insertDimension: {
        range: {
          sheetId: Number(input.sheetId),
          dimension: "ROWS",
          startIndex,
          endIndex: startIndex + 1,
        },
        inheritFromBefore: true,
      },
    },
  ];
}

/** Copia formato A:U de history → replacement (misma fila+1). */
export function buildCopyFormatToReplacementRequests(input: {
  sheetId: number;
  historyRow1Based: number;
}): object[] {
  const hist = Number(input.historyRow1Based);
  if (!(hist > 0)) return [];
  return [
    {
      copyPaste: {
        source: {
          sheetId: Number(input.sheetId),
          startRowIndex: hist - 1,
          endRowIndex: hist,
          startColumnIndex: 0,
          endColumnIndex: 21,
        },
        destination: {
          sheetId: Number(input.sheetId),
          startRowIndex: hist,
          endRowIndex: hist + 1,
          startColumnIndex: 0,
          endColumnIndex: 21,
        },
        pasteType: "PASTE_FORMAT",
        pasteOrientation: "NORMAL",
      },
    },
  ];
}

/** Pinta naranja A:U en la fila histórica. */
export function buildOrangeHistoryFormatRequests(input: {
  sheetId: number;
  historyRow1Based: number;
}): object[] {
  const hist = Number(input.historyRow1Based);
  if (!(hist > 0)) return [];
  return [
    {
      repeatCell: {
        range: {
          sheetId: Number(input.sheetId),
          startRowIndex: hist - 1,
          endRowIndex: hist,
          startColumnIndex: 0,
          endColumnIndex: 21,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { ...RESCHEDULED_HISTORY_ORANGE_BG },
          },
        },
        fields: "userEnteredFormat.backgroundColor",
      },
    },
  ];
}

/** Elimina replacement (rollback). startIndex = replacementRow-1. */
export function buildDeleteReplacementRowRequests(input: {
  sheetId: number;
  replacementRow1Based: number;
}): object[] {
  const r = Number(input.replacementRow1Based);
  if (!(r > 0)) return [];
  return [
    {
      deleteDimension: {
        range: {
          sheetId: Number(input.sheetId),
          dimension: "ROWS",
          startIndex: r - 1,
          endIndex: r,
        },
      },
    },
  ];
}

/**
 * Tras insertar 1 fila debajo de `insertAfterRow` (1-based history),
 * toda fila abs > insertAfterRow se desplaza +1.
 */
export function shiftSheetRowAfterInsert(input: {
  currentRow: number;
  insertAfterRow1Based: number;
}): number {
  const cur = Number(input.currentRow);
  const after = Number(input.insertAfterRow1Based);
  if (!(cur > 0) || !(after > 0)) return cur;
  if (cur > after) return cur + 1;
  return cur;
}

export function planRowReindexAfterInsert(input: {
  insertAfterRow1Based: number;
  inventoryRows: ReadonlyArray<{ id: string; sheetRow: number }>;
  linkRows: ReadonlyArray<{ id: string; rowNumber: number }>;
}): {
  inventoryUpdates: Array<{ id: string; from: number; to: number }>;
  linkUpdates: Array<{ id: string; from: number; to: number }>;
} {
  const after = Number(input.insertAfterRow1Based);
  const inventoryUpdates = input.inventoryRows
    .map((r) => {
      const to = shiftSheetRowAfterInsert({
        currentRow: r.sheetRow,
        insertAfterRow1Based: after,
      });
      return to !== r.sheetRow
        ? { id: r.id, from: r.sheetRow, to }
        : null;
    })
    .filter((x): x is { id: string; from: number; to: number } => x != null);

  const linkUpdates = input.linkRows
    .map((r) => {
      const to = shiftSheetRowAfterInsert({
        currentRow: r.rowNumber,
        insertAfterRow1Based: after,
      });
      return to !== r.rowNumber
        ? { id: r.id, from: r.rowNumber, to }
        : null;
    })
    .filter((x): x is { id: string; from: number; to: number } => x != null);

  return { inventoryUpdates, linkUpdates };
}

/**
 * Capacidad activa: excluye RESCHEDULED_HISTORY (disabled).
 * Fixture 3 slots → history disabled + replacement available = 3.
 */
export function countActiveCapacityAfterReschedule(input: {
  statuses: ReadonlyArray<
    "available" | "linked" | "claimed" | "occupied_external" | "disabled" | "conflict"
  >;
}): { activePhysical: number; available: number; occupied: number } {
  const active = input.statuses.filter((s) => s !== "disabled");
  const occupied = active.filter((s) =>
    s === "linked" ||
    s === "claimed" ||
    s === "occupied_external" ||
    s === "conflict"
  ).length;
  return {
    activePhysical: active.length,
    occupied,
    available: Math.max(0, active.length - occupied),
  };
}

export type RescheduleHistoryRestoreMode = "clear_restore" | "history_rollback";

export type RescheduleHistorySnapshot = Readonly<{
  mode: "history";
  bookingId: string;
  expedienteId: string;
  sheetTitle: string;
  sheetId: number;
  historyRow: number;
  replacementRow: number | null;
  /** O:U previo al mark (para rollback a cita activa). */
  techOUBefore: readonly string[];
  hora: string;
  insertedReplacement: boolean;
}>;

/**
 * Rollback si create destino falla tras history+replacement en el mismo batch.
 */
export function shouldRollbackHistoryAfterCreateFailure(input: {
  createFailed: boolean;
  historySnapshot: RescheduleHistorySnapshot | null | undefined;
}): boolean {
  return Boolean(
    input.createFailed &&
      input.historySnapshot?.mode === "history" &&
      input.historySnapshot.historyRow > 0 &&
      input.historySnapshot.sheetTitle,
  );
}

/** Idempotency key específica de history+replacement. */
export function rescheduleHistoryIdempotencyKey(input: {
  priorBookingId: string;
  newBookingId?: string | null;
  version?: string;
}): string {
  const neu = String(input.newBookingId ?? "").trim() || "pending";
  return `${input.priorBookingId}>${neu}:history:${input.version ?? "v1"}`;
}

/**
 * Gate Sheet: P=prior con O=REAGENDADO NO es “owned activo”.
 */
export function isPriorSheetStillActivelyOwned(input: {
  sheetBookingId: string | null | undefined;
  sheetEstado: string | null | undefined;
  priorBookingId: string;
}): boolean {
  const prior = String(input.priorBookingId ?? "").trim();
  const p = String(input.sheetBookingId ?? "").trim();
  if (!prior || p !== prior) return false;
  if (isRescheduledHistoryEstado(input.sheetEstado)) return false;
  return true;
}

/**
 * Contrato O:U de la fila histórica (P = UUID obligatorio).
 * O=REAGENDADO no es ACTIVE. P/Q identifican el booking cancelado.
 * S=crm. U=rescheduled_history_v1 (no SINCRONIZADO).
 */
export const RESCHEDULED_HISTORY_TECH_CONTRACT = {
  O_estado: RESCHEDULED_HISTORY_VISIBLE_LABEL,
  P_bookingId: "prior_booking_uuid",
  Q_expedienteId: "expediente_uuid",
  R_slotKey: "preserve_or_empty",
  S_syncSource: "crm",
  T_syncUpdatedAt: "iso8601",
  U_syncVersion: "rescheduled_history_v1",
} as const;

export function describeHistoryTechRow(
  techOU: ReadonlyArray<string | null | undefined>,
): {
  estado: string;
  bookingId: string;
  expedienteId: string;
  slotKey: string;
  syncSource: string;
  syncUpdatedAt: string;
  syncVersion: string;
  isHistorical: boolean;
  isActiveSync: boolean;
} {
  const estado = String(techOU[0] ?? "").trim();
  const bookingId = String(techOU[1] ?? "").trim();
  return {
    estado,
    bookingId,
    expedienteId: String(techOU[2] ?? "").trim(),
    slotKey: String(techOU[3] ?? "").trim(),
    syncSource: String(techOU[4] ?? "").trim(),
    syncUpdatedAt: String(techOU[5] ?? "").trim(),
    syncVersion: String(techOU[6] ?? "").trim(),
    isHistorical: isRescheduledHistoryEstado(estado),
    isActiveSync: String(estado).toUpperCase() === "SINCRONIZADO",
  };
}

export function a1FullTabAuRange(sheetTitle: string): string {
  const titleEsc = `'${sheetTitle.replace(/'/g, "''")}'`;
  return `${titleEsc}!A:U`;
}

/** Identidad canónica: columna P. Nunca NSS/nombre. */
export function locateSheetRowByBookingId(
  grid: ReadonlyArray<ReadonlyArray<string | null | undefined>>,
  bookingId: string,
): number | null {
  const id = String(bookingId ?? "").trim();
  if (!id) return null;
  for (let i = 0; i < grid.length; i++) {
    if (cell(grid[i] ?? [], AGENDA_SHEET_COL_INDEX.bookingId) === id) {
      return i + 1;
    }
  }
  return null;
}

export function locateHistoryRowByBookingId(
  grid: ReadonlyArray<ReadonlyArray<string | null | undefined>>,
  bookingId: string,
): number | null {
  const id = String(bookingId ?? "").trim();
  if (!id) return null;
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i] ?? [];
    if (cell(row, AGENDA_SHEET_COL_INDEX.bookingId) !== id) continue;
    if (isRescheduledHistoryEstado(cell(row, AGENDA_SHEET_COL_INDEX.estado))) {
      return i + 1;
    }
  }
  return null;
}

export function isReplacementFreeRow(
  historyHora: string,
  nextRow: ReadonlyArray<string | null | undefined> | null | undefined,
): boolean {
  if (!nextRow) return false;
  const horaTrim = String(historyHora ?? "").trim();
  const nextHora = String(nextRow[AGENDA_SHEET_COL_INDEX.hora] ?? "").trim();
  return (
    nextHora === horaTrim &&
    !cell(nextRow, AGENDA_SHEET_COL_INDEX.nss) &&
    !cell(nextRow, AGENDA_SHEET_COL_INDEX.nombre) &&
    !cell(nextRow, AGENDA_SHEET_COL_INDEX.asesor) &&
    !cell(nextRow, AGENDA_SHEET_COL_INDEX.bookingId) &&
    !isRescheduledHistoryEstado(cell(nextRow, AGENDA_SHEET_COL_INDEX.estado))
  );
}

/**
 * Lock lógico: un worker procesa outbox en serie (claim SKIP LOCKED).
 * Dentro del batch, mismos tab → filas inferiores primero + re-locate UUID.
 */
export function tabMutationLockKey(
  spreadsheetId: string,
  sheetId: number,
): string {
  return `agenda-sheet-tab:${spreadsheetId}:${sheetId}`;
}

export function sortRescheduleJobsForTabSafety<
  T extends {
    event_type?: unknown;
    payload?: { sheet_id?: unknown; sheet_row?: unknown } | null;
  },
>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => {
    const typeA = String(a.event_type ?? "");
    const typeB = String(b.event_type ?? "");
    const cancelA =
      typeA === "booking_cancelled" || typeA === "booking_cancelled_cleanup";
    const cancelB =
      typeB === "booking_cancelled" || typeB === "booking_cancelled_cleanup";
    if (cancelA && cancelB) {
      const sheetA = Number(a.payload?.sheet_id ?? 0);
      const sheetB = Number(b.payload?.sheet_id ?? 0);
      if (sheetA > 0 && sheetA === sheetB) {
        return (
          Number(b.payload?.sheet_row ?? 0) - Number(a.payload?.sheet_row ?? 0)
        );
      }
    }
    return 0;
  });
}

export type HistoryRollbackDecision =
  | {
      action: "restore_active_unmark";
      historyRow: number;
      reason: string;
    }
  | {
      action: "restore_active_and_delete_replacement";
      historyRow: number;
      replacementRow: number;
      reason: string;
    }
  | { action: "noop_keep_history"; reason: string }
  | { action: "noop"; reason: string };

/**
 * Rollback por UUID (grid live), nunca old_sheet_row+1 ciego.
 * Si destino ya está confirmado → no revertir origen (retry create).
 */
export function decideHistoryRollbackFromGrid(input: {
  grid: ReadonlyArray<ReadonlyArray<string | null | undefined>>;
  priorBookingId: string;
  destinationWriteConfirmed: boolean;
}): HistoryRollbackDecision {
  const historyRow = locateHistoryRowByBookingId(
    input.grid,
    input.priorBookingId,
  );
  if (!historyRow) {
    return { action: "noop", reason: "history_row_not_found_by_uuid" };
  }
  if (input.destinationWriteConfirmed) {
    return {
      action: "noop_keep_history",
      reason: "destination_confirmed_keep_history",
    };
  }
  const hist = input.grid[historyRow - 1] ?? [];
  const hora = String(hist[AGENDA_SHEET_COL_INDEX.hora] ?? "");
  const next = input.grid[historyRow] ?? null;
  if (isReplacementFreeRow(hora, next)) {
    return {
      action: "restore_active_and_delete_replacement",
      historyRow,
      replacementRow: historyRow + 1,
      reason: "uuid_history_plus_verified_replacement",
    };
  }
  return {
    action: "restore_active_unmark",
    historyRow,
    reason: "uuid_history_without_verified_replacement",
  };
}

type SimRow = {
  hora: string;
  nss: string;
  nombre: string;
  asesor: string;
  estado: string;
  bookingId: string;
};

function simToGrid(rows: SimRow[]): string[][] {
  return rows.map((r) => {
    const out = Array.from({ length: 21 }, () => "");
    out[0] = r.hora;
    out[1] = r.nss;
    out[2] = r.nombre;
    out[3] = r.asesor;
    out[14] = r.estado;
    out[15] = r.bookingId;
    out[18] = r.bookingId ? "crm" : "";
    return out;
  });
}

/**
 * Simula N reagendos en el mismo tab. Siempre relocaliza por UUID
 * después de cada insert (sheet_row stale se ignora).
 */
export function applyRescheduleHistoryOnGrid(input: {
  grid: string[][];
  priorBookingId: string;
  staleSheetRow?: number;
  /** Solo tests: simular worker que no relocaliza. */
  trustStaleRow?: boolean;
}): { grid: string[][]; historyRow: number; replacementRow: number } {
  const located = locateSheetRowByBookingId(input.grid, input.priorBookingId);
  const historyRow = input.trustStaleRow
    ? Number(input.staleSheetRow ?? located ?? 0)
    : (located ?? Number(input.staleSheetRow ?? 0));
  if (!(historyRow > 0)) {
    throw new Error("booking_uuid_not_on_grid");
  }
  const row = [...(input.grid[historyRow - 1] ?? [])];
  while (row.length < 21) row.push("");
  row[AGENDA_SHEET_COL_INDEX.estado] = RESCHEDULED_HISTORY_VISIBLE_LABEL;
  const hora = String(row[0] ?? "");
  const replacement = Array.from({ length: 21 }, () => "");
  replacement[0] = hora;
  const next = [
    ...input.grid.slice(0, historyRow),
    replacement,
    ...input.grid.slice(historyRow),
  ];
  next[historyRow - 1] = row;
  return {
    grid: next,
    historyRow,
    replacementRow: historyRow + 1,
  };
}

export function simulateSameTabReschedules(input: {
  initial: SimRow[];
  jobs: ReadonlyArray<{ bookingId: string; staleSheetRow: number }>;
  /** Si false, usa staleSheetRow (demostrar cruce). */
  relocateByUuid: boolean;
  processOrder: "stale_asc" | "stale_desc";
}): {
  grid: string[][];
  crossedClients: boolean;
  activeCapacity: number;
  historyCount: number;
} {
  const jobs = [...input.jobs].sort((a, b) =>
    input.processOrder === "stale_desc"
      ? b.staleSheetRow - a.staleSheetRow
      : a.staleSheetRow - b.staleSheetRow,
  );
  let grid = simToGrid(input.initial);
  for (const job of jobs) {
    const row = input.relocateByUuid
      ? locateSheetRowByBookingId(grid, job.bookingId)
      : job.staleSheetRow;
    if (!row) continue;
    const applied = applyRescheduleHistoryOnGrid({
      grid,
      priorBookingId: job.bookingId,
      staleSheetRow: row ?? undefined,
      trustStaleRow: !input.relocateByUuid,
    });
    grid = applied.grid;
  }
  let crossed = false;
  for (const job of input.jobs) {
    const r = locateHistoryRowByBookingId(grid, job.bookingId);
    if (!r) {
      crossed = true;
      continue;
    }
    const nombre = String(grid[r - 1]?.[2] ?? "");
    const expected = input.initial.find((x) => x.bookingId === job.bookingId);
    if (expected && nombre !== expected.nombre) crossed = true;
  }
  const statuses = grid
    .filter((r) => String(r[0] ?? "").trim())
    .map((r) => {
      const estado = String(r[14] ?? "").trim().toUpperCase();
      if (estado === "REAGENDADO" || estado === "RESCHEDULED_HISTORY") {
        return "disabled" as const;
      }
      if (String(r[15] ?? "").trim()) return "linked" as const;
      return "available" as const;
    });
  const cap = countActiveCapacityAfterReschedule({ statuses });
  return {
    grid,
    crossedClients: crossed,
    activeCapacity: cap.activePhysical,
    historyCount: statuses.filter((s) => s === "disabled").length,
  };
}
