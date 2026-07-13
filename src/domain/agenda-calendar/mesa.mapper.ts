import { normalizeBookingDate, normalizeBookingTime } from "@/lib/asesorAgendaCalendar";
import type {
  MesaAgendaBookingEntry,
  MesaAgendaBookingKind,
  MesaAgendaBookingPerson,
  MesaAgendaBookingStatus,
} from "./mesa.types";

export class MesaAgendaBookingsSupabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MesaAgendaBookingsSupabaseError";
  }
}

/** Fila cruda de RPC `get_mesa_agenda_bookings` (snake_case). */
export type MesaAgendaBookingRpcRow = Readonly<{
  booking_id?: string;
  expediente_id?: string;
  booking_date?: string;
  booking_time?: string;
  kind?: string;
  status?: string;
  location_id?: string | null;
  note?: string | null;
  created_at?: string;
  cancelled_at?: string | null;
  cliente_nombre?: string | null;
  nss?: string | null;
  etapa_actual?: number | string | null;
  subestado?: string | null;
  submitted_to_mesa?: boolean | null;
  asesor_id?: string;
  asesor_full_name?: string | null;
  asesor_email?: string | null;
  created_by?: string | null;
  created_by_full_name?: string | null;
  created_by_email?: string | null;
}>;

function parseKind(value: string | undefined): MesaAgendaBookingKind | null {
  if (value === "biometricos" || value === "firmas" || value === "notificacion") {
    return value;
  }
  return null;
}

function parseStatus(value: string | undefined): MesaAgendaBookingStatus | null {
  if (value === "booked" || value === "cancelled") return value;
  return null;
}

function mapPerson(
  id: string | null | undefined,
  fullName: string | null | undefined,
  email: string | null | undefined,
): MesaAgendaBookingPerson {
  return {
    id: String(id ?? "").trim(),
    fullName: fullName?.trim() || null,
    email: email?.trim() || null,
  };
}

function normalizeIsoTimestamp(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

export function mapMesaAgendaBookingRpcRow(
  row: MesaAgendaBookingRpcRow,
): MesaAgendaBookingEntry | null {
  const bookingDate = row.booking_date ? normalizeBookingDate(String(row.booking_date)) : "";
  const bookingTime = row.booking_time ? normalizeBookingTime(String(row.booking_time)) : "";
  const kind = parseKind(row.kind);
  const status = parseStatus(row.status);
  const bookingId = String(row.booking_id ?? "").trim();
  const expedienteId = String(row.expediente_id ?? "").trim();

  if (!bookingId || !expedienteId || !bookingDate || !bookingTime || !kind || !status) {
    return null;
  }

  const etapaRaw = row.etapa_actual;
  const etapaParsed =
    typeof etapaRaw === "number"
      ? etapaRaw
      : Number.parseInt(String(etapaRaw ?? ""), 10);

  return {
    bookingId,
    expedienteId,
    bookingDate,
    bookingTime,
    kind,
    status,
    locationId: row.location_id?.trim() || null,
    note: row.note?.trim() || null,
    createdAt: normalizeIsoTimestamp(row.created_at) ?? "",
    cancelledAt: normalizeIsoTimestamp(row.cancelled_at),
    clienteNombre: row.cliente_nombre?.trim() ?? "",
    nss: row.nss?.trim() || null,
    etapaActual: Number.isFinite(etapaParsed) ? etapaParsed : 0,
    subestado: row.subestado?.trim() || null,
    submittedToMesa: row.submitted_to_mesa === true,
    asesor: mapPerson(row.asesor_id, row.asesor_full_name, row.asesor_email),
    createdBy: mapPerson(row.created_by, row.created_by_full_name, row.created_by_email),
  };
}

export function mapMesaAgendaBookingRpcRows(
  rows: readonly MesaAgendaBookingRpcRow[],
): MesaAgendaBookingEntry[] {
  return rows
    .map(mapMesaAgendaBookingRpcRow)
    .filter((row): row is MesaAgendaBookingEntry => row != null);
}

export function mapMesaAgendaBookingsRpcError(error: {
  message?: string;
  code?: string;
}): MesaAgendaBookingsSupabaseError {
  const msg = `${error.message ?? ""}`.toLowerCase();
  if (msg.includes("forbidden_role")) {
    return new MesaAgendaBookingsSupabaseError(
      "No tienes permiso para consultar la agenda de citas de Mesa.",
    );
  }
  if (msg.includes("invalid_date_range") || msg.includes("date_range_too_large")) {
    return new MesaAgendaBookingsSupabaseError(
      "Rango de fechas inválido para la agenda de citas.",
    );
  }
  if (
    msg.includes("not_authenticated") ||
    msg.includes("profile_inactive") ||
    msg.includes("profile_not_found")
  ) {
    return new MesaAgendaBookingsSupabaseError("Sesión inválida. Inicia sesión de nuevo.");
  }
  return new MesaAgendaBookingsSupabaseError(
    "No se pudo cargar la agenda de citas. Intenta de nuevo más tarde.",
  );
}

export function mesaAgendaBookingPersonDisplayName(person: MesaAgendaBookingPerson): string {
  const name = person.fullName?.trim();
  if (name) return name;
  const email = person.email?.trim();
  if (email) return email;
  if (person.id) return person.id;
  return "—";
}

export function compareMesaAgendaBookingEntries(
  a: MesaAgendaBookingEntry,
  b: MesaAgendaBookingEntry,
): number {
  const dateCmp = a.bookingDate.localeCompare(b.bookingDate);
  if (dateCmp !== 0) return dateCmp;
  const timeCmp = a.bookingTime.localeCompare(b.bookingTime);
  if (timeCmp !== 0) return timeCmp;
  return a.createdAt.localeCompare(b.createdAt);
}
