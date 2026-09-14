import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  resolvePrecalVisibleFecha,
  type AdminPrecalEvent,
  type AdminProductionSummary,
} from "./metrics";
import type {
  AdminAsesorProductionRow,
  AdminPrecalSummary,
  AdminProductionFilters,
} from "./repo";
import { resolveAdminEtapaActualesFilter } from "./repo";
import { adminEstadoRpcParam } from "./admin-estado-filter";
import { SupabaseAdminProductionRepo } from "./supabase.repo";

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

function mapPrecalItem(raw: Record<string, unknown>): AdminPrecalEvent {
  const decision = str(raw.decision);
  const aprobadoAt = strOrNull(raw.aprobado_at);
  const noCumpleAt = strOrNull(raw.no_cumple_at);
  return {
    expedienteId: str(raw.expediente_id),
    fecha:
      strOrNull(raw.fecha) ??
      resolvePrecalVisibleFecha({ decision, aprobadoAt, noCumpleAt }),
    aprobadoAt,
    noCumpleAt,
    clienteNombre: str(raw.cliente_nombre),
    asesorId: str(raw.asesor_id),
    asesorNombre: strOrNull(raw.asesor_nombre),
    asesorEmail: strOrNull(raw.asesor_email),
    decision,
    montoAprobadoAlAprobar:
      raw.monto_aprobado_al_aprobar == null
        ? null
        : num(raw.monto_aprobado_al_aprobar),
    montoAprobadoActual:
      raw.monto_aprobado_actual == null ? null : num(raw.monto_aprobado_actual),
    montoSnapshotNoRecuperable: Boolean(raw.monto_aprobado_snapshot_no_recuperable),
    programa: str(raw.programa),
  };
}

/**
 * Read-model Admin con una sola definición de universo filtrado.
 * Las RPC v2 reciben el arreglo de etapas internas del paso visual seleccionado,
 * por lo que Resumen, Producción, Precalificaciones y Excel quedan alineados.
 */
export class StageAwareSupabaseAdminProductionRepo extends SupabaseAdminProductionRepo {
  override async getMesaCohortByEtapa(filters: AdminProductionFilters) {
    const client = requireClient();
    const { data, error } = await client.rpc("admin_get_mesa_period_by_etapa_v2", {
      p_from: filters.bounds.fromIso,
      p_to_exclusive: filters.bounds.toExclusiveIso,
      p_asesor_id: filters.asesorId ?? null,
      p_estado: adminEstadoRpcParam(filters.estado),
      p_buscar: filters.buscar ?? null,
    });
    if (error) throw new Error(error.message || "No se pudo cargar el desglose por etapa");
    const row = (data ?? {}) as Record<string, unknown>;
    const by = Array.isArray(row.by_etapa) ? row.by_etapa : [];
    return {
      total: num(row.total),
      byEtapa: by.map((item) => {
        const r = item as Record<string, unknown>;
        return { etapa: num(r.etapa), count: num(r.count), pct: num(r.pct) };
      }),
    };
  }

  override async getSummary(
    filters: AdminProductionFilters,
  ): Promise<AdminProductionSummary> {
    const client = requireClient();
    const etapas = resolveAdminEtapaActualesFilter(filters);
    const { data, error } = await client.rpc("admin_get_production_summary_v2", {
      p_from: filters.bounds.fromIso,
      p_to_exclusive: filters.bounds.toExclusiveIso,
      p_asesor_id: filters.asesorId ?? null,
      p_etapas: etapas,
      p_estado: adminEstadoRpcParam(filters.estado),
    });
    if (error) throw new Error(error.message || "No se pudo cargar el resumen Admin");
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      enviadosAMesa: num(row.enviados_a_mesa),
      precalificacionesAprobadas: num(row.precalificaciones_aprobadas),
      precalificacionesNoCumple: num(row.precalificaciones_no_cumple),
      aprobadasMayorA20000: num(row.aprobadas_mayor_a_20000),
      montoAprobadoTotal: num(row.monto_aprobado_total),
    };
  }

  override async listByAsesor(
    filters: AdminProductionFilters,
  ): Promise<AdminAsesorProductionRow[]> {
    const client = requireClient();
    const etapas = resolveAdminEtapaActualesFilter(filters);
    const { data, error } = await client.rpc("admin_list_production_by_asesor_v2", {
      p_from: filters.bounds.fromIso,
      p_to_exclusive: filters.bounds.toExclusiveIso,
      p_estado: adminEstadoRpcParam(filters.estado),
      p_asesor_id: filters.asesorId ?? null,
      p_etapas: etapas,
    });
    if (error) throw new Error(error.message || "No se pudo cargar producción por asesor");
    const arr = Array.isArray(data) ? data : [];
    return arr.map((item) => {
      const r = item as Record<string, unknown>;
      const etapasRaw = (r.etapas ?? {}) as Record<string, unknown>;
      const etapasPorAsesor: Record<string, number> = {};
      for (const [k, v] of Object.entries(etapasRaw)) etapasPorAsesor[k] = num(v);
      return {
        asesorId: str(r.asesor_id),
        asesorNombre: strOrNull(r.asesor_nombre),
        asesorEmail: strOrNull(r.asesor_email),
        enviadosAMesa: num(r.enviados_a_mesa),
        precalificacionesAprobadas: num(r.precalificaciones_aprobadas),
        precalificacionesNoCumple: num(r.precalificaciones_no_cumple),
        aprobadasMayorA20000: num(r.aprobadas_mayor_a_20000),
        montoAprobadoTotal: num(r.monto_aprobado_total),
        etapas: etapasPorAsesor,
      };
    });
  }

  override async listPrecalificacionesPage(filters: AdminProductionFilters) {
    const client = requireClient();
    const etapas = resolveAdminEtapaActualesFilter(filters);
    const { data, error } = await client.rpc("admin_list_precalificaciones_page_v2", {
      p_from: filters.bounds.fromIso,
      p_to_exclusive: filters.bounds.toExclusiveIso,
      p_page: filters.page ?? 1,
      p_page_size: filters.pageSize ?? 25,
      p_asesor_id: filters.asesorId ?? null,
      p_decision_filter: filters.precalDecision ?? "resueltas",
      p_buscar: filters.buscar ?? null,
      p_etapas: etapas,
      p_estado: adminEstadoRpcParam(filters.estado),
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
}
