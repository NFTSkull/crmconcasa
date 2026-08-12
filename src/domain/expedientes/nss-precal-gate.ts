import { z } from "zod";
import type { ExpedienteProgramaUi } from "./create-expediente.input";

/** Status del gate RO `asesor_lookup_nss_precal_gate` (P155/P164). */
export const nssPrecalGateStatusSchema = z.enum([
  "ok_create",
  "reprecal_own_mesa",
  "reprecal_change_programa",
  "blocked_other_asesor",
  "blocked_ambiguous",
  /** Legacy P155; el gate P164 ya no lo emite para dueño elegible. */
  "blocked_programa_mismatch",
]);

export type NssPrecalGateStatus = z.infer<typeof nssPrecalGateStatusSchema>;

export const nssPrecalGateResultSchema = z.object({
  status: nssPrecalGateStatusSchema,
  message: z.string(),
  nss: z.string().optional(),
  programa: z.string().optional(),
  programa_actual: z.string().optional(),
  programa_solicitado: z.string().optional(),
  cambio_programa: z.boolean().optional(),
  expediente_id: z.string().uuid().optional().nullable(),
  reprecalificacion_pendiente_id: z.string().uuid().optional().nullable(),
});

export type NssPrecalGateResult = z.infer<typeof nssPrecalGateResultSchema>;

export const iniciarReprecalificacionResultSchema = z.object({
  ok: z.boolean(),
  idempotent: z.boolean().optional(),
  expediente_id: z.string().uuid(),
  intento_id: z.string().uuid(),
  status: z.string(),
  message: z.string(),
  programa: z.string().optional(),
  programa_solicitado: z.string().optional(),
  cambio_programa: z.boolean().optional(),
  cliente_nombre: z.string().optional(),
});

export type IniciarReprecalificacionResult = z.infer<
  typeof iniciarReprecalificacionResultSchema
>;

export type IniciarReprecalificacionInput = {
  programa: ExpedienteProgramaUi;
  nss: string;
  cliente_nombre: string;
  telefono_cliente: string;
  direccion_opcional: string;
  idempotency_key: string;
};

export const MSG_NSS_OWN_MESA_REPRECAL =
  "Este NSS ya tiene un expediente en Mesa asignado a ti. Puedes volver a precalificarlo; el resultado se actualizará en el mismo expediente.";

export const MSG_NSS_CHANGE_PROGRAMA =
  "Puedes solicitar cambio de programa sobre el mismo expediente. El programa y monto vigentes no cambian hasta que el Editor apruebe.";

export const MSG_NSS_OTHER_ASESOR =
  "Este NSS ya tiene un expediente en Mesa asignado a otro asesor.";

export const MSG_NSS_AMBIGUOUS =
  "Este NSS requiere revisión administrativa porque tiene más de un expediente vigente.";

export const MSG_NSS_PROGRAMA_MISMATCH =
  "Este NSS ya tiene un expediente en Mesa con otro programa. Usa el flujo de «Cambiar programa»; no se creará otro expediente.";

export const MSG_REPRECAL_CONFIRM =
  "Se guardará una nueva precalificación en el expediente existente. No se creará otro expediente.";

/** Mensaje UI canónico por status (no filtrar NSS completo en logs). */
export function messageForNssPrecalGateStatus(
  status: NssPrecalGateStatus,
  fallback?: string,
): string {
  switch (status) {
    case "reprecal_own_mesa":
      return MSG_NSS_OWN_MESA_REPRECAL;
    case "reprecal_change_programa":
      return MSG_NSS_CHANGE_PROGRAMA;
    case "blocked_other_asesor":
      return MSG_NSS_OTHER_ASESOR;
    case "blocked_ambiguous":
      return MSG_NSS_AMBIGUOUS;
    case "blocked_programa_mismatch":
      return MSG_NSS_PROGRAMA_MISMATCH;
    case "ok_create":
      return fallback?.trim() || "Puedes crear una nueva precalificación.";
    default:
      return fallback?.trim() || "No se pudo validar el NSS.";
  }
}

export function isNssPrecalGateBlocked(
  status: NssPrecalGateStatus,
): boolean {
  return (
    status === "blocked_other_asesor" ||
    status === "blocked_ambiguous" ||
    status === "blocked_programa_mismatch"
  );
}

/** Gate permite iniciar re-precal (mismo programa o cambio diferido). */
export function isNssPrecalGateReprecalAllowed(
  status: NssPrecalGateStatus,
): boolean {
  return (
    status === "reprecal_own_mesa" || status === "reprecal_change_programa"
  );
}
