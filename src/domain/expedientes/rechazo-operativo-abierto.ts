/**
 * P204-C — rechazo operativo abierto (read-model canónico, sin writer).
 *
 * Definición causal: último rechazo operativo SIN fila de reactivación.
 * No inferir solo desde subestado='rechazado' cuando hay datos de rechazo/reactivación.
 * Proxy de expediente: writer P108A deja subestado=rechazado solo mientras el
 * rechazo vigente sigue sin reactivación (invariante de integridad).
 */

import {
  ASESOR_REACTIVAR_RECHAZO_CTA,
  esExpedienteRechazadoOperativoActivo,
  subestadoCanonicoTrasReactivacion,
} from "./reactivar-expediente-rechazado";

export {
  ASESOR_REACTIVAR_RECHAZO_CTA,
  esExpedienteRechazadoOperativoActivo,
  subestadoCanonicoTrasReactivacion,
};

/** Causal: existe último rechazo y no tiene reactivación. */
export function isRechazoOperativoAbierto(input: {
  latestRechazoId?: string | null;
  latestRechazoHasReactivacion?: boolean | null;
}): boolean {
  const id = input.latestRechazoId?.trim();
  if (!id) return false;
  return input.latestRechazoHasReactivacion !== true;
}

/**
 * Proxy UI cuando solo hay campos de expediente (sin join rechazo/reactivación).
 * Usar solo si el writer mantiene: reactivar ⇒ subestado deja de ser rechazado.
 */
export function proxyRechazoOperativoAbiertoDesdeExpediente(input: {
  submittedToMesa?: boolean | null;
  cicloEstado?: string | null;
  subestado?: string | null;
}): boolean {
  return esExpedienteRechazadoOperativoActivo(input);
}

/** Prefer causal; si no hay datos de rechazo, cae al proxy de expediente. */
export function resolveRechazoOperativoAbierto(input: {
  latestRechazoId?: string | null;
  latestRechazoHasReactivacion?: boolean | null;
  submittedToMesa?: boolean | null;
  cicloEstado?: string | null;
  subestado?: string | null;
}): boolean {
  if (input.latestRechazoId != null && String(input.latestRechazoId).trim() !== "") {
    return isRechazoOperativoAbierto({
      latestRechazoId: input.latestRechazoId,
      latestRechazoHasReactivacion: input.latestRechazoHasReactivacion,
    });
  }
  return proxyRechazoOperativoAbiertoDesdeExpediente(input);
}

export function hasActivityAfterRechazo(input: {
  rechazoAt?: string | null;
  activityAts?: ReadonlyArray<string | null | undefined>;
}): boolean {
  const rechazoMs = parseIsoMs(input.rechazoAt);
  if (rechazoMs == null) return false;
  for (const raw of input.activityAts ?? []) {
    const ms = parseIsoMs(raw);
    if (ms != null && ms > rechazoMs) return true;
  }
  return false;
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export const ASESOR_RECHAZO_BANNER_TITLE = "Expediente rechazado por Mesa";

export const ASESOR_RECHAZO_BANNER_BODY =
  "Puedes corregir la información necesaria, pero el expediente seguirá bloqueado hasta que lo reenvíes a Mesa.";

export const ASESOR_RECHAZO_CAMBIOS_GUARDADOS = "Cambios guardados";

export const ASESOR_RECHAZO_FALTA_REENVIAR = "Falta reenviar a Mesa";

/** CTA preferido cuando el rechazo operativo está abierto. */
export const ASESOR_REENVIAR_A_MESA_CTA = "Reenviar a Mesa";

export const MESA_RECHAZO_ABIERTO_TITLE = "Rechazo operativo abierto";

export const MESA_RECHAZO_ABIERTO_SUB =
  "El expediente no puede avanzar hasta ser reactivado.";

export const MESA_REACTIVAR_EXPEDIENTE_CTA = "Reactivar expediente";

export const MESA_DOC_VALIDADA_NE_RECHAZO_CERRADO =
  "Documentación validada ≠ rechazo cerrado.";

export const MESA_MOVE_BLOQUEADO_RECHAZO_ABIERTO =
  "Rechazo operativo abierto. El expediente no puede avanzar hasta ser reactivado.";

export type AsesorRechazoOperativoBannerModel = {
  title: string;
  body: string;
  showActivityHint: boolean;
  activityPrimary: string | null;
  activitySecondary: string | null;
  ctaLabel: string;
  /** Nunca presentar "Corrección enviada" como mensaje final si abierto. */
  forbidsCorreccionEnviadaFinal: true;
};

export function buildAsesorRechazoOperativoBannerModel(input: {
  abierto: boolean;
  hasActivityAfterRechazo?: boolean;
  preferShortCta?: boolean;
}): AsesorRechazoOperativoBannerModel | null {
  if (!input.abierto) return null;
  const showActivity = Boolean(input.hasActivityAfterRechazo);
  return {
    title: ASESOR_RECHAZO_BANNER_TITLE,
    body: ASESOR_RECHAZO_BANNER_BODY,
    showActivityHint: showActivity,
    activityPrimary: showActivity ? ASESOR_RECHAZO_CAMBIOS_GUARDADOS : null,
    activitySecondary: showActivity ? ASESOR_RECHAZO_FALTA_REENVIAR : null,
    ctaLabel: input.preferShortCta
      ? ASESOR_REENVIAR_A_MESA_CTA
      : ASESOR_REACTIVAR_RECHAZO_CTA,
    forbidsCorreccionEnviadaFinal: true,
  };
}

export type MesaRechazoOperativoAbiertoModel = {
  title: string;
  subtitle: string;
  docNote: string;
  showReactivarCta: boolean;
  ctaLabel: string;
};

export function buildMesaRechazoOperativoAbiertoModel(input: {
  abierto: boolean;
  actorCanReactivar?: boolean;
}): MesaRechazoOperativoAbiertoModel | null {
  if (!input.abierto) return null;
  return {
    title: MESA_RECHAZO_ABIERTO_TITLE,
    subtitle: MESA_RECHAZO_ABIERTO_SUB,
    docNote: MESA_DOC_VALIDADA_NE_RECHAZO_CERRADO,
    showReactivarCta: input.actorCanReactivar !== false,
    ctaLabel: MESA_REACTIVAR_EXPEDIENTE_CTA,
  };
}

/** Inbox/detalle: con rechazo abierto el chip no puede ser Corrección enviada. */
export function estadoEfectivoCompatibleConRechazoAbierto(
  estadoEfectivo: string | null | undefined,
  abierto: boolean,
): boolean {
  if (!abierto) return true;
  return (estadoEfectivo ?? "").trim() !== "correccion_enviada";
}
