"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { mapCancelNotificacionRpcError } from "./cancel-notificacion-rpc-error";
import { mapReagendarNotificacionRpcError } from "./reagendar-notificacion-rpc-error";
import { mapBookNotificacionRpcError } from "./book-notificacion-rpc-error";
import { mapBookBiometricosRpcError } from "./book-biometricos-rpc-error";
import { mapCancelBiometricosRpcError } from "./cancel-biometricos-rpc-error";
import { mapReagendarBiometricosRpcError } from "./reagendar-biometricos-rpc-error";
import { fetchOrgAgendaBookedSlots } from "@/domain/agenda-calendar/supabase.repo";
import { SupabaseAgendaBiometricosConfigRepo } from "./supabase.repo";
import { AgendaBiometricosSupabaseError } from "./supabase.error";
import type {
  AgendaBiometricosActiveBooking,
  AgendaBiometricosBookedSlot,
  AgendaBiometricosBookingRepo,
  AgendaBiometricosCancelledBooking,
  AgendaNotificacionActiveBooking,
  BookBiometricosResult,
  BookNotificacionResult,
  CancelBiometricosResult,
  CancelNotificacionResult,
  ReagendarBiometricosResult,
  ReagendarNotificacionResult,
} from "./repo";

const BOOKING_SELECT = `
  id,
  expediente_id,
  booking_date,
  booking_time,
  location_id,
  status,
  note,
  cancelled_at,
  created_by
`;

type BookingRow = Readonly<{
  id: string;
  expediente_id: string;
  booking_date: string;
  booking_time: string;
  location_id: string;
  status: string;
  note: string | null;
  cancelled_at: string | null;
  created_by: string | null;
}>;

type BookRpcRow = Readonly<{
  ok?: boolean;
  booking_id?: string;
  expediente_id?: string;
  scheduled_at?: string;
  booking_date?: string;
  booking_time?: string;
  location_id?: string;
  etapa_actual?: number;
}>;

type CancelRpcRow = Readonly<{
  ok?: boolean;
  expediente_id?: string;
  booking_id?: string;
  status?: string;
  etapa_actual?: number;
}>;

type ReagendarRpcRow = Readonly<{
  ok?: boolean;
  expediente_id?: string;
  booking_id?: string;
  booking_anterior_id?: string;
  booking_nuevo_id?: string;
  booking_date?: string;
  booking_time?: string;
  scheduled_at?: string;
  status?: string;
  kind?: string;
  etapa_actual?: number;
}>;

function normalizeBookingTime(value: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(String(value).trim());
  return m ? `${m[1]}:${m[2]}` : String(value).trim();
}

function mapBookedSlot(row: BookingRow): AgendaBiometricosBookedSlot {
  return {
    bookingDate: String(row.booking_date),
    bookingTime: normalizeBookingTime(String(row.booking_time)),
    locationId: String(row.location_id),
  };
}

function mapActiveBooking(row: BookingRow): AgendaBiometricosActiveBooking {
  return {
    id: row.id,
    expedienteId: row.expediente_id,
    bookingDate: String(row.booking_date),
    bookingTime: normalizeBookingTime(String(row.booking_time)),
    locationId: String(row.location_id),
    status: "booked",
    note: row.note,
  };
}

function mapCancelledBooking(row: BookingRow): AgendaBiometricosCancelledBooking {
  return {
    id: row.id,
    expedienteId: row.expediente_id,
    bookingDate: String(row.booking_date),
    bookingTime: normalizeBookingTime(String(row.booking_time)),
    locationId: String(row.location_id),
    status: "cancelled",
    note: row.note,
    cancelledAt: row.cancelled_at,
  };
}

function mapNotificacionActiveBooking(row: BookingRow): AgendaNotificacionActiveBooking {
  return {
    id: row.id,
    expedienteId: row.expediente_id,
    bookingDate: String(row.booking_date),
    bookingTime: normalizeBookingTime(String(row.booking_time)),
    status: "booked",
    note: row.note,
    createdById: row.created_by,
  };
}

