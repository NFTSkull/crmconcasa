"use client";

import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { assertCalendarDateRange } from "@/lib/asesorAgendaCalendar";
import {
  mapMesaAgendaBookingRpcRows,
  mapMesaAgendaBookingsRpcError,
  MesaAgendaBookingsSupabaseError,
  type MesaAgendaBookingRpcRow,
} from "./mesa.mapper";
import { mapMesaAgendaDriveValidationRpcError } from "./mesa-drive-validation-rpc-error";
import type {
  FetchMesaAgendaBookingsParams,
  MesaAgendaBookingEntry,
} from "./mesa.types";

export { MesaAgendaBookingsSupabaseError };

export function buildMesaAgendaBookingsRpcPayload(
  params: FetchMesaAgendaBookingsParams,
): Readonly<{
  p_start_date: string;
  p_end_date: string;
  p_include_cancelled: boolean;
  p_kind: FetchMesaAgendaBookingsParams["kind"] | null;
}> {
  return {
    p_start_date: params.startDate,
    p_end_date: params.endDate,
    p_include_cancelled: params.includeCancelled,
    p_kind: params.kind ?? null,
  };
}

export async function fetchMesaAgendaBookings(
  params: FetchMesaAgendaBookingsParams,
): Promise<MesaAgendaBookingEntry[]> {
  assertCalendarDateRange(params.startDate, params.endDate);

  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new MesaAgendaBookingsSupabaseError("Supabase no está configurado.");
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabaseBrowser.auth.getSession();

  if (sessionError || !session?.user) {
    throw new MesaAgendaBookingsSupabaseError("No hay sesión activa.");
  }

  const { data, error } = await supabaseBrowser.rpc(
    "get_mesa_agenda_bookings",
    buildMesaAgendaBookingsRpcPayload(params),
  );

  if (error) {
    throw mapMesaAgendaBookingsRpcError(error);
  }

  const rows = (data ?? []) as MesaAgendaBookingRpcRow[];
  return mapMesaAgendaBookingRpcRows(rows);
}

export type MesaSetAgendaDriveValidationResult = Readonly<{
  ok: boolean;
  bookingId: string;
  driveValidated: boolean;
}>;

/** Marca o quita Validado en Drive por `agenda_bookings.id` (RPC P069). */
export async function setMesaAgendaDriveValidation(params: Readonly<{
  bookingId: string;
  validated: boolean;
}>): Promise<MesaSetAgendaDriveValidationResult> {
  const bookingId = params.bookingId.trim();
  if (!bookingId) {
    throw new MesaAgendaBookingsSupabaseError("booking_id es obligatorio.");
  }

  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new MesaAgendaBookingsSupabaseError("Supabase no está configurado.");
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabaseBrowser.auth.getSession();

  if (sessionError || !session?.user) {
    throw new MesaAgendaBookingsSupabaseError("No hay sesión activa.");
  }

  const { data, error } = await supabaseBrowser.rpc("mesa_set_agenda_drive_validation", {
    p_booking_id: bookingId,
    p_validated: params.validated,
  });

  if (error) {
    throw mapMesaAgendaDriveValidationRpcError(error);
  }

  const row = (data ?? {}) as Readonly<{
    ok?: boolean;
    booking_id?: string;
    drive_validated?: boolean;
  }>;

  return {
    ok: row.ok === true,
    bookingId: String(row.booking_id ?? bookingId),
    driveValidated: row.drive_validated === true,
  };
}
