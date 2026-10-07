"use client";

import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  parseClienteDatosDraft,
  type ClienteDatosDraft,
} from "@/lib/clienteDatosDraftLocalStorage";

async function hasActiveSession(): Promise<boolean> {
  if (!isSupabaseConfigured() || !supabaseBrowser) return false;
  const {
    data: { session },
    error,
  } = await supabaseBrowser.auth.getSession();
  return !error && Boolean(session?.user);
}

/**
 * Respaldo server-side del borrador parcial. Best effort: nunca bloquea la
 * captura local ni el flujo operativo si la red falla.
 */
export async function saveClienteDatosDraftServer(
  draft: ClienteDatosDraft,
): Promise<boolean> {
  if (!(await hasActiveSession()) || !supabaseBrowser) return false;

  const { error } = await supabaseBrowser.rpc(
    "asesor_guardar_cliente_datos_borrador",
    {
      p_expediente_id: draft.expedienteId,
      p_draft: draft,
      p_draft_version: draft.draftVersion,
      p_client_updated_at: draft.updatedAt,
    },
  );

  return !error;
}

export async function readClienteDatosDraftServer(
  expedienteId: string,
): Promise<ClienteDatosDraft | null> {
  const id = String(expedienteId).trim();
  if (!id || !(await hasActiveSession()) || !supabaseBrowser) return null;

  const { data, error } = await supabaseBrowser.rpc(
    "asesor_leer_cliente_datos_borrador",
    { p_expediente_id: id },
  );
  if (error || !data || typeof data !== "object") return null;

  const rawDraft = (data as { draft?: unknown }).draft;
  if (!rawDraft || typeof rawDraft !== "object") return null;

  return parseClienteDatosDraft(JSON.stringify(rawDraft));
}

/**
 * Solo se llama tras guardado oficial confirmado o descarte explícito.
 * Nunca se borra un borrador por heurística/timestamp.
 */
export async function removeClienteDatosDraftServer(
  expedienteId: string,
): Promise<boolean> {
  const id = String(expedienteId).trim();
  if (!id || !(await hasActiveSession()) || !supabaseBrowser) return false;

  const { error } = await supabaseBrowser.rpc(
    "asesor_borrar_cliente_datos_borrador",
    { p_expediente_id: id },
  );

  return !error;
}
