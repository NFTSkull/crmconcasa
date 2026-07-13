"use client";

import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { assertCalendarDateRange } from "@/lib/asesorAgendaCalendar";
import {
  mapMesaAgendaBookingRpcRows,
  mapMesaAgendaBookingsRpcError,
  MesaAgendaBookingsSupabaseError,
  type MesaAgendaBookingRpcRow,
} from "./mesa.mapper";
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
