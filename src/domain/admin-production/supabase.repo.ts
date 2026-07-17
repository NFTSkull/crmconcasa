import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import type { AdminMesaEnvioEvent, AdminPrecalEvent, AdminProductionSummary } from "./metrics";
import type {
  AdminAsesorProductionRow,
  AdminEtapaBucket,
  AdminPaginated,
  AdminPrecalSummary,
  AdminProductionFilters,
  AdminProductionRepo,
} from "./repo";

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
  return {
    expedienteId: str(raw.expediente_id),
    fechaEnvioMesa: str(raw.fecha_envio_mesa),
    clienteNombre: str(raw.cliente_nombre),
    asesorId: str(raw.asesor_id),
    asesorNombre: strOrNull(raw.asesor_nombre),
    asesorEmail: strOrNull(raw.asesor_email),
    etapaActual: num(raw.etapa_actual) || 1,
    subestado: str(raw.subestado) || "pendiente",
    cicloEstado: str(raw.ciclo_estado) || "activo",
    programa: str(raw.programa),
    montoAprobadoActual:
      raw.monto_aprobado_actual == null ? null : num(raw.monto_aprobado_actual),
    montoAprobadoAlAprobar:
      raw.monto_aprobado_al_aprobar == null ? null : num(raw.monto_aprobado_al_aprobar),
    updatedAt: strOrNull(raw.updated_at),
  };
}

function mapPrecalItem(raw: Record<string, unknown>): AdminPrecalEvent {
  return {
    expedienteId: str(raw.expediente_id),
    aprobadoAt: str(raw.aprobado_at),
    clienteNombre: str(raw.cliente_nombre),
    asesorId: str(raw.asesor_id),
    asesorNombre: strOrNull(raw.asesor_nombre),
    asesorEmail: strOrNull(raw.asesor_email),
    decision: str(raw.decision),
    montoAprobadoAlAprobar: num(raw.monto_aprobado_al_aprobar),
    montoAprobadoActual:
      raw.monto_aprobado_actual == null ? null : num(raw.monto_aprobado_actual),
    programa: str(raw.programa),
  };
}

function estadoParam(filters: AdminProductionFilters): string | null {
  if (!filters.estado || filters.estado === "todos") return null;
  return filters.estado;
}

export class SupabaseAdminProductionRepo implements AdminProductionRepo {
  async getSummary(filters: AdminProductionFilters): Promise<AdminProductionSummary> {
    const client = requireClient();
    const { data, error } = await client.rpc("admin_get_production_summary", {
      p_from: filters.bounds.fromIso,
      p_to_exclusive: filters.bounds.toExclusiveIso,
      p_asesor_id: filters.asesorId ?? null,
      p_etapa_actual: filters.etapaActual ?? null,
      p_estado: estadoParam(filters),
    });
    if (error) throw new Error(error.message || "No se pudo cargar el resumen Admin");
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      enviadosAMesa: num(row.enviados_a_mesa),
      precalificacionesAprobadas: num(row.precalificaciones_aprobadas),
      aprobadasMayorA20000: num(row.aprobadas_mayor_a_20000),
      montoAprobadoTotal: num(row.monto_aprobado_total),
    };
  }

  async getMesaCohortByEtapa(filters: AdminProductionFilters) {
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
    const { data, error } = await client.rpc("admin_list_production_by_asesor", {
      p_from: filters.bounds.fromIso,
      p_to_exclusive: filters.bounds.toExclusiveIso,
      p_estado: estadoParam(filters),
    });
    if (error) throw new Error(error.message || "No se pudo cargar producción por asesor");
    const arr = Array.isArray(data) ? data : [];
    return arr.map((item) => {
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
        aprobadasMayorA20000: num(r.aprobadas_mayor_a_20000),
        montoAprobadoTotal: num(r.monto_aprobado_total),
        etapas,
      };
    });
  }

  async listMesaEnviosPage(
    filters: AdminProductionFilters,
  ): Promise<AdminPaginated<AdminMesaEnvioEvent>> {
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
      p_decision_filter: filters.precalDecision ?? "todas",
      p_buscar: filters.buscar ?? null,
    });
    if (error) throw new Error(error.message || "No se pudo cargar precalificaciones");
    const row = (data ?? {}) as Record<string, unknown>;
    const sum = (row.summary ?? {}) as Record<string, unknown>;
    const summary: AdminPrecalSummary = {
      total: num(sum.total),
      aprobadas: num(sum.aprobadas),
      aprobadasMayorA20000: num(sum.aprobadas_mayor_a_20000),
      noCumple: num(sum.no_cumple),
      pendientes: num(sum.pendientes),
      montoAprobadoTotal: num(sum.monto_aprobado_total),
      montoPromedioAprobado: num(sum.monto_promedio_aprobado),
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

  async exportAll(filters: AdminProductionFilters) {
    const [summary, asesores, mesaPage, precalPage] = await Promise.all([
      this.getSummary(filters),
      this.listByAsesor(filters),
      this.listMesaEnviosPage({ ...filters, page: 1, pageSize: 100 }),
      this.listPrecalificacionesPage({ ...filters, page: 1, pageSize: 100 }),
    ]);

    const mesaEnvios: AdminMesaEnvioEvent[] = [...mesaPage.items];
    let page = 2;
    while (mesaEnvios.length < mesaPage.totalCount && mesaEnvios.length < 5000) {
      const next = await this.listMesaEnviosPage({ ...filters, page, pageSize: 100 });
      if (next.items.length === 0) break;
      mesaEnvios.push(...next.items);
      page += 1;
    }

    const precalificaciones: AdminPrecalEvent[] = [...precalPage.items];
    page = 2;
    while (
      precalificaciones.length < precalPage.totalCount &&
      precalificaciones.length < 5000
    ) {
      const next = await this.listPrecalificacionesPage({
        ...filters,
        page,
        pageSize: 100,
      });
      if (next.items.length === 0) break;
      precalificaciones.push(...next.items);
      page += 1;
    }

    return {
      summary,
      asesores,
      mesaEnvios: mesaEnvios.slice(0, 5000),
      precalificaciones: precalificaciones.slice(0, 5000),
    };
  }
}
