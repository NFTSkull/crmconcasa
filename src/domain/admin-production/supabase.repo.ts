import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  groupMesaEnviosByEtapaActual,
  resolvePrecalVisibleFecha,
  type AdminMesaEnvioEvent,
  type AdminPrecalEvent,
  type AdminProductionSummary,
} from "./metrics";
import {
  sanitizeAdminMotivo,
  sanitizeAdminTimelineSummary,
} from "./mesa-seguimiento";
import type {
  AdminAsesorProductionRow,
  AdminEtapaBucket,
  AdminPaginated,
  AdminPrecalSummary,
  AdminProductionFilters,
  AdminProductionRepo,
} from "./repo";
import {
  adminEstadoRpcParam,
  matchesAdminEstadoFilter,
} from "./admin-estado-filter";

function requireClient() {
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    throw new Error("Supabase no configurado");
  }
  return supabaseBrowser;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  const s = str(v).trim();
  return s || null;
}

function mapMesaItem(raw: Record<string, unknown>): AdminMesaEnvioEvent {
  const cicloEstado = str(raw.ciclo_estado) || "activo";
  const cancelado = cicloEstado === "cancelado";
  const rechazoOperativo = !cancelado && Boolean(raw.rechazo_operativo);
  return {
    expedienteId: str(raw.expediente_id),
    fechaEnvioMesa: str(raw.fecha_envio_mesa),
    clienteNombre: str(raw.cliente_nombre),
    asesorId: str(raw.asesor_id),
    asesorNombre: strOrNull(raw.asesor_nombre),
    programa: str(raw.programa),
    etapaActual: num(raw.etapa_actual) || 1,
    etapaLabel: str(raw.etapa_label) || String(raw.etapa_actual ?? ""),
    subestado: str(raw.subestado) || "pendiente",
    cicloEstado,
    situacionCode: cancelado
      ? "cancelado_operativo"
      : str(raw.situacion_code) || "continuar_etapa",
    situacionLabel: cancelado
      ? "Cancelado (terminal)"
      : str(raw.situacion_label) || "Continuar etapa actual",
    siguienteAccionLabel: cancelado
      ? "Sin acción operativa"
      : str(raw.siguiente_accion_label) || "Continuar etapa actual",
    siguienteAccionActor: cancelado
      ? "—"
      : str(raw.siguiente_accion_actor) || "Mesa",
    ultimaActividadMesaCode: strOrNull(raw.ultima_actividad_mesa_code),
    ultimaActividadMesaLabel: strOrNull(raw.ultima_actividad_mesa_label),
    ultimaActividadMesaAt: strOrNull(raw.ultima_actividad_mesa_at),
    correccionesAbiertasCount: num(raw.correcciones_abiertas_count),
    correccionAbiertaDesde: strOrNull(raw.correccion_abierta_desde),
    correccionesReenviadasCount: num(raw.correcciones_reenviadas_count),
    correccionReenviadaDesde: strOrNull(raw.correccion_reenviada_desde),
    esperaTipo: strOrNull(raw.espera_tipo),
    esperaLabel: strOrNull(raw.espera_label),
    esperaDesde: strOrNull(raw.espera_desde),
    rechazoOperativo,
    rechazoAt: rechazoOperativo ? strOrNull(raw.rechazo_at) : null,
    rechazoClasificacion: rechazoOperativo
      ? strOrNull(raw.rechazo_clasificacion)
      : null,
    rechazoMotivo: rechazoOperativo
      ? sanitizeAdminMotivo(raw.rechazo_motivo)
      : null,
    reingresoActivo: !cancelado && Boolean(raw.reingreso_activo),
  };
}

