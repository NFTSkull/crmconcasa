/**
 * RPC UI: ¿asesor en paquete documental externos? (Parte A SQL = autoridad).
 *
 * Tri-state: externo | interno | unknown.
 * UNKNOWN ≠ INTERNO: error / RPC ausente / payload inválido → "unknown".
 * El booleano legacy `fetchAsesorEsPaqueteDocumentalExternos` sigue existiendo
 * solo para callers no críticos (fail-closed → false); el expediente usa
 * `fetchAsesorEsPaqueteDocumentalExternosClasificacion`.
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

    const { data, error } = hasId
      ? await supabaseBrowser.rpc("asesor_es_paquete_documental_externos", {
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
 * No usar para gates B1–B5 ni envío crítico; preferir …Clasificacion.
 */
export async function fetchAsesorEsPaqueteDocumentalExternos(
  asesorId?: string | null,
): Promise<boolean> {
  const c = await fetchAsesorEsPaqueteDocumentalExternosClasificacion(asesorId);
  return c === "externo";
}
