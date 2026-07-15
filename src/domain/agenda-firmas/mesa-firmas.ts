import { z } from "zod";
import { AgendaFirmasSupabaseError } from "./supabase.error";

const uuidSchema = z.string().trim().uuid();
const futureIsoSchema = z.string().datetime({ offset: true });

export const mesaBookFirmasInputSchema = z.object({
  expedienteId: uuidSchema,
  bookingAt: futureIsoSchema,
  timezone: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  nota: z.string().trim().nullable().optional(),
});

export const mesaReagendarFirmasInputSchema = z.object({
  expedienteId: uuidSchema,
  bookingAt: futureIsoSchema,
  timezone: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  motivo: z.string().trim().min(1, "El motivo es obligatorio."),
});

export const mesaCancelFirmasInputSchema = z.object({
  expedienteId: uuidSchema,
  motivo: z.string().trim().min(1, "El motivo es obligatorio."),
});

export const mesaBookFirmasResponseSchema = z.object({
  ok: z.literal(true),
  expediente_id: uuidSchema,
  booking_id: uuidSchema,
  booking_at: z.string().min(1),
  timezone: z.string().min(1),
  booking_date: z.string().min(1),
  booking_time: z.string().min(1),
  location_id: z.string().min(1),
  etapa_actual: z.number().int().min(1).max(12),
});

export const mesaReagendarFirmasResponseSchema = z.object({
  ok: z.literal(true),
  expediente_id: uuidSchema,
  old_booking_id: uuidSchema,
  new_booking_id: uuidSchema,
  booking_at: z.string().min(1),
  timezone: z.string().min(1),
  booking_date: z.string().min(1),
  booking_time: z.string().min(1),
  location_id: z.string().min(1),
  etapa_actual: z.number().int().min(1).max(12),
});

export const mesaCancelFirmasResponseSchema = z.object({
  ok: z.literal(true),
  expediente_id: uuidSchema,
  booking_id: uuidSchema,
  status: z.literal("cancelled"),
  etapa_actual: z.number().int().min(1).max(12),
  fecha_cita_cleared: z.boolean(),
});

export type MesaBookFirmasInput = z.infer<typeof mesaBookFirmasInputSchema>;
export type MesaReagendarFirmasInput = z.infer<
  typeof mesaReagendarFirmasInputSchema
>;
export type MesaCancelFirmasInput = z.infer<typeof mesaCancelFirmasInputSchema>;
export type MesaBookFirmasResponse = z.infer<
  typeof mesaBookFirmasResponseSchema
>;
export type MesaReagendarFirmasResponse = z.infer<
  typeof mesaReagendarFirmasResponseSchema
>;
export type MesaCancelFirmasResponse = z.infer<
  typeof mesaCancelFirmasResponseSchema
>;

type RpcErrorLike = Readonly<{
  code?: string;
  message?: string;
  details?: string;
}>;

const MESSAGES: Readonly<Record<string, string>> = {
  MESA_SIGNATURE_UNAUTHORIZED: "No tienes permiso para gestionar firmas.",
  MESA_SIGNATURE_NOT_FOUND: "El expediente no existe o no está disponible.",
  MESA_SIGNATURE_NOT_VISIBLE: "No tienes visibilidad sobre este expediente.",
  MESA_SIGNATURE_BAD_DATE: "Selecciona una fecha futura válida.",
  MESA_SIGNATURE_BAD_TIMEZONE:
    "La zona horaria no coincide con la agenda configurada.",
  MESA_SIGNATURE_BAD_LOCATION: "Selecciona una sede válida.",
  MESA_SIGNATURE_BAD_STATE: "El expediente no está activo en Mesa.",
  MESA_SIGNATURE_BAD_STAGE: "Solo se pueden agendar firmas en etapas 9 o 10.",
  MESA_SIGNATURE_ALREADY_BOOKED:
    "El expediente ya tiene una cita de firma activa.",
  MESA_SIGNATURE_REASON_REQUIRED: "El motivo es obligatorio.",
  MESA_SIGNATURE_NO_ACTIVE_BOOKING:
    "No existe una cita de firma activa para esta operación.",
};

export function getMesaFirmasErrorCode(error: RpcErrorLike): string | null {
  const source = `${error.message ?? ""} ${error.details ?? ""}`;
  return Object.keys(MESSAGES).find((code) => source.includes(code)) ?? null;
}

export function mapMesaFirmasRpcError(
  error: RpcErrorLike,
): AgendaFirmasSupabaseError {
  const code = getMesaFirmasErrorCode(error);
  if (code) return new AgendaFirmasSupabaseError(MESSAGES[code]);
  return new AgendaFirmasSupabaseError(
    "No se pudo completar la gestión de la cita de firma.",
  );
}

export function getMesaFirmasUiAccess(input: {
  role: string | null | undefined;
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
}): { visible: boolean; canCreate: boolean; canCancel: boolean } {
  const isMesa = [
    "mesa_admin",
    "mesa_interno",
    "mesa_externo",
    "super_admin",
    "mesa_control",
    "mesa_control_admin",
    "mesa_control_interno",
    "mesa_control_externo",
  ].includes(String(input.role ?? ""));
  const canCreate =
    isMesa && (input.etapaActual === 9 || input.etapaActual === 10);
  const canCancel = isMesa && input.hasActiveBooking;
  return {
    visible: canCreate || canCancel,
    canCreate,
    canCancel,
  };
}