function mapPrecalItem(raw: Record<string, unknown>): AdminPrecalEvent {
  const decision = str(raw.decision);
  const aprobadoAt = strOrNull(raw.aprobado_at);
  const noCumpleAt = strOrNull(raw.no_cumple_at);
  const fecha =
    strOrNull(raw.fecha) ??
    resolvePrecalVisibleFecha({ decision, aprobadoAt, noCumpleAt });
  return {
    expedienteId: str(raw.expediente_id),
    fecha,
    aprobadoAt,
    noCumpleAt,
    clienteNombre: str(raw.cliente_nombre),
    asesorId: str(raw.asesor_id),
    asesorNombre: strOrNull(raw.asesor_nombre),
    asesorEmail: strOrNull(raw.asesor_email),
    decision,
    montoAprobadoAlAprobar:
      raw.monto_aprobado_al_aprobar == null ? null : num(raw.monto_aprobado_al_aprobar),
    montoAprobadoActual:
      raw.monto_aprobado_actual == null ? null : num(raw.monto_aprobado_actual),
    montoSnapshotNoRecuperable: Boolean(raw.monto_aprobado_snapshot_no_recuperable),
    programa: str(raw.programa),
  };
}

function estadoParam(filters: AdminProductionFilters): string | null {
  return adminEstadoRpcParam(filters.estado);
}

/** P094: filtros que el SQL legado mezcla y deben resolverse en cliente. */
function needsAdminEstadoClientSplit(
  estado: AdminProductionFilters["estado"],
): boolean {
  return estado === "rechazados" || estado === "cancelados";
}

function applyAdminEstadoClientFilter<
  T extends { cicloEstado: string; subestado: string; etapaActual: number },
>(items: T[], estado: AdminProductionFilters["estado"]): T[] {
  if (!needsAdminEstadoClientSplit(estado)) return items;
  return items.filter((r) =>
    matchesAdminEstadoFilter(
      {
        cicloEstado: r.cicloEstado,
        subestado: r.subestado,
        etapaActual: r.etapaActual,
      },
      estado,
    ),
  );
}

function paginateClient<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): AdminPaginated<T> {
  const p = Math.max(1, page || 1);
  const size = Math.min(100, Math.max(1, pageSize || 25));
  const from = (p - 1) * size;
  return {
    items: items.slice(from, from + size),
    totalCount: items.length,
    page: p,
    pageSize: size,
  };
}

function buildAsesorRowsFromMesa(
  mesa: readonly AdminMesaEnvioEvent[],
  baseRows: readonly AdminAsesorProductionRow[],
  asesorId: string | null | undefined,
): AdminAsesorProductionRow[] {
  const map = new Map<string, AdminAsesorProductionRow>();
  for (const b of baseRows) {
    map.set(b.asesorId, {
      ...b,
      enviadosAMesa: 0,
      etapas: {},
    });
  }
  for (const r of mesa) {
    const prev = map.get(r.asesorId);
    if (!prev) {
      map.set(r.asesorId, {
        asesorId: r.asesorId,
        asesorNombre: r.asesorNombre,
        asesorEmail: null,
        enviadosAMesa: 1,
        precalificacionesAprobadas: 0,
        precalificacionesNoCumple: 0,
        aprobadasMayorA20000: 0,
        montoAprobadoTotal: 0,
        etapas: { [String(r.etapaActual)]: 1 },
      });
      continue;
    }
    map.set(r.asesorId, {
      ...prev,
      asesorNombre: prev.asesorNombre ?? r.asesorNombre,
      enviadosAMesa: prev.enviadosAMesa + 1,
      etapas: {
        ...prev.etapas,
        [String(r.etapaActual)]: (prev.etapas[String(r.etapaActual)] ?? 0) + 1,
      },
    });
  }
  let rows = [...map.values()].sort((a, b) => b.enviadosAMesa - a.enviadosAMesa);
  if (asesorId) rows = rows.filter((r) => r.asesorId === asesorId);
  return rows;
}

