"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import type { ExpedientesRepo } from "./repo";
import type { CreateExpedienteInput } from "./create-expediente.input";
import type { ExpedienteMock } from "./mock.repo";
import { mapProgramaUiToDb } from "./map-programa";
import { ExpedientesSupabaseError } from "./supabase.error";
import { mapEnviarAMesaRpcError } from "./enviar-mesa-rpc-error";
import { mapAvanzarEtapaRpcError } from "./avanzar-etapa-rpc-error";
import { mapAsesorUpdateMontoAprobadoRpcError } from "./asesor-update-monto-aprobado-rpc-error";
import { mapUpsertEditorDecisionRpcError } from "./upsert-editor-decision-rpc-error";
import type { UpsertEditorDecisionInput } from "./upsert-editor-decision.input";
import {
  mapCreateExpedienteRpcToExpedienteMock,
  mapSupabaseRowToExpedienteMock,
  type CreateExpedienteRpcResponse,
  type SupabaseAsesorProfileEmbed,
  type SupabaseExpedienteListRow,
} from "./map-supabase-row";

const EXPEDIENTES_LIST_SELECT = `
  id,
  programa,
  nss,
  cliente_nombre,
  telefono_cliente,
  direccion_opcional,
  asesor_id,
  origen_mesa,
  submitted_to_mesa,
  fecha_envio_mesa,
  etapa_actual,
  subestado,
  ciclo_estado,
  motivo_rechazo,
  comentario_rechazo,
  fecha_cita,
  created_at,
  updated_at,
  editor_decisions ( decision, monto_aprobado, notas_revision ),
  asesor:profiles!expedientes_asesor_id_fkey ( email, full_name )
`;

export { ExpedientesSupabaseError } from "./supabase.error";

type AsesorDisplayRow = Readonly<{
  asesor_id: string;
  full_name: string | null;
  email: string | null;
}>;

async function fetchAsesorDisplayMap(
  client: SupabaseClient,
  asesorIds: string[],
): Promise<Map<string, SupabaseAsesorProfileEmbed>> {
  const unique = [...new Set(asesorIds.map((id) => id.trim()).filter(Boolean))];
  const map = new Map<string, SupabaseAsesorProfileEmbed>();
  if (unique.length === 0) return map;

  const { data, error } = await client.rpc("get_asesor_display_batch", {
    p_asesor_ids: unique,
  });

  if (error) {
    return map;
  }

  for (const row of (data ?? []) as AsesorDisplayRow[]) {
    const id = String(row.asesor_id ?? "").trim();
    if (!id) continue;
    map.set(id, {
      full_name: row.full_name,
      email: row.email,
    });
  }

  return map;
}

function mapRowsToExpedienteMocks(
  rows: SupabaseExpedienteListRow[],
  asesorMap: Map<string, SupabaseAsesorProfileEmbed>,
): ExpedienteMock[] {
  return rows.map((row) => {
    const embed = row.asesor;
    const embedded =
      embed && !Array.isArray(embed)
        ? embed
        : Array.isArray(embed)
          ? embed[0]
          : null;
    const hasEmbed =
      Boolean(embedded?.email?.trim()) || Boolean(embedded?.full_name?.trim());
    const override = hasEmbed ? null : asesorMap.get(row.asesor_id) ?? null;
    return mapSupabaseRowToExpedienteMock(row, override);
  });
}

function mapCreateExpedienteRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): ExpedientesSupabaseError {
  const msg = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();

  if (
    error.code === "23505" ||
    msg.includes("mismo nss y programa") ||
    msg.includes("expedientes_nss_programa_activo_unique") ||
    msg.includes("enviado a mesa")
  ) {
    return new ExpedientesSupabaseError(
      "Este NSS ya tiene un expediente enviado a Mesa.",
    );
  }

  if (error.code === "42501" || msg.includes("rol no autorizado") || msg.includes("no autenticado")) {
    return new ExpedientesSupabaseError(
      "No tienes permiso para crear expedientes. Inicia sesión como asesor activo.",
    );
  }

  if (msg.includes("nss debe tener exactamente 11")) {
    return new ExpedientesSupabaseError("El NSS (IMSS) debe tener exactamente 11 dígitos.");
  }

  if (msg.includes("teléfono debe tener exactamente 10")) {
    return new ExpedientesSupabaseError(
      "El teléfono del cliente debe tener exactamente 10 dígitos (México).",
    );
  }

  if (msg.includes("nombre del cliente es obligatorio")) {
    return new ExpedientesSupabaseError("El nombre del cliente es requerido.");
  }

  return new ExpedientesSupabaseError(
    "No se pudo crear el expediente. Intenta de nuevo más tarde.",
  );
}

