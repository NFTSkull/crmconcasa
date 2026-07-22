import type { RechazoOperativoInput } from "./reingreso-post-biometricos";

/**
 * Payload canónico hacia `rechazar_etapa_operativa`.
 * La UI no captura biométricos; se envían defaults seguros.
 */
export function buildRechazoOperativoPayload(input: {
  motivo: string;
  comentario?: string | null;
}): RechazoOperativoInput {
  return {
    motivo: input.motivo.trim(),
    comentario: input.comentario?.trim() ? input.comentario.trim() : null,
    biometricosCondicion: "desconocida",
    biometricosRazon: null,
    biometricosBookingId: null,
  };
}