export class SupabaseAdminProductionRepo implements AdminProductionRepo {
  async getSummary(filters: AdminProductionFilters): Promise<AdminProductionSummary> {
    const client = requireClient();
    // Precal KPIs no usan p_estado; solo enviados_a_mesa se filtra por estado.
    // Para rechazados/cancelados: precal sin mezcla + enviados desde listado filtrado.
    const rpcEstado = needsAdminEstadoClientSplit(filters.estado)
      ? null
      : estadoParam(filters);
    const { data, error } = await client.rpc("admin_get_production_summary", {
      p_from: filters.bounds.fromIso,
      p_to_exclusive: filters.bounds.toExclusiveIso,
      p_asesor_id: filters.asesorId ?? null,
      p_etapa_actual: filters.etapaActual ?? null,
      p_estado: rpcEstado,
    });
    if (error) throw new Error(error.message || "No se pudo cargar el resumen Admin");
    const row = (data ?? {}) as Record<string, unknown>;
    const base: AdminProductionSummary = {
      enviadosAMesa: num(row.enviados_a_mesa),
      precalificacionesAprobadas: num(row.precalificaciones_aprobadas),
      precalificacionesNoCumple: num(row.precalificaciones_no_cumple),
      aprobadasMayorA20000: num(row.aprobadas_mayor_a_20000),
      montoAprobadoTotal: num(row.monto_aprobado_total),
    };
    if (!needsAdminEstadoClientSplit(filters.estado)) return base;
    const mesa = await this.listAllMesaEnviosSplit(filters);
    return { ...base, enviadosAMesa: mesa.length };
  }

  async getMesaCohortByEtapa(filters: AdminProductionFilters) {
    if (needsAdminEstadoClientSplit(filters.estado)) {
      const rows = await this.listAllMesaEnviosSplit({
        ...filters,
        etapaActual: null,
      });
      return { total: rows.length, byEtapa: groupMesaEnviosByEtapaActual(rows) };
    }
    const client = requireClient();
    const { data, error } = await client.rpc("admin_get_mesa_cohort_by_etapa", {
      p_from: filters.bounds.fromIso,
      p_to_exclusive: filters.bounds.toExclusiveIso,
      p_asesor_id: filters.asesorId ?? null,
      p_estado: estadoParam(filters),
    });
    if (error) throw new Error(error.message || "No se pudo cargar el estado por etapa");
    const row = (data ?? {}) as Record<string, unknown>;
    const by = Array.isArray(row.by_etapa) ? row.by_etapa : [];
    const byEtapa: AdminEtapaBucket[] = by.map((item) => {
      const r = item as Record<string, unknown>;
      return { etapa: num(r.etapa), count: num(r.count), pct: num(r.pct) };
    });
    return { total: num(row.total), byEtapa };
  }

  async listByAsesor(filters: AdminProductionFilters): Promise<AdminAsesorProductionRow[]> {
    const client = requireClient();
    const rpcEstado = needsAdminEstadoClientSplit(filters.estado)
      ? null
      : estadoParam(filters);
    const { data, error } = await client.rpc("admin_list_production_by_asesor", {
      p_from: filters.bounds.fromIso,
      p_to_exclusive: filters.bounds.toExclusiveIso,
      p_estado: rpcEstado,
      p_asesor_id: filters.asesorId ?? null,
    });
    if (error) throw new Error(error.message || "No se pudo cargar producción por asesor");
    const arr = Array.isArray(data) ? data : [];
    const baseRows: AdminAsesorProductionRow[] = arr.map((item) => {
      const r = item as Record<string, unknown>;
      const etapasRaw = (r.etapas ?? {}) as Record<string, unknown>;
      const etapas: Record<string, number> = {};
      for (const [k, v] of Object.entries(etapasRaw)) etapas[k] = num(v);
      return {
        asesorId: str(r.asesor_id),
        asesorNombre: strOrNull(r.asesor_nombre),
        asesorEmail: strOrNull(r.asesor_email),
        enviadosAMesa: num(r.enviados_a_mesa),
        precalificacionesAprobadas: num(r.precalificaciones_aprobadas),
        precalificacionesNoCumple: num(r.precalificaciones_no_cumple),
        aprobadasMayorA20000: num(r.aprobadas_mayor_a_20000),
        montoAprobadoTotal: num(r.monto_aprobado_total),
        etapas,
      };
    });
    if (!needsAdminEstadoClientSplit(filters.estado)) return baseRows;
    const mesa = await this.listAllMesaEnviosSplit({
      ...filters,
      etapaActual: null,
    });
    return buildAsesorRowsFromMesa(mesa, baseRows, filters.asesorId);
  }

