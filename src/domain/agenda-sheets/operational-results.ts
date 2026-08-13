/**
 * Proyección de resultados operativos CITAS 2026 (reporting Bernardo).
 * P180: color + texto + contexto → effective_result (KPI).
 * Legacy *_result_class se mantiene (P165/P170); no activa APPLY.
 */

import {
  isSheetColumnHeaderRow,
  parseSheetSectionHeader,
  parseSheetTime,
  type AgendaSheetKind,
  type AgendaSheetSede,
} from "./parsers";
import {
  classifyBiometricResult,
  classifyNotificationResult,
  classifySignatureResult,
  formatSignatureResultRaw,
  type OperationalResultClass,
} from "./operational-result-classifiers";
import { extractOperationalNote } from "./operational-notes";
import {
  evaluateOperationalRedFlags,
  EMPTY_OPERATIONAL_RED_FLAGS,
  type EffectiveBackground,
  type EffectiveBackgroundGrid,
  type OperationalColor,
} from "./effective-background";
import {
  colorFromEiCell,
  deriveBiometricEffectiveResult,
  deriveNotificationEffectiveResult,
  deriveSignatureEffectiveResult,
  isCompletedCurrentEffective,
  type OperationalEffectiveResult,
  type OperationalProjectionStatus,
} from "./operational-effective-result";
import { detectInscripcionRebookRequirement } from "@/domain/agenda-inscripcion/detect-rebook";

export type OperationalResultUpsertRow = Readonly<{
  organization_id: string;
  spreadsheet_id: string;
  sheet_id: number;
  sheet_title: string;
  booking_date: string;
  sheet_row: number;
  kind: AgendaSheetKind;
  location_id: AgendaSheetSede;
  slot_time: string | null;
  booking_id: string | null;
  expediente_id: string | null;
  biometric_result_class: OperationalResultClass;
  biometric_result_raw: string | null;
  notification_result_class: OperationalResultClass;
  notification_result_raw: string | null;
  signature_result_class: OperationalResultClass;
  signature_result_raw: string | null;
  notes_raw: string | null;
  biometric_cell_red: boolean;
  notification_cell_red: boolean;
  signature_cell_red: boolean;
  operational_red_veto: boolean;
  operational_red_columns?: string[];
  /** P175: bio + REAGENDA INSCRIP* en F. */
  inscripcion_rebook_required: boolean;
  inscripcion_rebook_reason_raw: string | null;
  /** P180 */
  biometric_color: OperationalColor;
  notification_color: OperationalColor;
  signature_color: OperationalColor;
  biometric_effective_result: OperationalEffectiveResult;
  notification_effective_result: OperationalEffectiveResult;
  signature_effective_result: OperationalEffectiveResult;
  projection_status: OperationalProjectionStatus;
}>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cell(
  row: ReadonlyArray<string | null | undefined> | undefined,
  idx: number,
): string {
  return String(row?.[idx] ?? "").trim();
}

function asUuidOrNull(raw: string): string | null {
  const t = raw.trim();
  return UUID_RE.test(t) ? t : null;
}

function nullIfEmpty(raw: string): string | null {
  const t = raw.trim();
  return t ? t : null;
}

function isReagendadosBlockHeader(a: string): boolean {
  const n = a
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toUpperCase();
  return n.includes("REAGENDA");
}

/** P175: flag proyección solo en filas biométricos. */
function inscripcionRebookFields(input: {
  kind: AgendaSheetKind | string;
  notificationRaw: string | null;
}): {
  inscripcion_rebook_required: boolean;
  inscripcion_rebook_reason_raw: string | null;
} {
  if (input.kind !== "biometricos") {
    return {
      inscripcion_rebook_required: false,
      inscripcion_rebook_reason_raw: null,
    };
  }
  const required = detectInscripcionRebookRequirement(input.notificationRaw);
  return {
    inscripcion_rebook_required: required,
    inscripcion_rebook_reason_raw: required ? input.notificationRaw : null,
  };
}

/**
 * Señal de firma: col F = FIRMO, col G = FIRMA.
 * Notas H/I (COMPLETO / FALTA ACUSE) no se usan para decidir firma.
 */
export function extractFirmoFirmaCells(
  row: ReadonlyArray<string | null | undefined>,
): { firmo: string; firma: string } {
  return {
    firmo: cell(row, 5), // F
    firma: cell(row, 6), // G
  };
}

