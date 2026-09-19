import type { PaqueteDocumentalClasificacion } from "@/domain/asesor-equipo/asesor-en-equipo-por-lider-email";

/**
 * Para externos el Acuse no participa como requisito ni aviso de agenda de firma.
 * Solo un interno confirmado conserva el aviso previo. UNKNOWN no inventa requisito.
 */
export function shouldShowAcusePendienteFirmas(params: Readonly<{
  actorClasificacion: PaqueteDocumentalClasificacion;
  acusePendienteSubir: boolean;
}>): boolean {
  return params.acusePendienteSubir && params.actorClasificacion === "interno";
}
