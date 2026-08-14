import type { ExpedientesRepo } from "@/domain/expedientes/repo";
import type { ExpedienteMock } from "@/domain/expedientes/mock.repo";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";
import {
  computeAdminPrecalSummary,
  computeAdminProductionSummary,
  emptyAdminMesaSeguimientoFields,
  groupMesaEnviosByEtapaActual,
  resolvePrecalVisibleFecha,
  type AdminMesaEnvioEvent,
  type AdminPrecalEvent,
} from "./metrics";
import { formatAdminMesaAsesorLabel } from "./mesa-seguimiento";
import { isInstantInPeriod } from "./period";
import type {
  AdminAsesorProductionRow,
  AdminPaginated,
  AdminProductionFilters,
  AdminProductionRepo,
  AdminSnapshotEtapasResult,
  AdminSnapshotFilters,
} from "./repo";
import { matchesAdminEtapaActualFilter } from "./repo";
import { matchesAdminEstadoFilter } from "./admin-estado-filter";
import {
  ADMIN_CLIENTE_SEARCH_DEFAULT_LIMIT,
  clampAdminClienteSearchLimit,
  isAdminClienteSearchQueryActive,
  matchesAdminClienteSearchQuery,
  type AdminClienteSearchInput,
  type AdminClienteSearchItem,
  type AdminClienteSearchResult,
} from "./admin-cliente-search";
import { mapEtapaInternaAPasoVisual } from "@/domain/expedientes/asesor-seguimiento-operativo";

