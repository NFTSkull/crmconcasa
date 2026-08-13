/**
 * P180 B1.1 — decisión fail-closed para marcar STALE en proyección ops.
 * Solo full-reconcile con snapshot completo (A:U + E:I) y upsert OK.
 */

export type OpsMarkStaleDecision =
  | {
      allow: true;
      rowMin: number;
      rowMax: number;
      allowEmptySnapshot: boolean;
      seenRows: number[];
    }
  | {
      allow: false;
      reason:
        | "not_full_reconcile"
        | "values_fetch_failed"
        | "colors_fetch_failed"
        | "grids_misaligned"
        | "ops_upsert_failed"
        | "empty_grid_scope"
        | "invalid_scope";
    };

export function decideOpsMarkStale(input: {
  /** true solo si NO hay filterKind/filterLocation (webhook/parcial = false). */
  fullTabReconcile: boolean;
  valuesFetchOk: boolean;
  colorsFetchOk: boolean;
  /** A:U y E:I con misma cantidad de filas. */
  gridsAligned: boolean;
  opsUpsertFailed: boolean;
  /** Filas efectivamente leídas en A:U (p.ej. grid.length). */
  gridRowCount: number;
  seenRows: readonly number[];
}): OpsMarkStaleDecision {
  if (!input.fullTabReconcile) {
    return { allow: false, reason: "not_full_reconcile" };
  }
  if (!input.valuesFetchOk) {
    return { allow: false, reason: "values_fetch_failed" };
  }
  if (!input.colorsFetchOk) {
    return { allow: false, reason: "colors_fetch_failed" };
  }
  if (!input.gridsAligned) {
    return { allow: false, reason: "grids_misaligned" };
  }
  if (input.opsUpsertFailed) {
    return { allow: false, reason: "ops_upsert_failed" };
  }
  if (!Number.isFinite(input.gridRowCount) || input.gridRowCount < 1) {
    return { allow: false, reason: "empty_grid_scope" };
  }

  const rowMin = 1;
  const rowMax = Math.floor(input.gridRowCount);
  if (rowMax < rowMin) {
    return { allow: false, reason: "invalid_scope" };
  }

  const seenRows = [...input.seenRows].filter(
    (r) => Number.isInteger(r) && r >= rowMin && r <= rowMax,
  );

  return {
    allow: true,
    rowMin,
    rowMax,
    allowEmptySnapshot: seenRows.length === 0,
    seenRows,
  };
}
