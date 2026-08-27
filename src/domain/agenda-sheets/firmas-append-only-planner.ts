/**
 * P212 Fase 1.6 — plan APPEND-ONLY de bloques Firmas al FINAL seguro.
 * 0 insertDimension mid-sheet. 0 writes.
 */

import {
  FIRMAS_TARGET_SLOTS,
  type FirmasStructurePlanAction,
  type SheetSede,
} from "./firmas-sheet-structure-planner";

export const FIRMAS_SHEET_READ_RANGE_LAST_ROW = 200 as const;
export const FIRMAS_TARGET_HOURS = ["08:00", "09:00", "10:00"] as const;
export type FirmasTargetHour = (typeof FIRMAS_TARGET_HOURS)[number];

export type FirmasHourDeficit = Readonly<{
  hour: FirmasTargetHour;
  current: number;
  add: number;
  final: number;
}>;

export type FirmasAppendOnlyTabPlan = Readonly<{
  date: string;
  sheetId: number;
  sheetTitle: string;
  lastUsedRowPre: number;
  gridRowCount: number | null;
  monterrey: Record<FirmasTargetHour, FirmasHourDeficit>;
  apodaca: Record<FirmasTargetHour, FirmasHourDeficit>;
  mtyAddTotal: number;
  apoAddTotal: number;
  /** Filas nuevas: 1 header por sede con adds + N data rows. */
  plannedAppendRows: number;
  firstAppendRow: number;
  lastAppendRow: number;
  withinReadRange200: boolean;
  appendDimensionNeeded: boolean;
  decision:
    | "SAFE_APPEND_ONLY"
    | "STOP_RANGE_LIMIT"
    | "STOP_TEMPLATE_UNKNOWN"
    | "STOP_OTHER";
  rejectReason: string | null;
  actions: readonly FirmasAppendAction[];
}>;

export type FirmasAppendAction =
  | Readonly<{ type: "append_section_header"; row: number; sede: SheetSede }>
  | Readonly<{
      type: "append_slot_row";
      row: number;
      sede: SheetSede;
      slotTime: FirmasTargetHour;
      /** copy format from template; never copy booking data */
      copyFormatFromRow: number | null;
    }>
  | Readonly<{
      type: "append_dimension_rows";
      count: number;
      reason: "grid_rowCount_insufficient";
    }>
  | Readonly<{
      type: "forbidden_insert_mid_sheet";
      afterRow: number;
      note: string;
    }>;

export type FirmasInventoryPhysicalRow = Readonly<{
  sheet_row: number;
  location_id: "monterrey" | "apodaca" | string;
  slot_time: string;
  status?: string;
}>;

function emptyDeficits(): Record<FirmasTargetHour, FirmasHourDeficit> {
  return {
    "08:00": { hour: "08:00", current: 0, add: 0, final: 0 },
    "09:00": { hour: "09:00", current: 0, add: 0, final: 0 },
    "10:00": { hour: "10:00", current: 0, add: 0, final: 0 },
  };
}

function deficitsForSede(
  rows: readonly FirmasInventoryPhysicalRow[],
  sede: SheetSede,
): Record<FirmasTargetHour, FirmasHourDeficit> {
  const out = emptyDeficits();
  for (const h of FIRMAS_TARGET_HOURS) {
    const current = rows.filter(
      (r) =>
        r.location_id === sede &&
        String(r.slot_time).slice(0, 5) === h,
    ).length;
    const add = Math.max(0, 5 - current);
    out[h] = { hour: h, current, add, final: current + add };
  }
  return out;
}

/**
 * Plan append-only: nuevos encabezados MONTERREY/APODACA FIRMAS + filas target
 * DESPUÉS de lastUsedRowPre. Nunca insert mid-sheet.
 */
