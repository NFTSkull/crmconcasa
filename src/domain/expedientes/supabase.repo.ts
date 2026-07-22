"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import type { ExpedientesRepo } from "./repo";
import {
  normalizeAsesorPaginationOptions,
  type ListForAsesorPaginatedOptions,
  type PaginatedExpedientesResult,
} from "./list-for-asesor-paginated";
import {
  mapNextCursorFromRpc,
  mapRpcCountsToServerCounts,
  mesaListBandejaPageRpcSchema,
  normalizeCategoriaResumen,
  normalizeMesaBandejaPageLimit,
  type ListForMesaControlPaginatedQuery,
  type MesaBandejaPageItem,
  type PaginatedMesaBandejaResult,
} from "./list-for-mesa-control-paginated";
import type { MesaExpedienteEstado } from "@/domain/mesa-ops/types";
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
  iniciarReingresoResponseSchema,
  mapReingresoRpcError,
  rechazoOperativoInputSchema,
  reingresoExpedienteIdSchema,
  reingresoElegibilidadSchema,
  type RechazoOperativoInput,
  type ReingresoElegibilidad,
} from "./reingreso-post-biometricos";
import {
  cancelacionOperativaInputSchema,
  mapMesaCancelacionRpcError,
  type CancelacionOperativaInput,
  type ExpedienteCancelacionRow,
} from "./mesa-cancelacion-operativa";
import {
  buildEditorListOrFilter,
  normalizeEditorListPage,
  type EditorListPage,
  type EditorListQuery,
} from "./editor-list-query";
import {
  mapCreateExpedienteRpcToExpedienteMock,
  mapSupabaseRowToExpedienteMock,
  type CreateExpedienteRpcResponse,
  type SupabaseAsesorProfileEmbed,
  type SupabaseExpedienteListRow,
} from "./map-supabase-row";
import {
  mapMesaMovimientoRpcError,
  mesaMovimientoHistorialRowSchema,
  mesaMovimientoInputSchema,
  mesaMovimientoResultadoSchema,
  type MesaMovimientoHistorialRow,
  type MesaMovimientoInput,
  type MesaMovimientoResultado,
} from "./mesa-movimiento-etapa";

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
  expediente_anterior_id,
  reingreso_rechazo_id,
  editor_decisions ( decision, monto_aprobado, notas_revision, aprobado_at, monto_aprobado_al_aprobar, no_cumple_at ),
  reingreso_rechazo:expediente_rechazos_operativos!expedientes_reingreso_rechazo_padre_fk (
    etapa,
    motivo,
    comentario,
    biometricos_condicion,
    biometricos_razon
  ),
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

async function fetchExpedientesListPaginatedForAsesor(
  options: ListForAsesorPaginatedOptions,
): Promise<PaginatedExpedientesResult> {
  const { client, userId } = await requireSupabaseSession();
  const { from, to } = normalizeAsesorPaginationOptions(options);

  const { data, error, count } = await client
    .from("expedientes")
    .select(EXPEDIENTES_LIST_SELECT, { count: "exact" })
    .is("deleted_at", null)
    .eq("asesor_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    throw new ExpedientesSupabaseError(
      "No se pudo cargar el listado de expedientes. Intenta de nuevo más tarde.",
    );
  }

  const rows = (data ?? []) as SupabaseExpedienteListRow[];
  const asesorMap = await fetchAsesorDisplayMap(
    client,
    rows.map((row) => row.asesor_id),
  );

  return {
    items: mapRowsToExpedienteMocks(rows, asesorMap),
    totalCount: count ?? rows.length,
  };
}

