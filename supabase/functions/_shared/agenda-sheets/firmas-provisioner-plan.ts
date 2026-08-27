/**
 * P212 Fase 2A — construcción + validación de writes allowlisted del Firmas provisioner.
 * ÚNICO lugar que define qué requests de batchUpdate están permitidos.
 *
 * Allowlist:
 * - appendDimension ROWS (solo al final / extender grid)
 * - copyPaste pasteType=PASTE_FORMAT
 * - updateDimensionProperties (row height filas NUEVAS)
 * - mergeCells (solo headers nuevos A:G)
 * - updateCells userEnteredValue SOLO columna A, filas NUEVAS
 *
 * PROHIBIDO: insertDimension, deleteDimension, PASTE_NORMAL, PASTE_VALUES,
 * escribir B:U, clear, merge fuera de filas nuevas.
 */

export const FIRMAS_PROVISIONER_TARGET_HOURS = ["08:00", "09:00", "10:00"] as const;
export type FirmasProvisionerHour = (typeof FIRMAS_PROVISIONER_TARGET_HOURS)[number];

export type FirmasProvisionerHourDeficit = Readonly<{
  hour: FirmasProvisionerHour;
  current: number;
  add: number;
  final: number;
}>;

export type FirmasProvisionerLayoutRow =
  | Readonly<{
      kind: "header";
      row: number;
      sede: "monterrey" | "apodaca";
      text: "MONTERREY FIRMAS" | "APODACA FIRMAS";
      formatSourceRow: number;
    }>
  | Readonly<{
      kind: "slot";
      row: number;
      sede: "monterrey" | "apodaca";
      slotTime: FirmasProvisionerHour;
      formatSourceRow: number;
    }>;

export type FirmasProvisionerPlan = Readonly<{
  bookingDate: string;
  sheetId: number;
  sheetTitle: string;
  lastUsedRowPre: number;
  gridRowCount: number | null;
  firstNewRow: number;
  lastNewRow: number;
  appendDimensionCount: number;
  monterrey: Record<FirmasProvisionerHour, FirmasProvisionerHourDeficit>;
  apodaca: Record<FirmasProvisionerHour, FirmasProvisionerHourDeficit>;
  layout: readonly FirmasProvisionerLayoutRow[];
  sources: Readonly<{
    headerFormatRow: number;
    mty08: number;
    mty09: number;
    mty10: number;
    apo: number;
  }>;
  decision: "SAFE_CANONICAL_APPEND" | "STOP";
  rejectReason: string | null;
}>;

const ALLOWED_REQUEST_KEYS = new Set([
  "appendDimension",
  "copyPaste",
  "updateDimensionProperties",
  "mergeCells",
  "updateCells",
]);

const FORBIDDEN_REQUEST_KEYS = new Set([
  "insertDimension",
  "deleteDimension",
  "deleteRange",
  "cutPaste",
  "pasteData",
  "repeatCell",
  "updateCells" /* gated separately */,
]);

function emptyDeficits(): Record<FirmasProvisionerHour, FirmasProvisionerHourDeficit> {
  return {
    "08:00": { hour: "08:00", current: 0, add: 0, final: 0 },
    "09:00": { hour: "09:00", current: 0, add: 0, final: 0 },
    "10:00": { hour: "10:00", current: 0, add: 0, final: 0 },
  };
}

export function computeHourDeficits(
  physicalCounts: Partial<Record<FirmasProvisionerHour, number>>,
): Record<FirmasProvisionerHour, FirmasProvisionerHourDeficit> {
  const out = emptyDeficits();
  for (const h of FIRMAS_PROVISIONER_TARGET_HOURS) {
    const current = Math.max(0, Math.trunc(physicalCounts[h] ?? 0));
    const add = Math.max(0, 5 - current);
    out[h] = { hour: h, current, add, final: current + add };
  }
  return out;
}

