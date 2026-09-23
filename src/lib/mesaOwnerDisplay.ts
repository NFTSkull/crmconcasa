"use client";

import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

export type MesaOwnerDisplay = Readonly<{
  asesorId: string;
  fullName: string | null;
  email: string | null;
}>;

type AsesorDisplayRpcRow = Readonly<{
  asesor_id?: string | null;
  full_name?: string | null;
  email?: string | null;
}>;

type ExpedienteOwnerDisplayRpcRow = AsesorDisplayRpcRow &
  Readonly<{
    expediente_id?: string | null;
  }>;

function uniqueIds(ids: readonly string[]): string[] {
  return [
    ...new Set(
      ids
        .map((id) => String(id ?? "").trim())
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
    ),
  ];
}

export async function fetchMesaOwnerDisplayByAsesorIds(
  asesorIds: readonly string[],
): Promise<ReadonlyMap<string, MesaOwnerDisplay>> {
  const ids = uniqueIds(asesorIds);
  const result = new Map<string, MesaOwnerDisplay>();
  if (ids.length === 0 || !isSupabaseConfigured() || !supabaseBrowser) {
    return result;
  }

  const { data, error } = await supabaseBrowser.rpc(
    "mesa_get_asesor_display_batch",
    { p_asesor_ids: ids },
  );
  if (error) return result;

  for (const row of (data ?? []) as AsesorDisplayRpcRow[]) {
    const asesorId = String(row.asesor_id ?? "").trim();
    if (!asesorId) continue;
    result.set(asesorId, {
      asesorId,
      fullName: row.full_name?.trim() || null,
      email: row.email?.trim() || null,
    });
  }
  return result;
}

export async function fetchMesaOwnerDisplayByExpedienteIds(
  expedienteIds: readonly string[],
): Promise<ReadonlyMap<string, MesaOwnerDisplay>> {
  const ids = uniqueIds(expedienteIds);
  const result = new Map<string, MesaOwnerDisplay>();
  if (ids.length === 0 || !isSupabaseConfigured() || !supabaseBrowser) {
    return result;
  }

  const { data, error } = await supabaseBrowser.rpc(
    "mesa_get_expediente_owner_display_batch",
    { p_expediente_ids: ids },
  );
  if (error) return result;

  for (const row of (data ?? []) as ExpedienteOwnerDisplayRpcRow[]) {
    const expedienteId = String(row.expediente_id ?? "").trim();
    const asesorId = String(row.asesor_id ?? "").trim();
    if (!expedienteId || !asesorId) continue;
    result.set(expedienteId, {
      asesorId,
      fullName: row.full_name?.trim() || null,
      email: row.email?.trim() || null,
    });
  }
  return result;
}