export function buildFirmasAppendOnlyTabPlan(input: {
  date: string;
  sheetId: number;
  sheetTitle: string;
  firmasRows: readonly FirmasInventoryPhysicalRow[];
  /** Última fila con contenido real en A:U (cualquier sección). */
  lastUsedRowPre: number;
  /** Sheet properties rowCount si se conoce. */
  gridRowCount?: number | null;
  /** Fila plantilla Firmas (misma sede) para copiar formato — null = STOP_TEMPLATE_UNKNOWN si hay adds. */
  templateRowBySede?: Partial<Record<SheetSede, number | null>>;
  /** Si false, no sabemos plantilla A:U → STOP_TEMPLATE_UNKNOWN cuando hay adds. */
  templateContractKnown?: boolean;
}): FirmasAppendOnlyTabPlan {
  const monterrey = deficitsForSede(input.firmasRows, "monterrey");
  const apodaca = deficitsForSede(input.firmasRows, "apodaca");
  const mtyAddTotal =
    monterrey["08:00"].add + monterrey["09:00"].add + monterrey["10:00"].add;
  const apoAddTotal =
    apodaca["08:00"].add + apodaca["09:00"].add + apodaca["10:00"].add;

  const actions: FirmasAppendAction[] = [];
  let cursor = input.lastUsedRowPre + 1;
  const firstAppendRow = cursor;

  const appendSede = (sede: SheetSede, deficits: Record<FirmasTargetHour, FirmasHourDeficit>) => {
    const totalAdd =
      deficits["08:00"].add + deficits["09:00"].add + deficits["10:00"].add;
    if (totalAdd <= 0) return;
    actions.push({ type: "append_section_header", row: cursor, sede });
    cursor += 1;
    const template =
      input.templateRowBySede?.[sede] ??
      input.firmasRows.find((r) => r.location_id === sede)?.sheet_row ??
      null;
    for (const h of FIRMAS_TARGET_HOURS) {
      for (let i = 0; i < deficits[h].add; i++) {
        actions.push({
          type: "append_slot_row",
          row: cursor,
          sede,
          slotTime: h,
          copyFormatFromRow: template,
        });
        cursor += 1;
      }
    }
  };

  appendSede("monterrey", monterrey);
  appendSede("apodaca", apodaca);

  const lastAppendRow =
    actions.length === 0 ? input.lastUsedRowPre : cursor - 1;
  const plannedAppendRows =
    actions.length === 0 ? 0 : lastAppendRow - input.lastUsedRowPre;

  const gridRowCount = input.gridRowCount ?? null;
  let appendDimensionNeeded = false;
  if (gridRowCount != null && lastAppendRow > gridRowCount) {
    appendDimensionNeeded = true;
    actions.push({
      type: "append_dimension_rows",
      count: lastAppendRow - gridRowCount,
      reason: "grid_rowCount_insufficient",
    });
  }

  // Explicitly record that mid-sheet insert is never part of this plan.
  actions.push({
    type: "forbidden_insert_mid_sheet",
    afterRow: input.lastUsedRowPre,
    note: "insertDimension mid-sheet PROHIBIDO; solo append al final",
  });

  const withinReadRange200 = lastAppendRow <= FIRMAS_SHEET_READ_RANGE_LAST_ROW;

  let decision: FirmasAppendOnlyTabPlan["decision"] = "SAFE_APPEND_ONLY";
  let rejectReason: string | null = null;

  if (plannedAppendRows === 0) {
    decision = "SAFE_APPEND_ONLY";
  } else if (!withinReadRange200) {
    decision = "STOP_RANGE_LIMIT";
    rejectReason = `lastAppendRow=${lastAppendRow} > ${FIRMAS_SHEET_READ_RANGE_LAST_ROW} (readers A1:U200)`;
  } else if (input.templateContractKnown === false) {
    decision = "STOP_TEMPLATE_UNKNOWN";
    rejectReason = "Contrato A:U plantilla Firmas no determinado (falta Google SA / live format)";
  }

  return {
    date: input.date,
    sheetId: input.sheetId,
    sheetTitle: input.sheetTitle,
    lastUsedRowPre: input.lastUsedRowPre,
    gridRowCount,
    monterrey,
    apodaca,
    mtyAddTotal,
    apoAddTotal,
    plannedAppendRows,
    firstAppendRow: plannedAppendRows === 0 ? input.lastUsedRowPre : firstAppendRow,
    lastAppendRow,
    withinReadRange200,
    appendDimensionNeeded,
    decision,
    rejectReason,
    actions,
  };
}

/** Aplica plan a un grid en memoria (solo append al final). */
export function applyAppendOnlyPlanToGrid(
  preGrid: readonly (readonly string[])[],
  plan: FirmasAppendOnlyTabPlan,
): string[][] {
  const out = preGrid.map((r) => [...r]);
  while (out.length < plan.lastUsedRowPre) out.push([]);
  for (const a of plan.actions) {
    if (a.type === "append_section_header") {
      while (out.length < a.row) out.push([]);
      const label =
        a.sede === "monterrey" ? "MONTERREY FIRMAS" : "APODACA FIRMAS";
      out[a.row - 1] = [label];
    } else if (a.type === "append_slot_row") {
      while (out.length < a.row) out.push([]);
      // Solo A = hora; B:U vacíos (sin booking metadata).
      out[a.row - 1] = [a.slotTime];
    }
  }
  return out;
}

export function countTargetPhysical(
  rows: readonly { location_id: string; slot_time: string; kind?: string }[],
  sede: SheetSede,
  hour: FirmasTargetHour,
): number {
  return rows.filter(
    (r) =>
      (r.kind == null || r.kind === "firmas") &&
      r.location_id === sede &&
      String(r.slot_time).slice(0, 5) === hour,
  ).length;
}

/** Cap lógico por hora nunca supera 5 aunque haya más filas físicas. */
export function firmasHourlyBookableCap(params: {
  physicalAvailable: number;
  hourlyLogicalCap?: number;
  dailyRemaining: number | null;
}): number {
  const hourly = params.hourlyLogicalCap ?? 5;
  const physical = Math.max(0, Math.trunc(params.physicalAvailable));
  const base = Math.min(hourly, physical);
  if (params.dailyRemaining == null) return base;
  return Math.min(base, Math.max(0, Math.trunc(params.dailyRemaining)));
}

void FIRMAS_TARGET_SLOTS;
void (null as unknown as FirmasStructurePlanAction);
