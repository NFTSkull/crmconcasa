"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { mapProgramaUiToDb } from "@/domain/expedientes/map-programa";
import {
  asesorLiderContextSchema,
  asesorLiderDashboardSchema,
  asesorLiderExpedientesPageSchema,
  asesorLiderListPageInputSchema,
  asesorLiderMembersResultSchema,
  listAsesoresActivosOrgResultSchema,
  type AsesorLiderListPageInput,
} from "./rpc";
import type {
  AsesorActivoOrg,
  AsesorLiderContext,
  AsesorLiderDashboard,
  AsesorLiderExpedientesPage,
  AsesorLiderMember,
  CreateExpedienteForAsesorInput,
} from "./types";

export class AsesorLiderSupabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsesorLiderSupabaseError";
  }
}

async function requireSessionClient(): Promise<SupabaseClient> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new AsesorLiderSupabaseError(
      "Supabase no está configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  const {
    data: { session },
    error: sessionError,
  } = await supabaseBrowser.auth.getSession();
  if (sessionError || !session?.user) {
    throw new AsesorLiderSupabaseError(
      "Debes iniciar sesión para usar el dashboard de equipo.",
    );
  }
  return supabaseBrowser;
}

function mapRpcError(error: { message?: string; code?: string }, fallback: string): never {
  const msg = (error.message ?? "").trim();
  if (msg) {
    throw new AsesorLiderSupabaseError(msg);
  }
  throw new AsesorLiderSupabaseError(fallback);
}

export class AsesorLiderSupabaseRepo {
  async getContext(): Promise<AsesorLiderContext> {
    const client = await requireSessionClient();
    const { data, error } = await client.rpc("asesor_lider_get_context");
    if (error) {
      mapRpcError(error, "No se pudo obtener el contexto de líder.");
    }
    const parsed = asesorLiderContextSchema.safeParse(data);
    if (!parsed.success) {
      throw new AsesorLiderSupabaseError(
        "Respuesta inválida de asesor_lider_get_context.",
      );
    }
    return parsed.data;
  }

  async listMembers(): Promise<readonly AsesorLiderMember[]> {
    const client = await requireSessionClient();
    const { data, error } = await client.rpc("asesor_lider_list_members");
    if (error) {
      mapRpcError(error, "No se pudo listar miembros del equipo.");
    }
    const parsed = asesorLiderMembersResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new AsesorLiderSupabaseError(
        "Respuesta inválida de asesor_lider_list_members.",
      );
    }
    return parsed.data.members;
  }

  async getDashboard(filters?: {
    asesorId?: string | null;
    fechaDesde?: string | null;
    fechaHasta?: string | null;
  }): Promise<AsesorLiderDashboard> {
    const client = await requireSessionClient();
    const { data, error } = await client.rpc("asesor_lider_get_dashboard", {
      p_asesor_id: filters?.asesorId?.trim() || null,
      p_fecha_desde: filters?.fechaDesde?.trim() || null,
      p_fecha_hasta: filters?.fechaHasta?.trim() || null,
    });
    if (error) {
      mapRpcError(error, "No se pudo cargar el dashboard del equipo.");
    }
    const parsed = asesorLiderDashboardSchema.safeParse(data);
    if (!parsed.success) {
      throw new AsesorLiderSupabaseError(
        "Respuesta inválida de asesor_lider_get_dashboard.",
      );
    }
    return parsed.data;
  }

  async listExpedientesPage(
    input: Partial<AsesorLiderListPageInput> = {},
  ): Promise<AsesorLiderExpedientesPage> {
    const normalized = asesorLiderListPageInputSchema.parse({
      page: input.page ?? 1,
      page_size: input.page_size ?? 25,
      buscar: input.buscar ?? null,
      asesor_id: input.asesor_id ?? null,
      etapa_exacta: input.etapa_exacta ?? null,
      fecha_desde: input.fecha_desde ?? null,
      fecha_hasta: input.fecha_hasta ?? null,
      ciclo: input.ciclo ?? null,
    });
    const client = await requireSessionClient();
    const { data, error } = await client.rpc(
      "asesor_lider_list_expedientes_page",
      {
        p_page: normalized.page,
        p_page_size: normalized.page_size,
        p_buscar: normalized.buscar?.trim() || null,
        p_asesor_id: normalized.asesor_id || null,
        p_etapa_exacta: normalized.etapa_exacta ?? null,
        p_fecha_desde: normalized.fecha_desde?.trim() || null,
        p_fecha_hasta: normalized.fecha_hasta?.trim() || null,
        p_ciclo: normalized.ciclo ?? null,
      },
    );
    if (error) {
      mapRpcError(error, "No se pudo listar expedientes del equipo.");
    }
    const parsed = asesorLiderExpedientesPageSchema.safeParse(data);
    if (!parsed.success) {
      throw new AsesorLiderSupabaseError(
        "Respuesta inválida de asesor_lider_list_expedientes_page.",
      );
    }
    return parsed.data;
  }

  async listAsesoresActivosOrg(): Promise<readonly AsesorActivoOrg[]> {
    const client = await requireSessionClient();
    const { data, error } = await client.rpc("list_asesores_activos_org");
    if (error) {
      mapRpcError(error, "No se pudo listar asesores de la organización.");
    }
    const parsed = listAsesoresActivosOrgResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new AsesorLiderSupabaseError(
        "Respuesta inválida de list_asesores_activos_org.",
      );
    }
    return parsed.data.asesores;
  }

  async createExpedienteForAsesor(
    input: CreateExpedienteForAsesorInput,
  ): Promise<{ id: string; asesor_id: string }> {
    const client = await requireSessionClient();
    const programaDb = input.programaUi
      ? mapProgramaUiToDb(input.programaUi)
      : mapProgramaUiToDb(input.programa);

    const { data, error } = await client.rpc("create_expediente_for_asesor", {
      p_asesor_id: input.asesorId.trim(),
      p_programa: programaDb,
      p_nss: input.nss.trim(),
      p_cliente_nombre: input.cliente_nombre.trim(),
      p_telefono_cliente: input.telefono_cliente.trim(),
      p_direccion_opcional: (input.direccion_opcional ?? "").trim(),
    });
    if (error) {
      mapRpcError(error, "No se pudo crear el expediente para el asesor.");
    }
    if (!data || typeof data !== "object") {
      throw new AsesorLiderSupabaseError(
        "Respuesta vacía de create_expediente_for_asesor.",
      );
    }
    const row = data as { id?: string; asesor_id?: string };
    if (!row.id || !row.asesor_id) {
      throw new AsesorLiderSupabaseError(
        "Respuesta incompleta de create_expediente_for_asesor.",
      );
    }
    return { id: String(row.id), asesor_id: String(row.asesor_id) };
  }
}
