import type { CategoriaResumenDocumental } from "@/domain/expediente-archivos/types";

/**
 * Expediente del lado del asesor: Mesa rechazó datos o documentos y debe esperar corrección.
 * `resumenDocumental` ya unifica rechazo documental y `cliente_datos.rechazado` vía
 * `deriveResumenExpedienteCorreccion`.
 */
export function estaEnEsperaDeAsesor(
  resumenDocumental?: CategoriaResumenDocumental | null,
): boolean {
  return resumenDocumental === "correccion_requerida";
}
