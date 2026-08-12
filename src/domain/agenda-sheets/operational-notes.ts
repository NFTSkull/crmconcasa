/**
 * Extracción de NOTAS (motivo descriptivo) desde fila CITAS 2026.
 * No altera classifiers: solo texto para notes_raw / rechazo.
 *
 * Preferencia: columna cuyo header normalizado = NOTAS.
 * Fallback v1 (índices 0-based) si no hay header map:
 * - biométricos: H = 7
 * - firmas: H = 7, si vacío I = 8 (layouts Monterrey/Apodaca)
 */

import { normalizeSheetOpsText } from "./operational-result-classifiers";

function cell(
  row: ReadonlyArray<string | null | undefined> | undefined,
  idx: number,
): string {
  return String(row?.[idx] ?? "").trim();
}

function nullIfEmpty(raw: string): string | null {
  const t = raw.trim();
  return t ? t : null;
}

/** Índice 0-based de columna NOTAS en una fila de headers, o null. */
export function findNotasColumnIndex(
  headerRow: ReadonlyArray<string | null | undefined> | null | undefined,
): number | null {
  if (!headerRow || headerRow.length === 0) return null;
  for (let i = 0; i < headerRow.length; i++) {
    if (normalizeSheetOpsText(cell(headerRow, i)) === "NOTAS") {
      return i;
    }
  }
  return null;
}

/**
 * Extrae notes_raw. Header map gana; si no, fallback por kind.
 */
export function extractOperationalNote(input: {
  kind: string;
  row: ReadonlyArray<string | null | undefined>;
  headerRow?: ReadonlyArray<string | null | undefined> | null;
}): string | null {
  const fromHeader = findNotasColumnIndex(input.headerRow);
  if (fromHeader != null) {
    return nullIfEmpty(cell(input.row, fromHeader));
  }

  const kind = String(input.kind ?? "").trim().toLowerCase();
  if (kind === "biometricos") {
    return nullIfEmpty(cell(input.row, 7)); // H
  }
  // firmas / desconocido: H luego I
  return nullIfEmpty(cell(input.row, 7)) ?? nullIfEmpty(cell(input.row, 8));
}