type NotificacionRpcRow = Readonly<{
  ok?: boolean;
  booking_id?: string;
  expediente_id?: string;
  scheduled_at?: string;
  booking_date?: string;
  booking_time?: string;
  location_id?: string;
  etapa_actual?: number;
}>;

async function getActiveBookingByKind(
  client: SupabaseClient,
  expedienteId: string,
  kind: "biometricos" | "notificacion",
): Promise<BookingRow | null> {
  const { data, error } = await client
    .from("agenda_bookings")
    .select(BOOKING_SELECT)
    .eq("expediente_id", expedienteId)
    .eq("kind", kind)
    .eq("status", "booked")
    .maybeSingle();

  if (error) {
    throw new AgendaBiometricosSupabaseError(
      kind === "notificacion"
        ? "No se pudo consultar la notificación activa."
        : "No se pudo consultar la cita biométrica activa.",
    );
  }

  return data ? (data as BookingRow) : null;
}

async function getCurrentOrganizationId(client: SupabaseClient): Promise<string> {
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError || !user?.id) {
    throw new AgendaBiometricosSupabaseError(
      "No hay sesión de Supabase activa. Inicia sesión de nuevo.",
    );
  }

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("organization_id, active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.organization_id || profile.active === false) {
    throw new AgendaBiometricosSupabaseError(
      "No se pudo resolver la organización del usuario activo.",
    );
  }

  return String(profile.organization_id);
}

async function requireSupabaseSession(): Promise<{ client: SupabaseClient }> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AgendaBiometricosSupabaseError(
      "Supabase no está configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const client = supabaseBrowser;
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();

  if (sessionError || !session?.user) {
    throw new AgendaBiometricosSupabaseError(
      "No hay sesión de Supabase activa. Inicia sesión de nuevo.",
    );
  }

  return { client };
}

/** P3M.2: lectura config + bookings y reserva vía RPC `book_biometricos`. */
export class SupabaseAgendaBiometricosBookingRepo implements AgendaBiometricosBookingRepo {
  private readonly configRepo = new SupabaseAgendaBiometricosConfigRepo();

  getBiometricosConfig() {
    return this.configRepo.getBiometricosConfig();
  }

  async listBookedSlots(params: {
    fromDate: string;
    toDate: string;
    locationId?: string;
  }): Promise<readonly AgendaBiometricosBookedSlot[]> {
    await requireSupabaseSession();
    const slots = await fetchOrgAgendaBookedSlots({
      fromDate: params.fromDate,
      toDate: params.toDate,
      kind: "biometricos",
      locationId: params.locationId,
    });
    return slots.map((row) => mapBookedSlot({
      booking_date: row.bookingDate,
      booking_time: row.bookingTime,
      location_id: row.locationId,
    } as BookingRow));
  }

  async getActiveBooking(expedienteId: string): Promise<AgendaBiometricosActiveBooking | null> {
    const { client } = await requireSupabaseSession();
    const data = await getActiveBookingByKind(client, expedienteId, "biometricos");
    if (!data) return null;
    return mapActiveBooking(data);
  }

  async getActiveNotificacionBooking(
    expedienteId: string,
  ): Promise<AgendaNotificacionActiveBooking | null> {
    const { client } = await requireSupabaseSession();
    const data = await getActiveBookingByKind(client, expedienteId, "notificacion");
    if (!data) return null;
    return mapNotificacionActiveBooking(data);
  }

  async listActiveNotificacionByExpedienteIds(
    expedienteIds: readonly string[],
  ): Promise<Map<string, AgendaNotificacionActiveBooking>> {
    const uniqueIds = [...new Set(expedienteIds.map((id) => id.trim()).filter(Boolean))];
    const result = new Map<string, AgendaNotificacionActiveBooking>();
    if (uniqueIds.length === 0) return result;

    const { client } = await requireSupabaseSession();
    const { data, error } = await client
      .from("agenda_bookings")
      .select(BOOKING_SELECT)
      .in("expediente_id", uniqueIds)
      .eq("kind", "notificacion")
      .eq("status", "booked");

    if (error) {
      throw new AgendaBiometricosSupabaseError(
        "No se pudo consultar las notificaciones activas de la bandeja.",
      );
    }

    for (const row of (data ?? []) as BookingRow[]) {
      const booking = mapNotificacionActiveBooking(row);
      result.set(booking.expedienteId, booking);
    }

    return result;
  }

