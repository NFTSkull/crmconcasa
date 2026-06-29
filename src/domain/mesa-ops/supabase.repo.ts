"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { MesaOpsSupabaseError } from "./supabase.error";
import { mapMesaReleaseRpcError, mapMesaTakeRpcError } from "./mesa-ops-rpc-error";
import type {
  MesaExpedienteEstado,
  MesaExpedienteOpsRow,
  MesaReleaseExpedienteResult,
  MesaTakeExpedienteResult,
} from "./types";

const OPS_SELECT = `
  expediente_id,
  estado_mesa,
  assigned_to,
  assigned_at,
  last_activity_at,
  assignee:profiles!mesa_expediente_ops_assigned_to_fkey ( full_name )
`;

type OpsDbRow = Readonly<{
  expediente_id: string;
  estado_mesa: MesaExpedienteEstado;
  assigned_to: string | null;
  assigned_at: string | null;
  last_activity_at: string | null;
  assignee: { full_name: string } | { full_name: string }[] | null;
}>;

function mapOpsRow(row: OpsDbRow): MesaExpedienteOpsRow {
  const assignee = row.assignee;
  let assignedToName: string | null = null;
  if (assignee && !Array.isArray(assignee)) {
    assignedToName = assignee.full_name?.trim() || null;
  } else if (Array.isArray(assignee) && assignee[0]) {
    assignedToName = assignee[0].full_name?.trim() || null;
  }

  return {
    expedienteId: String(row.expediente_id),
    estadoMesa: row.estado_mesa,
    assignedTo: row.assigned_to ? String(row.assigned_to) : null,
    assignedAt: row.assigned_at ? String(row.assigned_at) : null,
    lastActivityAt: row.last_activity_at ? String(row.last_activity_at) : null,
    assignedToName,
  };
}

async function requireSupabaseSession(): Promise<{
  client: SupabaseClient;
  userId: string;
}> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new MesaOpsSupabaseError(
      "Supabase no está configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const client = supabaseBrowser;
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();

  if (sessionError || !session?.user?.id) {
    throw new MesaOpsSupabaseError("Debes iniciar sesión para operar la bandeja Mesa.");
  }

  return { client, userId: session.user.id };
}

export class MesaOpsSupabaseRepo {
  async resolveCurrentUserId(): Promise<string | null> {
    if (!isSupabaseConfigured() || !supabaseBrowser) return null;
    const {
      data: { session },
    } = await supabaseBrowser.auth.getSession();
    return session?.user?.id ?? null;
  }

  async resolveCurrentUserAppRole(): Promise<string | null> {
    if (!isSupabaseConfigured() || !supabaseBrowser) return null;
    try {
      const { client, userId } = await requireSupabaseSession();
      const { data, error } = await client
        .from("profiles")
        .select("app_role")
        .eq("id", userId)
        .maybeSingle();

      if (error || !data) {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            "[mesa-ops] resolveCurrentUserAppRole:",
            error?.message ?? "sin perfil",
          );
        }
        return null;
      }

      const appRole = (data as { app_role?: string }).app_role;
      return typeof appRole === "string" && appRole.trim() ? appRole.trim() : null;
    } catch (err) {
      if (err instanceof MesaOpsSupabaseError) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[mesa-ops] resolveCurrentUserAppRole:", err.message);
        }
        return null;
      }
      throw err;
    }
  }

  async listByExpedienteIds(expedienteIds: readonly string[]): Promise<MesaExpedienteOpsRow[]> {
    const ids = [...new Set(expedienteIds.map((id) => String(id).trim()).filter(Boolean))];
    if (ids.length === 0) return [];

    try {
      const { client } = await requireSupabaseSession();
      const { data, error } = await client
        .from("mesa_expediente_ops")
        .select(OPS_SELECT)
        .in("expediente_id", ids);

      if (error) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[mesa-ops] listByExpedienteIds:", error.message);
        }
        return [];
      }

      return (data as OpsDbRow[] | null)?.map(mapOpsRow) ?? [];
    } catch (err) {
      if (err instanceof MesaOpsSupabaseError) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[mesa-ops] listByExpedienteIds:", err.message);
        }
        return [];
      }
      throw err;
    }
  }

  async getByExpedienteId(expedienteId: string): Promise<MesaExpedienteOpsRow | null> {
    const rows = await this.listByExpedienteIds([expedienteId]);
    return rows[0] ?? null;
  }

  async takeExpediente(expedienteId: string): Promise<MesaTakeExpedienteResult> {
    const idNorm = String(expedienteId).trim();
    if (!idNorm) {
      throw new MesaOpsSupabaseError("El identificador del expediente es obligatorio.");
    }

    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc("mesa_take_expediente", {
      p_expediente_id: idNorm,
    });

    if (error) {
      throw mapMesaTakeRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new MesaOpsSupabaseError("No se pudo tomar el expediente. Respuesta vacía del servidor.");
    }

    const payload = data as Record<string, unknown>;
    return {
      ok: Boolean(payload.ok),
      idempotent: payload.idempotent === true,
      expedienteId: String(payload.expediente_id ?? idNorm),
      estadoMesa: String(payload.estado_mesa ?? "trabajando") as MesaExpedienteEstado,
      assignedTo: payload.assigned_to ? String(payload.assigned_to) : null,
      assignedAt: payload.assigned_at ? String(payload.assigned_at) : null,
    };
  }

  async releaseExpediente(
    expedienteId: string,
    motivo?: string | null,
  ): Promise<MesaReleaseExpedienteResult> {
    const idNorm = String(expedienteId).trim();
    if (!idNorm) {
      throw new MesaOpsSupabaseError("El identificador del expediente es obligatorio.");
    }

    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc("mesa_release_expediente", {
      p_expediente_id: idNorm,
      p_motivo: motivo ?? null,
    });

    if (error) {
      throw mapMesaReleaseRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new MesaOpsSupabaseError(
        "No se pudo liberar el expediente. Respuesta vacía del servidor.",
      );
    }

    const payload = data as Record<string, unknown>;
    return {
      ok: Boolean(payload.ok),
      expedienteId: String(payload.expediente_id ?? idNorm),
      estadoMesa: String(payload.estado_mesa ?? "sin_asignar") as MesaExpedienteEstado,
      previousAssignedTo: payload.previous_assigned_to
        ? String(payload.previous_assigned_to)
        : null,
    };
  }
}