async function fetchExpedientesListForEditor(
  query: EditorListQuery,
): Promise<EditorListPage> {
  const { client } = await requireSupabaseSession();
  const { page, pageSize, from, to } = normalizeEditorListPage(
    query.page,
    query.pageSize,
  );
  const orFilter = buildEditorListOrFilter(query.search ?? "");

  let dbQuery = client
    .from("expedientes")
    .select(EXPEDIENTES_LIST_SELECT, { count: "exact" })
    .is("deleted_at", null);

  if (orFilter) {
    dbQuery = dbQuery.or(orFilter);
  }

  const { data, error, count } = await dbQuery
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    throw new ExpedientesSupabaseError(
      "No se pudo cargar el listado de expedientes. Intenta de nuevo más tarde.",
    );
  }

  const rows = (data ?? []) as SupabaseExpedienteListRow[];
  const asesorMap = await fetchAsesorDisplayMap(
    client,
    rows.map((row) => row.asesor_id),
  );

  return {
    items: mapRowsToExpedienteMocks(rows, asesorMap),
    total: count ?? rows.length,
    page,
    pageSize,
  };
}

async function fetchExpedientesListForMesaControl(): Promise<ExpedienteMock[]> {
  const { client } = await requireSupabaseSession();

  const { data, error } = await client
    .from("expedientes")
    .select(EXPEDIENTES_LIST_SELECT)
    .is("deleted_at", null)
    .eq("submitted_to_mesa", true)
    // P094: incluye cancelados para el chip agrupado; «Todos» los excluye en UI.
    .in("ciclo_estado", ["activo", "cancelado"])
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

async function fetchExpedientesListForMesaControlPaginated(
  query: ListForMesaControlPaginatedQuery,
): Promise<PaginatedMesaBandejaResult> {
  const { client } = await requireSupabaseSession();
  const limit = normalizeMesaBandejaPageLimit(query.limit);
  const etapa =
    typeof query.etapa === "number" && Number.isFinite(query.etapa)
      ? query.etapa
      : null;
  const subestado =
    typeof query.subestado === "string" &&
    query.subestado.trim() !== "" &&
    query.subestado !== "todas"
      ? query.subestado.trim()
      : null;

  const { data, error } = await client.rpc("mesa_list_bandeja_page", {
    p_limit: limit,
    p_cursor_sort_ts: query.cursor?.sortTs ?? null,
    p_cursor_id: query.cursor?.id ?? null,
    p_quick_filter: query.quickFilter,
    p_ops_filter: query.opsFilter,
    p_buscar: query.buscar?.trim() ? query.buscar.trim() : null,
    p_etapa: etapa,
    p_subestado: subestado,
    p_solo_citas_hoy: Boolean(query.soloCitasHoy),
    p_today_ymd: query.todayYmd ?? null,
    p_rechazos_sub: query.rechazosSub ?? "rechazados",
    p_origen: query.origen ?? "todos",
    p_include_counts: query.includeCounts !== false,
  });

  if (error) {
    throw new ExpedientesSupabaseError(
      "No se pudo cargar la bandeja de Mesa de control. Intenta de nuevo más tarde.",
    );
  }

  const parsed = mesaListBandejaPageRpcSchema.safeParse(data);
  if (!parsed.success) {
    throw new ExpedientesSupabaseError(
      "Respuesta inválida al cargar la bandeja paginada de Mesa.",
    );
  }

  const payload = parsed.data;
  const asesorMap = await fetchAsesorDisplayMap(
    client,
    payload.items.map((row) => String(row.asesor_id ?? "")),
  );

  const items: MesaBandejaPageItem[] = payload.items.map((row) => {
    const listRow: SupabaseExpedienteListRow = {
      id: row.id,
      programa: row.programa ?? "",
      nss: row.nss ?? "",
      cliente_nombre: row.cliente_nombre ?? "",
      telefono_cliente: row.telefono_cliente ?? "",
      direccion_opcional: row.direccion_opcional,
      asesor_id: row.asesor_id ?? "",
      origen_mesa: row.origen_mesa,
      submitted_to_mesa: row.submitted_to_mesa,
      fecha_envio_mesa: row.fecha_envio_mesa,
      etapa_actual: row.etapa_actual,
      subestado: row.subestado,
      ciclo_estado: row.ciclo_estado,
      motivo_rechazo: row.motivo_rechazo,
      comentario_rechazo: row.comentario_rechazo,
      fecha_cita: row.fecha_cita,
      created_at: row.created_at,
      updated_at: row.updated_at,
      expediente_anterior_id: row.expediente_anterior_id,
      reingreso_rechazo_id: row.reingreso_rechazo_id,
    };
    const base = mapSupabaseRowToExpedienteMock(
      listRow,
      asesorMap.get(String(row.asesor_id ?? "")) ?? null,
    );
    const sortTs =
      (typeof row.sort_ts === "string" && row.sort_ts.trim()) ||
      base.operativo.fechaEnvioMesa ||
      base.base.createdAt;
    const estadoRaw = row.ops_estado_mesa;
    const estadoMesa: MesaExpedienteEstado =
      estadoRaw === "sin_asignar" ||
      estadoRaw === "trabajando" ||
      estadoRaw === "en_espera_asesor" ||
      estadoRaw === "en_espera_cliente" ||
      estadoRaw === "en_espera_reagenda" ||
      estadoRaw === "bloqueado" ||
      estadoRaw === "listo_para_avanzar" ||
      estadoRaw === "completado"
        ? estadoRaw
        : "sin_asignar";
    const opsHint =
      row.ops_assigned_to || row.ops_estado_mesa || row.ops_assigned_at
        ? {
            estadoMesa,
            assignedTo: row.ops_assigned_to ?? null,
            assignedAt: row.ops_assigned_at ?? null,
            lastActivityAt: row.ops_last_activity_at ?? null,
          }
        : null;
    return {
      ...base,
      sortTs,
      categoriaResumen: normalizeCategoriaResumen(row.categoria_resumen),
      opsHint,
    };
  });

  return {
    items,
    totalCount: payload.total_count,
    hasMore: payload.has_more,
    nextCursor: mapNextCursorFromRpc(payload.next_cursor, payload.has_more),
    counts: mapRpcCountsToServerCounts(payload.counts ?? null),
  };
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

  async listForEditor(query: EditorListQuery): Promise<EditorListPage> {
    return fetchExpedientesListForEditor(query);
  }

  async listForMesaControl(): Promise<ExpedienteMock[]> {
    return fetchExpedientesListForMesaControl();
  }

  async listForMesaControlPaginated(
    query: ListForMesaControlPaginatedQuery,
  ): Promise<PaginatedMesaBandejaResult> {
    return fetchExpedientesListForMesaControlPaginated(query);
  }

  async listForAsesor(_asesorEmail: string): Promise<ExpedienteMock[]> {
    void _asesorEmail;
    return fetchExpedientesList({ restrictToAsesor: true });
  }

  async listForAsesorPaginated(
    _asesorEmail: string,
    options: ListForAsesorPaginatedOptions,
  ): Promise<PaginatedExpedientesResult> {
    void _asesorEmail;
    return fetchExpedientesListPaginatedForAsesor(options);
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

  async mesaMoverEtapaOperativa(
    expedienteId: string,
    input: MesaMovimientoInput,
  ): Promise<MesaMovimientoResultado> {
    const idResult = reingresoExpedienteIdSchema.safeParse(expedienteId);
    const inputResult = mesaMovimientoInputSchema.safeParse(input);
    if (!idResult.success) {
      throw new ExpedientesSupabaseError(
        "El identificador del expediente no es válido.",
      );
    }
    if (!inputResult.success) {
      throw new ExpedientesSupabaseError(
        inputResult.error.issues[0]?.message ??
          "Los datos del movimiento manual no son válidos.",
      );
    }

    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc("mesa_mover_etapa_operativa", {
      p_expediente_id: idResult.data,
      p_etapa_destino: inputResult.data.etapaDestino,
      p_etapa_esperada: inputResult.data.etapaEsperada,
      p_motivo: inputResult.data.motivo,
    });

    if (error) throw mapMesaMovimientoRpcError(error);

    const parsed = mesaMovimientoResultadoSchema.safeParse(data);
    if (!parsed.success) {
      throw new ExpedientesSupabaseError(
        "La etapa cambió, pero la respuesta del servidor no es válida.",
      );
    }
    return parsed.data;
  }

  async listMesaMovimientos(
    expedienteId: string,
  ): Promise<readonly MesaMovimientoHistorialRow[]> {
    const idResult = reingresoExpedienteIdSchema.safeParse(expedienteId);
    if (!idResult.success) {
      throw new ExpedientesSupabaseError(
        "El identificador del expediente no es válido.",
      );
    }

    const { client } = await requireSupabaseSession();
    const { data, error } = await client
      .from("expediente_movimientos_mesa")
      .select(
        "id, organization_id, expediente_id, etapa_origen, etapa_destino, subestado_origen, subestado_destino, motivo, actor_id, actor_role, created_at",
      )
      .eq("expediente_id", idResult.data)
      .order("created_at", { ascending: false });

    if (error) {
      throw new ExpedientesSupabaseError(
        "No se pudo consultar el historial de movimientos manuales.",
      );
    }

    return (data ?? []).map((row) => {
      const parsed = mesaMovimientoHistorialRowSchema.safeParse(row);
      if (!parsed.success) {
        throw new ExpedientesSupabaseError(
          "El historial de movimientos contiene una respuesta inválida.",
        );
      }
      return parsed.data;
    });
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

  async rechazarEtapaOperativa(
    expedienteId: string,
    input: RechazoOperativoInput,
  ): Promise<ExpedienteMock> {
    const idResult = reingresoExpedienteIdSchema.safeParse(expedienteId);
    const inputResult = rechazoOperativoInputSchema.safeParse(input);
    if (!idResult.success) {
      throw new ExpedientesSupabaseError(
        "El identificador del expediente no es válido.",
      );
    }
    if (!inputResult.success) {
      throw new ExpedientesSupabaseError(
        inputResult.error.issues[0]?.message ??
          "Los datos del rechazo no son válidos.",
      );
    }

    const { client } = await requireSupabaseSession();
    const value = inputResult.data;
    const { data, error } = await client.rpc("rechazar_etapa_operativa", {
      p_expediente_id: idResult.data,
      p_motivo: value.motivo,
      p_comentario: value.comentario || null,
      p_biometricos_condicion: value.biometricosCondicion,
      p_biometricos_razon: value.biometricosRazon || null,
      p_biometricos_booking_id: value.biometricosBookingId || null,
    });

    if (error) {
      throw mapReingresoRpcError(
        error,
        "No se pudo registrar el rechazo operativo.",
      );
    }
    if (!data || typeof data !== "object") {
      throw new ExpedientesSupabaseError(
        "El rechazo se registró sin una respuesta válida.",
      );
    }

    const refreshed = await fetchExpedienteById(idResult.data);
    if (!refreshed) {
      throw new ExpedientesSupabaseError(
        "El rechazo se registró, pero no se pudo recargar el expediente.",
      );
    }
    return refreshed;
  }

  async cancelarExpedienteOperativo(
    expedienteId: string,
    input: CancelacionOperativaInput,
  ): Promise<ExpedienteMock> {
    const idResult = reingresoExpedienteIdSchema.safeParse(expedienteId);
    const inputResult = cancelacionOperativaInputSchema.safeParse(input);
    if (!idResult.success) {
      throw new ExpedientesSupabaseError(
        "El identificador del expediente no es válido.",
      );
    }
    if (!inputResult.success) {
      throw new ExpedientesSupabaseError(
        inputResult.error.issues[0]?.message ??
          "Los datos de la cancelación no son válidos.",
      );
    }

    const { client } = await requireSupabaseSession();
    const value = inputResult.data;
    const { data, error } = await client.rpc("cancelar_expediente_operativo", {
      p_expediente_id: idResult.data,
      p_motivo: value.motivo,
      p_comentario: value.comentario || null,
    });

    if (error) {
      throw mapMesaCancelacionRpcError(
        error,
        "No se pudo registrar la cancelación operativa.",
      );
    }
    if (!data || typeof data !== "object") {
      throw new ExpedientesSupabaseError(
        "La cancelación se registró sin una respuesta válida.",
      );
    }

    const refreshed = await fetchExpedienteById(idResult.data);
    if (!refreshed) {
      throw new ExpedientesSupabaseError(
        "La cancelación se registró, pero no se pudo recargar el expediente.",
      );
    }
    return refreshed;
  }

  async getUltimaCancelacionOperativa(
    expedienteId: string,
  ): Promise<ExpedienteCancelacionRow | null> {
    const idResult = reingresoExpedienteIdSchema.safeParse(expedienteId);
    if (!idResult.success) {
      throw new ExpedientesSupabaseError(
        "El identificador del expediente no es válido.",
      );
    }
    const { client } = await requireSupabaseSession();
    const { data, error } = await client
      .from("expediente_cancelaciones")
      .select(
        "id, expediente_id, etapa, subestado_anterior, motivo, comentario, decidido_por, decidido_por_rol, created_at",
      )
      .eq("expediente_id", idResult.data)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new ExpedientesSupabaseError(
        "No se pudo cargar el historial de cancelación.",
      );
    }
    if (!data) return null;
    return {
      id: String(data.id),
      expedienteId: String(data.expediente_id),
      etapa: Number(data.etapa),
      subestadoAnterior: String(data.subestado_anterior),
      motivo: String(data.motivo),
      comentario:
        data.comentario == null ? null : String(data.comentario),
      decididoPor: String(data.decidido_por),
      decididoPorRol: String(data.decidido_por_rol),
      createdAt: String(data.created_at),
    };
  }

  async getReingresoPostBiometricosElegibilidad(
    expedienteId: string,
  ): Promise<ReingresoElegibilidad> {
    const idResult = reingresoExpedienteIdSchema.safeParse(expedienteId);
    if (!idResult.success) {
      throw new ExpedientesSupabaseError(
        "El identificador del expediente no es válido.",
      );
    }

    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc(
      "get_reingreso_post_biometricos_elegibilidad",
      { p_expediente_id: idResult.data },
    );
    if (error) {
      throw mapReingresoRpcError(
        error,
        "No se pudo consultar la elegibilidad del reingreso.",
      );
    }

    const parsed = reingresoElegibilidadSchema.safeParse(data);
    if (!parsed.success) {
      throw new ExpedientesSupabaseError(
        "La elegibilidad recibió una respuesta inválida del servidor.",
      );
    }
    return parsed.data;
  }

  async iniciarReingresoPostBiometricos(
    expedienteAnteriorId: string,
    nota?: string | null,
  ): Promise<ExpedienteMock> {
    const idResult =
      reingresoExpedienteIdSchema.safeParse(expedienteAnteriorId);
    if (!idResult.success) {
      throw new ExpedientesSupabaseError(
        "El identificador del expediente no es válido.",
      );
    }

    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc(
      "iniciar_reingreso_post_biometricos",
      {
        p_expediente_anterior_id: idResult.data,
        p_nota: nota?.trim() || null,
      },
    );
    if (error) {
      throw mapReingresoRpcError(error);
    }

    const parsed = iniciarReingresoResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new ExpedientesSupabaseError(
        "El reingreso recibió una respuesta inválida del servidor.",
      );
    }

    const child = await fetchExpedienteById(parsed.data.expediente_id);
    if (!child) {
      throw new ExpedientesSupabaseError(
        "El reingreso se creó, pero no se pudo cargar el expediente nuevo.",
      );
    }
    return child;
  }
}