/** @deprecated Usar extractFirmoFirmaCells + formatSignatureResultRaw. */
export function extractSignatureResultRaw(
  row: ReadonlyArray<string | null | undefined>,
): string {
  const { firmo, firma } = extractFirmoFirmaCells(row);
  return formatSignatureResultRaw(firmo, firma) ?? "";
}

function metricColorsForKind(input: {
  kind: AgendaSheetKind | string;
  eiBackgrounds: ReadonlyArray<EffectiveBackground> | null | undefined;
}): {
  biometric_color: OperationalColor;
  notification_color: OperationalColor;
  signature_color: OperationalColor;
} {
  const e = colorFromEiCell(input.eiBackgrounds, 0);
  const f = colorFromEiCell(input.eiBackgrounds, 1);
  if (input.kind === "biometricos") {
    return {
      biometric_color: e,
      notification_color: f,
      signature_color: "UNKNOWN",
    };
  }
  return {
    biometric_color: "UNKNOWN",
    notification_color: "UNKNOWN",
    signature_color: f,
  };
}

/** Clasifica una fila ya ubicada en sección biométricos o firmas. */
export function classifyOperationalRow(input: {
  kind: AgendaSheetKind;
  row: ReadonlyArray<string | null | undefined>;
  eiBackgrounds?: ReadonlyArray<EffectiveBackground> | null;
  notesRaw?: string | null;
  inReagendadosBlock?: boolean;
}): {
  biometric_result_class: OperationalResultClass;
  biometric_result_raw: string | null;
  notification_result_class: OperationalResultClass;
  notification_result_raw: string | null;
  signature_result_class: OperationalResultClass;
  signature_result_raw: string | null;
  biometric_color: OperationalColor;
  notification_color: OperationalColor;
  signature_color: OperationalColor;
  biometric_effective_result: OperationalEffectiveResult;
  notification_effective_result: OperationalEffectiveResult;
  signature_effective_result: OperationalEffectiveResult;
} {
  const e = cell(input.row, 4);
  const f = cell(input.row, 5);
  const g = cell(input.row, 6);
  const colors = metricColorsForKind({
    kind: input.kind,
    eiBackgrounds: input.eiBackgrounds,
  });
  const notes = input.notesRaw ?? null;
  const reag = Boolean(input.inReagendadosBlock);

  if (input.kind === "biometricos") {
    return {
      biometric_result_class: classifyBiometricResult(e),
      biometric_result_raw: nullIfEmpty(e),
      notification_result_class: classifyNotificationResult(f),
      notification_result_raw: nullIfEmpty(f),
      signature_result_class: "PENDING",
      signature_result_raw: null,
      ...colors,
      biometric_effective_result: deriveBiometricEffectiveResult({
        color: colors.biometric_color,
        raw: e,
        notes,
        auxText: g,
        inReagendadosBlock: reag,
      }),
      notification_effective_result: deriveNotificationEffectiveResult({
        color: colors.notification_color,
        raw: f,
        notes,
        auxText: g,
        inReagendadosBlock: reag,
      }),
      signature_effective_result: "PENDING",
    };
  }

  const { firmo, firma } = extractFirmoFirmaCells(input.row);
  return {
    biometric_result_class: "PENDING",
    biometric_result_raw: null,
    notification_result_class: "PENDING",
    notification_result_raw: null,
    signature_result_class: classifySignatureResult(firmo, firma),
    signature_result_raw: formatSignatureResultRaw(firmo, firma),
    ...colors,
    biometric_effective_result: "PENDING",
    notification_effective_result: "PENDING",
    signature_effective_result: deriveSignatureEffectiveResult({
      color: colors.signature_color,
      raw: firmo,
      notes,
      firmaAux: firma,
      inReagendadosBlock: reag,
    }),
  };
}

function projectionStatusForRow(input: {
  bookingId: string | null;
  expedienteId: string | null;
}): OperationalProjectionStatus {
  // Filas vivas del Sheet: CURRENT (con o sin P/Q). UNLINKED reservado a tooling.
  void input;
  return "CURRENT";
}

/**
 * Construye filas de proyección desde grilla A:U (o al menos A:I + P/Q).
 * Incluye filas con horario físico aunque estén vacías (PENDING) para
 * que una edición posterior sea idempotente por (spreadsheet, sheet, row).
 */
