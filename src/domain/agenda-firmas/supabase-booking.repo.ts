"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { mapBookFirmasRpcError } from "./book-firmas-rpc-error";
import { mapCancelFirmasRpcError } from "./cancel-firmas-rpc-error";
import { mapReagendarFirmasRpcError } from "./reagendar-firmas-rpc-error";
import { SupabaseAgendaFirmasConfigRepo } from "./supabase.repo";
import { AgendaFirmasSupabaseError } from "./supabase.error";
import type {
  AgendaFirmasActiveBooking,
  AgendaFirmasBookedSlot,
  AgendaFirmasBookingRepo,
  AgendaFirmasCancelledBooking,
  BookFirmasResult,
  CancelFirmasResult,
  ReagendarFirmasResult,
} from "./repo";

const BOOKING_SELECT = `
  id,
  expediente_id,
  booking_date,
  booking_time,
  location_id,
  status,
  note,
  cancelled_at
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
  booking_anterior_id?: string;
  booking_nuevo_id?: string;
  scheduled_at?: string;
  status?: string;
  kind?: string;
  etapa_actual?: number;
}>;

function normalizeBookingTime(value: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(String(value).trim());
  return m ? `${m[1]}:${m[2]}` : String(value).trim();
}

function mapBookedSlot(row: BookingRow): AgendaFirmasBookedSlot {
  return {
    bookingDate: String(row.booking_date),
    bookingTime: normalizeBookingTime(String(row.booking_time)),
    locationId: String(row.location_id),
  };
}

function mapActiveBooking(row: BookingRow): AgendaFirmasActiveBooking {
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

function mapCancelledBooking(row: BookingRow): AgendaFirmasCancelledBooking {
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

async function getCurrentOrganizationId(client: SupabaseClient): Promise<string> {
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError || !user?.id) {
    throw new AgendaFirmasSupabaseError(
      "No hay sesi?n de Supabase activa. Inicia sesi?n de nuevo.",
    );
  }

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("organization_id, active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.organization_id || profile.active === false) {
    throw new AgendaFirmasSupabaseError(
      "No se pudo resolver la organizaci?n del usuario activo.",
    );
  }

  return String(profile.organization_id);
}

async function requireSupabaseSession(): Promise<{ client: SupabaseClient }> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AgendaFirmasSupabaseError(
      "Supabase no est? configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const client = supabaseBrowser;
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();

  if (sessionError || !session?.user) {
    throw new AgendaFirmasSupabaseError(
      "No hay sesi?n de Supabase activa. Inicia sesi?n de nuevo.",
    );
  }

  return { client };
}

/** P3P.2: lectura config + bookings y reserva v?a RPC `book_firmas`. */
export class SupabaseAgendaFirmasBookingRepo implements AgendaFirmasBookingRepo {
  private readonly configRepo = new SupabaseAgendaFirmasConfigRepo();

  getFirmasConfig() {
    return this.configRepo.getFirmasConfig();
  }

  async listBookedSlots(params: {
    fromDate: string;
    toDate: string;
    locationId?: string;
  }): Promise<readonly AgendaFirmasBookedSlot[]> {
    const { client } = await requireSupabaseSession();
    const organizationId = await getCurrentOrganizationId(client);

    let query = client
      .from("agenda_bookings")
      .select(BOOKING_SELECT)
      .eq("organization_id", organizationId)
      .eq("kind", "firmas")
      .eq("status", "booked")
      .gte("booking_date", params.fromDate)
      .lte("booking_date", params.toDate);

    if (params.locationId) {
      query = query.eq("location_id", params.locationId);
    }

    const { data, error } = await query;

    if (error) {
      throw new AgendaFirmasSupabaseError(
        "No se pudieron cargar las reservas de firmas. Intenta de nuevo m?s tarde.",
      );
    }

    return (data ?? []).map((row) => mapBookedSlot(row as BookingRow));
  }

  async getActiveBooking(expedienteId: string): Promise<AgendaFirmasActiveBooking | null> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client
      .from("agenda_bookings")
      .select(BOOKING_SELECT)
      .eq("expediente_id", expedienteId)
      .eq("kind", "firmas")
      .eq("status", "booked")
      .maybeSingle();

    if (error) {
      throw new AgendaFirmasSupabaseError(
        "No se pudo consultar la cita de firma activa.",
      );
    }

    if (!data) return null;
    return mapActiveBooking(data as BookingRow);
  }

  async getLastCancelledBooking(
    expedienteId: string,
  ): Promise<AgendaFirmasCancelledBooking | null> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client
      .from("agenda_bookings")
      .select(BOOKING_SELECT)
      .eq("expediente_id", expedienteId)
      .eq("kind", "firmas")
      .eq("status", "cancelled")
      .order("cancelled_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new AgendaFirmasSupabaseError(
        "No se pudo consultar la ?ltima cita de firma cancelada.",
      );
    }

    if (!data) return null;
    return mapCancelledBooking(data as BookingRow);
  }

  async bookFirmas(params: {
    expedienteId: string;
    scheduledAt: string;
    locationId: string;
    note?: string | null;
  }): Promise<BookFirmasResult> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client.rpc("book_firmas", {
      p_expediente_id: params.expedienteId,
      p_scheduled_at: params.scheduledAt,
      p_location_id: params.locationId,
      p_note: params.note ?? null,
    });

    if (error) {
      throw mapBookFirmasRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new AgendaFirmasSupabaseError(
        "Respuesta inv?lida al agendar la cita de firma.",
      );
    }

    const row = data as BookRpcRow;
    if (!row.ok) {
      throw new AgendaFirmasSupabaseError(
        "La RPC no confirm? la reserva de firma.",
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
      etapaActual: Number(row.etapa_actual ?? 9),
    };
  }

  async cancelFirmas(params: {
    expedienteId: string;
    motivo?: string | null;
  }): Promise<CancelFirmasResult> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client.rpc("cancel_firmas", {
      p_expediente_id: params.expedienteId,
      p_motivo: params.motivo?.trim() || null,
    });

    if (error) {
      throw mapCancelFirmasRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new AgendaFirmasSupabaseError(
        "Respuesta inv?lida al cancelar la cita de firma.",
      );
    }

    const row = data as CancelRpcRow;
    if (!row.ok) {
      throw new AgendaFirmasSupabaseError(
        "La RPC no confirm? la cancelaci?n de firma.",
      );
    }

    return {
      ok: true,
      expedienteId: String(row.expediente_id ?? params.expedienteId),
      bookingId: String(row.booking_id ?? ""),
      status: "cancelled",
      etapaActual: Number(row.etapa_actual ?? 9),
    };
  }

  async reagendarFirmas(params: {
    expedienteId: string;
    scheduledAt: string;
    locationId: string;
    note?: string | null;
  }): Promise<ReagendarFirmasResult> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client.rpc("reagendar_firmas", {
      p_expediente_id: params.expedienteId,
      p_scheduled_at: params.scheduledAt,
      p_location_id: params.locationId,
      p_note: params.note ?? null,
    });

    if (error) {
      throw mapReagendarFirmasRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new AgendaFirmasSupabaseError(
        "Respuesta inv?lida al reagendar la cita de firma.",
      );
    }

    const row = data as ReagendarRpcRow;
    if (!row.ok) {
      throw new AgendaFirmasSupabaseError(
        "La RPC no confirm? el reagendado de firma.",
      );
    }

    return {
      ok: true,
      expedienteId: String(row.expediente_id ?? params.expedienteId),
      bookingAnteriorId: String(row.booking_anterior_id ?? ""),
      bookingNuevoId: String(row.booking_nuevo_id ?? ""),
      scheduledAt: String(row.scheduled_at ?? params.scheduledAt),
      status: "booked",
      kind: "firmas",
      etapaActual: Number(row.etapa_actual ?? 9),
    };
  }
}
