/**
 * Contrato de limpieza de fila Sheet tras cancelación/reagenda CRM.
 * Propiedad solo por booking_id + source=crm (nunca solo NSS/nombre/hora).
 * Limpieza: solo B:D y O:U (batchClear). Nunca escribe A ni G:N.
 */

export type CancelClearClassification =
  | "safe_to_clear"
  | "already_absent"
  | "row_reused"
  | "manual_result_conflict"
  | "not_crm_owned"
  | "ambiguous"
  | "duplicate_booking_row";

export type CancelClearDecision = {
  classification: CancelClearClassification;
  reason: string;
  keepHora: string;
  /** true → batchClear B:D (no escribe A). */
  clearBtoD: boolean;
  /** E/F no se escriben en clear seguro (ya vacíos); flag solo documental. */
  clearEtoF: boolean;
  /** true → batchClear O:U. */
  clearOU: boolean;
  conflictingColumns: string[];
  /** Si true, outbox debe ir a dead (no retry storm). */
  terminalNoRetry: boolean;
};

function cell(
  row: ReadonlyArray<string | null | undefined>,
  idx: number,
): string {
  return String(row[idx] ?? "").trim();
}

/** Snapshot valor-por-valor de G:N (índices 6–13). */
export function snapshotPreserveGN(
  row: ReadonlyArray<string | null | undefined>,
): string[] {
  const out: string[] = [];
  for (let i = 6; i <= 13; i++) {
    out.push(String(row[i] ?? ""));
  }
  return out;
}