export function buildOperationalResultUpsertRows(input: {
  organizationId: string;
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  bookingDate: string;
  grid: ReadonlyArray<ReadonlyArray<string | null | undefined>>;
  /** Grid E:I alineado al mismo índice de fila que A:U (p.ej. E1:I200). */
  backgroundsEi?: EffectiveBackgroundGrid | null;
}): OperationalResultUpsertRow[] {
  const out: OperationalResultUpsertRow[] = [];
  let section: { kind: AgendaSheetKind; location_id: AgendaSheetSede } | null =
    null;
  let headerRow: ReadonlyArray<string | null | undefined> | null = null;
  let inReagendadosBlock = false;

  for (let i = 0; i < input.grid.length; i++) {
    const row = input.grid[i] ?? [];
    const a = cell(row, 0);
    const sectionParse = parseSheetSectionHeader(a);
    if (sectionParse.ok) {
      section = {
        kind: sectionParse.value.kind,
        location_id: sectionParse.value.sede,
      };
      headerRow = null;
      inReagendadosBlock = false;
      continue;
    }
    if (a && isReagendadosBlockHeader(a)) {
      inReagendadosBlock = true;
      continue;
    }
    if (!section) continue;
    // P175: sección inscripción es inventario/agenda; no proyecta KPIs bio/firmas.
    if (section.kind === "inscripcion") continue;
    if (isSheetColumnHeaderRow(a)) {
      headerRow = row;
      continue;
    }

    let slotTime: string | null = null;
    if (a) {
      const timeParse = parseSheetTime(a);
      if (!timeParse.ok) continue;
      slotTime = timeParse.value;
    } else if (section.kind === "firmas") {
      const nss = cell(row, 1);
      const nombre = cell(row, 2);
      const firmo = cell(row, 5);
      if (!nss && !nombre && !firmo) continue;
      slotTime = null;
    } else {
      continue;
    }

    const notesRaw = extractOperationalNote({
      kind: section.kind,
      row,
      headerRow,
    });
    const classified = classifyOperationalRow({
      kind: section.kind,
      row,
      eiBackgrounds: input.backgroundsEi?.[i] ?? null,
      notesRaw,
      inReagendadosBlock,
    });
    const bookingId = asUuidOrNull(cell(row, 15)); // P
    const expedienteId = asUuidOrNull(cell(row, 16)); // Q
    const redFlags =
      input.backgroundsEi == null
        ? EMPTY_OPERATIONAL_RED_FLAGS
        : evaluateOperationalRedFlags({
            kind: section.kind,
            eiBackgrounds: input.backgroundsEi[i] ?? null,
          });

    out.push({
      organization_id: input.organizationId,
      spreadsheet_id: input.spreadsheetId,
      sheet_id: input.sheetId,
      sheet_title: input.sheetTitle,
      booking_date: input.bookingDate,
      sheet_row: i + 1,
      kind: section.kind,
      location_id: section.location_id,
      slot_time: slotTime,
      booking_id: bookingId,
      expediente_id: expedienteId,
      biometric_result_class: classified.biometric_result_class,
      biometric_result_raw: classified.biometric_result_raw,
      notification_result_class: classified.notification_result_class,
      notification_result_raw: classified.notification_result_raw,
      signature_result_class: classified.signature_result_class,
      signature_result_raw: classified.signature_result_raw,
      ...inscripcionRebookFields({
        kind: section.kind,
        notificationRaw: classified.notification_result_raw,
      }),
      notes_raw: notesRaw,
      biometric_cell_red: redFlags.biometric_cell_red,
      notification_cell_red: redFlags.notification_cell_red,
      signature_cell_red: redFlags.signature_cell_red,
      operational_red_veto: redFlags.operational_red_veto,
      operational_red_columns: [...redFlags.operational_red_columns],
      biometric_color: classified.biometric_color,
      notification_color: classified.notification_color,
      signature_color: classified.signature_color,
      biometric_effective_result: classified.biometric_effective_result,
      notification_effective_result: classified.notification_effective_result,
      signature_effective_result: classified.signature_effective_result,
      projection_status: projectionStatusForRow({
        bookingId,
        expedienteId,
      }),
    });
  }

  return out;
}

