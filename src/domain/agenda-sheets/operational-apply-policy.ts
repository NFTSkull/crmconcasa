/**
 * Política de aplicación Sheet → expediente (P170) — mirror de producto.
 * No conecta Edge; solo helpers de motivo / targets para tests unitarios.
 */

export type OperationalApplyKind = "biometricos" | "firmas";

export type OperationalApplyClass =
  | "COMPLETED"
  | "PENDING"
  | "UNKNOWN"
  | "FAILED_OR_NOT_ATTENDED";

export const SHEET_REJECT_FALLBACK_MOTIVO =
  "Resultado operativo no exitoso registrado en CITAS 2026" as const;

/**
 * Motivo de rechazo cuando la señal canónica es FAILED.
 * Preferencia: notes_raw → raw de la señal fallida → fallback fijo.
 */
export function resolveSheetRejectMotivo(input: {
  kind: OperationalApplyKind;
  biometricClass: string;
  biometricRaw: string | null | undefined;
  notificationClass: string;
  notificationRaw: string | null | undefined;
  signatureClass: string;
  signatureRaw: string | null | undefined;
  notesRaw: string | null | undefined;
}): string {
  const notes = String(input.notesRaw ?? "").trim();
  if (notes) return notes;

  const bio = String(input.biometricClass ?? "").trim().toUpperCase();
  const notif = String(input.notificationClass ?? "").trim().toUpperCase();
  const sig = String(input.signatureClass ?? "").trim().toUpperCase();

  let failedRaw: string | null = null;
  if (input.kind === "biometricos") {
    if (bio === "FAILED_OR_NOT_ATTENDED") {
      failedRaw = String(input.biometricRaw ?? "").trim() || null;
    } else if (notif === "FAILED_OR_NOT_ATTENDED") {
      failedRaw = String(input.notificationRaw ?? "").trim() || null;
    }
  } else if (sig === "FAILED_OR_NOT_ATTENDED") {
    failedRaw = String(input.signatureRaw ?? "").trim() || null;
  }

  return failedRaw || SHEET_REJECT_FALLBACK_MOTIVO;
}

/** Target monótono biométricos según bio/notif (sin mutar). */
export function biometricTargetEtapa(input: {
  biometricClass: string;
  notificationClass: string;
}): 5 | 8 | null {
  const bio = String(input.biometricClass ?? "").trim().toUpperCase();
  const notif = String(input.notificationClass ?? "").trim().toUpperCase();
  if (bio !== "COMPLETED") return null;
  if (notif === "COMPLETED") return 8;
  return 5;
}

/** Target monótono firmas COMPLETED. */
export function signatureTargetEtapa(signatureClass: string): 11 | null {
  const sig = String(signatureClass ?? "").trim().toUpperCase();
  return sig === "COMPLETED" ? 11 : null;
}
