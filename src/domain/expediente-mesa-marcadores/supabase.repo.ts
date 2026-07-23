"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  isMesaMarcadorTipo,
  mesaSetMarcadorRpcSchema,
  type MesaExpedienteMarcador,
  type MesaMarcadorTipo,
  type MesaSetExpedienteMarcadorResult,
} from "./types";

export class ExpedienteMesaMarcadoresSupabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpedienteMesaMarcadoresSupabaseError";
  }
}

async function requireSupabaseSession(): Promise<{
  client: SupabaseClient;
}> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new ExpedienteMesaMarcadoresSupabaseError(
      "Supabase no está configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  const client = supabaseBrowser;
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();
  if (sessionError || !session?.user?.id) {
    throw new ExpedienteMesaMarcadoresSupabaseError(
      "Debes iniciar sesión para gestionar marcadores Mesa.",
    );
  }
  return { client };
}

function mapSetError(error: { message?: string; code?: string }): never {
  const msg = String(error.message ?? "");
  if (msg.includes("rol no autorizado") || error.code === "42501") {
    throw new ExpedienteMesaMarcadoresSupabaseError(
      "No tienes permiso para cambiar este marcador.",
    );
  }
  if (msg.includes("tipo no permitido")) {
    throw new ExpedienteMesaMarcadoresSupabaseError("Tipo de marcador no permitido.");
  }
  if (msg.includes("organización") || msg.includes("no autorizado")) {
    throw new ExpedienteMesaMarcadoresSupabaseError(
      "No autorizado para este expediente.",
    );
  }
  throw new ExpedienteMesaMarcadoresSupabaseError(
    msg || "No se pudo actualizar el marcador.",
  );
}

export class ExpedienteMesaMarcadoresSupabaseRepo {
  async listActiveByExpedienteIds(
    expedienteIds: readonly string[],
    tipo: MesaMarcadorTipo = "tiene_datos",
  ): Promise<Map<string, MesaExpedienteMarcador>> {
    const unique = [...new Set(expedienteIds.map((id) => id.trim()).filter(Boolean))];
    const out = new Map<string, MesaExpedienteMarcador>();
    if (unique.length === 0) return out;

    const { client } = await requireSupabaseSession();
    const { data, error } = await client
      .from("expediente_mesa_marcadores")
      .select("expediente_id, tipo, active, updated_at")
      .in("expediente_id", unique)
      .eq("tipo", tipo)
      .eq("active", true);

    if (error) {
      throw new ExpedienteMesaMarcadoresSupabaseError(
        "No se pudieron cargar los marcadores de la bandeja.",
      );
    }

    for (const row of data ?? []) {
      const expedienteId = String(
        (row as { expediente_id?: string }).expediente_id ?? "",
      ).trim();
      const rowTipo = String((row as { tipo?: string }).tipo ?? "").trim();
      if (!expedienteId || !isMesaMarcadorTipo(rowTipo)) continue;
      out.set(expedienteId, {
        expedienteId,
        tipo: rowTipo,
        active: (row as { active?: boolean }).active === true,
        updatedAt: String((row as { updated_at?: string }).updated_at ?? ""),
      });
    }
    return out;
  }

  async setMarcador(params: {
    expedienteId: string;
    tipo: MesaMarcadorTipo;
    active: boolean;
  }): Promise<MesaSetExpedienteMarcadorResult> {
    const expedienteId = String(params.expedienteId).trim();
    if (!expedienteId) {
      throw new ExpedienteMesaMarcadoresSupabaseError("Expediente inválido.");
    }
    if (!isMesaMarcadorTipo(params.tipo)) {
      throw new ExpedienteMesaMarcadoresSupabaseError("Tipo de marcador no permitido.");
    }

    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc("mesa_set_expediente_marcador", {
      p_expediente_id: expedienteId,
      p_tipo: params.tipo,
      p_active: params.active,
    });

    if (error) mapSetError(error);

    const parsed = mesaSetMarcadorRpcSchema.safeParse(data);
    if (!parsed.success) {
      throw new ExpedienteMesaMarcadoresSupabaseError(
        "Respuesta inválida al actualizar el marcador.",
      );
    }

    return {
      ok: parsed.data.ok,
      idempotent: parsed.data.idempotent === true,
      expedienteId: parsed.data.expediente_id,
      tipo: parsed.data.tipo,
      active: parsed.data.active,
      updatedAt: parsed.data.updated_at,
    };
  }
}