/** Una fila: requiere kind/location conocidos (p.ej. webhook). */
export function buildOperationalResultFromRow(input: {
  organizationId: string;
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  bookingDate: string;
  sheetRow: number;
  kind: AgendaSheetKind | string;
  locationId: AgendaSheetSede | string;
  row: ReadonlyArray<string | null | undefined>;
  headerRow?: ReadonlyArray<string | null | undefined> | null;
  eiBackgrounds?: ReadonlyArray<EffectiveBackground> | null;
  inReagendadosBlock?: boolean;
}): OperationalResultUpsertRow | null {
  if (input.kind !== "biometricos" && input.kind !== "firmas") return null;
  if (input.locationId !== "monterrey" && input.locationId !== "apodaca") {
    return null;
  }
  const a = cell(input.row, 0);
  let slotTime: string | null = null;
  if (a) {
    const timeParse = parseSheetTime(a);
    if (!timeParse.ok) return null;
    slotTime = timeParse.value;
  } else if (input.kind === "firmas") {
    const nss = cell(input.row, 1);
    const nombre = cell(input.row, 2);
    const firmo = cell(input.row, 5);
    if (!nss && !nombre && !firmo) return null;
    slotTime = null;
  } else {
    return null;
  }
  const notesRaw = extractOperationalNote({
    kind: input.kind,
    row: input.row,
    headerRow: input.headerRow,
  });
  const classified = classifyOperationalRow({
    kind: input.kind,
    row: input.row,
    eiBackgrounds: input.eiBackgrounds,
    notesRaw,
    inReagendadosBlock: input.inReagendadosBlock,
  });
  const redFlags =
    input.eiBackgrounds == null
      ? EMPTY_OPERATIONAL_RED_FLAGS
      : evaluateOperationalRedFlags({
          kind: input.kind,
          eiBackgrounds: input.eiBackgrounds,
        });
  const bookingId = asUuidOrNull(cell(input.row, 15));
  const expedienteId = asUuidOrNull(cell(input.row, 16));
  return {
    organization_id: input.organizationId,
    spreadsheet_id: input.spreadsheetId,
    sheet_id: input.sheetId,
    sheet_title: input.sheetTitle,
    booking_date: input.bookingDate,
    sheet_row: input.sheetRow,
    kind: input.kind,
    location_id: input.locationId,
    slot_time: slotTime,
    booking_id: bookingId,
    expediente_id: expedienteId,
    biometric_result_class: classified.biometric_result_class,
    biometric_result_raw: classified.biometric_result_raw,
    notification_result_class: classified.notification_result_class,
    notification_result_raw: classified.notification_result_raw,
    signature_result_class: classified.signature_result_class,
    signature_result_raw: classified.signature_result_raw,
    ...inscripcionRebookFields({
      kind: input.kind,
      notificationRaw: classified.notification_result_raw,
    }),
    notes_raw: notesRaw,
    biometric_cell_red: redFlags.biometric_cell_red,
    notification_cell_red: redFlags.notification_cell_red,
    signature_cell_red: redFlags.signature_cell_red,
    operational_red_veto: redFlags.operational_red_veto,
    operational_red_columns: [...redFlags.operational_red_columns],
    biometric_color: classified.biometric_color,
    notification_color: classified.notification_color,
    signature_color: classified.signature_color,
    biometric_effective_result: classified.biometric_effective_result,
    notification_effective_result: classified.notification_effective_result,
    signature_effective_result: classified.signature_effective_result,
    projection_status: projectionStatusForRow({
      bookingId,
      expedienteId,
    }),
  };
}

/** KPI Bernardo P180: CURRENT + COMPLETED_CURRENT.
 * 2+ CURRENT mismo booking_id+kind+date → 0 (IDENTITY_CONFLICT; no elegir ganador).
 */
export function countCompletedOperational(input: {
  rows: readonly OperationalResultUpsertRow[];
  metric: "biometricos" | "firmas" | "notificaciones";
}): number {
  const currentByBooking = new Map<string, number>();
  for (const r of input.rows) {
    if (r.projection_status !== "CURRENT" || r.booking_id == null) continue;
    const key = `${r.kind}:${r.booking_date}:${r.booking_id}`;
    currentByBooking.set(key, (currentByBooking.get(key) ?? 0) + 1);
  }
  let n = 0;
  for (const r of input.rows) {
    if (r.projection_status !== "CURRENT") continue;
    if (r.booking_id != null) {
      const key = `${r.kind}:${r.booking_date}:${r.booking_id}`;
      if ((currentByBooking.get(key) ?? 0) > 1) continue;
    }
    let hit = false;
    if (input.metric === "biometricos") {
      hit =
        r.kind === "biometricos" &&
        isCompletedCurrentEffective(r.biometric_effective_result);
    } else if (input.metric === "firmas") {
      hit =
        r.kind === "firmas" &&
        isCompletedCurrentEffective(r.signature_effective_result);
    } else {
      hit =
        r.kind === "biometricos" &&
        isCompletedCurrentEffective(r.notification_effective_result);
    }
    if (hit) n += 1;
  }
  return n;
}

/** Re-export color helper used by tests/fixtures. */
export { colorFromEiCell };
