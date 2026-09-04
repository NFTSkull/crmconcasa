/**
 * RPC UI: ¿asesor en paquete documental externos? (Parte A SQL = autoridad).
 * Fail-closed: error / payload inválido → false (comportamiento interno clásico).
 */
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

export function parseAsesorEsPaqueteDocumentalExternos(raw: unknown): boolean {
  return raw === true;
}

/**
 * Llama `asesor_es_paquete_documental_externos`.
 * `asesorId` UUID del perfil; omitido/null → JWT actual.
 * Nunca lanza: fail-closed → false.
 */
export async function fetchAsesorEsPaqueteDocumentalExternos(
  asesorId?: string | null,
): Promise<boolean> {
  try {
    if (!isSupabaseConfigured() || !supabaseBrowser) return false;

    const id = String(asesorId ?? "").trim();
    const hasId =
      id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      );

    // Sin args cuando es JWT: PostgREST aplica DEFAULT NULL → current_profile_id().
    const { data, error } = hasId
      ? await supabaseBrowser.rpc("asesor_es_paquete_documental_externos", {
          p_asesor_id: id,
        })
      : await supabaseBrowser.rpc("asesor_es_paquete_documental_externos");

    if (error) return false;
    return parseAsesorEsPaqueteDocumentalExternos(data);
  } catch {
    return false;
  }
}
