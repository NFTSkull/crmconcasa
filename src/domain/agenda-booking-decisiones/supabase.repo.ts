import { z } from "zod";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  agendaBookingDecisionRowSchema,
  mapAgendaBookingDecisionRow,
  mesaCancelarCitaYContinuarResultSchema,
  mesaGestionarCitaResultSchema,
  type AgendaBookingDecision,
  type MesaCancelarCitaYContinuarResult,
  type MesaGestionarCitaAction,
  type MesaGestionarCitaResult,
} from "./types";

export class AgendaBookingDecisionesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgendaBookingDecisionesError";
  }
}

function requireClient() {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AgendaBookingDecisionesError(
      "Supabase no está configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return supabaseBrowser;
}

function mapGestionarRpcError(msg: string): AgendaBookingDecisionesError {
  if (/motivo obligatorio/i.test(msg)) {
    return new AgendaBookingDecisionesError("El motivo es obligatorio.");
  }
  if (/rol no autorizado/i.test(msg)) {
    return new AgendaBookingDecisionesError("No tienes permiso para esta acción.");
  }
  if (/booking no activo|no encontrado/i.test(msg)) {
    return new AgendaBookingDecisionesError("La cita ya no está activa o no existe.");
  }
  if (/solo en etapa 4/i.test(msg)) {
    return new AgendaBookingDecisionesError(
      "Cancelar y continuar (biométricos) solo aplica en etapa 4.",
    );
  }
  if (/solo en etapa 10/i.test(msg)) {
    return new AgendaBookingDecisionesError(
      "Cancelar y continuar (firmas) solo aplica en etapa 10.",
    );
  }
  if (/notificación no soporta/i.test(msg)) {
    return new AgendaBookingDecisionesError(
      "Notificación no admite cancelar y continuar.",
    );
  }
  if (/ciclo activo|cancelado|rechaz/i.test(msg)) {
    return new AgendaBookingDecisionesError(
      "El expediente no está en un estado operable para continuar.",
    );
  }
  return new AgendaBookingDecisionesError("No se pudo completar la operación.");
}

export async function listAgendaBookingDecisiones(
  expedienteId: string,
): Promise<AgendaBookingDecision[]> {
  const client = requireClient();
  const { data, error } = await client.rpc("list_agenda_booking_decisiones", {
    p_expediente_id: expedienteId,
  });

  if (error) {
    const msg = error.message ?? "";
    if (/no autenticado/i.test(msg)) {
      throw new AgendaBookingDecisionesError("Tu sesión expiró. Inicia sesión nuevamente.");
    }
    if (/no autorizado/i.test(msg)) {
      throw new AgendaBookingDecisionesError(
        "No tienes permiso para consultar decisiones de cita.",
      );
    }
    throw new AgendaBookingDecisionesError("No se pudieron cargar las decisiones de cita.");
  }

  const parsed = z.array(agendaBookingDecisionRowSchema).safeParse(data ?? []);
  if (!parsed.success) {
    throw new AgendaBookingDecisionesError("La respuesta de decisiones no es válida.");
  }
  return parsed.data.map(mapAgendaBookingDecisionRow);
}

export async function mesaGestionarCita(params: {
  bookingId: string;
  action: MesaGestionarCitaAction;
  motivo: string;
  newScheduledAt?: string | null;
  newLocationId?: string | null;
  newBookingDate?: string | null;
}): Promise<MesaGestionarCitaResult> {
  const client = requireClient();
  const { data, error } = await client.rpc("mesa_gestionar_cita", {
    p_booking_id: params.bookingId,
    p_action: params.action,
    p_motivo: params.motivo,
    p_new_scheduled_at: params.newScheduledAt ?? null,
    p_new_location_id: params.newLocationId ?? null,
    p_new_booking_date: params.newBookingDate ?? null,
  });

  if (error) {
    throw mapGestionarRpcError(error.message ?? "");
  }

  const parsed = mesaGestionarCitaResultSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new AgendaBookingDecisionesError("La respuesta al gestionar la cita no es válida.");
  }
  return parsed.data;
}

export async function mesaCancelarCitaYContinuar(params: {
  bookingId: string;
  motivo: string;
}): Promise<MesaCancelarCitaYContinuarResult> {
  const client = requireClient();
  const { data, error } = await client.rpc("mesa_cancelar_cita_y_continuar", {
    p_booking_id: params.bookingId,
    p_motivo: params.motivo,
  });

  if (error) {
    throw mapGestionarRpcError(error.message ?? "");
  }

  const parsed = mesaCancelarCitaYContinuarResultSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new AgendaBookingDecisionesError(
      "La respuesta de cancelar y continuar no es válida.",
    );
  }
  return parsed.data;
}
