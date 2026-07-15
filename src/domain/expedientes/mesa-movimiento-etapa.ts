import { z } from "zod";
import { ExpedientesSupabaseError } from "./supabase.error";

export const mesaEtapaSchema = z.number().int().min(1).max(12);

export const mesaMovimientoInputSchema = z.object({
  etapaDestino: mesaEtapaSchema,
  etapaEsperada: mesaEtapaSchema,
  motivo: z
    .string()
    .trim()
    .min(1, "El motivo es obligatorio.")
    .max(500, "El motivo no puede exceder 500 caracteres."),
});

export type MesaMovimientoInput = z.infer<typeof mesaMovimientoInputSchema>;

export const mesaMovimientoDireccionSchema = z.enum([
  "avance",
  "retroceso",
  "salto",
]);

export const mesaMovimientoResultadoSchema = z.object({
  ok: z.literal(true),
  expediente_id: z.string().uuid(),
  movimiento_id: z.string().uuid(),
  etapa_anterior: mesaEtapaSchema,
  etapa_actual: mesaEtapaSchema,
  subestado_anterior: z.string().min(1),
  subestado: z.string().min(1),
  direccion: mesaMovimientoDireccionSchema,
});

export type MesaMovimientoResultado = z.infer<
  typeof mesaMovimientoResultadoSchema
>;

export const mesaMovimientoHistorialRowSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  expediente_id: z.string().uuid(),
  etapa_origen: mesaEtapaSchema,
  etapa_destino: mesaEtapaSchema,
  subestado_origen: z.string().min(1),
  subestado_destino: z.string().min(1),
  motivo: z.string().min(1).max(500),
  actor_id: z.string().uuid(),
  actor_role: z.enum([
    "mesa_admin",
    "mesa_interno",
    "mesa_externo",
    "super_admin",
  ]),
  created_at: z.string().min(1),
});

export type MesaMovimientoHistorialRow = z.infer<
  typeof mesaMovimientoHistorialRowSchema
>;

export type MesaMovimientoRpcError = Readonly<{
  code?: string;
  message?: string;
  details?: string;
}>;

const MESA_MOVE_MESSAGES: Readonly<Record<string, string>> = {
  MESA_MOVE_UNAUTHORIZED: "No tienes permiso para mover este expediente.",
  MESA_MOVE_NOT_FOUND: "El expediente no existe o ya no está disponible.",
  MESA_MOVE_NOT_VISIBLE: "No tienes visibilidad sobre este expediente.",
  MESA_MOVE_NOT_SUBMITTED: "El expediente todavía no fue enviado a Mesa.",
  MESA_MOVE_CYCLE_NOT_ACTIVE: "El ciclo del expediente no está activo.",
  MESA_MOVE_BAD_SUBSTATE:
    "El expediente debe estar en validación de Mesa o en proceso.",
  MESA_MOVE_BAD_DESTINATION: "Selecciona una etapa válida entre 1 y 12.",
  MESA_MOVE_SAME_STAGE: "Selecciona una etapa diferente de la actual.",
  MESA_MOVE_REASON_REQUIRED: "El motivo del movimiento es obligatorio.",
  MESA_MOVE_REASON_TOO_LONG: "El motivo no puede exceder 500 caracteres.",
  MESA_MOVE_STAGE_CONFLICT:
    "La etapa cambió desde que abriste esta pantalla. Se recargó el expediente.",
};

export function getMesaMovimientoErrorCode(
  error: MesaMovimientoRpcError,
): string | null {
  const source = `${error.message ?? ""} ${error.details ?? ""}`;
  return (
    Object.keys(MESA_MOVE_MESSAGES).find((code) => source.includes(code)) ??
    null
  );
}

export function mapMesaMovimientoRpcError(
  error: MesaMovimientoRpcError,
): ExpedientesSupabaseError {
  const code = getMesaMovimientoErrorCode(error);
  return new ExpedientesSupabaseError(
    code
      ? MESA_MOVE_MESSAGES[code]
      : "No se pudo realizar el movimiento manual de etapa.",
  );
}

export function getMesaMovimientoDireccion(
  etapaOrigen: number,
  etapaDestino: number,
): "avance" | "retroceso" | "salto" {
  if (Math.abs(etapaDestino - etapaOrigen) > 1) return "salto";
  return etapaDestino > etapaOrigen ? "avance" : "retroceso";
}

export function puedeMostrarControlManualMesa(input: {
  role: string | null | undefined;
  submittedToMesa: boolean;
  cicloEstado: string | null | undefined;
  subestado: string | null | undefined;
}): boolean {
  return (
    [
      "mesa_admin",
      "mesa_interno",
      "mesa_externo",
      "super_admin",
      "mesa_control_admin",
      "mesa_control_interno",
      "mesa_control_externo",
      "mesa_control",
    ].includes(String(input.role ?? "")) &&
    input.submittedToMesa &&
    input.cicloEstado === "activo" &&
    ["en_validacion_mesa", "en_proceso"].includes(input.subestado ?? "")
  );
}

export function deriveMesaMovimientoAdvertencias(input: {
  etapaActual: number;
  etapaDestino: number;
  hasBiometricBooking: boolean;
  hasFirmasBooking: boolean;
  hasMonto: boolean;
  hasMissingDocuments: boolean;
  hasRetencion: boolean;
  hasValidatedData: boolean;
}): string[] {
  const warnings: string[] = [];
  if (
    input.etapaDestino >= 3 &&
    input.etapaDestino <= 5 &&
    !input.hasBiometricBooking
  ) {
    warnings.push("No existe booking biométrico activo.");
  }
  if (
    (input.etapaDestino === 9 || input.etapaDestino === 10) &&
    !input.hasFirmasBooking
  ) {
    warnings.push("No existe booking de firmas activo.");
  }
  if (
    input.hasFirmasBooking &&
    input.etapaDestino !== 9 &&
    input.etapaDestino !== 10
  ) {
    warnings.push("Existe un booking de firmas activo fuera de la etapa destino.");
  }
  if (
    input.hasBiometricBooking &&
    (input.etapaDestino < 3 || input.etapaDestino > 5)
  ) {
    warnings.push("Existe un booking biométrico activo fuera de la etapa destino.");
  }
  if (!input.hasMonto) warnings.push("Falta monto aprobado.");
  if (input.hasMissingDocuments) warnings.push("Existen documentos faltantes o pendientes.");
  if (input.hasRetencion && input.etapaDestino < 8) {
    warnings.push("Existe retención capturada de una etapa posterior.");
  }
  if (input.hasValidatedData && input.etapaDestino < input.etapaActual) {
    warnings.push("Se está regresando después de una validación.");
  }
  if (Math.abs(input.etapaDestino - input.etapaActual) > 1) {
    warnings.push("Se están saltando una o varias etapas.");
  }
  if (input.etapaDestino === 11 || input.etapaDestino === 12) {
    warnings.push(
      "Cambiar la etapa no registra automáticamente una firma o un pago.",
    );
  }
  return warnings;
}

export function puedeConfirmarMovimientoMesa(input: {
  etapaActual: number;
  etapaDestino: number;
  motivo: string;
  saving: boolean;
}): boolean {
  return (
    !input.saving &&
    input.etapaActual !== input.etapaDestino &&
    mesaMovimientoInputSchema.safeParse({
      etapaDestino: input.etapaDestino,
      etapaEsperada: input.etapaActual,
      motivo: input.motivo,
    }).success
  );
}