export function lastUsedRowFromGrid(grid: readonly (readonly string[])[]): number {
  let last = 0;
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const has = row.slice(0, 21).some((c) => String(c ?? "").trim() !== "");
    if (has) last = i + 1;
  }
  return last;
}

export function buildFirmasProvisionerPlan(input: {
  bookingDate: string;
  sheetId: number;
  sheetTitle: string;
  lastUsedRowPre: number;
  gridRowCount: number | null;
  mtyPhysical: Partial<Record<FirmasProvisionerHour, number>>;
  apoPhysical: Partial<Record<FirmasProvisionerHour, number>>;
  sources: FirmasProvisionerPlan["sources"];
}): FirmasProvisionerPlan {
  const monterrey = computeHourDeficits(input.mtyPhysical);
  const apodaca = computeHourDeficits(input.apoPhysical);
  const mtyAdd =
    monterrey["08:00"].add + monterrey["09:00"].add + monterrey["10:00"].add;
  const apoAdd =
    apodaca["08:00"].add + apodaca["09:00"].add + apodaca["10:00"].add;

  const layout: FirmasProvisionerLayoutRow[] = [];
  let cursor = input.lastUsedRowPre + 1;
  const firstNewRow = cursor;

  const appendSede = (
    sede: "monterrey" | "apodaca",
    deficits: Record<FirmasProvisionerHour, FirmasProvisionerHourDeficit>,
    totalAdd: number,
  ) => {
    if (totalAdd <= 0) return;
    const text = sede === "monterrey" ? "MONTERREY FIRMAS" : "APODACA FIRMAS";
    layout.push({
      kind: "header",
      row: cursor,
      sede,
      text,
      formatSourceRow: input.sources.headerFormatRow,
    });
    cursor += 1;
    for (const h of FIRMAS_PROVISIONER_TARGET_HOURS) {
      const src =
        sede === "monterrey"
          ? h === "08:00"
            ? input.sources.mty08
            : h === "09:00"
              ? input.sources.mty09
              : input.sources.mty10
          : input.sources.apo;
      for (let i = 0; i < deficits[h].add; i++) {
        layout.push({
          kind: "slot",
          row: cursor,
          sede,
          slotTime: h,
          formatSourceRow: src,
        });
        cursor += 1;
      }
    }
  };

  appendSede("monterrey", monterrey, mtyAdd);
  appendSede("apodaca", apodaca, apoAdd);

  const lastNewRow = layout.length === 0 ? input.lastUsedRowPre : cursor - 1;
  let rejectReason: string | null = null;
  let decision: FirmasProvisionerPlan["decision"] = "SAFE_CANONICAL_APPEND";

  if (layout.length === 0) {
    rejectReason = "nothing_to_append";
    // Still SAFE (idempotent no-op) — treat as SAFE with empty layout.
  }
  if (lastNewRow > 200) {
    decision = "STOP";
    rejectReason = `lastNewRow=${lastNewRow} > 200`;
  }
  const srcOk =
    input.sources.headerFormatRow > 0 &&
    input.sources.mty08 > 0 &&
    input.sources.mty09 > 0 &&
    input.sources.mty10 > 0 &&
    input.sources.apo > 0;
  if (!srcOk) {
    decision = "STOP";
    rejectReason = "missing_format_source_rows";
  }
  if (input.lastUsedRowPre < 1) {
    decision = "STOP";
    rejectReason = "invalid_lastUsedRowPre";
  }

  let appendDimensionCount = 0;
  if (input.gridRowCount != null && lastNewRow > input.gridRowCount) {
    appendDimensionCount = lastNewRow - input.gridRowCount;
  }

  return {
    bookingDate: input.bookingDate,
    sheetId: input.sheetId,
    sheetTitle: input.sheetTitle,
    lastUsedRowPre: input.lastUsedRowPre,
    gridRowCount: input.gridRowCount,
    firstNewRow: layout.length === 0 ? input.lastUsedRowPre : firstNewRow,
    lastNewRow,
    appendDimensionCount,
    monterrey,
    apodaca,
    layout,
    sources: input.sources,
    decision,
    rejectReason,
  };
}