export function preserveGNUnchanged(
  before: ReadonlyArray<string | null | undefined>,
  after: ReadonlyArray<string | null | undefined>,
): boolean {
  const a = snapshotPreserveGN(before);
  const b = snapshotPreserveGN(after);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** E/F con texto humano (no vacío). */
export function hasHumanResultInEF(
  row: ReadonlyArray<string | null | undefined>,
): { conflict: boolean; columns: string[] } {
  const cols: string[] = [];
  if (cell(row, 4)) cols.push("E");
  if (cell(row, 5)) cols.push("F");
  return { conflict: cols.length > 0, columns: cols };
}

export function classifyCancelRowClearance(input: {
  row: ReadonlyArray<string | null | undefined>;
  cancelledBookingId: string;
  cancelledExpedienteId?: string | null;
}): CancelClearDecision {
  const bookingId = String(input.cancelledBookingId ?? "").trim();
  const expedienteId = String(input.cancelledExpedienteId ?? "").trim();
  const row = input.row ?? [];
  const hora = String(row[0] ?? "");
  const nss = cell(row, 1);
  const nombre = cell(row, 2);
  const asesor = cell(row, 3);
  const estado = cell(row, 14);
  const metaBooking = cell(row, 15);
  const metaExp = cell(row, 16);
  const source = cell(row, 18).toLowerCase();
  const techAny = [14, 15, 16, 17, 18, 19, 20].some((i) => cell(row, i));
  const visibleAny = Boolean(nss || nombre || asesor);
  const ef = hasHumanResultInEF(row);

  if (!bookingId) {
    return {
      classification: "ambiguous",
      reason: "cancelled_booking_id vacío",
      keepHora: hora,
      clearBtoD: false,
      clearEtoF: false,
      clearOU: false,
      conflictingColumns: [],
      terminalNoRetry: true,
    };
  }

  // Sin metadata ni visibles → ya limpia
  if (!techAny && !visibleAny && !ef.conflict) {
    return {
      classification: "already_absent",
      reason: "fila sin B:D ni O:U",
      keepHora: hora,
      clearBtoD: false,
      clearEtoF: false,
      clearOU: false,
      conflictingColumns: [],
      terminalNoRetry: false,
    };
  }

  // Sin booking_id en P: no limpiar por NSS/nombre
  if (!metaBooking) {
    return {
      classification: "already_absent",
      reason: "sin CRM_BOOKING_ID en P; no se limpia por NSS/nombre",
      keepHora: hora,
      clearBtoD: false,
      clearEtoF: false,
      clearOU: false,
      conflictingColumns: [],
      terminalNoRetry: false,
    };
  }

  if (metaBooking !== bookingId) {
    return {
      classification: "row_reused",
      reason: `P tiene booking distinto (${metaBooking})`,
      keepHora: hora,
      clearBtoD: false,
      clearEtoF: false,
      clearOU: false,
      conflictingColumns: ["P"],
      terminalNoRetry: false,
    };
  }

  if (source && source !== "crm") {
    return {
      classification: "not_crm_owned",
      reason: `source=${source || "(vacío)"}`,
      keepHora: hora,
      clearBtoD: false,
      clearEtoF: false,
      clearOU: false,
      conflictingColumns: ["S"],
      terminalNoRetry: true,
    };
  }

  // source vacío pero booking_id CRM coincide: permitir (legado CANCELADA)
  if (expedienteId && metaExp && metaExp !== expedienteId) {
    return {
      classification: "ambiguous",
      reason: `Q expediente distinto (${metaExp})`,
      keepHora: hora,
      clearBtoD: false,
      clearEtoF: false,
      clearOU: false,
      conflictingColumns: ["Q"],
      terminalNoRetry: true,
    };
  }

  // No usar U/link.sync_version como row_reused: el worker de cancel
  // legado incrementaba U al escribir CANCELADA (p.ej. link=1, Sheet=2)
  // mientras P sigue siendo el booking cancelado. La carrera real se detecta
  // con P distinto en el read inmediato pre-clear.

  if (ef.conflict) {
    return {
      classification: "manual_result_conflict",
      reason: `E/F con resultado humano: ${ef.columns.join(",")}`,
      keepHora: hora,
      clearBtoD: false,
      clearEtoF: false,
      clearOU: false,
      conflictingColumns: ef.columns,
      terminalNoRetry: true,
    };
  }

  return {
    classification: "safe_to_clear",
    reason: estado === "CANCELADA"
      ? "metadata CANCELADA + booking_id exacto"
      : "source=crm + booking_id exacto",
    keepHora: hora,
    clearBtoD: true,
    clearEtoF: false, // E/F ya vacíos; no escribir
    clearOU: true,
    conflictingColumns: [],
    terminalNoRetry: false,
  };
}

/**
 * Rangos A1 a limpiar con values.batchClear.
 * Solo B:D y O:U — nunca A ni E:N / G:N.
 */
export function cancelClearBatchRanges(
  sheetTitle: string,
  rowNumber: number,
): string[] {
  const titleEsc = `'${sheetTitle.replace(/'/g, "''")}'`;
  return [
    `${titleEsc}!B${rowNumber}:D${rowNumber}`,
    `${titleEsc}!O${rowNumber}:U${rowNumber}`,
  ];
}

/** @deprecated No usar: reescribir A:D puede alterar A. Preferir batchClear. */
export function buildClearedVisibleAdRow(horaKeep: string): string[] {
  return [horaKeep, "", "", ""];
}

/** @deprecated Preferir batchClear O:U. */
export function buildClearedTechRow(): string[] {
  return ["", "", "", "", "", "", ""];
}

export function verifyClearedRowReadback(input: {
  row: ReadonlyArray<string | null | undefined>;
  expectedHora: string;
  /** Snapshot G:N previo al clear (valor por valor). */
  expectedGN?: ReadonlyArray<string | null | undefined>;
  /** Snapshot E:F previo (deben seguir vacíos). */
  expectedEFEmpty?: boolean;
}): { ok: boolean; reason?: string } {
  const row = input.row ?? [];
  const hora = String(row[0] ?? "");
  if (hora !== String(input.expectedHora ?? "")) {
    return { ok: false, reason: "hora_mismatch" };
  }
  for (const idx of [1, 2, 3]) {
    if (cell(row, idx)) {
      return { ok: false, reason: `visible_not_empty_col_${idx}` };
    }
  }
  // E/F deben seguir vacíos tras clear seguro
  if (input.expectedEFEmpty !== false) {
    for (const idx of [4, 5]) {
      if (cell(row, idx)) {
        return { ok: false, reason: `ef_not_empty_col_${idx}` };
      }
    }
  }
  if (input.expectedGN) {
    if (!preserveGNUnchanged(input.expectedGN, row)) {
      return { ok: false, reason: "gn_changed" };
    }
  }
  for (const idx of [14, 15, 16, 17, 18, 19, 20]) {
    if (cell(row, idx)) {
      return { ok: false, reason: `tech_not_empty_col_${idx}` };
    }
  }
  return { ok: true };
}

/**
 * Inventario: fila con estado CANCELADA o sin occupancy efectiva → available.
 * Incluye CANCELADA con E/F en conflicto (capacidad libre mientras revisión manual).
 */
export function inventoryStatusFromSheetRow(input: {
  nss: string;
  name: string;
  techBookingId: string | null;
  techEstado?: string | null;
}): "available" | "linked" | "occupied_external" {
  const estado = String(input.techEstado ?? "").trim().toUpperCase();
  if (estado === "CANCELADA") return "available";
  if (input.techBookingId) return "linked";
  if (input.nss || input.name) return "occupied_external";
  return "available";
}

/** Resumen live A:F / O:U / G:N para dry-run (sin secretos). */
export function summarizeLiveRowAU(
  row: ReadonlyArray<string | null | undefined>,
): {
  A_F: string[];
  O_U: string[];
  G_N_has_data: boolean;
  G_N_preview: string[];
} {
  const r = row ?? [];
  const AF = [0, 1, 2, 3, 4, 5].map((i) => String(r[i] ?? ""));
  const OU = [14, 15, 16, 17, 18, 19, 20].map((i) => String(r[i] ?? ""));
  const GN = snapshotPreserveGN(r);
  return {
    A_F: AF,
    O_U: OU,
    G_N_has_data: GN.some((c) => String(c).trim() !== ""),
    G_N_preview: GN,
  };
}