  async listMesaEnviosPage(
    filters: AdminProductionFilters,
  ): Promise<AdminPaginated<AdminMesaEnvioEvent>> {
    if (needsAdminEstadoClientSplit(filters.estado)) {
      const all = await this.listAllMesaEnviosSplit(filters);
      return paginateClient(all, filters.page ?? 1, filters.pageSize ?? 25);
    }
    const client = requireClient();
    const { data, error } = await client.rpc("admin_list_mesa_envios_page", {
      p_from: filters.bounds.fromIso,
      p_to_exclusive: filters.bounds.toExclusiveIso,
      p_page: filters.page ?? 1,
      p_page_size: filters.pageSize ?? 25,
      p_asesor_id: filters.asesorId ?? null,
      p_etapa_actual: filters.etapaActual ?? null,
      p_estado: estadoParam(filters),
      p_buscar: filters.buscar ?? null,
    });
    if (error) throw new Error(error.message || "No se pudo cargar enviados a Mesa");
    const row = (data ?? {}) as Record<string, unknown>;
    const items = (Array.isArray(row.items) ? row.items : []).map((x) =>
      mapMesaItem(x as Record<string, unknown>),
    );
    return {
      items,
      totalCount: num(row.total_count),
      page: num(row.page) || 1,
      pageSize: num(row.page_size) || 25,
    };
  }

  async listPrecalificacionesPage(filters: AdminProductionFilters) {
    const client = requireClient();
    const { data, error } = await client.rpc("admin_list_precalificaciones_page", {
      p_from: filters.bounds.fromIso,
      p_to_exclusive: filters.bounds.toExclusiveIso,
      p_page: filters.page ?? 1,
      p_page_size: filters.pageSize ?? 25,
      p_asesor_id: filters.asesorId ?? null,
      p_decision_filter: filters.precalDecision ?? "resueltas",
      p_buscar: filters.buscar ?? null,
    });
    if (error) throw new Error(error.message || "No se pudo cargar precalificaciones");
    const row = (data ?? {}) as Record<string, unknown>;
    const sum = (row.summary ?? {}) as Record<string, unknown>;
    const summary: AdminPrecalSummary = {
      resueltasCount: num(sum.resueltas_count),
      aprobadasCount: num(sum.aprobadas_count),
      noCumpleCount: num(sum.no_cumple_count),
      pendientesActualesCount: num(sum.pendientes_actuales_count),
      mayores20000Count: num(sum.mayores_20000_count),
      mejoravitAprobadasCount: num(sum.mejoravit_aprobadas_count),
      montoMejoravitTotal: num(sum.monto_mejoravit_total),
      montoMejoravitPromedio: num(sum.monto_mejoravit_promedio),
    };
    const items = (Array.isArray(row.items) ? row.items : []).map((x) =>
      mapPrecalItem(x as Record<string, unknown>),
    );
    return {
      items,
      totalCount: num(row.total_count),
      page: num(row.page) || 1,
      pageSize: num(row.page_size) || 25,
      summary,
    };
  }

  async getExpedienteMesaTimeline(input: {
    expedienteId: string;
    limit?: number;
    offset?: number;
  }) {
    const client = requireClient();
    const { data, error } = await client.rpc("admin_get_expediente_mesa_timeline", {
      p_expediente_id: input.expedienteId,
      p_limit: input.limit ?? 10,
      p_offset: input.offset ?? 0,
    });
    if (error) throw new Error(error.message || "No se pudo cargar el seguimiento");
    const row = (data ?? {}) as Record<string, unknown>;
    const itemsRaw = Array.isArray(row.items) ? row.items : [];
    return {
      expedienteId: str(row.expediente_id) || input.expedienteId,
      totalCount: num(row.total_count),
      limit: num(row.limit) || (input.limit ?? 10),
      offset: num(row.offset) || (input.offset ?? 0),
      hasMore: Boolean(row.has_more),
      items: itemsRaw.map((item) => {
        const r = item as Record<string, unknown>;
        const summaryRaw =
          r.summary && typeof r.summary === "object" && !Array.isArray(r.summary)
            ? (r.summary as Record<string, unknown>)
            : {};
        return {
          at: str(r.at),
          action: str(r.action),
          actorGeneral: strOrNull(r.actor_general),
          summary: sanitizeAdminTimelineSummary(summaryRaw),
        };
      }),
    };
  }

