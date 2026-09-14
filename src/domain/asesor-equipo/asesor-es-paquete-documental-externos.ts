/**
 * RPC UI: clasificación del paquete documental / perfil de captura.
 *
 * Tri-state: externo | interno | unknown.
 * UNKNOWN ≠ INTERNO: error / RPC ausente / payload inválido → "unknown".
 *
 * Sin `asesorId` clasifica al ACTOR para la UX documental (Silvia continúa como
 * paquete externo). Con `asesorId` clasifica al DUEÑO para Datos Generales:
 * Equipo Silvia usa captura completa, mientras Anette/otros externos conservan
 * captura simplificada. Esa separación evita cambiar el enrutamiento operativo.
 */
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import type { PaqueteDocumentalClasificacion } from "@/domain/asesor-equipo/asesor-en-equipo-por-lider-email";

export type { PaqueteDocumentalClasificacion };

/** Solo `true`/`false` literales de RPC exitosa; resto → unknown. */
export function parseAsesorEsPaqueteDocumentalExternosClasificacion(
  raw: unknown,
): PaqueteDocumentalClasificacion {
  if (raw === true) return "externo";
  if (raw === false) return "interno";
  return "unknown";
}

/** @deprecated Preferir parse…Clasificacion. true solo si externo confirmado. */
export function parseAsesorEsPaqueteDocumentalExternos(raw: unknown): boolean {
  return raw === true;
}

/**
 * Clasificación tri-state. Nunca lanza.
 * Sin Supabase / error de red / payload raro → "unknown".
 */
export async function fetchAsesorEsPaqueteDocumentalExternosClasificacion(
  asesorId?: string | null,
): Promise<PaqueteDocumentalClasificacion> {
  try {
    if (!isSupabaseConfigured() || !supabaseBrowser) return "unknown";

    const id = String(asesorId ?? "").trim();
    const hasId =
      id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      );

    // Dueño explícito → política de CAPTURA. Actor → política documental/UX.
    const { data, error } = hasId
      ? await supabaseBrowser.rpc("asesor_usa_captura_simplificada", {
          p_asesor_id: id,
        })
      : await supabaseBrowser.rpc("asesor_es_paquete_documental_externos");

    if (error) return "unknown";
    return parseAsesorEsPaqueteDocumentalExternosClasificacion(data);
  } catch {
    return "unknown";
  }
}

/**
 * Legacy booleano. Fail-closed → false (puede confundir UNKNOWN con interno).
 * No usar para gates críticos; preferir …Clasificacion.
 */
export async function fetchAsesorEsPaqueteDocumentalExternos(
  asesorId?: string | null,
): Promise<boolean> {
  const c = await fetchAsesorEsPaqueteDocumentalExternosClasificacion(asesorId);
  return c === "externo";
}
