import type { ExpedienteMontoMejoravitContext } from "./types";

/** Asesor: mostrar sección solo si Mesa ya actualizó el monto. */
export function shouldShowAsesorMontoMejoravitSection(
  ctx: Pick<ExpedienteMontoMejoravitContext, "montoMejoravitActualizado"> | null,
): boolean {
  return ctx != null && ctx.montoMejoravitActualizado != null;
}

/** Mesa: botón Actualizar solo con canUpdate del backend. */
export function shouldShowMesaMontoUpdateButton(
  ctx: Pick<ExpedienteMontoMejoravitContext, "canUpdate"> | null,
): boolean {
  return ctx?.canUpdate === true;
}

export function hasMesaMontoOverride(
  ctx: Pick<ExpedienteMontoMejoravitContext, "montoMejoravitActualizado"> | null,
): boolean {
  return ctx != null && ctx.montoMejoravitActualizado != null;
}
