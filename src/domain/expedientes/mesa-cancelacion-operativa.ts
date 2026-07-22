import { z } from "zod";
import { ExpedientesSupabaseError } from "./supabase.error";
import { reingresoExpedienteIdSchema, type RpcErrorLike } from "./reingreso-post-biometricos";

export { reingresoExpedienteIdSchema };

export const cancelacionOperativaInputSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(1, "El motivo de la cancelación es obligatorio.")
    .max(500, "El motivo no puede exceder 500 caracteres."),
  comentario: z
    .string()
    .trim()
    .max(2000, "El comentario no puede exceder 2000 caracteres.")
    .nullable()
    .optional(),
});

export type CancelacionOperativaInput = z.infer<
  typeof cancelacionOperativaInputSchema
>;

export const cancelacionOperativaResponseSchema = z.object({
  ok: z.literal(true),
  expediente_id: z.string().uuid(),
  cancelacion_id: z.string().uuid(),
  ciclo_estado: z.literal("cancelado"),
  subestado: z.string().min(1),
  etapa: z.number().int().min(1).max(12),
});

export type CancelacionOperativaResponse = z.infer<
  typeof cancelacionOperativaResponseSchema
>;

export type ExpedienteCancelacionRow = Readonly<{
  id: string;
  expedienteId: string;
  etapa: number;
  subestadoAnterior: string;
  motivo: string;
  comentario: string | null;
  decididoPor: string;
  decididoPorRol: string;
  createdAt: string;
}>;

const MESA_CANCEL_MESSAGES: Readonly<Record<string, string>> = {
  MESA_CANCEL_EXP_UNAUTHORIZED:
    "No tienes permiso para cancelar este expediente.",
  MESA_CANCEL_EXP_NOT_FOUND: "No se encontró el expediente a cancelar.",
  MESA_CANCEL_EXP_NOT_VISIBLE:
    "El expediente no está visible para tu rol de Mesa.",
  MESA_CANCEL_EXP_NOT_SUBMITTED:
    "Solo se pueden cancelar expedientes enviados a Mesa.",
  MESA_CANCEL_EXP_ALREADY_CANCELLED: "El expediente ya está cancelado.",
  MESA_CANCEL_EXP_CYCLE_NOT_ACTIVE:
    "Solo se pueden cancelar expedientes con ciclo activo.",
  MESA_CANCEL_EXP_REASON_REQUIRED: "El motivo de la cancelación es obligatorio.",
  MESA_CANCEL_EXP_REASON_TOO_LONG:
    "El motivo no puede exceder 500 caracteres.",
  MESA_CANCEL_EXP_COMMENT_TOO_LONG:
    "El comentario no puede exceder 2000 caracteres.",
  MESA_CANCEL_EXP_BOOKING_MUTATION:
    "La cancelación no debe alterar la agenda. Intenta de nuevo.",
};

export function getMesaCancelacionErrorCode(
  error: RpcErrorLike,
): string | null {
  const source = `${error.message ?? ""} ${error.details ?? ""}`;
  return (
    Object.keys(MESA_CANCEL_MESSAGES).find((code) => source.includes(code)) ??
    null
  );
}

export function mapMesaCancelacionRpcError(
  error: RpcErrorLike,
  fallback = "No se pudo cancelar el expediente.",
): ExpedientesSupabaseError {
  const code = getMesaCancelacionErrorCode(error);
  if (code) {
    return new ExpedientesSupabaseError(MESA_CANCEL_MESSAGES[code] ?? fallback);
  }
  if (error.code === "42501") {
    return new ExpedientesSupabaseError(
      "No tienes permiso para cancelar este expediente.",
    );
  }
  return new ExpedientesSupabaseError(fallback);
}

/** Cancelación terminal: enviado a Mesa y ciclo activo (incluye ya rechazado). */
export function esElegibleCancelacionOperativa(input: {
  dataModeSupabase: boolean;
  submittedToMesa: boolean;
  cicloEstado: string | null | undefined;
}): boolean {
  return (
    input.dataModeSupabase &&
    input.submittedToMesa &&
    input.cicloEstado === "activo"
  );
}

export function esExpedienteCancelado(
  cicloEstado: string | null | undefined,
): boolean {
  return cicloEstado === "cancelado";
}

export const MESA_CANCELACION_OPERATIVA_ANCHOR_ID =
  "mesa-cancelacion-operativa" as const;

export const MESA_CANCELACION_OPERATIVA_CARD_BADGE =
  "Cancelación · no continuará";

export const MESA_CANCELACION_OPERATIVA_CARD_TITLE =
  "Cancelar / el cliente no continuará";

export const MESA_CANCELACION_OPERATIVA_CARD_INTRO =
  "Cierra el trámite de forma terminal porque el cliente no continuará. No es un rechazo operativo ni cancela citas automáticamente.";

export const MESA_CANCELACION_OPERATIVA_CARD_CTA =
  "Cancelar / el cliente no continuará";
