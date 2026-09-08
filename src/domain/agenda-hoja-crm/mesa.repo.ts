import { supabaseBrowser } from "@/lib/supabaseBrowser";

export type AgendaHojaColor = "GREEN" | "RED" | "ORANGE" | "OTHER" | "UNKNOWN";
export type AgendaHojaRowSource = "inventory" | "manual";

export type AgendaHojaRow = Readonly<{
  rowSource: AgendaHojaRowSource;
  rowId: string;
  manualOccupancyId: string | null;
  inventoryId: string | null;
  bookingId: string | null;
  expedienteId: string | null;
  bookingDate: string;
  kind: "biometricos" | "firmas" | "inscripcion";
  locationId: string;
  logicalTime: string;
  displayTime: string;
  rowStatus: string;
  originLabel: string;
  nss: string;
  clienteNombre: string;
  asesorNombre: string;
  biometricResultRaw: string;
  biometricColor: AgendaHojaColor;
  notificationResultRaw: string;
  notificationColor: AgendaHojaColor;
  signatureResultRaw: string;
  signatureColor: AgendaHojaColor;
  notesRaw: string;
  sheetTitle: string | null;
  sheetRow: number | null;
  editable: boolean;
  available: boolean;
  crmOverride: boolean;
}>;

export class AgendaHojaCrmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgendaHojaCrmError";
  }
}

type RpcRow = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function nullableStr(v: unknown): string | null {
  const value = str(v).trim();
  return value || null;
}

function toColor(v: unknown): AgendaHojaColor {
  const value = str(v).toUpperCase();
  if (value === "GREEN" || value === "RED" || value === "ORANGE" || value === "OTHER") {
    return value;
  }
  return "UNKNOWN";
}

function toTime(v: unknown): string {
  return str(v).slice(0, 5) || "00:00";
}

function mapRow(row: RpcRow): AgendaHojaRow {
  const kind = str(row.kind);
  return {
    rowSource: str(row.row_source) === "manual" ? "manual" : "inventory",
    rowId: str(row.row_id),
    manualOccupancyId: nullableStr(row.manual_occupancy_id),
    inventoryId: nullableStr(row.inventory_id),
    bookingId: nullableStr(row.booking_id),
    expedienteId: nullableStr(row.expediente_id),
    bookingDate: str(row.booking_date).slice(0, 10),
    kind:
      kind === "firmas" || kind === "inscripcion" ? kind : "biometricos",
    locationId: str(row.location_id),
    logicalTime: toTime(row.logical_time),
    displayTime: toTime(row.display_time),
    rowStatus: str(row.row_status),
    originLabel: str(row.origin_label),
    nss: str(row.nss),
    clienteNombre: str(row.cliente_nombre),
    asesorNombre: str(row.asesor_nombre),
    biometricResultRaw: str(row.biometric_result_raw),
    biometricColor: toColor(row.biometric_color),
    notificationResultRaw: str(row.notification_result_raw),
    notificationColor: toColor(row.notification_color),
    signatureResultRaw: str(row.signature_result_raw),
    signatureColor: toColor(row.signature_color),
    notesRaw: str(row.notes_raw),
    sheetTitle: nullableStr(row.sheet_title),
    sheetRow:
      typeof row.sheet_row === "number"
        ? row.sheet_row
        : row.sheet_row == null
          ? null
          : Number(row.sheet_row) || null,
    editable: row.editable === true,
    available: row.available === true,
    crmOverride: row.crm_override === true,
  };
}

function requireClient() {
  if (!supabaseBrowser) {
    throw new AgendaHojaCrmError("La hoja operativa requiere modo Supabase.");
  }
  return supabaseBrowser;
}

async function requireSession() {
  const client = requireClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.user) {
    throw new AgendaHojaCrmError("Tu sesión expiró. Vuelve a iniciar sesión.");
  }
  return client;
}

function mapRpcError(raw: string | undefined): string {
  const message = raw?.trim() || "No se pudo completar la operación.";
  if (/MANUAL_DUPLICADO_CRM/i.test(message)) {
    return message.replace(/^.*MANUAL_DUPLICADO_CRM:\s*/i, "");
  }
  if (/SIN_CUPO_REAL_EN_SHEET|SIN_CUPO_DIA/i.test(message)) {
    return "Ese lugar ya está ocupado o el cupo del día está completo. Actualiza la hoja y elige otro espacio.";
  }
  if (/no autorizado|rol no autorizado|42501/i.test(message)) {
    return "No tienes permiso para editar la hoja operativa.";
  }
  return message.replace(/^agenda_hoja_crm_[a-z_]+:\s*/i, "");
}

export async function fetchAgendaHojaCrm(dateYmd: string): Promise<AgendaHojaRow[]> {
  const client = await requireSession();
  const { data, error } = await client.rpc("agenda_hoja_crm_list", {
    p_date: dateYmd,
  });
  if (error) throw new AgendaHojaCrmError(mapRpcError(error.message));
  return ((data ?? []) as RpcRow[]).map(mapRow);
}

export type SaveAgendaHojaResultInput = Readonly<{
  rowSource: AgendaHojaRowSource;
  rowId: string;
  biometricResultRaw: string;
  biometricColor: AgendaHojaColor;
  notificationResultRaw: string;
  notificationColor: AgendaHojaColor;
  signatureResultRaw: string;
  signatureColor: AgendaHojaColor;
  notesRaw: string;
}>;

export async function saveAgendaHojaResult(input: SaveAgendaHojaResultInput): Promise<void> {
  const client = await requireSession();
  const { error } = await client.rpc("agenda_hoja_crm_save_result", {
    p_row_source: input.rowSource,
    p_row_id: input.rowId,
    p_biometric_result_raw: input.biometricResultRaw || null,
    p_biometric_color: input.biometricColor,
    p_notification_result_raw: input.notificationResultRaw || null,
    p_notification_color: input.notificationColor,
    p_signature_result_raw: input.signatureResultRaw || null,
    p_signature_color: input.signatureColor,
    p_notes_raw: input.notesRaw || null,
  });
  if (error) throw new AgendaHojaCrmError(mapRpcError(error.message));
}

export type AddAgendaManualInput = Readonly<{
  bookingDate: string;
  logicalTime: string;
  displayTime: string;
  kind: "biometricos" | "firmas" | "inscripcion";
  locationId: string;
  nss: string;
  clienteNombre: string;
  asesorNombre: string;
  notes: string;
}>;

export async function addAgendaManual(input: AddAgendaManualInput): Promise<void> {
  const client = await requireSession();
  const { error } = await client.rpc("agenda_hoja_crm_add_manual", {
    p_booking_date: input.bookingDate,
    p_booking_time: input.logicalTime,
    p_kind: input.kind,
    p_location_id: input.locationId,
    p_display_time: input.displayTime,
    p_nss: input.nss || null,
    p_cliente_nombre: input.clienteNombre,
    p_asesor_nombre: input.asesorNombre || null,
    p_notes: input.notes || null,
  });
  if (error) throw new AgendaHojaCrmError(mapRpcError(error.message));
}

export async function cancelAgendaManual(manualOccupancyId: string): Promise<void> {
  const client = await requireSession();
  const { error } = await client.rpc("agenda_hoja_crm_cancel_manual", {
    p_manual_occupancy_id: manualOccupancyId,
  });
  if (error) throw new AgendaHojaCrmError(mapRpcError(error.message));
}
