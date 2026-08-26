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
  ASESOR_INBOX_NOTIF_DEFAULT_LIMIT,
  asesorInboxSummaryResultSchema,
  asesorListExpedientesPageInputSchema,
  asesorListExpedientesPageResultSchema,
  type AsesorInboxSummaryResult,
  type AsesorListExpedientesPageInput,
  type AsesorListExpedientesPageResult,
} from "./asesor-inbox-rpc";
import {
  asesorReenviarCorreccionResultSchema,
  parseAsesorCorreccionDetalle,
  type AsesorCorreccionDetalle,
  type AsesorReenviarCorreccionResult,
} from "./asesor-correccion-detalle";
import {
  parseExpedienteVigenciaDocumentalEstado,
  type ExpedienteVigenciaDocumentalEstado,
} from "./vigencia-documental";
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
import {
  isMesaBandejaCountsRpcMissing,
  parseMesaBandejaCountsRpcPayload,
} from "./mesa-bandeja-counts-fast";
import type { MesaExpedienteEstado } from "@/domain/mesa-ops/types";
import {
  mapMesaCambiosSubfiltroToRpc,
  normalizeMesaCambioRequestType,
  normalizeMesaCambioRevisionOrigen,
} from "@/lib/mesaCambiosRevisionOrigenUi";
import type { CreateExpedienteInput, ExpedienteProgramaUi } from "./create-expediente.input";
import type { ExpedienteMock } from "./mock.repo";
import { mapProgramaUiToDb } from "./map-programa";
import {
  iniciarReprecalificacionResultSchema,
  messageForNssPrecalGateStatus,
  nssPrecalGateResultSchema,
  type IniciarReprecalificacionInput,
  type IniciarReprecalificacionResult,
  type NssPrecalGateResult,
} from "./nss-precal-gate";
import { ExpedientesSupabaseError } from "./supabase.error";
import { mapEnviarAMesaRpcError } from "./enviar-mesa-rpc-error";
import { mapAsesorEnviarReingresoRpcError } from "./reingreso-manual";
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
  mapReactivacionRpcError,
  reactivarExpedienteResponseSchema,
} from "./reactivar-expediente-rechazado";
import {
  cancelacionOperativaInputSchema,
  mapMesaCancelacionRpcError,
  type CancelacionOperativaInput,
  type ExpedienteCancelacionRow,
} from "./mesa-cancelacion-operativa";
import {
  normalizeEditorListPage,
  type EditorListPage,
  type EditorListQuery,
} from "./editor-list-query";
import {
  editorGuardarBorradorReprecalResultSchema,
  editorListExpedienteIdsPageResultSchema,
  EDITOR_INBOX_DEFAULT_PAGE_SIZE,
  EDITOR_LIST_PAGE_INCOMPLETE_MSG,
  reorderEditorRowsByRpcIds,
} from "./editor-inbox-rpc";
import { mapEditorDraftRpcError } from "./editor-draft-rpc-error";
import {
  buildEditorReprecalSidecar,
  EDITOR_REPRECAL_INTENTOS_SELECT,
  indexPendingIntentosByExpediente,
  parseEditorReprecalIntentoRows,
  type EditorReprecalIntentoRow,
  type EditorReprecalMeta,
} from "./editor-reprecal-read-model";
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
  firma_agendable_desde,
  pago_concasa_resultado,
  pago_concasa_at,
  pago_concasa_by,
  created_at,
  updated_at,
  expediente_anterior_id,
  reingreso_rechazo_id,
  reingreso_manual_count,
  reingreso_manual_at,
  reingreso_manual_by,
  reprecalificacion_pendiente_id,
  reprecal_intento:expediente_precalificacion_intentos!expedientes_reprecalificacion_pendiente_id_fkey (
    programa,
    programa_solicitado
  ),
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
    msg.includes("asignado a otro asesor") ||
    msg.includes("blocked_other_asesor")
  ) {
    return new ExpedientesSupabaseError(
      "Este NSS ya tiene un expediente activo asignado a otro asesor.",
    );
  }

  if (
    msg.includes("más de un expediente vigente") ||
    msg.includes("blocked_ambiguous") ||
    msg.includes("revisión administrativa")
  ) {
    return new ExpedientesSupabaseError(
      "Este NSS requiere revisión administrativa porque tiene más de un expediente vigente.",
    );
  }

  if (
    msg.includes("cambiar programa") ||
    msg.includes("blocked_programa_mismatch") ||
    msg.includes("otro programa")
  ) {
    return new ExpedientesSupabaseError(
      "Este NSS ya tiene un expediente activo con otro programa. Usa el flujo de «Cambiar programa»; no se creará otro expediente.",
    );
  }

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

function mapReprecalificacionRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): ExpedientesSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (msg.includes("asignado a otro asesor")) {
    return new ExpedientesSupabaseError(
      "Este NSS ya tiene un expediente activo asignado a otro asesor.",
    );
  }
  if (msg.includes("revisión administrativa") || msg.includes("más de un expediente")) {
    return new ExpedientesSupabaseError(
      "Este NSS requiere revisión administrativa porque tiene más de un expediente vigente.",
    );
  }
  if (msg.includes("cambiar programa") || msg.includes("otro programa")) {
    return new ExpedientesSupabaseError(
      "Este NSS ya tiene un expediente activo con otro programa. Usa el flujo de «Cambiar programa»; no se creará otro expediente.",
    );
  }
  if (error.code === "42501" || msg.includes("solo asesor") || msg.includes("no autenticado")) {
    return new ExpedientesSupabaseError(
      "No tienes permiso para re-precalificar. Inicia sesión como asesor activo.",
    );
  }
  if (msg.includes("teléfono inválido")) {
    return new ExpedientesSupabaseError(
      "El teléfono del cliente debe tener exactamente 10 dígitos (México).",
    );
  }
  if (msg.includes("nombre obligatorio")) {
    return new ExpedientesSupabaseError("El nombre del cliente es requerido.");
  }
  if (raw.length > 0 && raw.length < 280) {
    return new ExpedientesSupabaseError(raw.replace(/^asesor_iniciar_reprecalificacion:\s*/i, ""));
  }
  return new ExpedientesSupabaseError(
    "No se pudo iniciar la re-precalificación. Intenta de nuevo más tarde.",
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
  const { page, pageSize } = normalizeEditorListPage(
    query.page,
    query.pageSize ?? EDITOR_INBOX_DEFAULT_PAGE_SIZE,
  );
  const searchTerm = (query.search ?? "").trim();

  const { data: rpcRaw, error: rpcError } = await client.rpc(
    "editor_list_expediente_ids_page",
    {
      p_page: page,
      p_page_size: pageSize,
      p_search: searchTerm ? searchTerm : null,
    },
  );

  if (rpcError) {
    throw new ExpedientesSupabaseError(
      "No se pudo cargar el listado de expedientes. Intenta de nuevo más tarde.",
    );
  }

  const parsedPage = editorListExpedienteIdsPageResultSchema.safeParse(rpcRaw);
  if (!parsedPage.success) {
    throw new ExpedientesSupabaseError(
      "No se pudo cargar el listado de expedientes. Respuesta inválida.",
    );
  }

  const orderedIds = parsedPage.data.items.map((item) => item.id);
  const total = parsedPage.data.total_count;

  if (orderedIds.length === 0) {
    return {
      items: [],
      total,
      page,
      pageSize,
      reprecalByExpedienteId: {},
      pendingIntentoByExpedienteId: {},
    };
  }

  const { data, error } = await client
    .from("expedientes")
    .select(EXPEDIENTES_LIST_SELECT)
    .in("id", orderedIds);

  if (error) {
    throw new ExpedientesSupabaseError(
      "No se pudo cargar el listado de expedientes. Intenta de nuevo más tarde.",
    );
  }

  const rows = (data ?? []) as SupabaseExpedienteListRow[];
  let orderedRows: SupabaseExpedienteListRow[];
  try {
    orderedRows = reorderEditorRowsByRpcIds(orderedIds, rows);
  } catch (err) {
    if (err instanceof Error && err.name === "EditorListPageIncompleteError") {
      throw new ExpedientesSupabaseError(EDITOR_LIST_PAGE_INCOMPLETE_MSG);
    }
    throw err;
  }

  const asesorMap = await fetchAsesorDisplayMap(
    client,
    orderedRows.map((row) => row.asesor_id),
  );

  const items = mapRowsToExpedienteMocks(orderedRows, asesorMap);
  const sidecar = await fetchEditorReprecalSidecarBundle(
    client,
    items.map((item) => item.id),
  );
  const pendingIntentoByExpedienteId = indexPendingIntentosByExpediente(
    sidecar.intentos,
    items,
  );

  return {
    items,
    total,
    page,
    pageSize,
    reprecalByExpedienteId: sidecar.resolved,
    pendingIntentoByExpedienteId,
  };
}

