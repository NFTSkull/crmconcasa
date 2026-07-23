import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import type { MesaActividadSnapshot } from "@/lib/mesaExpedienteActividadUi";

/** Dedup Strict Mode / remounts: una RPC por expediente en ventana corta. */
const recentVistaAtMs = new Map<string, number>();
const VISTA_DEDUP_MS = 4000;

/** Registra vista Mesa al abrir detalle. Falla controlada (no bloquea UI). */
export async function mesaRegistrarVistaExpediente(
  expedienteId: string,
): Promise<boolean> {
  const id = String(expedienteId ?? "").trim();
  if (!id) return false;
  if (!isSupabaseConfigured() || !supabaseBrowser) return false;
  const now = Date.now();
  const prev = recentVistaAtMs.get(id);
  if (prev != null && now - prev < VISTA_DEDUP_MS) return true;
  recentVistaAtMs.set(id, now);
  try {
    const { error } = await supabaseBrowser.rpc("mesa_registrar_vista_expediente", {
      p_expediente_id: id,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function fetchMesaExpedienteActividad(
  expedienteId: string,
): Promise<MesaActividadSnapshot | null> {
  const id = String(expedienteId ?? "").trim();
  if (!id) return null;
  if (!isSupabaseConfigured() || !supabaseBrowser) return null;
  try {
    const { data, error } = await supabaseBrowser.rpc("get_mesa_expediente_actividad", {
      p_expediente_id: id,
    });
    if (error || !data || typeof data !== "object") return null;
    const row = data as Record<string, unknown>;
    return {
      lastViewedByName:
        typeof row.last_viewed_by_name === "string" ? row.last_viewed_by_name : null,
      lastViewedAt:
        typeof row.last_viewed_at === "string" ? row.last_viewed_at : null,
      lastUpdatedByName:
        typeof row.last_updated_by_name === "string" ? row.last_updated_by_name : null,
      lastUpdatedAt:
        typeof row.last_updated_at === "string" ? row.last_updated_at : null,
    };
  } catch {
    return null;
  }
}
