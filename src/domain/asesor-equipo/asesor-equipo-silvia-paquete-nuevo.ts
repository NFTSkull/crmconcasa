/**
 * Rollout UI del paquete nuevo Equipo Silvia.
 *
 * Gate efectivo (docs combinado + CLABE):
 *   duenoEnEquipoSilvia && asesor_equipo_silvia_paquete_nuevo_habilitado()
 *
 * El switch vive en `asesor_equipo_paquete_rollout` (Cloud). Esta UI NUNCA lo muta.
 * Fail-closed: error / RPC ausente / payload raro → false.
 */
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

export function parseAsesorEquipoSilviaPaqueteNuevoHabilitado(
  raw: unknown,
): boolean {
  return raw === true;
}

/**
 * RPC `asesor_equipo_silvia_paquete_nuevo_habilitado()` — sin args.
 * Nunca lanza: fail-closed → false.
 */
export async function fetchAsesorEquipoSilviaPaqueteNuevoHabilitado(): Promise<boolean> {
  try {
    if (!isSupabaseConfigured() || !supabaseBrowser) return false;
    const { data, error } = await supabaseBrowser.rpc(
      "asesor_equipo_silvia_paquete_nuevo_habilitado",
    );
    if (error) return false;
    return parseAsesorEquipoSilviaPaqueteNuevoHabilitado(data);
  } catch {
    return false;
  }
}

/** Ambos true; cualquier null/undefined/false → false. */
export function isSilviaPaqueteNuevoGate(params: Readonly<{
  duenoEnEquipoSilvia: boolean | null | undefined;
  paqueteNuevoHabilitado: boolean | null | undefined;
}>): boolean {
  return (
    params.duenoEnEquipoSilvia === true &&
    params.paqueteNuevoHabilitado === true
  );
}