/** Construye requests Google batchUpdate estrictamente allowlisted. */
export function buildProvisionerBatchRequests(
  plan: FirmasProvisionerPlan,
): object[] {
  if (plan.decision !== "SAFE_CANONICAL_APPEND") {
    throw new Error(`cannot_build_writes:${plan.rejectReason ?? plan.decision}`);
  }
  const sheetId = plan.sheetId;
  const reqs: object[] = [];

  if (plan.appendDimensionCount > 0) {
    reqs.push({
      appendDimension: {
        sheetId,
        dimension: "ROWS",
        length: plan.appendDimensionCount,
      },
    });
  }

  for (const item of plan.layout) {
    const destRow0 = item.row - 1;
    const srcRow0 = item.formatSourceRow - 1;
    const endCol = item.kind === "header" ? 7 : 21; // header A:G format; slot A:U
    reqs.push({
      copyPaste: {
        source: {
          sheetId,
          startRowIndex: srcRow0,
          endRowIndex: srcRow0 + 1,
          startColumnIndex: 0,
          endColumnIndex: endCol,
        },
        destination: {
          sheetId,
          startRowIndex: destRow0,
          endRowIndex: destRow0 + 1,
          startColumnIndex: 0,
          endColumnIndex: endCol,
        },
        pasteType: "PASTE_FORMAT",
        pasteOrientation: "NORMAL",
      },
    });
    reqs.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: destRow0,
          endIndex: destRow0 + 1,
        },
        properties: { pixelSize: 21 },
        fields: "pixelSize",
      },
    });
    if (item.kind === "header") {
      reqs.push({
        mergeCells: {
          range: {
            sheetId,
            startRowIndex: destRow0,
            endRowIndex: destRow0 + 1,
            startColumnIndex: 0,
            endColumnIndex: 7,
          },
          mergeType: "MERGE_ALL",
        },
      });
    }
    const text = item.kind === "header" ? item.text : item.slotTime;
    reqs.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: destRow0,
          endRowIndex: destRow0 + 1,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        rows: [
          {
            values: [{ userEnteredValue: { stringValue: text } }],
          },
        ],
        fields: "userEnteredValue",
      },
    });
  }

  assertProvisionerRequestsAllowed(reqs, {
    sheetId: plan.sheetId,
    lastUsedRowPre: plan.lastUsedRowPre,
  });
  return reqs;
}

export type ProvisionerAllowContext = Readonly<{
  sheetId: number;
  lastUsedRowPre: number;
}>;

/**
 * Hard gate: cualquier request fuera de allowlist → throw.
 * Tests estáticos deben llamar esto.
 */
