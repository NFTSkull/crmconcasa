/**
 * P093 B1 / P108A — UX de separación entre movimiento manual y rechazo operativo.
 * Solo helpers de presentación; no mutan datos ni inferen rechazo por texto.
 */

/** Ancla de scroll hacia la tarjeta canónica de rechazo (pasos visibles 1–11). */
export const MESA_RECHAZO_OPERATIVO_ANCHOR_ID = "mesa-rechazo-operativo";

export const MESA_MOVIMIENTO_NO_ES_RECHAZO_COPY =
  "Este control solo cambia la etapa operativa. No registra un rechazo: no pone el subestado «rechazado», no crea registro en rechazos operativos ni alimenta el filtro «Rechazados».";

export const MESA_MOTIVO_PARECE_RECHAZO_WARNING =
  "El motivo parece describir un rechazo. El movimiento manual no rechaza el expediente. Si la decisión es rechazar, usa «Rechazar expediente».";

export const MESA_MOTIVO_PARECE_RECHAZO_SIN_ELEGIBILIDAD_WARNING =
  "El motivo parece describir un rechazo. El movimiento manual no rechaza el expediente. El rechazo operativo canónico aplica en los 11 pasos visibles (etapas internas 1–12) cuando el expediente está activo y enviado a Mesa.";

export const MESA_RECHAZO_OPERATIVO_ATAJO_LABEL =
  "Ir a Rechazar expediente";

export const MESA_RECHAZO_OPERATIVO_CARD_BADGE =
  "Rechazo operativo · puede continuar";

export const MESA_RECHAZO_OPERATIVO_CARD_TITLE = "Rechazar expediente";

export const MESA_RECHAZO_OPERATIVO_CARD_INTRO =
  "Registra un rechazo operativo: el asesor verá el motivo/nota y podrá corregir y reenviar el mismo expediente a Mesa.";

export const MESA_RECHAZO_OPERATIVO_CARD_CTA = "Rechazar expediente";

/**
 * Heurística informativa (no bloqueante): el motivo libre menciona rechazo.
 * Nunca ejecuta ni infiere un rechazo real.
 */
export function motivoManualPareceRechazo(motivo: string): boolean {
  return /rechaz/i.test(motivo);
}

/** Elegibilidad UI de la tarjeta de rechazo operativo (etapas internas 1–12). */
export function esElegibleRechazoOperativoPostBiometricos(input: {
  submittedToMesa: boolean;
  cicloEstado: string | null | undefined;
  subestado: string | null | undefined;
  etapaActual: number | null | undefined;
}): boolean {
  const etapa = input.etapaActual;
  return (
    input.submittedToMesa === true &&
    input.cicloEstado === "activo" &&
    input.subestado !== "rechazado" &&
    typeof etapa === "number" &&
    etapa >= 1 &&
    etapa <= 12
  );
}

export function mensajeAdvertenciaMotivoPareceRechazo(
  elegibleRechazoOperativo: boolean,
): string {
  return elegibleRechazoOperativo
    ? MESA_MOTIVO_PARECE_RECHAZO_WARNING
    : MESA_MOTIVO_PARECE_RECHAZO_SIN_ELEGIBILIDAD_WARNING;
}
