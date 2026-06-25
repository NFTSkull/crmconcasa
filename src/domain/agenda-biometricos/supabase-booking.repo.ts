"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { mapBookBiometricosRpcError } from "./book-biometricos-rpc-error";
import { SupabaseAgendaBiometricosConfigRepo } from "./supabase.repo";
import { AgendaBiometricosSupabaseError } from "./supabase.error";
import type {
  AgendaBiometricosActiveBooking,
  AgendaBiometricosBookedSlot,
  AgendaBiometricosBookingRepo,
  BookBiometricosResult,
} from "./repo";

const BOOKING_SELECT = `
  id,
  expediente_id,
  booking_date,
  booking_time,
  location_id,
  status,
  note
`;

type BookingRow = Readonly<{
  id: string;
  expediente_id: string;
  booking_date: string;
  booking_time: string;
  location_id: string;
  status: string;
  note: string | null;
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
    const { client } = await requireSupabaseSession();
    const organizationId = await getCurrentOrganizationId(client);

    let query = client
      .from("agenda_bookings")
      .select(BOOKING_SELECT)
      .eq("organization_id", organizationId)
      .eq("kind", "biometricos")
      .eq("status", "booked")
      .gte("booking_date", params.fromDate)
      .lte("booking_date", params.toDate);

    if (params.locationId) {
      query = query.eq("location_id", params.locationId);
    }

    const { data, error } = await query;

    if (error) {
      throw new AgendaBiometricosSupabaseError(
        "No se pudieron cargar las reservas biométricas. Intenta de nuevo más tarde.",
      );
    }

    return (data ?? []).map((row) => mapBookedSlot(row as BookingRow));
  }

  async getActiveBooking(expedienteId: string): Promise<AgendaBiometricosActiveBooking | null> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client
      .from("agenda_bookings")
      .select(BOOKING_SELECT)
      .eq("expediente_id", expedienteId)
      .eq("kind", "biometricos")
      .eq("status", "booked")
      .maybeSingle();

    if (error) {
      throw new AgendaBiometricosSupabaseError(
        "No se pudo consultar la cita biométrica activa.",
      );
    }

    if (!data) return null;
    return mapActiveBooking(data as BookingRow);
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
}
