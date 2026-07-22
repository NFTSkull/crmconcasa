import { z } from "zod";
import { ExpedientesSupabaseError } from "./supabase.error";

export const biometricosCondicionSchema = z.enum([
  "reutilizables",
  "repetir",
  "invalidos",
  "no_completados",
  "desconocida",
]);

export type BiometricosCondicion = z.infer<typeof biometricosCondicionSchema>;

export const reingresoExpedienteIdSchema = z.string().trim().uuid();

export const rechazoOperativoInputSchema = z
  .object({
    motivo: z.string().trim().min(1, "El motivo del rechazo es obligatorio."),
    comentario: z.string().trim().nullable().optional(),
    /** Default seguro cuando la UI no clasifica biométricos. */
    biometricosCondicion: biometricosCondicionSchema.default("desconocida"),
    biometricosRazon: z.string().trim().nullable().optional(),
    biometricosBookingId: z.string().uuid().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      !["reutilizables", "repetir", "invalidos"].includes(
        value.biometricosCondicion,
      )
    ) {
      return;
    }
    if (!value.biometricosBookingId) {
      ctx.addIssue({
        code: "custom",
        path: ["biometricosBookingId"],
        message: "Selecciona el booking biométrico que respalda la decisión.",
      });
    }
    if (!value.biometricosRazon?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["biometricosRazon"],
        message: "La razón biométrica es obligatoria para esta condición.",
      });
    }
  });

export type RechazoOperativoInput = z.infer<typeof rechazoOperativoInputSchema>;

export const reingresoElegibilidadSchema = z.object({
  eligible: z.boolean(),
  reason_code: z.string().min(1),
  reason_message: z.string().nullable(),
  rechazo_id: z.string().uuid().nullable(),
  biometricos_condicion: biometricosCondicionSchema.nullable(),
  existing_child_id: z.string().uuid().nullable(),
});

export type ReingresoElegibilidad = z.infer<
  typeof reingresoElegibilidadSchema
>;

export const iniciarReingresoResponseSchema = z.object({
  ok: z.literal(true),
  expediente_id: z.string().uuid(),
  expediente_anterior_id: z.string().uuid(),
  rechazo_id: z.string().uuid(),
  etapa_actual: z.literal(6),
  documentos_reutilizados: z.array(z.string()),
  documentos_pendientes: z.array(z.string()),
  monto_pendiente: z.boolean(),
});

export type IniciarReingresoResponse = z.infer<
  typeof iniciarReingresoResponseSchema
>;

export type RpcErrorLike = Readonly<{
  code?: string;
  message?: string;
  details?: string;
}>;

const REENTRY_MESSAGES: Readonly<Record<string, string>> = {
  REENTRY_NOT_STAGE_5_OR_6:
    "El reingreso solo está disponible para rechazos en Biométricos o Inscripción.",
  REENTRY_STAGE_OUT_OF_RANGE:
    "El rechazo operativo solo aplica en etapas internas 1 a 12.",
  REENTRY_NOT_REJECTED: "El expediente no está rechazado.",
  REENTRY_CYCLE_NOT_ACTIVE: "El ciclo anterior ya no está activo.",
  REENTRY_NO_CLASSIFIED_REJECTION:
    "El expediente no tiene una decisión biométrica de rechazo registrada.",
  REENTRY_BIOMETRICS_NOT_REUSABLE:
    "Mesa indicó que los biométricos no pueden reutilizarse.",
  REENTRY_BOOKING_EVIDENCE_MISSING:
    "Falta una cita biométrica pasada que respalde la decisión.",
  REENTRY_FUTURE_BOOKING_ACTIVE:
    "Existe una cita biométrica futura activa. Mesa debe cancelarla primero.",
  REENTRY_ALREADY_USED: "Este rechazo ya fue utilizado para crear un reingreso.",
  REENTRY_ACTIVE_CHILD_EXISTS:
    "Ya existe un reingreso activo para este expediente.",
  REENTRY_ACTIVE_NSS_EXISTS:
    "Existe otro ciclo activo para el mismo NSS y programa.",
  REENTRY_NOT_OWNER: "No tienes permiso para realizar esta acción.",
  REENTRY_DOCUMENTS_PENDING:
    "Faltan documentos nuevos validados para continuar.",
  REENTRY_AMOUNT_PENDING:
    "Falta la nueva aprobación de monto para continuar.",
};

export function getReingresoErrorCode(error: RpcErrorLike): string | null {
  const source = `${error.message ?? ""} ${error.details ?? ""}`;
  return (
    Object.keys(REENTRY_MESSAGES).find((code) => source.includes(code)) ?? null
  );
}

export function mapReingresoRpcError(
  error: RpcErrorLike,
  fallback = "No se pudo completar la operación de reingreso.",
): ExpedientesSupabaseError {
  const code = getReingresoErrorCode(error);
  if (code) {
    return new ExpedientesSupabaseError(REENTRY_MESSAGES[code] ?? fallback);
  }
  if (error.code === "42501") {
    return new ExpedientesSupabaseError(
      "No tienes permiso para realizar esta acción.",
    );
  }
  return new ExpedientesSupabaseError(fallback);
}

export function puedeConsultarReingresoPostBiometricos(input: {
  dataModeSupabase: boolean;
  etapaActual: number | null | undefined;
  subestado: string | null | undefined;
  cicloEstado: string | null | undefined;
  esHijoReingreso: boolean;
}): boolean {
  return (
    input.dataModeSupabase &&
    !input.esHijoReingreso &&
    (input.etapaActual === 5 || input.etapaActual === 6) &&
    input.subestado === "rechazado" &&
    input.cicloEstado === "activo"
  );
}

export function esExpedienteReingreso(input: {
  expedienteAnteriorId?: string | null;
  rechazoId?: string | null;
}): boolean {
  return Boolean(input.expedienteAnteriorId && input.rechazoId);
}
