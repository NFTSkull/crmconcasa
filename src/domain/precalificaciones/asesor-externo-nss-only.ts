import type {
  CreateExpedienteInput,
  ExpedienteProgramaUi,
} from "@/domain/expedientes/create-expediente.input";
import type { NssPrecalGateResult } from "@/domain/expedientes/nss-precal-gate";

/**
 * Alta simplificada para asesores externos.
 *
 * El scraper de Infonavit ya recibe únicamente el NSS. El programa se conserva
 * como dato técnico del expediente: los nuevos externos nacen en Mejoravit y,
 * si el NSS ya pertenece a un expediente propio, la reprecalificación conserva
 * el programa vigente de ese expediente.
 */
export const ASESOR_EXTERNO_NSS_ONLY_DEFAULT_PROGRAMA: ExpedienteProgramaUi =
  "Mejoravit";

/** Valores transitorios hasta que el asesor capture Datos Generales. */
export const ASESOR_EXTERNO_NSS_ONLY_PENDING_NAME = "POR CAPTURAR";
export const ASESOR_EXTERNO_NSS_ONLY_PENDING_PHONE = "0000000000";

const PROGRAMA_DB_TO_UI: Readonly<Record<string, ExpedienteProgramaUi>> = {
  mejoravit: "Mejoravit",
  subcuenta: "Subcuenta",
  compro_tu_casa: "Compro tu casa",
};

export function isAsesorExternoOrigin(
  value: string | null | undefined,
): boolean {
  return String(value ?? "")
    .trim()
    .toLowerCase() === "externo";
}

export function normalizeExternalNssOnly(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

export function validateExternalNssOnly(raw: string): string {
  const nss = normalizeExternalNssOnly(raw);
  if (!/^\d{11}$/.test(nss)) {
    throw new Error("El NSS (IMSS) debe tener exactamente 11 dígitos.");
  }
  return nss;
}

export function buildExternalNssOnlyCreateInput(args: {
  nss: string;
  asesorEmail: string;
}): CreateExpedienteInput {
  return {
    programa: ASESOR_EXTERNO_NSS_ONLY_DEFAULT_PROGRAMA,
    nss: validateExternalNssOnly(args.nss),
    cliente_nombre: ASESOR_EXTERNO_NSS_ONLY_PENDING_NAME,
    telefono_cliente: ASESOR_EXTERNO_NSS_ONLY_PENDING_PHONE,
    direccion_opcional: "",
    asesorEmail: args.asesorEmail.trim(),
  };
}

/**
 * Para un NSS ya existente nunca se fuerza el default Mejoravit: se conserva
 * el programa actual para que una reprecalificación NSS-only no se convierta
 * accidentalmente en cambio de programa.
 */
export function resolveExternalExistingPrograma(
  gate: NssPrecalGateResult,
): ExpedienteProgramaUi | null {
  const key = String(gate.programa_actual ?? gate.programa ?? "")
    .trim()
    .toLowerCase();
  return PROGRAMA_DB_TO_UI[key] ?? null;
}
