import type { ExpedienteProgramaUi } from "./create-expediente.input";
import { mapProgramaUiToDb } from "./map-programa";
import {
  MSG_NSS_AMBIGUOUS,
  MSG_NSS_CHANGE_PROGRAMA,
  MSG_NSS_OTHER_ASESOR,
  MSG_NSS_OWN_MESA_REPRECAL,
  MSG_NSS_PROGRAMA_MISMATCH,
  type NssPrecalGateResult,
  type NssPrecalGateStatus,
} from "./nss-precal-gate";

/** Opciones de producto para «Cambiar programa» (no incluye Subcuenta). */
export const CAMBIAR_PROGRAMA_OPTIONS = [
  "Mejoravit",
  "Compro tu casa",
] as const satisfies ReadonlyArray<ExpedienteProgramaUi>;

export type CambiarProgramaOption = (typeof CAMBIAR_PROGRAMA_OPTIONS)[number];

export type ReprecalUiMode = "same_programa" | "change_programa";

/**
 * Condiciones básicas de UI (backend sigue siendo autoridad).
 * P169: expediente propio activo (pre o post Mesa). Ya no exige `submittedToMesa`.
 */
export function canShowAsesorReprecalActions(input: {
  dataSupabase: boolean;
  /** Conservado por compat de props; no bloquea visibilidad (P169). */
  submittedToMesa?: boolean;
  cicloEstado?: string | null;
}): boolean {
  if (!input.dataSupabase) return false;
  if (input.cicloEstado === "cancelado") return false;
  return true;
}

export function isSameProgramaUi(
  vigente: string,
  solicitado: string,
): boolean {
  return mapProgramaUiToDb(vigente) === mapProgramaUiToDb(solicitado);
}

/** Opciones de cambio excluyendo el programa vigente. */
export function opcionesCambioPrograma(
  programaVigenteUi: string,
): CambiarProgramaOption[] {
  return CAMBIAR_PROGRAMA_OPTIONS.filter(
    (opt) => !isSameProgramaUi(programaVigenteUi, opt),
  );
}

export function messageForUnexpectedGateFromDetalle(
  status: NssPrecalGateStatus,
): string {
  switch (status) {
    case "ok_create":
      return "No se pudo reutilizar este expediente para precalificación. Recarga la página o contacta a soporte.";
    case "blocked_other_asesor":
      return MSG_NSS_OTHER_ASESOR;
    case "blocked_ambiguous":
      return MSG_NSS_AMBIGUOUS;
    case "blocked_programa_mismatch":
      return MSG_NSS_PROGRAMA_MISMATCH;
    case "reprecal_own_mesa":
      return MSG_NSS_OWN_MESA_REPRECAL;
    case "reprecal_change_programa":
      return MSG_NSS_CHANGE_PROGRAMA;
    default:
      return "No se pudo validar la solicitud de precalificación.";
  }
}

/**
 * Valida el gate antes de `iniciarReprecalificacion` desde el detalle.
 * No crea expediente. Devuelve mensaje de error o null si OK.
 */
export function validateGateForDetalleReprecal(input: {
  mode: ReprecalUiMode;
  gate: NssPrecalGateResult;
  expedienteId: string;
}): string | null {
  const { mode, gate, expedienteId } = input;
  const expectedStatus: NssPrecalGateStatus =
    mode === "same_programa" ? "reprecal_own_mesa" : "reprecal_change_programa";

  if (gate.status === "blocked_other_asesor") {
    return "Este NSS pertenece a un expediente de otro asesor.";
  }
  if (gate.status === "blocked_ambiguous") {
    return "No fue posible determinar un único expediente para este NSS.";
  }
  if (gate.status === "ok_create") {
    return messageForUnexpectedGateFromDetalle("ok_create");
  }
  if (gate.status === "blocked_programa_mismatch") {
    return gate.message?.trim() || MSG_NSS_PROGRAMA_MISMATCH;
  }
  if (gate.status !== expectedStatus) {
    return `Estado de validación inesperado (${gate.status}). No se envió la solicitud.`;
  }
  const gateExp = String(gate.expediente_id ?? "").trim();
  if (!gateExp || gateExp !== String(expedienteId).trim()) {
    return "El expediente validado no coincide con el expediente actual. No se envió la solicitud.";
  }
  return null;
}

/** En `/asesor/nueva`, cambio de programa no debe caer en create_expediente. */
export function messageForNuevaChangeProgramaBlocked(): string {
  return "Para cambiar de programa usa «Cambiar programa» en el detalle del expediente. No se creará otro expediente.";
}

/**
 * Mensaje canónico cuando `/asesor/nueva` encuentra expediente propio activo
 * (pre o post Mesa). No create; abrir detalle para reprecal / cambio.
 */
export const MSG_NUEVA_EXISTING_ACTIVE_OPEN_DETALLE =
  "Este NSS ya tiene un expediente activo. Abre el expediente para enviar una nueva precalificación o cambiar de programa.";

export function messageForNuevaExistingActiveExpediente(): string {
  return MSG_NUEVA_EXISTING_ACTIVE_OPEN_DETALLE;
}