async function fetchEditorReprecalSidecarBundle(
  client: SupabaseClient,
  expedienteIds: string[],
): Promise<{
  resolved: Readonly<Record<string, EditorReprecalMeta>>;
  intentos: EditorReprecalIntentoRow[];
}> {
  const ids = [...new Set(expedienteIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { resolved: {}, intentos: [] };

  const { data, error } = await client
    .from("expediente_precalificacion_intentos")
    .select(EDITOR_REPRECAL_INTENTOS_SELECT)
    .in("expediente_id", ids);

  if (error) {
    throw new ExpedientesSupabaseError(
      "No se pudo cargar el historial de re-precalificación.",
    );
  }

  const intentos = parseEditorReprecalIntentoRows(data ?? []);
  return {
    resolved: buildEditorReprecalSidecar(intentos),
    intentos,
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
    p_quick_filter: mapMesaCambiosSubfiltroToRpc(
      query.quickFilter,
      query.cambiosSubfiltro ?? "todos",
    ),
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
      reingreso_manual_count: row.reingreso_manual_count,
      reingreso_manual_at: row.reingreso_manual_at,
      reingreso_manual_by: row.reingreso_manual_by,
      pago_concasa_resultado: row.pago_concasa_resultado,
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
      lastViewedByName: row.last_viewed_by_name ?? null,
      lastViewedAt: row.last_viewed_at ?? null,
      lastUpdatedByName: row.last_updated_by_name ?? null,
      lastUpdatedAt: row.last_updated_at ?? null,
      cambioRevisionOrigen: normalizeMesaCambioRevisionOrigen(
        row.cambio_revision_origen,
      ),
      cambioRequestType: normalizeMesaCambioRequestType(row.cambio_request_type),
      cambioRequestAt: row.cambio_request_at ?? null,
      cambioRevisionEstado: row.cambio_revision_estado ?? null,
      cambioActionableAt: row.cambio_actionable_at ?? null,
      cambioBatchId: row.cambio_batch_id ?? null,
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

async function fetchAsesorInboxPage(
  rawInput: AsesorListExpedientesPageInput,
): Promise<AsesorListExpedientesPageResult> {
  const input = asesorListExpedientesPageInputSchema.parse(rawInput);
  const { client } = await requireSupabaseSession();

  const { data, error } = await client.rpc("asesor_list_expedientes_page", {
    p_page: input.page,
    p_page_size: input.page_size,
    p_buscar: input.buscar ?? null,
    p_decision: input.decision ?? null,
    p_estatus_operativo: input.estatus_operativo ?? null,
    p_resultado_real: input.resultado_real ?? null,
    p_programa: input.programa ?? null,
    p_etapa_exacta: input.etapa_exacta ?? null,
    p_fecha_desde: input.fecha_desde ?? null,
    p_fecha_hasta: input.fecha_hasta ?? null,
    p_quick_filter: input.quick_filter ?? "todos",
  });

  if (error) {
    const msg = String(error.message ?? "");
    if (/could not find|does not exist|PGRST202/i.test(msg)) {
      throw new ExpedientesSupabaseError(
        "El listado paginado del asesor no está disponible en este entorno. Contacta a soporte o aplica la migración 161.",
      );
    }
    throw new ExpedientesSupabaseError(
      "No se pudo cargar el listado de expedientes. Intenta de nuevo más tarde.",
    );
  }

  const parsed = asesorListExpedientesPageResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new ExpedientesSupabaseError(
      "Respuesta inválida al cargar el inbox paginado del asesor.",
    );
  }
  return parsed.data;
}

async function fetchAsesorInboxSummary(
  notifLimit?: number,
): Promise<AsesorInboxSummaryResult> {
  const { client } = await requireSupabaseSession();
  const limit = Math.min(
    100,
    Math.max(1, Math.floor(notifLimit ?? ASESOR_INBOX_NOTIF_DEFAULT_LIMIT) || 1),
  );

  const { data, error } = await client.rpc("asesor_inbox_summary", {
    p_notif_limit: limit,
  });

  if (error) {
    const msg = String(error.message ?? "");
    if (/could not find|does not exist|PGRST202/i.test(msg)) {
      throw new ExpedientesSupabaseError(
        "El resumen del inbox asesor no está disponible en este entorno. Contacta a soporte o aplica la migración 161.",
      );
    }
    throw new ExpedientesSupabaseError(
      "No se pudo cargar el resumen del inbox. Intenta de nuevo más tarde.",
    );
  }

  const parsed = asesorInboxSummaryResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new ExpedientesSupabaseError(
      "Respuesta inválida al cargar el resumen del inbox asesor.",
    );
  }
  return parsed.data;
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

  async listEditorReprecalMeta(
    expedienteIds: readonly string[],
  ): Promise<{
    resolvedByExpedienteId: Readonly<Record<string, EditorReprecalMeta>>;
    pendingIntentoByExpedienteId: Readonly<
      Record<string, EditorReprecalIntentoRow>
    >;
    intentos: readonly EditorReprecalIntentoRow[];
  }> {
    const { client } = await requireSupabaseSession();
    const bundle = await fetchEditorReprecalSidecarBundle(client, [
      ...expedienteIds,
    ]);
    const pendingIntentoByExpedienteId: Record<string, EditorReprecalIntentoRow> =
      {};
    for (const id of expedienteIds) {
      const pending = bundle.intentos.find(
        (row) =>
          row.expediente_id === id &&
          (row.decision ?? "pendiente") === "pendiente",
      );
      if (pending) pendingIntentoByExpedienteId[id] = pending;
    }
    return {
      resolvedByExpedienteId: bundle.resolved,
      pendingIntentoByExpedienteId,
      intentos: bundle.intentos,
    };
  }

  async listForMesaControl(): Promise<ExpedienteMock[]> {
    return fetchExpedientesListForMesaControl();
  }

  async listForMesaControlPaginated(
    query: ListForMesaControlPaginatedQuery,
  ): Promise<PaginatedMesaBandejaResult> {
    return fetchExpedientesListForMesaControlPaginated(query);
  }

  async getMesaBandejaCounts(input: {
    todayYmd: string | null;
    origen: string | null;
  }): Promise<import("./list-for-mesa-control-paginated").MesaBandejaServerCounts | null> {
    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc("mesa_bandeja_counts_fast", {
      p_today_ymd: input.todayYmd,
      p_origen: input.origen,
    });

    if (error) {
      if (isMesaBandejaCountsRpcMissing(error)) {
        const page = await fetchExpedientesListForMesaControlPaginated({
          limit: 1,
          cursor: null,
          quickFilter: "todos",
          opsFilter: "todo_mesa",
          buscar: undefined,
          etapa: null,
          subestado: null,
          soloCitasHoy: false,
          todayYmd: input.todayYmd,
          origen: input.origen,
          includeCounts: true,
        });
        return page.counts;
      }
      throw new ExpedientesSupabaseError(
        error.message || "No se pudieron cargar los counts de Mesa.",
      );
    }

    return parseMesaBandejaCountsRpcPayload(data);
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

  async listAsesorInboxPage(
    input: AsesorListExpedientesPageInput,
  ): Promise<AsesorListExpedientesPageResult> {
    return fetchAsesorInboxPage(input);
  }

  async getAsesorInboxSummary(
    notifLimit?: number,
  ): Promise<AsesorInboxSummaryResult> {
    return fetchAsesorInboxSummary(notifLimit);
  }

  async getAsesorInboxEstadoEfectivo(expedienteId: string): Promise<string | null> {
    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc("asesor_inbox_estado_efectivo", {
      p_expediente_id: expedienteId,
    });
    if (error) {
      const code = String((error as { code?: string }).code ?? "");
      if (code === "PGRST202" || /asesor_inbox_estado_efectivo/i.test(error.message ?? "")) {
        return null;
      }
      throw new ExpedientesSupabaseError(
        error.message || "No se pudo leer el estado efectivo del expediente.",
      );
    }
    return typeof data === "string" && data.trim() ? data.trim() : null;
  }

  async getAsesorCorreccionDetalle(
    expedienteId: string,
  ): Promise<AsesorCorreccionDetalle | null> {
    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc("asesor_correccion_detalle", {
      p_expediente_id: expedienteId,
    });
    if (error) {
      const code = String((error as { code?: string }).code ?? "");
      if (code === "PGRST202" || /asesor_correccion_detalle/i.test(error.message ?? "")) {
        return null;
      }
      throw new ExpedientesSupabaseError(
        error.message || "No se pudo leer el detalle de corrección.",
      );
    }
    return parseAsesorCorreccionDetalle(data);
  }

  async getVigenciaDocumentalEstado(
    expedienteId: string,
  ): Promise<ExpedienteVigenciaDocumentalEstado | null> {
    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc(
      "expediente_vigencia_documental_estado",
      { p_expediente_id: expedienteId },
    );
    if (error) {
      const code = String((error as { code?: string }).code ?? "");
      if (
        code === "PGRST202" ||
        /expediente_vigencia_documental_estado/i.test(error.message ?? "")
      ) {
        return null;
      }
      throw new ExpedientesSupabaseError(
        error.message || "No se pudo leer la vigencia documental.",
      );
    }
    return parseExpedienteVigenciaDocumentalEstado(data);
  }

  async reenviarCorreccionAMesa(
    expedienteId: string,
  ): Promise<AsesorReenviarCorreccionResult> {
    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc("asesor_reenviar_correccion_a_mesa", {
      p_expediente_id: expedienteId,
    });
    if (error) {
      throw new ExpedientesSupabaseError(
        error.message || "No se pudo reenviar la corrección a Mesa.",
      );
    }
    const parsed = asesorReenviarCorreccionResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new ExpedientesSupabaseError(
        "Respuesta inválida al reenviar la corrección a Mesa.",
      );
    }
    return parsed.data;
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

  async lookupNssPrecalGate(
    nss: string,
    programa: ExpedienteProgramaUi,
  ): Promise<NssPrecalGateResult> {
    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc("asesor_lookup_nss_precal_gate", {
      p_nss: nss.trim(),
      p_programa: mapProgramaUiToDb(programa),
    });
    if (error) {
      throw mapReprecalificacionRpcError(error);
    }
    const parsed = nssPrecalGateResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new ExpedientesSupabaseError(
        "No se pudo validar el NSS. Respuesta inválida del servidor.",
      );
    }
    return {
      ...parsed.data,
      message: messageForNssPrecalGateStatus(
        parsed.data.status,
        parsed.data.message,
      ),
    };
  }

  async iniciarReprecalificacion(
    input: IniciarReprecalificacionInput,
  ): Promise<IniciarReprecalificacionResult> {
    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc("asesor_iniciar_reprecalificacion", {
      p_nss: input.nss.trim(),
      p_programa: mapProgramaUiToDb(input.programa),
      p_cliente_nombre: input.cliente_nombre.trim(),
      p_telefono_cliente: input.telefono_cliente.trim(),
      p_direccion_opcional: input.direccion_opcional.trim(),
      p_idempotency_key: input.idempotency_key.trim() || null,
    });
    if (error) {
      throw mapReprecalificacionRpcError(error);
    }
    const parsed = iniciarReprecalificacionResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new ExpedientesSupabaseError(
        "No se pudo iniciar la re-precalificación. Respuesta inválida del servidor.",
      );
    }
    return parsed.data;
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

  async enviarReingresoAMesa(expedienteId: string): Promise<ExpedienteMock> {
    const idNorm = String(expedienteId).trim();
    if (!idNorm) {
      throw new ExpedientesSupabaseError("El identificador del expediente es obligatorio.");
    }

    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc("asesor_enviar_reingreso_a_mesa", {
      p_expediente_id: idNorm,
    });

    if (error) {
      throw mapAsesorEnviarReingresoRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new ExpedientesSupabaseError(
        "No se pudo reingresar a Mesa. Respuesta vacía del servidor.",
      );
    }

    const refreshed = await fetchExpedienteById(idNorm);
    if (!refreshed) {
      throw new ExpedientesSupabaseError(
        "El reingreso a Mesa se registró, pero no se pudo recargar el expediente.",
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

  async guardarBorradorReprecalificacion(
    expedienteId: string,
    input: { monto_aprobado: number | null; notas: string },
  ) {
    const idNorm = String(expedienteId).trim();
    if (!idNorm) {
      throw new ExpedientesSupabaseError(
        "El identificador del expediente es obligatorio.",
      );
    }

    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc(
      "editor_guardar_borrador_reprecalificacion",
      {
        p_expediente_id: idNorm,
        p_monto_aprobado: input.monto_aprobado,
        p_notas: input.notas ?? "",
      },
    );

    if (error) {
      throw mapEditorDraftRpcError(error);
    }

    const parsed = editorGuardarBorradorReprecalResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new ExpedientesSupabaseError(
        "No se pudo guardar el borrador. Respuesta inválida del servidor.",
      );
    }
    return parsed.data;
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

    const { data, error } = await client.rpc(
      "mesa_avanzar_etapa_reactivando_si_necesario",
      rpcArgs,
    );

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

  async decidirPagoConcasa(
    expedienteId: string,
    resultado: "pagado" | "no_pagado",
    comentario?: string | null,
  ): Promise<ExpedienteMock> {
    const idNorm = String(expedienteId).trim();
    if (!idNorm) {
      throw new ExpedientesSupabaseError("El identificador del expediente es obligatorio.");
    }
    if (resultado !== "pagado" && resultado !== "no_pagado") {
      throw new ExpedientesSupabaseError("Resultado de Pago ConCasa inválido.");
    }

    const { client } = await requireSupabaseSession();

    const rpcArgs: {
      p_expediente_id: string;
      p_resultado: string;
      p_comentario?: string;
    } = {
      p_expediente_id: idNorm,
      p_resultado: resultado,
    };

    const comentarioNorm = comentario?.trim();
    if (comentarioNorm) {
      rpcArgs.p_comentario = comentarioNorm;
    }

    const { data, error } = await client.rpc("decidir_pago_concasa", rpcArgs);

    if (error) {
      throw mapAvanzarEtapaRpcError(error);
    }

    if (!data || typeof data !== "object") {
      throw new ExpedientesSupabaseError(
        "No se pudo registrar el resultado de Pago ConCasa. Respuesta vacía del servidor.",
      );
    }

    const refreshed = await fetchExpedienteById(idNorm);
    if (!refreshed) {
      throw new ExpedientesSupabaseError(
        "El resultado se guardó, pero no se pudo recargar el expediente.",
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

  async reactivarExpedienteRechazado(
    expedienteId: string,
  ): Promise<ExpedienteMock> {
    const idResult = reingresoExpedienteIdSchema.safeParse(expedienteId);
    if (!idResult.success) {
      throw new ExpedientesSupabaseError(
        "El identificador del expediente no es válido.",
      );
    }

    const { client } = await requireSupabaseSession();
    const { data, error } = await client.rpc("reactivar_expediente_rechazado", {
      p_expediente_id: idResult.data,
    });

    if (error) {
      throw mapReactivacionRpcError(
        error,
        "No se pudo reenviar el expediente a Mesa.",
      );
    }
    if (!data || typeof data !== "object") {
      throw new ExpedientesSupabaseError(
        "La reactivación se registró sin una respuesta válida.",
      );
    }

    const parsed = reactivarExpedienteResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new ExpedientesSupabaseError(
        "La reactivación recibió una respuesta inválida del servidor.",
      );
    }

    const refreshed = await fetchExpedienteById(idResult.data);
    if (!refreshed) {
      throw new ExpedientesSupabaseError(
        "La reactivación se registró, pero no se pudo recargar el expediente.",
      );
    }
    return refreshed;
  }

  async getRechazoOperativoAbierto(
    expedienteId: string,
  ): Promise<{
    abierto: boolean;
    rechazoId: string | null;
    rechazoAt: string | null;
  }> {
    const idResult = reingresoExpedienteIdSchema.safeParse(expedienteId);
    if (!idResult.success) {
      throw new ExpedientesSupabaseError(
        "El identificador del expediente no es válido.",
      );
    }

    const { client } = await requireSupabaseSession();
    const { data: rechazo, error: rechazoError } = await client
      .from("expediente_rechazos_operativos")
      .select("id, created_at")
      .eq("expediente_id", idResult.data)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rechazoError) {
      throw new ExpedientesSupabaseError(
        "No se pudo consultar el rechazo operativo vigente.",
      );
    }
    if (!rechazo?.id) {
      return { abierto: false, rechazoId: null, rechazoAt: null };
    }

    const { data: reactivacion, error: reacError } = await client
      .from("expediente_rechazo_reactivaciones")
      .select("id")
      .eq("rechazo_id", rechazo.id)
      .limit(1)
      .maybeSingle();

    if (reacError) {
      throw new ExpedientesSupabaseError(
        "No se pudo consultar la reactivación del rechazo operativo.",
      );
    }

    const abierto = !reactivacion?.id;
    return {
      abierto,
      rechazoId: String(rechazo.id),
      rechazoAt:
        typeof rechazo.created_at === "string" ? rechazo.created_at : null,
    };
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
