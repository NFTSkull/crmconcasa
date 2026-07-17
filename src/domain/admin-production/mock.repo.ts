import type { ExpedientesRepo } from "@/domain/expedientes/repo";
import type { ExpedienteMock } from "@/domain/expedientes/mock.repo";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";
import {
  computeAdminPrecalSummary,
  computeAdminProductionSummary,
  groupMesaEnviosByEtapaActual,
  resolvePrecalVisibleFecha,
  type AdminMesaEnvioEvent,
  type AdminPrecalEvent,
} from "./metrics";
import { isInstantInPeriod } from "./period";
import type {
  AdminAsesorProductionRow,
  AdminPaginated,
  AdminProductionFilters,
  AdminProductionRepo,
} from "./repo";

function matchesEstado(
  row: { cicloEstado: string; subestado: string; etapaActual: number },
  estado: AdminProductionFilters["estado"],
): boolean {
  if (!estado || estado === "todos") return true;
  if (estado === "activos") {
    return row.cicloEstado === "activo" && row.subestado !== "rechazado";
  }
  if (estado === "finalizados") {
    return row.cicloEstado === "cerrado" || row.etapaActual >= 11;
  }
  if (estado === "rechazados") {
    return row.subestado === "rechazado" || row.cicloEstado === "cancelado";
  }
  return true;
}

function mapMesa(e: ExpedienteMock): AdminMesaEnvioEvent | null {
  const fecha = e.operativo.fechaEnvioMesa;
  if (!e.operativo.submittedToMesa || !fecha) return null;
  return {
    expedienteId: e.id,
    fechaEnvioMesa: fecha,
    clienteNombre: e.base.cliente_nombre,
    asesorId: e.base.asesorId,
    asesorNombre: e.base.asesorNombre ?? null,
    asesorEmail: e.base.asesorEmail ?? null,
    etapaActual: e.operativo.etapaActual ?? 1,
    subestado: e.operativo.subestado ?? "pendiente",
    cicloEstado: e.operativo.cicloEstado ?? "activo",
    programa: e.base.programa,
    montoAprobadoActual: e.editorDecision.monto_aprobado,
    montoAprobadoAlAprobar: e.editorDecision.montoAprobadoAlAprobar ?? null,
    updatedAt: e.operativo.updatedAt,
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
      .filter((r) => filters.etapaActual == null || r.etapaActual === filters.etapaActual)
      .filter((r) =>
        matchesEstado(
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
        const label = asesorLabel(r.asesorNombre, r.asesorEmail, r.asesorId).toLowerCase();
        return (
          r.clienteNombre.toLowerCase().includes(buscar) ||
          label.includes(buscar) ||
          r.programa.toLowerCase().includes(buscar)
        );
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
        return (
          r.clienteNombre.toLowerCase().includes(buscar) ||
          label.includes(buscar) ||
          r.programa.toLowerCase().includes(buscar)
        );
      })
      .sort((a, b) => {
        const ta = a.fecha ? Date.parse(a.fecha) : 0;
        const tb = b.fecha ? Date.parse(b.fecha) : 0;
        return tb - ta;
      });
  }

  async getSummary(filters: AdminProductionFilters) {
    const all = await this.loadAll();
    return computeAdminProductionSummary({
      bounds: filters.bounds,
      mesaEnvios: this.filterMesa(all, { ...filters, etapaActual: filters.etapaActual }),
      precalRows: all.map(mapPrecal),
      asesorId: filters.asesorId,
      etapaActual: filters.etapaActual,
    });
  }

  async getMesaCohortByEtapa(filters: AdminProductionFilters) {
    const rows = this.filterMesa(await this.loadAll(), {
      ...filters,
      etapaActual: null,
    });
    const byEtapa = groupMesaEnviosByEtapaActual(rows);
    return { total: rows.length, byEtapa };
  }

  async listByAsesor(filters: AdminProductionFilters) {
    const all = await this.loadAll();
    const mesa = this.filterMesa(all, { ...filters, asesorId: null, etapaActual: null });
    const precal = all.map(mapPrecal);
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
      }
      return row;
    };

    for (const r of mesa) {
      const row = ensure(r.asesorId, r.asesorNombre, r.asesorEmail);
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

    return [...map.values()].sort((a, b) => b.enviadosAMesa - a.enviadosAMesa);
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
