import { z } from "zod";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import type { MesaPresenciaByExpediente } from "@/lib/mesaExpedientePresenciaUi";

const SESSION_STORAGE_KEY = "mesa_presencia_session_id";

/** session_id estable por pestaña (sessionStorage). */
export function getOrCreateMesaPresenciaSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : null;
    if (!id) return null;
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, id);
    return id;
  } catch {
    return null;
  }
}

export async function mesaTouchExpedientePresencia(
  expedienteId: string,
  sessionId: string,
): Promise<boolean> {
  const exp = String(expedienteId ?? "").trim();
  const sid = String(sessionId ?? "").trim();
  if (!exp || !sid) return false;
  if (!isSupabaseConfigured() || !supabaseBrowser) return false;
  try {
    const { error } = await supabaseBrowser.rpc("mesa_touch_expediente_presencia", {
      p_expediente_id: exp,
      p_session_id: sid,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function mesaCloseExpedientePresencia(
  expedienteId: string,
  sessionId: string,
): Promise<boolean> {
  const exp = String(expedienteId ?? "").trim();
  const sid = String(sessionId ?? "").trim();
  if (!exp || !sid) return false;
  if (!isSupabaseConfigured() || !supabaseBrowser) return false;
  try {
    const { error } = await supabaseBrowser.rpc("mesa_close_expediente_presencia", {
      p_expediente_id: exp,
      p_session_id: sid,
    });
    return !error;
  } catch {
    return false;
  }
}

const listRpcSchema = z.object({
  ok: z.boolean().optional(),
  items: z
    .array(
      z.object({
        expediente_id: z.string().uuid(),
        users: z.array(
          z.object({
            user_id: z.string().uuid(),
            full_name: z.string().nullable().optional(),
          }),
        ),
      }),
    )
    .default([]),
});

/** Batch presencia activa para IDs visibles (sin N+1). */
export async function mesaListExpedientesPresencia(
  expedienteIds: readonly string[],
): Promise<ReadonlyMap<string, MesaPresenciaByExpediente>> {
  const ids = [
    ...new Set(
      expedienteIds
        .map((x) => String(x ?? "").trim())
        .filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
    ),
  ];
  const empty = new Map<string, MesaPresenciaByExpediente>();
  if (ids.length === 0) return empty;
  if (!isSupabaseConfigured() || !supabaseBrowser) return empty;
  try {
    const { data, error } = await supabaseBrowser.rpc("mesa_list_expedientes_presencia", {
      p_expediente_ids: ids,
    });
    if (error || !data) return empty;
    const parsed = listRpcSchema.safeParse(data);
    if (!parsed.success) return empty;
    const map = new Map<string, MesaPresenciaByExpediente>();
    for (const item of parsed.data.items) {
      map.set(item.expediente_id, {
        expedienteId: item.expediente_id,
        users: item.users.map((u) => ({
          userId: u.user_id,
          fullName: u.full_name ?? null,
        })),
      });
    }
    return map;
  } catch {
    return empty;
  }
}
