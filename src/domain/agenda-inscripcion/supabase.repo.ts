"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  INSCRIPCION_BOOKING_KIND,
  INSCRIPCION_FIXED_TIME,
} from "./constants";
import {
  mapBookInscripcionRpcError,
  mapCancelInscripcionRpcError,
  mapMesaSolicitarInscripcionRpcError,
} from "./rpc-error";
import { AgendaInscripcionError } from "./supabase.error";
import type {
  AgendaInscripcionRepo,
  BookInscripcionParams,
  CancelInscripcionParams,
  InscripcionAvailabilitySlot,
  InscripcionMutationResult,
  ReagendarInscripcionParams,
} from "./repo";
import type {
  AgendaInscripcionActiveBooking,
  AgendaInscripcionAsesorEligibility,
  AgendaInscripcionRequirement,
  AgendaInscripcionRequirementSourceType,
  AgendaInscripcionRequirementStatus,
} from "./types";

type ReqRow = Readonly<{
  id: string;
  organization_id: string;
  expediente_id: string;
  source_booking_id: string | null;
  source_kind: string | null;
  source_type: string;
  status: string;
  requested_by: string | null;
  requested_at: string;
  booked_booking_id: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  reason: string | null;
  source_sheet_id: number | string | null;
  source_sheet_row: number | null;
  created_at: string;
  updated_at: string;
}>;

type BookingRow = Readonly<{
  id: string;
  expediente_id: string;
  booking_date: string;
  booking_time: string;
  location_id: string;
  status: string;
}>;

function clientOrThrow(): SupabaseClient {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AgendaInscripcionError(
      "Supabase no está configurado en este entorno.",
    );
  }
  return supabaseBrowser;
}

function normalizeTime(value: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(String(value).trim());
  return m ? `${m[1]}:${m[2]}` : String(value).trim();
}

