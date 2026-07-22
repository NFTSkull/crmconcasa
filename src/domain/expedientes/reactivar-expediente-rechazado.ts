import { z } from "zod";
import { ExpedientesSupabaseError } from "./supabase.error";
import type { RpcErrorLike } from "./reingreso-post-biometricos";
import { reingresoExpedienteIdSchema } from "./reingreso-post-biometricos";

export { reingresoExpedienteIdSchema };

export const reactivarExpedienteResponseSchema = z.object({
  ok: z.literal(true),
  expediente_id: z.string().uuid(),
  reactivacion_id: z.string().uuid(),
  rechazo_id: z.string().uuid(),
  etapa: z.number().int().min(1).max(12),
  subestado_anterior: z.string().min(1),
  subestado: z.enum(["en_validacion_mesa", "en_proceso"]),
});

export type ReactivarExpedienteResponse = z.infer<
  typeof reactivarExpedienteResponseSchema
>;

/** Subestado canónico post-reactivación (misma regla que mesa_mover_etapa). */
export function subestadoCanonicoTrasReactivacion(
  etapaActual: number,
): "en_validacion_mesa" | "en_proceso" {
  return etapaActual === 1 ? "en_validacion_mesa" : "en_proceso";
}

export function esExpedienteRechazadoOperativoActivo(input: {
  submittedToMesa?: boolean | null;
  cicloEstado?: string | null;
  subestado?: string | null;
}): boolean {
  return (
    input.submittedToMesa === true &&
    (input.cicloEstado == null || input.cicloEstado === "activo") &&
    input.subestado === "rechazado"
  );
}

export const ASESOR_REACTIVAR_RECHAZO_CTA = "Corregir y reenviar a Mesa";

const REACTIVATION_MESSAGES: Readonly<Record<string, string>> = {
  REACTIVATION_UNAUTHORIZED:
    "No tienes permiso para reenviar este expediente a Mesa.",
  REACTIVATION_NOT_FOUND: "El expediente no existe o ya no está disponible.",
  REACTIVATION_CYCLE_NOT_ACTIVE:
    "El expediente está cancelado o su ciclo ya no está activo.",
  REACTIVATION_NOT_REJECTED: "El expediente no está rechazado.",
  REACTIVATION_NO_REJECTION: "No hay un rechazo vigente para reactivar.",
  REACTIVATION_ALREADY_DONE: "Este rechazo ya fue reenviado a Mesa.",
  REACTIVATION_STAGE_OUT_OF_RANGE: "La etapa del expediente no es válida.",
  REACTIVATION_SIDE_EFFECT:
    "La reactivación se detuvo para no alterar citas o documentos.",
};

export function getReactivacionErrorCode(error: RpcErrorLike): string | null {
  const source = `${error.message ?? ""} ${error.details ?? ""}`;
  return (
    Object.keys(REACTIVATION_MESSAGES).find((code) => source.includes(code)) ??
    null
  );
}

export function mapReactivacionRpcError(
  error: RpcErrorLike,
  fallback = "No se pudo reenviar el expediente a Mesa.",
): ExpedientesSupabaseError {
  const code = getReactivacionErrorCode(error);
  return new ExpedientesSupabaseError(
    code ? (REACTIVATION_MESSAGES[code] ?? fallback) : fallback,
  );
}
