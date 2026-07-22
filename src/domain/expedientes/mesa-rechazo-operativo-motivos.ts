/**
 * Motivos sugeridos del rechazo operativo canónico (etapas 5/6).
 * Alineados al catálogo mock post-biométricos; «Otro» exige texto libre.
 */

export const MESA_RECHAZO_OPERATIVO_MOTIVOS = [
  "Huellas ilegibles",
  "No actualizada en AFORE",
  "No acudió",
  "RFC con error",
  "CURP equivocada",
  "Código postal diferente",
  "Crédito vigente",
  "Mal buró",
  "Problemas legales",
  "Usurpación de identidad",
  "Otro",
] as const;

export type MesaRechazoOperativoMotivo =
  (typeof MESA_RECHAZO_OPERATIVO_MOTIVOS)[number];

export function isRechazoOperativoMotivoOtro(motivo: string): boolean {
  return motivo.trim().toLowerCase() === "otro";
}

/**
 * Resuelve el motivo canónico a persistir en `motivo_rechazo`.
 * «Otro» solo es válido con texto manual no vacío.
 */
export function resolveMotivoRechazoOperativo(
  motivoSeleccionado: string,
  textoOtro: string,
): string | null {
  const seleccion = motivoSeleccionado.trim();
  const otro = textoOtro.trim();

  if (!seleccion) return null;

  if (isRechazoOperativoMotivoOtro(seleccion)) {
    return otro.length > 0 ? otro : null;
  }

  return seleccion;
}

/** True cuando hay motivo válido (select conocido o «Otro» con texto). */
export function motivoRechazoOperativoEsValido(
  motivoSeleccionado: string,
  textoOtro: string,
): boolean {
  return resolveMotivoRechazoOperativo(motivoSeleccionado, textoOtro) != null;
}
