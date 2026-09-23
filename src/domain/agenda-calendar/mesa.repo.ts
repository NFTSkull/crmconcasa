"use client";

import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { assertCalendarDateRange } from "@/lib/asesorAgendaCalendar";
import { fetchMesaOwnerDisplayByAsesorIds } from "@/lib/mesaOwnerDisplay";
import {
  mapMesaAgendaBookingRpcRows,
  mapMesaAgendaBookingsRpcError,
  MesaAgendaBookingsSupabaseError,
  type MesaAgendaBookingRpcRow,
} from "./mesa.mapper";
import { mapMesaAgendaDriveValidationRpcError } from "./mesa-drive-validation-rpc-error";
import {
  mapMesaReportGroupRpcError,
  type MesaAgendaReportGroup,
} from "./mesa-report-group";
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
  const entries = mapMesaAgendaBookingRpcRows(rows);
  const ownerDisplay = await fetchMesaOwnerDisplayByAsesorIds(
    entries.map((entry) => entry.asesor.id),
  );

  return entries.map((entry) => {
    const display = ownerDisplay.get(entry.asesor.id);
    if (!display?.fullName) return entry;
    return {
      ...entry,
      asesor: {
        ...entry.asesor,
        fullName: display.fullName,
      },
    };
  });
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

export type MesaCompletarCitaOperativaResult = Readonly<{
  ok: boolean;
  idempotent: boolean;
  bookingId: string;
  expedienteId: string;
  kind: string;
  etapaAnterior: number;
  etapaActual: number;
}>;

/**
 * Cierra operativamente una cita ya ocurrida y lleva el expediente a su destino canónico:
 * biométricos → Acuse, inscripción → Acuse, firma → Firmado.
 */
export async function completarMesaAgendaCitaOperativa(params: Readonly<{
  bookingId: string;
}>): Promise<MesaCompletarCitaOperativaResult> {
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

  const { data, error } = await supabaseBrowser.rpc("mesa_completar_cita_operativa", {
    p_booking_id: bookingId,
  });

  if (error) {
    throw new MesaAgendaBookingsSupabaseError(error.message || "No se pudo completar la cita.");
  }

  const row = (data ?? {}) as Readonly<{
    ok?: boolean;
    idempotent?: boolean;
    booking_id?: string;
    expediente_id?: string;
    kind?: string;
    etapa_anterior?: number;
    etapa_actual?: number;
  }>;

  return {
    ok: row.ok === true,
    idempotent: row.idempotent === true,
    bookingId: String(row.booking_id ?? bookingId),
    expedienteId: String(row.expediente_id ?? ""),
    kind: String(row.kind ?? ""),
    etapaAnterior: Number(row.etapa_anterior ?? 0),
    etapaActual: Number(row.etapa_actual ?? 0),
  };
}

export type MesaSetAgendaReportGroupResult = Readonly<{
  ok: boolean;
  bookingId: string;
  reportGroup: string;
}>;

/** Actualiza solo `report_group` (clasificación Excel P109). No muta kind/fecha/hora. */
export async function setMesaAgendaBookingReportGroup(params: Readonly<{
  bookingId: string;
  reportGroup: string;
}>): Promise<MesaSetAgendaReportGroupResult> {
  const bookingId = params.bookingId.trim();
  const reportGroup = params.reportGroup.trim();
  if (!bookingId) {
    throw new MesaAgendaBookingsSupabaseError("booking_id es obligatorio.");
  }
  if (!reportGroup) {
    throw new MesaAgendaBookingsSupabaseError("report_group es obligatorio.");
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

  const { data, error } = await supabaseBrowser.rpc(
    "mesa_set_agenda_booking_report_group",
    {
      p_booking_id: bookingId,
      p_report_group: reportGroup,
    },
  );

  if (error) {
    throw mapMesaReportGroupRpcError(error);
  }

  const row = (data ?? {}) as Readonly<{
    ok?: boolean;
    booking_id?: string;
    report_group?: string;
  }>;

  return {
    ok: row.ok === true,
    bookingId: String(row.booking_id ?? bookingId),
    reportGroup: String(row.report_group ?? reportGroup) as MesaAgendaReportGroup,
  };
}