/** Paridad SQL admin `p_buscar`: cliente / asesor / programa / NSS. */
export function matchesAdminProductionBuscar(
  buscar: string | null | undefined,
  fields: {
    clienteNombre: string;
    asesorLabel: string;
    programa: string;
    nss?: string | null;
  },
): boolean {
  const q = buscar?.trim().toLowerCase() ?? "";
  if (!q) return true;
  const nss = String(fields.nss ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
  const qDigits = q.replace(/\s+/g, "");
  return (
    fields.clienteNombre.toLowerCase().includes(q) ||
    fields.asesorLabel.toLowerCase().includes(q) ||
    fields.programa.toLowerCase().includes(q) ||
    (nss.length > 0 && nss.includes(qDigits))
  );
}

function mapSnapshot(e: ExpedienteMock): AdminMesaEnvioEvent {
  const fecha = e.operativo.fechaEnvioMesa ?? e.base.createdAt ?? "";
  const subestado = e.operativo.subestado ?? "pendiente";
  const cicloEstado = e.operativo.cicloEstado ?? "activo";
  const etapaActual = e.operativo.etapaActual ?? 1;
  const cancelado = cicloEstado === "cancelado";
  const rechazoOperativo = !cancelado && subestado === "rechazado";
  const defaults = emptyAdminMesaSeguimientoFields(fecha || new Date(0).toISOString());
  return {
    expedienteId: e.id,
    fechaEnvioMesa: e.operativo.fechaEnvioMesa ?? "",
    clienteNombre: e.base.cliente_nombre,
    asesorId: e.base.asesorId,
    asesorNombre: e.base.asesorNombre ?? null,
    programa: e.base.programa,
    etapaActual,
    subestado,
    cicloEstado,
    ...defaults,
    rechazoOperativo,
    rechazoMotivo: rechazoOperativo
      ? (e.operativo.motivoRechazo ?? "Sin motivo registrado")
      : null,
    situacionCode: cancelado
      ? "cancelado_operativo"
      : rechazoOperativo
        ? "rechazo_operativo"
        : defaults.situacionCode,
    situacionLabel: cancelado
      ? "Cancelado (terminal)"
      : rechazoOperativo
        ? "Rechazado operativamente"
        : defaults.situacionLabel,
    siguienteAccionLabel: cancelado
      ? "Sin acción operativa"
      : rechazoOperativo
        ? "Revisar reingreso"
        : defaults.siguienteAccionLabel,
    siguienteAccionActor: cancelado
      ? "—"
      : rechazoOperativo
        ? "Asesor"
        : defaults.siguienteAccionActor,
  };
}

function mapMesa(e: ExpedienteMock): AdminMesaEnvioEvent | null {
  const fecha = e.operativo.fechaEnvioMesa;
  if (!e.operativo.submittedToMesa || !fecha) return null;
  const subestado = e.operativo.subestado ?? "pendiente";
  const cicloEstado = e.operativo.cicloEstado ?? "activo";
  const etapaActual = e.operativo.etapaActual ?? 1;
  const cancelado = cicloEstado === "cancelado";
  const rechazoOperativo = !cancelado && subestado === "rechazado";
  const defaults = emptyAdminMesaSeguimientoFields(fecha);
  return {
    expedienteId: e.id,
    fechaEnvioMesa: fecha,
    clienteNombre: e.base.cliente_nombre,
    asesorId: e.base.asesorId,
    asesorNombre: e.base.asesorNombre ?? null,
    programa: e.base.programa,
    etapaActual,
    subestado,
    cicloEstado,
    ...defaults,
    rechazoOperativo,
    rechazoMotivo: rechazoOperativo
      ? (e.operativo.motivoRechazo ?? "Sin motivo registrado")
      : null,
    situacionCode: cancelado
      ? "cancelado_operativo"
      : rechazoOperativo
        ? "rechazo_operativo"
        : defaults.situacionCode,
    situacionLabel: cancelado
      ? "Cancelado (terminal)"
      : rechazoOperativo
        ? "Rechazado operativamente"
        : defaults.situacionLabel,
    siguienteAccionLabel: cancelado
      ? "Sin acción operativa"
      : rechazoOperativo
        ? "Revisar reingreso"
        : defaults.siguienteAccionLabel,
    siguienteAccionActor: cancelado
      ? "—"
      : rechazoOperativo
        ? "Asesor"
        : defaults.siguienteAccionActor,
  };
}

function mapPrecal(e: ExpedienteMock): AdminPrecalEvent {
  const decision = e.editorDecision.decision;
  const aprobadoAt = e.editorDecision.aprobadoAt ?? null;
  const noCumpleAt = e.editorDecision.noCumpleAt ?? null;
  const montoRaw = e.editorDecision.montoAprobadoAlAprobar;
  const monto =
    typeof montoRaw === "number" && Number.isFinite(montoRaw) && montoRaw > 0
      ? montoRaw
      : null;
  return {
    expedienteId: e.id,
    fecha: resolvePrecalVisibleFecha({ decision, aprobadoAt, noCumpleAt }),
    aprobadoAt,
    noCumpleAt,
    clienteNombre: e.base.cliente_nombre,
    asesorId: e.base.asesorId,
    asesorNombre: e.base.asesorNombre ?? null,
    asesorEmail: e.base.asesorEmail ?? null,
    decision,
    montoAprobadoAlAprobar: monto,
    montoAprobadoActual: e.editorDecision.monto_aprobado,
    montoSnapshotNoRecuperable: Boolean(
      (e.editorDecision as { montoSnapshotNoRecuperable?: boolean })
        .montoSnapshotNoRecuperable,
    ),
    programa: e.base.programa,
  };
}

function asesorLabel(nombre: string | null, email: string | null, id: string): string {
  return formatAsesorExpedienteLabel({ fullName: nombre, email, fallbackId: id });
}

function paginate<T>(items: readonly T[], page: number, pageSize: number): AdminPaginated<T> {
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

function matchesPrecalFilter(
  r: AdminPrecalEvent,
  dec: NonNullable<AdminProductionFilters["precalDecision"]>,
  bounds: AdminProductionFilters["bounds"],
): boolean {
  if (dec === "pendientes") return r.decision === "pendiente";

  const isAprobadaPeriodo =
    r.decision === "aprobado" &&
    !!r.aprobadoAt &&
    isInstantInPeriod(r.aprobadoAt, bounds);
  const isNoCumplePeriodo =
    r.decision === "no_cumple" &&
    !!r.noCumpleAt &&
    isInstantInPeriod(r.noCumpleAt, bounds);

  if (dec === "aprobadas") return isAprobadaPeriodo;
  if (dec === "no_cumple") return isNoCumplePeriodo;
  if (dec === "resueltas") return isAprobadaPeriodo || isNoCumplePeriodo;
  if (dec === "todas") {
    return isAprobadaPeriodo || isNoCumplePeriodo || r.decision === "pendiente";
  }
  return isAprobadaPeriodo || isNoCumplePeriodo;
}

export class MockAdminProductionRepo implements AdminProductionRepo {
  constructor(private readonly expedientesRepo: ExpedientesRepo) {}

  private async loadAll(): Promise<ExpedienteMock[]> {
    return this.expedientesRepo.listForAdmin();
  }

  private filterMesa(
    all: ExpedienteMock[],
    filters: AdminProductionFilters,
  ): AdminMesaEnvioEvent[] {
    const buscar = filters.buscar?.trim().toLowerCase() ?? "";
    return all
      .map(mapMesa)
      .filter((r): r is AdminMesaEnvioEvent => r != null)
      .filter((r) => isInstantInPeriod(r.fechaEnvioMesa, filters.bounds))
      .filter((r) => !filters.asesorId || r.asesorId === filters.asesorId)
      .filter((r) => matchesAdminEtapaActualFilter(r.etapaActual, filters))
      .filter((r) =>
        matchesAdminEstadoFilter(
          {
            cicloEstado: r.cicloEstado,
            subestado: r.subestado,
            etapaActual: r.etapaActual,
          },
          filters.estado,
        ),
      )
      .filter((r) => {
        if (!buscar) return true;
        const label = formatAdminMesaAsesorLabel(r.asesorNombre).toLowerCase();
        const exp = all.find((e) => e.id === r.expedienteId);
        return matchesAdminProductionBuscar(buscar, {
          clienteNombre: r.clienteNombre,
          asesorLabel: label,
          programa: r.programa,
          nss: exp?.base.nss,
        });
      })
      .sort((a, b) => Date.parse(b.fechaEnvioMesa) - Date.parse(a.fechaEnvioMesa));
  }

  private filterPrecal(
    all: ExpedienteMock[],
    filters: AdminProductionFilters,
  ): AdminPrecalEvent[] {
    const buscar = filters.buscar?.trim().toLowerCase() ?? "";
    const dec = filters.precalDecision ?? "resueltas";
    return all
      .map(mapPrecal)
      .filter((r) => !filters.asesorId || r.asesorId === filters.asesorId)
      .filter((r) => matchesPrecalFilter(r, dec, filters.bounds))
      .filter((r) => {
        if (!buscar) return true;
        const label = asesorLabel(r.asesorNombre, r.asesorEmail, r.asesorId).toLowerCase();
        const exp = all.find((e) => e.id === r.expedienteId);
        return matchesAdminProductionBuscar(buscar, {
          clienteNombre: r.clienteNombre,
          asesorLabel: label,
          programa: r.programa,
          nss: exp?.base.nss,
        });
      })
      .sort((a, b) => {
        const ta = a.fecha ? Date.parse(a.fecha) : 0;
        const tb = b.fecha ? Date.parse(b.fecha) : 0;
        return tb - ta;
      });
  }

  async searchClienteExpedientes(
    input: AdminClienteSearchInput,
  ): Promise<AdminClienteSearchResult> {
    const limit = clampAdminClienteSearchLimit(
      input.limit ?? ADMIN_CLIENTE_SEARCH_DEFAULT_LIMIT,
    );
    if (!isAdminClienteSearchQueryActive(input.buscar)) {
      return { items: [], truncated: false, limit };
    }
    const all = await this.loadAll();
    const matched = all
      .filter((e) => !input.asesorId || e.base.asesorId === input.asesorId)
      .filter((e) =>
        matchesAdminClienteSearchQuery(input.buscar, {
          clienteNombre: e.base.cliente_nombre,
          nss: e.base.nss,
          asesorNombre: e.base.asesorNombre,
          asesorEmail: e.base.asesorEmail,
          programa: e.base.programa,
        }),
      )
      .sort((a, b) => {
        const ua = Date.parse(a.operativo.updatedAt ?? a.base.createdAt);
        const ub = Date.parse(b.operativo.updatedAt ?? b.base.createdAt);
        if (ub !== ua) return ub - ua;
        const ca = Date.parse(a.base.createdAt);
        const cb = Date.parse(b.base.createdAt);
        if (cb !== ca) return cb - ca;
        return b.id.localeCompare(a.id);
      });
    const truncated = matched.length > limit;
    const items: AdminClienteSearchItem[] = matched.slice(0, limit).map((e) => ({
      expedienteId: e.id,
      clienteNombre: e.base.cliente_nombre,
      nss: e.base.nss,
      asesorId: e.base.asesorId,
      asesorNombre: e.base.asesorNombre ?? null,
      asesorEmail: e.base.asesorEmail ?? null,
      programa: e.base.programa,
      createdAt: e.base.createdAt,
      updatedAt: e.operativo.updatedAt,
      cicloEstado: e.operativo.cicloEstado ?? "activo",
      submittedToMesa: Boolean(e.operativo.submittedToMesa),
      fechaEnvioMesa: e.operativo.fechaEnvioMesa,
      etapaActual: e.operativo.etapaActual ?? 1,
      subestado: e.operativo.subestado,
      editorDecision: e.editorDecision.decision,
      montoAprobado: e.editorDecision.monto_aprobado,
      aprobadoAt: e.editorDecision.aprobadoAt ?? null,
      noCumpleAt: e.editorDecision.noCumpleAt ?? null,
      reprecalificacionPendienteId: e.reprecalificacionPendienteId ?? null,
      precalPending: Boolean(e.reprecalificacionPendienteId),
      programaSolicitado: e.reprecalificacionPendiente?.programaSolicitado ?? null,
    }));
    return { items, truncated, limit };
  }

  async getSummary(filters: AdminProductionFilters) {
    const all = await this.loadAll();
    return computeAdminProductionSummary({
      bounds: filters.bounds,
      mesaEnvios: this.filterMesa(all, filters),
      precalRows: all.map(mapPrecal),
      asesorId: filters.asesorId,
      // Ya filtrado en mesaEnvios (soporta Paso 3 → [3,4]).
      etapaActual: null,
    });
  }

  async getMesaCohortByEtapa(filters: AdminProductionFilters) {
    const rows = this.filterMesa(await this.loadAll(), {
      ...filters,
      etapaActual: null,
      etapaActuales: null,
    });
    const byEtapa = groupMesaEnviosByEtapaActual(rows);
    return { total: rows.length, byEtapa };
  }

  private filterSnapshot(
    all: ExpedienteMock[],
    filters: AdminSnapshotFilters,
  ): AdminMesaEnvioEvent[] {
    const buscar = filters.buscar?.trim().toLowerCase() ?? "";
    return all
      .filter((e) => {
        // Misma def. KPI enviados a Mesa, sin rango: Integración solo si ya enviado.
        const et = e.operativo.etapaActual ?? 1;
        if (et !== 1) return true;
        return Boolean(e.operativo.submittedToMesa && e.operativo.fechaEnvioMesa);
      })
      .map(mapSnapshot)
      .filter((r) => !filters.asesorId || r.asesorId === filters.asesorId)
      .filter((r) => matchesAdminEtapaActualFilter(r.etapaActual, filters))
      .filter((r) =>
        matchesAdminEstadoFilter(
          {
            cicloEstado: r.cicloEstado,
            subestado: r.subestado,
            etapaActual: r.etapaActual,
          },
          filters.estado,
        ),
      )
      .filter((r) => {
        if (!buscar) return true;
        const label = formatAdminMesaAsesorLabel(r.asesorNombre).toLowerCase();
        const exp = all.find((e) => e.id === r.expedienteId);
        return matchesAdminProductionBuscar(buscar, {
          clienteNombre: r.clienteNombre,
          asesorLabel: label,
          programa: r.programa,
          nss: exp?.base.nss,
        });
      })
      .sort((a, b) => {
        const ta = Date.parse(a.fechaEnvioMesa) || 0;
        const tb = Date.parse(b.fechaEnvioMesa) || 0;
        return tb - ta;
      });
  }

  async getExpedientesSnapshotEtapas(
    filters: AdminSnapshotFilters,
  ): Promise<AdminSnapshotEtapasResult> {
    const rows = this.filterSnapshot(await this.loadAll(), {
      ...filters,
      etapaActual: null,
      etapaActuales: null,
    });
    const byEtapa = groupMesaEnviosByEtapaActual(rows);
    const pasoCounts = new Map<number, number>();
    for (const r of rows) {
      const paso = mapEtapaInternaAPasoVisual(r.etapaActual);
      pasoCounts.set(paso, (pasoCounts.get(paso) ?? 0) + 1);
    }
    const total = rows.length;
    const byPasoVisual = Array.from({ length: 11 }, (_, i) => {
      const pasoVisual = i + 1;
      const count = pasoCounts.get(pasoVisual) ?? 0;
      return {
        pasoVisual,
        count,
        pct: total === 0 ? 0 : Math.round((count * 1000) / total) / 10,
      };
    });
    return {
      totalActual: total,
      byEtapa,
      byPasoVisual,
      generatedAt: new Date().toISOString(),
    };
  }

  async listExpedientesSnapshotPage(filters: AdminSnapshotFilters) {
    return paginate(
      this.filterSnapshot(await this.loadAll(), filters),
      filters.page ?? 1,
      filters.pageSize ?? 25,
    );
  }

  async listByAsesor(filters: AdminProductionFilters) {
    const all = await this.loadAll();
    const mesa = this.filterMesa(all, {
      ...filters,
      etapaActual: null,
      etapaActuales: null,
    });
    const precal = all
      .map(mapPrecal)
      .filter((r) => !filters.asesorId || r.asesorId === filters.asesorId);
    const map = new Map<string, AdminAsesorProductionRow>();

    const ensure = (id: string, nombre: string | null, email: string | null) => {
      let row = map.get(id);
      if (!row) {
        row = {
          asesorId: id,
          asesorNombre: nombre,
          asesorEmail: email,
          enviadosAMesa: 0,
          precalificacionesAprobadas: 0,
          precalificacionesNoCumple: 0,
          aprobadasMayorA20000: 0,
          montoAprobadoTotal: 0,
          etapas: {},
        };
        map.set(id, row);
      } else if ((email && !row.asesorEmail) || (nombre && !row.asesorNombre)) {
        row = {
          ...row,
          asesorNombre: row.asesorNombre ?? nombre,
          asesorEmail: row.asesorEmail ?? email,
        };
        map.set(id, row);
      }
      return row;
    };

    for (const r of mesa) {
      const row = ensure(r.asesorId, r.asesorNombre, null);
      map.set(r.asesorId, {
        ...row,
        enviadosAMesa: row.enviadosAMesa + 1,
        etapas: {
          ...row.etapas,
          [String(r.etapaActual)]: (row.etapas[String(r.etapaActual)] ?? 0) + 1,
        },
      });
    }

    const summaryByAsesor = new Map<string, ReturnType<typeof computeAdminProductionSummary>>();
    for (const r of precal) {
      ensure(r.asesorId, r.asesorNombre, r.asesorEmail);
      if (!summaryByAsesor.has(r.asesorId)) {
        summaryByAsesor.set(
          r.asesorId,
          computeAdminProductionSummary({
            bounds: filters.bounds,
            mesaEnvios: [],
            precalRows: precal.filter((x) => x.asesorId === r.asesorId),
          }),
        );
      }
    }
    for (const [id, s] of summaryByAsesor) {
      const row = map.get(id);
      if (!row) continue;
      map.set(id, {
        ...row,
        precalificacionesAprobadas: s.precalificacionesAprobadas,
        precalificacionesNoCumple: s.precalificacionesNoCumple,
        aprobadasMayorA20000: s.aprobadasMayorA20000,
        montoAprobadoTotal: s.montoAprobadoTotal,
      });
    }

    let rows = [...map.values()].sort((a, b) => b.enviadosAMesa - a.enviadosAMesa);
    if (filters.asesorId) {
      rows = rows.filter((r) => r.asesorId === filters.asesorId);
    }
    return rows;
  }

  async listMesaEnviosPage(filters: AdminProductionFilters) {
    return paginate(
      this.filterMesa(await this.loadAll(), filters),
      filters.page ?? 1,
      filters.pageSize ?? 25,
    );
  }

  async listPrecalificacionesPage(filters: AdminProductionFilters) {
    const rows = this.filterPrecal(await this.loadAll(), filters);
    const page = paginate(rows, filters.page ?? 1, filters.pageSize ?? 25);
    return { ...page, summary: computeAdminPrecalSummary(rows) };
  }

  async getExpedienteMesaTimeline(input: {
    expedienteId: string;
    limit?: number;
    offset?: number;
  }) {
    const all = await this.loadAll();
    const exp = all.find((e) => e.id === input.expedienteId);
    const fecha = exp?.operativo.fechaEnvioMesa ?? null;
    const items =
      fecha && exp?.operativo.submittedToMesa
        ? [
            {
              at: fecha,
              action: "expediente.enviar_a_mesa",
              actorGeneral: "Asesor",
              summary: {} as Record<string, string | null>,
            },
          ]
        : [];
    const limit = Math.min(100, Math.max(1, input.limit ?? 10));
    const offset = Math.max(0, input.offset ?? 0);
    const pageItems = items.slice(offset, offset + limit);
    return {
      expedienteId: input.expedienteId,
      totalCount: items.length,
      limit,
      offset,
      hasMore: offset + pageItems.length < items.length,
      items: pageItems,
    };
  }

  async exportAll(filters: AdminProductionFilters) {
    const all = await this.loadAll();
    const mesaEnvios = this.filterMesa(all, filters);
    const precalificaciones = this.filterPrecal(all, {
      ...filters,
      precalDecision: filters.precalDecision ?? "resueltas",
    });
    const asesores = await this.listByAsesor(filters);
    const summary = await this.getSummary(filters);
    const precalSummary = computeAdminPrecalSummary(precalificaciones);
    return { mesaEnvios, precalificaciones, asesores, summary, precalSummary };
  }
}
