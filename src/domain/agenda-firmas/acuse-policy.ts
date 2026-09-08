import type { PaqueteDocumentalClasificacion } from "@/domain/asesor-equipo/asesor-en-equipo-por-lider-email";

/**
 * Para externos el Acuse no participa como requisito ni aviso de agenda de firma.
 * Internos/unknown conservan el comportamiento previo (unknown fail-safe).
 */
export function shouldShowAcusePendienteFirmas(params: Readonly<{
  actorClasificacion: PaqueteDocumentalClasificacion;
  acusePendienteSubir: boolean;
}>): boolean {
  if (!params.acusePendienteSubir) return false;
  if (params.actorClasificacion === "externo") return false;
  return true;
}
