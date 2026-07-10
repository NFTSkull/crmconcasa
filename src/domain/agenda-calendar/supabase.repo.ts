"use client";

import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  assertCalendarDateRange,
  normalizeBookingDate,
  normalizeBookingTime,
  type AsesorAgendaCalendarEntry,
  type AgendaCalendarKind,
  type AgendaCalendarStatus,
} from "@/lib/asesorAgendaCalendar";

export class AsesorAgendaCalendarSupabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsesorAgendaCalendarSupabaseError";
  }
}

type CalendarRpcRow = Readonly<{
  booking_id?: string;
  booking_date?: string;
  booking_time?: string;
  kind?: string;
  status?: string;
  location_id?: string;
  asesor_id?: string;
  asesor_full_name?: string | null;
  asesor_email?: string | null;
}>;

function mapRpcRow(row: CalendarRpcRow): AsesorAgendaCalendarEntry | null {
  const bookingDate = row.booking_date ? normalizeBookingDate(String(row.booking_date)) : "";
  const bookingTime = row.booking_time ? normalizeBookingTime(String(row.booking_time)) : "";
  const kind = row.kind === "firmas" ? "firmas" : row.kind === "notificacion" ? "notificacion" : row.kind === "biometricos" ? "biometricos" : null;
  const status = row.status === "cancelled" ? "cancelled" : row.status === "booked" ? "booked" : null;
  if (!bookingDate || !bookingTime || !kind || !status) return null;
  return {
    bookingId: String(row.booking_id ?? ""),
    bookingDate,
    bookingTime: normalizeBookingTime(bookingTime),
    kind: kind as AgendaCalendarKind,
    status: status as AgendaCalendarStatus,
    locationId: row.location_id?.trim() || "—",
    asesorId: String(row.asesor_id ?? ""),
    asesorFullName: row.asesor_full_name?.trim() || null,
    asesorEmail: row.asesor_email?.trim() || null,
  };
}

function mapCalendarRpcError(error: { message?: string; code?: string }): AsesorAgendaCalendarSupabaseError {
  const msg = `${error.message ?? ""}`.toLowerCase();
  if (msg.includes("forbidden_role")) {
    return new AsesorAgendaCalendarSupabaseError("No tienes permiso para ver el calendario de citas.");
  }
  if (msg.includes("invalid_date_range") || msg.includes("date_range_too_large")) {
    return new AsesorAgendaCalendarSupabaseError("Rango de fechas inválido para el calendario.");
  }
  if (msg.includes("not_authenticated") || msg.includes("profile_not_found")) {
    return new AsesorAgendaCalendarSupabaseError("Sesión inválida. Inicia sesión de nuevo.");
  }
  return new AsesorAgendaCalendarSupabaseError(
    "No se pudo cargar el calendario de citas. Intenta de nuevo más tarde.",
  );
}

export async function fetchAsesorAgendaCalendarEntries(params: {
  startDate: string;
  endDate: string;
  includeCancelled: boolean;
}): Promise<AsesorAgendaCalendarEntry[]> {
  assertCalendarDateRange(params.startDate, params.endDate);

  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AsesorAgendaCalendarSupabaseError("Supabase no está configurado.");
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabaseBrowser.auth.getSession();

  if (sessionError || !session?.user) {
    throw new AsesorAgendaCalendarSupabaseError("No hay sesión activa.");
  }

  const { data, error } = await supabaseBrowser.rpc("get_asesor_agenda_calendar", {
    p_start_date: params.startDate,
    p_end_date: params.endDate,
    p_include_cancelled: params.includeCancelled,
  });

  if (error) {
    throw mapCalendarRpcError(error);
  }

  const rows = (data ?? []) as CalendarRpcRow[];
  return rows.map(mapRpcRow).filter((row): row is AsesorAgendaCalendarEntry => row != null);
}

/** Slot ocupado org-wide (sin PII) para calcular disponibilidad en cards de agenda. */
export type OrgAgendaBookedSlot = Readonly<{
  bookingDate: string;
  bookingTime: string;
  locationId: string;
}>;

export function mapCalendarEntriesToOrgBookedSlots(
  entries: readonly AsesorAgendaCalendarEntry[],
  kind: AgendaCalendarKind,
  locationId?: string,
): OrgAgendaBookedSlot[] {
  const locFilter = locationId?.trim();
  return entries
    .filter((e) => e.kind === kind && e.status === "booked")
    .filter((e) => !locFilter || e.locationId === locFilter)
    .map((e) => ({
      bookingDate: e.bookingDate,
      bookingTime: e.bookingTime,
      locationId: e.locationId,
    }));
}

/** Citas activas org-wide vía RPC (evita RLS limitado por expediente del asesor). */
export async function fetchOrgAgendaBookedSlots(params: {
  fromDate: string;
  toDate: string;
  kind: AgendaCalendarKind;
  locationId?: string;
}): Promise<readonly OrgAgendaBookedSlot[]> {
  const entries = await fetchAsesorAgendaCalendarEntries({
    startDate: params.fromDate,
    endDate: params.toDate,
    includeCancelled: false,
  });
  return mapCalendarEntriesToOrgBookedSlots(entries, params.kind, params.locationId);
}