  async getLastCancelledBooking(
    expedienteId: string,
  ): Promise<AgendaBiometricosCancelledBooking | null> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client
      .from("agenda_bookings")
      .select(BOOKING_SELECT)
      .eq("expediente_id", expedienteId)
      .eq("kind", "biometricos")
      .eq("status", "cancelled")
      .order("cancelled_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new AgendaBiometricosSupabaseError(
        "No se pudo consultar la última cita biométrica cancelada.",
      );
    }

    if (!data) return null;
    return mapCancelledBooking(data as BookingRow);
  }

  async bookBiometricos(params: {
    expedienteId: string;
    scheduledAt: string;
    locationId: string;
    note?: string | null;
  }): Promise<BookBiometricosResult> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client.rpc("book_biometricos", {
      p_expediente_id: params.expedienteId,
      p_scheduled_at: params.scheduledAt,
      p_location_id: params.locationId,
      p_note: params.note ?? null,
    });

    if (error) {
      throw mapBookBiometricosRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new AgendaBiometricosSupabaseError(
        "Respuesta inválida al agendar la cita biométrica.",
      );
    }

    const row = data as BookRpcRow;
    if (!row.ok) {
      throw new AgendaBiometricosSupabaseError(
        "La RPC no confirmó la reserva biométrica.",
      );
    }

    return {
      ok: true,
      bookingId: String(row.booking_id ?? ""),
      expedienteId: String(row.expediente_id ?? params.expedienteId),
      scheduledAt: String(row.scheduled_at ?? params.scheduledAt),
      bookingDate: String(row.booking_date ?? ""),
      bookingTime: normalizeBookingTime(String(row.booking_time ?? "")),
      locationId: String(row.location_id ?? params.locationId),
      etapaActual: Number(row.etapa_actual ?? 4),
    };
  }

  async bookNotificacionEtapa3(params: {
    expedienteId: string;
    bookingDate: string;
    note?: string | null;
  }): Promise<BookNotificacionResult> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client.rpc("book_notificacion_etapa3", {
      p_expediente_id: params.expedienteId,
      p_booking_date: params.bookingDate,
      p_note: params.note ?? null,
    });

    if (error) {
      throw mapBookNotificacionRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new AgendaBiometricosSupabaseError(
        "Respuesta inválida al agendar la notificación.",
      );
    }

    const row = data as NotificacionRpcRow;
    if (!row.ok) {
      throw new AgendaBiometricosSupabaseError(
        "La RPC no confirmó la notificación.",
      );
    }

    return {
      ok: true,
      bookingId: String(row.booking_id ?? ""),
      expedienteId: String(row.expediente_id ?? params.expedienteId),
      scheduledAt: String(row.scheduled_at ?? ""),
      bookingDate: String(row.booking_date ?? params.bookingDate),
      bookingTime: normalizeBookingTime(String(row.booking_time ?? "12:00")),
      locationId: String(row.location_id ?? "notificacion"),
      etapaActual: Number(row.etapa_actual ?? 3),
    };
  }

  async cancelNotificacionEtapa3(params: {
    expedienteId: string;
    motivo?: string | null;
  }): Promise<CancelNotificacionResult> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client.rpc("cancel_notificacion_etapa3", {
      p_expediente_id: params.expedienteId,
      p_motivo: params.motivo?.trim() || null,
    });

    if (error) {
      throw mapCancelNotificacionRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new AgendaBiometricosSupabaseError(
        "Respuesta inválida al cancelar la notificación.",
      );
    }

    const row = data as CancelRpcRow;
    if (!row.ok) {
      throw new AgendaBiometricosSupabaseError(
        "La RPC no confirmó la cancelación de notificación.",
      );
    }

    return {
      ok: true,
      expedienteId: String(row.expediente_id ?? params.expedienteId),
      bookingId: String(row.booking_id ?? ""),
      status: "cancelled",
      etapaActual: Number(row.etapa_actual ?? 3),
    };
  }

  async reagendarNotificacionEtapa3(params: {
    expedienteId: string;
    bookingDate: string;
    note?: string | null;
  }): Promise<ReagendarNotificacionResult> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client.rpc("reagendar_notificacion_etapa3", {
      p_expediente_id: params.expedienteId,
      p_booking_date: params.bookingDate,
      p_note: params.note ?? null,
    });

    if (error) {
      throw mapReagendarNotificacionRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new AgendaBiometricosSupabaseError(
        "Respuesta inválida al reagendar la notificación.",
      );
    }

    const row = data as ReagendarRpcRow;
    if (!row.ok) {
      throw new AgendaBiometricosSupabaseError(
        "La RPC no confirmó el reagendado de notificación.",
      );
    }

    return {
      ok: true,
      expedienteId: String(row.expediente_id ?? params.expedienteId),
      bookingAnteriorId: String(row.booking_anterior_id ?? ""),
      bookingNuevoId: String(row.booking_nuevo_id ?? row.booking_id ?? ""),
      scheduledAt: String(row.scheduled_at ?? ""),
      bookingDate: String(row.booking_date ?? params.bookingDate),
      bookingTime: normalizeBookingTime(String(row.booking_time ?? "12:00")),
      status: "booked",
      kind: "notificacion",
      etapaActual: Number(row.etapa_actual ?? 3),
    };
  }

  async cancelBiometricos(params: {
    expedienteId: string;
    motivo?: string | null;
  }): Promise<CancelBiometricosResult> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client.rpc("cancel_biometricos", {
      p_expediente_id: params.expedienteId,
      p_motivo: params.motivo?.trim() || null,
    });

    if (error) {
      throw mapCancelBiometricosRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new AgendaBiometricosSupabaseError(
        "Respuesta inválida al cancelar la cita biométrica.",
      );
    }

    const row = data as CancelRpcRow;
    if (!row.ok) {
      throw new AgendaBiometricosSupabaseError(
        "La RPC no confirmó la cancelación biométrica.",
      );
    }

    return {
      ok: true,
      expedienteId: String(row.expediente_id ?? params.expedienteId),
      bookingId: String(row.booking_id ?? ""),
      status: "cancelled",
      etapaActual: Number(row.etapa_actual ?? 4),
    };
  }

  async reagendarBiometricos(params: {
    expedienteId: string;
    scheduledAt: string;
    locationId: string;
    note?: string | null;
  }): Promise<ReagendarBiometricosResult> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client.rpc("reagendar_biometricos", {
      p_expediente_id: params.expedienteId,
      p_scheduled_at: params.scheduledAt,
      p_location_id: params.locationId,
      p_note: params.note ?? null,
    });

    if (error) {
      throw mapReagendarBiometricosRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new AgendaBiometricosSupabaseError(
        "Respuesta inválida al reagendar la cita biométrica.",
      );
    }

    const row = data as ReagendarRpcRow;
    if (!row.ok) {
      throw new AgendaBiometricosSupabaseError(
        "La RPC no confirmó el reagendado biométrico.",
      );
    }

    return {
      ok: true,
      expedienteId: String(row.expediente_id ?? params.expedienteId),
      bookingAnteriorId: String(row.booking_anterior_id ?? ""),
      bookingNuevoId: String(row.booking_nuevo_id ?? ""),
      scheduledAt: String(row.scheduled_at ?? params.scheduledAt),
      status: "booked",
      kind: "biometricos",
      etapaActual: Number(row.etapa_actual ?? 4),
    };
  }
}