async function requireSupabaseSession(): Promise<{
  client: SupabaseClient;
  userId: string;
}> {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new ExpedientesSupabaseError(
      "Supabase no está configurado. Revisa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const client = supabaseBrowser;
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();

  if (sessionError || !session?.user) {
    throw new ExpedientesSupabaseError(
      "No hay sesión de Supabase activa. Inicia sesión de nuevo.",
    );
  }

  return { client, userId: session.user.id };
}

async function fetchExpedientesList(options?: {
  restrictToAsesor?: boolean;
}): Promise<ExpedienteMock[]> {
  const { client, userId } = await requireSupabaseSession();

  let query = client
    .from("expedientes")
    .select(EXPEDIENTES_LIST_SELECT)
    .is("deleted_at", null);

  if (options?.restrictToAsesor) {
    query = query.eq("asesor_id", userId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new ExpedientesSupabaseError(
      "No se pudo cargar el listado de expedientes. Intenta de nuevo más tarde.",
    );
  }

  if (!data || data.length === 0) {
    return [];
  }

  const rows = data as SupabaseExpedienteListRow[];
  const asesorMap = await fetchAsesorDisplayMap(
    client,
    rows.map((row) => row.asesor_id),
  );
  return mapRowsToExpedienteMocks(rows, asesorMap);
}

async function fetchExpedientesListForMesaControl(): Promise<ExpedienteMock[]> {
  const { client } = await requireSupabaseSession();

  const { data, error } = await client
    .from("expedientes")
    .select(EXPEDIENTES_LIST_SELECT)
    .is("deleted_at", null)
    .eq("submitted_to_mesa", true)
    .eq("ciclo_estado", "activo")
    .order("fecha_envio_mesa", { ascending: true });

  if (error) {
    throw new ExpedientesSupabaseError(
      "No se pudo cargar la bandeja de Mesa de control. Intenta de nuevo más tarde.",
    );
  }

  if (!data || data.length === 0) {
    return [];
  }

  const rows = data as SupabaseExpedienteListRow[];
  const asesorMap = await fetchAsesorDisplayMap(
    client,
    rows.map((row) => row.asesor_id),
  );
  return mapRowsToExpedienteMocks(rows, asesorMap);
}

async function fetchExpedienteById(id: string): Promise<ExpedienteMock | null> {
  const idNorm = String(id).trim();
  if (!idNorm) return null;

  const { client } = await requireSupabaseSession();

  const { data, error } = await client
    .from("expedientes")
    .select(EXPEDIENTES_LIST_SELECT)
    .eq("id", idNorm)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new ExpedientesSupabaseError(
      "No se pudo cargar el expediente. Intenta de nuevo más tarde.",
    );
  }

  if (!data) return null;

  const row = data as SupabaseExpedienteListRow;
  const asesorMap = await fetchAsesorDisplayMap(client, [row.asesor_id]);
  return mapSupabaseRowToExpedienteMock(row, asesorMap.get(row.asesor_id) ?? null);
}

/**
 * Lectura vía RLS (JWT del usuario autenticado).
 * P3B.1: `listForAdmin()`; P3B.2: `listForAsesor()`; P3C: `createExpediente()`; P3D: `getById()`; P3E: `enviarAMesa()`; P3F: `listForEditor()` + `upsertEditorDecision()`; P3J.1: `listForMesaControl()`.
 */
export class SupabaseExpedientesRepo implements ExpedientesRepo {
  async listForAdmin(): Promise<ExpedienteMock[]> {
    return fetchExpedientesList();
  }

  async listForEditor(): Promise<ExpedienteMock[]> {
    return fetchExpedientesList();
  }

  async listForMesaControl(): Promise<ExpedienteMock[]> {
    return fetchExpedientesListForMesaControl();
  }

  async listForAsesor(_asesorEmail: string): Promise<ExpedienteMock[]> {
    void _asesorEmail;
    return fetchExpedientesList({ restrictToAsesor: true });
  }

  async getById(id: string): Promise<ExpedienteMock | null> {
    return fetchExpedienteById(id);
  }

  async createExpediente(input: CreateExpedienteInput): Promise<ExpedienteMock> {
    const { client } = await requireSupabaseSession();

    const { data, error } = await client.rpc("create_expediente", {
      p_programa: mapProgramaUiToDb(input.programa),
      p_nss: input.nss.trim(),
      p_cliente_nombre: input.cliente_nombre.trim(),
      p_telefono_cliente: input.telefono_cliente.trim(),
      p_direccion_opcional: input.direccion_opcional.trim(),
    });

    if (error) {
      throw mapCreateExpedienteRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new ExpedientesSupabaseError(
        "No se pudo crear el expediente. Respuesta vacía del servidor.",
      );
    }

    return mapCreateExpedienteRpcToExpedienteMock(
      data as CreateExpedienteRpcResponse,
      input.asesorEmail,
    );
  }

  async enviarAMesa(expedienteId: string): Promise<ExpedienteMock> {
    const idNorm = String(expedienteId).trim();
    if (!idNorm) {
      throw new ExpedientesSupabaseError("El identificador del expediente es obligatorio.");
    }

    const { client } = await requireSupabaseSession();

    const { data, error } = await client.rpc("enviar_a_mesa", {
      p_expediente_id: idNorm,
    });

    if (error) {
      throw mapEnviarAMesaRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new ExpedientesSupabaseError(
        "No se pudo enviar a Mesa. Respuesta vacía del servidor.",
      );
    }

    const refreshed = await fetchExpedienteById(idNorm);
    if (!refreshed) {
      throw new ExpedientesSupabaseError(
        "El envío a Mesa se registró, pero no se pudo recargar el expediente.",
      );
    }

    return refreshed;
  }

  async upsertEditorDecision(
    expedienteId: string,
    input: UpsertEditorDecisionInput,
  ): Promise<ExpedienteMock> {
    const idNorm = String(expedienteId).trim();
    if (!idNorm) {
      throw new ExpedientesSupabaseError("El identificador del expediente es obligatorio.");
    }

    const { client } = await requireSupabaseSession();

    const motivo = input.notas_revision?.trim() ?? "";
    const rpcArgs: {
      p_expediente_id: string;
      p_decision: UpsertEditorDecisionInput["decision"];
      p_monto_aprobado?: number | null;
      p_motivo?: string | null;
    } = {
      p_expediente_id: idNorm,
      p_decision: input.decision,
    };

    if (input.decision === "aprobado") {
      rpcArgs.p_monto_aprobado = input.monto_aprobado;
    }

    if (motivo.length > 0) {
      rpcArgs.p_motivo = motivo;
    }

    const { data, error } = await client.rpc("upsert_editor_decision", rpcArgs);

    if (error) {
      throw mapUpsertEditorDecisionRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new ExpedientesSupabaseError(
        "No se pudo guardar la decisión. Respuesta vacía del servidor.",
      );
    }

    const refreshed = await fetchExpedienteById(idNorm);
    if (!refreshed) {
      throw new ExpedientesSupabaseError(
        "La decisión se guardó, pero no se pudo recargar el expediente.",
      );
    }

    return refreshed;
  }

  async avanzarEtapaOperativa(
    expedienteId: string,
    comentario?: string | null,
  ): Promise<ExpedienteMock> {
    const idNorm = String(expedienteId).trim();
    if (!idNorm) {
      throw new ExpedientesSupabaseError("El identificador del expediente es obligatorio.");
    }

    const { client } = await requireSupabaseSession();

    const rpcArgs: {
      p_expediente_id: string;
      p_comentario?: string;
    } = {
      p_expediente_id: idNorm,
    };

    const comentarioNorm = comentario?.trim();
    if (comentarioNorm) {
      rpcArgs.p_comentario = comentarioNorm;
    }

    const { data, error } = await client.rpc("avanzar_etapa_operativa", rpcArgs);

    if (error) {
      throw mapAvanzarEtapaRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new ExpedientesSupabaseError(
        "No se pudo avanzar la etapa. Respuesta vacía del servidor.",
      );
    }

    const refreshed = await fetchExpedienteById(idNorm);
    if (!refreshed) {
      throw new ExpedientesSupabaseError(
        "La etapa se actualizó, pero no se pudo recargar el expediente.",
      );
    }

    return refreshed;
  }

  async asesorUpdateMontoAprobado(
    expedienteId: string,
    montoAprobado: number,
  ): Promise<ExpedienteMock> {
    const idNorm = String(expedienteId).trim();
    if (!idNorm) {
      throw new ExpedientesSupabaseError("El identificador del expediente es obligatorio.");
    }
    if (!Number.isFinite(montoAprobado) || montoAprobado <= 0) {
      throw new ExpedientesSupabaseError("El monto aprobado debe ser mayor a cero.");
    }

    const { client } = await requireSupabaseSession();

    const { data, error } = await client.rpc("asesor_update_monto_aprobado", {
      p_expediente_id: idNorm,
      p_monto_aprobado: montoAprobado,
    });

    if (error) {
      throw mapAsesorUpdateMontoAprobadoRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new ExpedientesSupabaseError(
        "No se pudo guardar el monto aprobado. Respuesta vacía del servidor.",
      );
    }

    const refreshed = await fetchExpedienteById(idNorm);
    if (!refreshed) {
      throw new ExpedientesSupabaseError(
        "El monto se guardó, pero no se pudo recargar el expediente.",
      );
    }

    return refreshed;
  }
}