function mapRequirement(row: ReqRow): AgendaInscripcionRequirement {
  return {
    id: row.id,
    organizationId: row.organization_id,
    expedienteId: row.expediente_id,
    sourceBookingId: row.source_booking_id,
    sourceKind: row.source_kind,
    sourceType: row.source_type as AgendaInscripcionRequirementSourceType,
    status: row.status as AgendaInscripcionRequirementStatus,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    bookedBookingId: row.booked_booking_id,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    reason: row.reason,
    sourceSheetId:
      row.source_sheet_id == null ? null : Number(row.source_sheet_id),
    sourceSheetRow: row.source_sheet_row,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActiveBooking(row: BookingRow): AgendaInscripcionActiveBooking {
  return {
    bookingId: row.id,
    expedienteId: row.expediente_id,
    bookingDate: String(row.booking_date).slice(0, 10),
    bookingTime: normalizeTime(String(row.booking_time)),
    locationId: String(row.location_id),
    status: "booked",
    kind: INSCRIPCION_BOOKING_KIND,
  };
}

function mutationFromError(e: unknown): InscripcionMutationResult {
  if (e instanceof AgendaInscripcionError) {
    return { ok: false, errorCode: e.code, message: e.message };
  }
  return {
    ok: false,
    errorCode: "UNKNOWN",
    message: e instanceof Error ? e.message : "Error desconocido",
  };
}

export class SupabaseAgendaInscripcionRepo implements AgendaInscripcionRepo {
  async getOpenRequirement(
    expedienteId: string,
  ): Promise<AgendaInscripcionRequirement | null> {
    const sb = clientOrThrow();
    const { data, error } = await sb
      .from("agenda_inscripcion_requerimientos")
      .select(
        "id,organization_id,expediente_id,source_booking_id,source_kind,source_type,status,requested_by,requested_at,booked_booking_id,completed_at,cancelled_at,reason,source_sheet_id,source_sheet_row,created_at,updated_at",
      )
      .eq("expediente_id", expedienteId)
      .in("status", ["pending_booking", "booked", "rebook_required"])
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      // Tabla/enum ausente (Cloud sin mig 173) → sin requirement.
      if (
        /does not exist|invalid input value for enum|agenda_inscripcion/i.test(
          error.message,
        )
      ) {
        return null;
      }
      throw new AgendaInscripcionError(error.message);
    }
    return data ? mapRequirement(data as ReqRow) : null;
  }

  async getActiveBooking(
    expedienteId: string,
  ): Promise<AgendaInscripcionActiveBooking | null> {
    const sb = clientOrThrow();
    const { data, error } = await sb
      .from("agenda_bookings")
      .select("id,expediente_id,booking_date,booking_time,location_id,status")
      .eq("expediente_id", expedienteId)
      .eq("kind", INSCRIPCION_BOOKING_KIND)
      .eq("status", "booked")
      .maybeSingle();
    if (error) {
      if (/invalid input value for enum|inscripcion/i.test(error.message)) {
        return null;
      }
      throw new AgendaInscripcionError(error.message);
    }
    return data ? mapActiveBooking(data as BookingRow) : null;
  }

  async getAsesorEligibility(
    expedienteId: string,
  ): Promise<AgendaInscripcionAsesorEligibility> {
    try {
      const sb = clientOrThrow();
      const { data, error } = await sb.rpc(
        "agenda_inscripcion_asesor_eligibility",
        { p_expediente_id: expedienteId },
      );
      if (error) {
        if (
          /does not exist|agenda_inscripcion_asesor_eligibility/i.test(
            error.message,
          )
        ) {
          return { eligible: false, reasonCode: "rpc_unavailable" };
        }
        throw new AgendaInscripcionError(error.message);
      }
      const row = data as {
        eligible?: boolean;
        reason_code?: string;
        has_open_requirement?: boolean;
        has_active_booking?: boolean;
        location_id?: string;
        fixed_time?: string;
        etapa_actual?: number;
      } | null;
      return {
        eligible: row?.eligible === true,
        reasonCode: String(row?.reason_code ?? "unknown"),
        hasOpenRequirement: row?.has_open_requirement === true,
        hasActiveBooking: row?.has_active_booking === true,
        locationId: "monterrey",
        fixedTime: "11:00",
        etapaActual:
          typeof row?.etapa_actual === "number" ? row.etapa_actual : undefined,
      };
    } catch {
      return { eligible: false, reasonCode: "eligibility_error" };
    }
  }

  async listAvailability(params: {
    fromDate: string;
    toDate: string;
    locationId?: string;
  }): Promise<readonly InscripcionAvailabilitySlot[]> {
    const sb = clientOrThrow();
    const locationId = params.locationId ?? "monterrey";
    // Una fecha: fromDate (card usa día seleccionado).
    const bookingDate = params.fromDate;
    const { data, error } = await sb.rpc("agenda_sheet_inventory_availability", {
      p_kind: INSCRIPCION_BOOKING_KIND,
      p_date: bookingDate,
      p_location_id: locationId,
    });
    if (error) {
      if (/inscripcion|invalid input value for enum/i.test(error.message)) {
        return [
          {
            bookingDate,
            locationId,
            bookingTime: INSCRIPCION_FIXED_TIME,
            capacity: 0,
            occupied: 0,
            available: 0,
          },
        ];
      }
      throw new AgendaInscripcionError(error.message);
    }

    const payload = data as {
      ok?: boolean;
      slots?: ReadonlyArray<{
        slot_time?: string;
        sheet_slot_time?: string | null;
        available?: number;
        capacity?: number;
        occupied?: number;
      }>;
    } | null;

    const slots = payload?.slots ?? [];
    const match = slots.find((s) => {
      const t = normalizeTime(String(s.sheet_slot_time ?? s.slot_time ?? ""));
      return t === INSCRIPCION_FIXED_TIME;
    });

    const available = Number(match?.available ?? 0);
    const capacity = Number(match?.capacity ?? available);
    const occupied = Number(match?.occupied ?? Math.max(0, capacity - available));

    return [
      {
        bookingDate,
        locationId,
        bookingTime: INSCRIPCION_FIXED_TIME,
        capacity,
        occupied,
        available,
      },
    ];
  }

  async book(params: BookInscripcionParams): Promise<InscripcionMutationResult> {
    try {
      const sb = clientOrThrow();
      const { data, error } = await sb.rpc("book_inscripcion_extraordinaria", {
        p_expediente_id: params.expedienteId,
        p_booking_date: params.bookingDate,
        p_location_id: params.locationId,
        p_note: params.note ?? null,
      });
      if (error) throw mapBookInscripcionRpcError(error);
      const row = data as {
        ok?: boolean;
        booking_id?: string;
        requirement_id?: string;
        requirement_created?: boolean;
      } | null;
      if (!row?.ok) {
        return { ok: false, message: "No se pudo agendar la cita." };
      }
      return {
        ok: true,
        bookingId: row.booking_id,
        requirementId: row.requirement_id,
        requirementCreated: row.requirement_created === true,
      };
    } catch (e) {
      return mutationFromError(
        e instanceof AgendaInscripcionError ? e : mapBookInscripcionRpcError(e as never),
      );
    }
  }

  async cancel(
    params: CancelInscripcionParams,
  ): Promise<InscripcionMutationResult> {
    try {
      const sb = clientOrThrow();
      const active = await this.getActiveBooking(params.expedienteId);
      if (!active) {
        return {
          ok: false,
          errorCode: "NO_BOOKING",
          message: "No hay una cita de inscripción activa para cancelar.",
        };
      }
      const { data, error } = await sb.rpc("cancel_inscripcion_extraordinaria", {
        p_booking_id: active.bookingId,
        p_motivo: params.motivo ?? null,
        p_resolve_requirement: params.terminal === true,
      });
      if (error) throw mapCancelInscripcionRpcError(error);
      const row = data as { ok?: boolean; booking_id?: string } | null;
      if (!row?.ok) {
        return { ok: false, message: "No se pudo cancelar la cita." };
      }
      return { ok: true, bookingId: row.booking_id ?? active.bookingId };
    } catch (e) {
      return mutationFromError(
        e instanceof AgendaInscripcionError
          ? e
          : mapCancelInscripcionRpcError(e as never),
      );
    }
  }

  async cancelByBookingId(params: {
    bookingId: string;
    motivo?: string | null;
    terminal?: boolean;
  }): Promise<InscripcionMutationResult> {
    try {
      const sb = clientOrThrow();
      const { data, error } = await sb.rpc("cancel_inscripcion_extraordinaria", {
        p_booking_id: params.bookingId,
        p_motivo: params.motivo ?? null,
        p_resolve_requirement: params.terminal === true,
      });
      if (error) throw mapCancelInscripcionRpcError(error);
      const row = data as { ok?: boolean; booking_id?: string } | null;
      if (!row?.ok) {
        return { ok: false, message: "No se pudo cancelar la cita." };
      }
      return { ok: true, bookingId: row.booking_id ?? params.bookingId };
    } catch (e) {
      return mutationFromError(
        e instanceof AgendaInscripcionError
          ? e
          : mapCancelInscripcionRpcError(e as never),
      );
    }
  }

  async reagendar(
    params: ReagendarInscripcionParams,
  ): Promise<InscripcionMutationResult> {
    try {
      const sb = clientOrThrow();
      const { data, error } = await sb.rpc(
        "reagendar_inscripcion_extraordinaria",
        {
          p_expediente_id: params.expedienteId,
          p_booking_date: params.bookingDate,
          p_location_id: params.locationId,
          p_note: params.note ?? null,
        },
      );
      if (error) throw mapBookInscripcionRpcError(error);
      const row = data as { ok?: boolean; booking_id?: string } | null;
      if (!row?.ok) {
        return { ok: false, message: "No se pudo reagendar la cita." };
      }
      return { ok: true, bookingId: row.booking_id };
    } catch (e) {
      return mutationFromError(
        e instanceof AgendaInscripcionError ? e : mapBookInscripcionRpcError(e as never),
      );
    }
  }

  async mesaSolicitar(params: {
    expedienteId: string;
    motivo: string;
  }): Promise<InscripcionMutationResult & { requirementId?: string; idempotent?: boolean }> {
    try {
      const sb = clientOrThrow();
      const { data, error } = await sb.rpc("mesa_solicitar_cita_inscripcion", {
        p_expediente_id: params.expedienteId,
        p_motivo: params.motivo,
      });
      if (error) throw mapMesaSolicitarInscripcionRpcError(error);
      const row = data as {
        ok?: boolean;
        requirement_id?: string;
        idempotent?: boolean;
      } | null;
      if (!row?.ok) {
        return { ok: false, message: "No se pudo solicitar la cita." };
      }
      return {
        ok: true,
        requirementId: row.requirement_id,
        idempotent: row.idempotent === true,
      };
    } catch (e) {
      return mutationFromError(
        e instanceof AgendaInscripcionError
          ? e
          : mapMesaSolicitarInscripcionRpcError(e as never),
      );
    }
  }

  /** Listado Admin / bandeja: requisitos abiertos del asesor. */
  async listOpenRequirementsForAsesor(): Promise<
    readonly AgendaInscripcionRequirement[]
  > {
    const sb = clientOrThrow();
    const { data, error } = await sb
      .from("agenda_inscripcion_requerimientos")
      .select(
        "id,organization_id,expediente_id,source_booking_id,source_kind,source_type,status,requested_by,requested_at,booked_booking_id,completed_at,cancelled_at,reason,source_sheet_id,source_sheet_row,created_at,updated_at",
      )
      .in("status", ["pending_booking", "rebook_required"])
      .order("requested_at", { ascending: false })
      .limit(100);
    if (error) {
      if (
        /does not exist|invalid input value for enum|agenda_inscripcion/i.test(
          error.message,
        )
      ) {
        return [];
      }
      throw new AgendaInscripcionError(error.message);
    }
    return ((data ?? []) as ReqRow[]).map(mapRequirement);
  }

  /** Bookings inscripción del periodo (Reporte del día). Fail-soft sin mig 173. */
  async listBookedForPeriod(params: {
    fromDate: string;
    toDateInclusive: string;
  }): Promise<
    ReadonlyArray<{
      bookingId: string;
      expedienteId: string;
      bookingDate: string;
      bookingTime: string;
      locationId: string;
      clienteNombre: string;
      asesorNombre: string;
    }>
  > {
    const sb = clientOrThrow();
    const { data, error } = await sb
      .from("agenda_bookings")
      .select(
        `
        id,
        expediente_id,
        booking_date,
        booking_time,
        location_id,
        expedientes!inner (
          cliente_nombre,
          profiles:asesor_id ( full_name )
        )
      `,
      )
      .eq("kind", INSCRIPCION_BOOKING_KIND)
      .eq("status", "booked")
      .gte("booking_date", params.fromDate)
      .lte("booking_date", params.toDateInclusive)
      .order("booking_date", { ascending: true })
      .limit(500);

    if (error) {
      if (/invalid input value for enum|inscripcion|does not exist/i.test(error.message)) {
        return [];
      }
      // Join shape may differ — soft empty
      console.warn("[inscripcion] listBookedForPeriod", error.message);
      return [];
    }

    type Row = {
      id: string;
      expediente_id: string;
      booking_date: string;
      booking_time: string;
      location_id: string;
      expedientes?: {
        cliente_nombre?: string | null;
        profiles?: { full_name?: string | null } | null;
      } | null;
    };

    return ((data ?? []) as Row[]).map((r) => ({
      bookingId: r.id,
      expedienteId: r.expediente_id,
      bookingDate: String(r.booking_date).slice(0, 10),
      bookingTime: normalizeTime(String(r.booking_time)),
      locationId: String(r.location_id),
      clienteNombre: r.expedientes?.cliente_nombre?.trim() || "Cliente",
      asesorNombre: r.expedientes?.profiles?.full_name?.trim() || "Asesor",
    }));
  }
}
