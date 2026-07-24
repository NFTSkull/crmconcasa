/**
 * P131 — RPC mesa_set_notificacion_booking_location (Zod + fail soft tipado).
 */

import { z } from "zod";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  CYNTHIA_SEDE_APODACA_ID,
  CYNTHIA_SEDE_MONTERREY_ID,
} from "@/lib/agendaCynthiaLocations";

const resultSchema = z.object({
  ok: z.boolean(),
  booking_id: z.string().uuid(),
  location_id: z.enum([CYNTHIA_SEDE_MONTERREY_ID, CYNTHIA_SEDE_APODACA_ID]),
  previous_location_id: z.string().nullable().optional(),
  unchanged: z.boolean().optional(),
  booking_date: z.string().nullable().optional(),
  booking_time: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
});

export type MesaSetNotificacionLocationResult = Readonly<{
  ok: true;
  bookingId: string;
  locationId: typeof CYNTHIA_SEDE_MONTERREY_ID | typeof CYNTHIA_SEDE_APODACA_ID;
  previousLocationId: string | null;
  unchanged: boolean;
  bookingDate: string | null;
  bookingTime: string | null;
  status: string | null;
  kind: string | null;
}>;

export class MesaSetNotificacionLocationError extends Error {
  readonly code: string;
  constructor(message: string, code = "rpc_error") {
    super(message);
    this.name = "MesaSetNotificacionLocationError";
    this.code = code;
  }
}

export function mapMesaSetNotificacionLocationError(err: unknown): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "No se pudo guardar la sede.";
  if (/rol no autorizado/i.test(msg)) {
    return "No tienes permiso para asignar sede.";
  }
  if (/solo kind=notificacion/i.test(msg)) {
    return "Solo se puede asignar sede a citas de Notificación.";
  }
  if (/ya es canónica/i.test(msg)) {
    return "Esta cita ya tiene una sede válida.";
  }
  if (/inválido|use monterrey o apodaca/i.test(msg)) {
    return "Selecciona Monterrey o Apodaca.";
  }
  if (/no encontrado|no autorizado|fuera de organización/i.test(msg)) {
    return "No se pudo actualizar esta cita.";
  }
  return "No se pudo guardar la sede. Intenta de nuevo.";
}

export async function mesaSetNotificacionBookingLocation(
  bookingId: string,
  locationId: string,
): Promise<MesaSetNotificacionLocationResult> {
  const id = String(bookingId ?? "").trim();
  const loc = String(locationId ?? "").trim().toLowerCase();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new MesaSetNotificacionLocationError("booking_id inválido", "validation");
  }
  if (loc !== CYNTHIA_SEDE_MONTERREY_ID && loc !== CYNTHIA_SEDE_APODACA_ID) {
    throw new MesaSetNotificacionLocationError(
      "Selecciona Monterrey o Apodaca.",
      "validation",
    );
  }
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new MesaSetNotificacionLocationError(
      "Supabase no configurado",
      "config",
    );
  }
  const { data, error } = await supabaseBrowser.rpc(
    "mesa_set_notificacion_booking_location",
    {
      p_booking_id: id,
      p_location_id: loc,
    },
  );
  if (error) {
    throw new MesaSetNotificacionLocationError(
      error.message || "rpc_error",
      error.code ?? "rpc_error",
    );
  }
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success || !parsed.data.ok) {
    throw new MesaSetNotificacionLocationError(
      "Respuesta inválida del servidor",
      "parse",
    );
  }
  return {
    ok: true,
    bookingId: parsed.data.booking_id,
    locationId: parsed.data.location_id,
    previousLocationId: parsed.data.previous_location_id ?? null,
    unchanged: Boolean(parsed.data.unchanged),
    bookingDate: parsed.data.booking_date ?? null,
    bookingTime: parsed.data.booking_time ?? null,
    status: parsed.data.status ?? null,
    kind: parsed.data.kind ?? null,
  };
}