export function assertProvisionerRequestsAllowed(
  requests: readonly object[],
  ctx: ProvisionerAllowContext,
): void {
  for (const raw of requests) {
    if (!raw || typeof raw !== "object") {
      throw new Error("invalid_request");
    }
    const keys = Object.keys(raw as Record<string, unknown>);
    if (keys.length !== 1) {
      throw new Error(`request_must_have_single_key:${keys.join(",")}`);
    }
    const key = keys[0]!;
    if (key === "insertDimension" || key === "deleteDimension") {
      throw new Error(`forbidden_request:${key}`);
    }
    if (!ALLOWED_REQUEST_KEYS.has(key)) {
      throw new Error(`request_not_allowlisted:${key}`);
    }

    const body = (raw as Record<string, unknown>)[key] as Record<string, unknown>;

    if (key === "appendDimension") {
      if (body.dimension !== "ROWS") {
        throw new Error("appendDimension_must_be_ROWS");
      }
      if (Number(body.sheetId) !== ctx.sheetId) {
        throw new Error("appendDimension_sheetId_mismatch");
      }
      if (!(Number(body.length) > 0)) {
        throw new Error("appendDimension_length_invalid");
      }
      continue;
    }

    if (key === "copyPaste") {
      const pasteType = String(body.pasteType ?? "");
      if (pasteType !== "PASTE_FORMAT") {
        throw new Error(`copyPaste_forbidden_pasteType:${pasteType}`);
      }
      const dest = body.destination as {
        startRowIndex?: number;
        endRowIndex?: number;
        startColumnIndex?: number;
        endColumnIndex?: number;
        sheetId?: number;
      };
      if (Number(dest.sheetId) !== ctx.sheetId) {
        throw new Error("copyPaste_dest_sheet_mismatch");
      }
      const destStart = Number(dest.startRowIndex);
      if (!(destStart >= ctx.lastUsedRowPre)) {
        // destStart is 0-based; lastUsedRowPre is 1-based → new rows start at index == lastUsedRowPre
        throw new Error(
          `copyPaste_dest_not_new_row:dest0=${destStart},lastUsedRowPre=${ctx.lastUsedRowPre}`,
        );
      }
      continue;
    }

    if (key === "updateDimensionProperties") {
      const range = body.range as {
        sheetId?: number;
        dimension?: string;
        startIndex?: number;
        endIndex?: number;
      };
      if (range.dimension !== "ROWS") {
        throw new Error("updateDimension_must_be_ROWS");
      }
      if (Number(range.sheetId) !== ctx.sheetId) {
        throw new Error("updateDimension_sheet_mismatch");
      }
      if (!(Number(range.startIndex) >= ctx.lastUsedRowPre)) {
        throw new Error("updateDimension_not_new_row");
      }
      continue;
    }

    if (key === "mergeCells") {
      const range = body.range as {
        sheetId?: number;
        startRowIndex?: number;
        endRowIndex?: number;
        startColumnIndex?: number;
        endColumnIndex?: number;
      };
      if (Number(range.sheetId) !== ctx.sheetId) {
        throw new Error("merge_sheet_mismatch");
      }
      if (!(Number(range.startRowIndex) >= ctx.lastUsedRowPre)) {
        throw new Error("merge_not_new_row");
      }
      if (Number(range.startColumnIndex) !== 0 || Number(range.endColumnIndex) !== 7) {
        throw new Error("merge_must_be_A_to_G");
      }
      continue;
    }

    if (key === "updateCells") {
      const range = body.range as {
        sheetId?: number;
        startRowIndex?: number;
        endRowIndex?: number;
        startColumnIndex?: number;
        endColumnIndex?: number;
      };
      if (Number(range.sheetId) !== ctx.sheetId) {
        throw new Error("updateCells_sheet_mismatch");
      }
      if (!(Number(range.startRowIndex) >= ctx.lastUsedRowPre)) {
        throw new Error("updateCells_not_new_row");
      }
      // SOLO columna A
      if (Number(range.startColumnIndex) !== 0 || Number(range.endColumnIndex) !== 1) {
        throw new Error(
          `updateCells_must_be_column_A_only:cols=${range.startColumnIndex}:${range.endColumnIndex}`,
        );
      }
      const fields = String(body.fields ?? "");
      if (fields !== "userEnteredValue") {
        throw new Error(`updateCells_fields_forbidden:${fields}`);
      }
      continue;
    }
  }

  void FORBIDDEN_REQUEST_KEYS;
}

/** Extrae columnas tocadas por updateCells (para tests). */
export function collectUpdateCellsColumnIndexes(
  requests: readonly object[],
): number[] {
  const cols: number[] = [];
  for (const raw of requests) {
    const uc = (raw as { updateCells?: { range?: { startColumnIndex?: number; endColumnIndex?: number } } })
      .updateCells;
    if (!uc?.range) continue;
    for (
      let c = Number(uc.range.startColumnIndex);
      c < Number(uc.range.endColumnIndex);
      c++
    ) {
      cols.push(c);
    }
  }
  return cols;
}

export function requestsContainForbiddenToken(
  requests: readonly object[],
  token: string,
): boolean {
  return JSON.stringify(requests).includes(token);
}