  async exportAll(filters: AdminProductionFilters) {
    const pageSize = 100;
    const [summary, asesores, mesaFirst, precalFirst] = await Promise.all([
      this.getSummary(filters),
      this.listByAsesor(filters),
      this.listMesaEnviosPage({ ...filters, page: 1, pageSize }),
      this.listPrecalificacionesPage({ ...filters, page: 1, pageSize }),
    ]);

    const mesaEnvios = await this.fetchAllPages(
      mesaFirst,
      (page) => this.listMesaEnviosPage({ ...filters, page, pageSize }),
      "enviados a Mesa",
    );
    const precalificaciones = await this.fetchAllPages(
      precalFirst,
      (page) => this.listPrecalificacionesPage({ ...filters, page, pageSize }),
      "precalificaciones",
    );

    return {
      summary,
      asesores,
      mesaEnvios,
      precalificaciones,
      precalSummary: precalFirst.summary,
    };
  }

  /**
   * Carga el bucket legado SQL `rechazados` (mezcla) y aplica predicado P094
   * en cliente. Usado solo para filtros `rechazados` / `cancelados`.
   */
  private async listAllMesaEnviosSplit(
    filters: AdminProductionFilters,
  ): Promise<AdminMesaEnvioEvent[]> {
    const raw = await this.fetchAllMesaEnviosRaw(filters, "rechazados");
    return applyAdminEstadoClientFilter(raw, filters.estado);
  }

  private async fetchAllMesaEnviosRaw(
    filters: AdminProductionFilters,
    rpcEstado: string | null,
  ): Promise<AdminMesaEnvioEvent[]> {
    const client = requireClient();
    const pageSize = 100;
    const all: AdminMesaEnvioEvent[] = [];
    let page = 1;
    let expected = Infinity;
    while (all.length < expected) {
      const { data, error } = await client.rpc("admin_list_mesa_envios_page", {
        p_from: filters.bounds.fromIso,
        p_to_exclusive: filters.bounds.toExclusiveIso,
        p_page: page,
        p_page_size: pageSize,
        p_asesor_id: filters.asesorId ?? null,
        p_etapa_actual: filters.etapaActual ?? null,
        p_estado: rpcEstado,
        p_buscar: filters.buscar ?? null,
      });
      if (error) throw new Error(error.message || "No se pudo cargar enviados a Mesa");
      const row = (data ?? {}) as Record<string, unknown>;
      expected = num(row.total_count);
      const batch = (Array.isArray(row.items) ? row.items : []).map((x) =>
        mapMesaItem(x as Record<string, unknown>),
      );
      if (batch.length === 0) break;
      all.push(...batch);
      page += 1;
      if (page > 10_000) {
        throw new Error("Listado Mesa Admin: demasiadas páginas al separar estado.");
      }
    }
    return all;
  }

  private async fetchAllPages<T>(
    first: AdminPaginated<T>,
    fetchPage: (page: number) => Promise<AdminPaginated<T>>,
    label: string,
  ): Promise<T[]> {
    const expected = first.totalCount;
    const items: T[] = [...first.items];
    let page = 2;
    while (items.length < expected) {
      const next = await fetchPage(page);
      if (next.totalCount !== expected) {
        throw new Error(
          `Exportación abortada de ${label}: total_count cambió (${expected}→${next.totalCount}). Reintenta.`,
        );
      }
      if (next.items.length === 0) break;
      items.push(...next.items);
      page += 1;
      if (page > 10_000) {
        throw new Error(`Exportación abortada de ${label}: demasiadas páginas.`);
      }
    }
    if (items.length !== expected) {
      throw new Error(
        `Exportación incompleta de ${label}: recuperadas ${items.length} de ${expected}. Reintenta.`,
      );
    }
    return items;
  }
}
