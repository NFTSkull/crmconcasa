import type { ExpedientesRepo } from "@/domain/expedientes/repo";
import type { ExpedienteMock } from "@/domain/expedientes/mock.repo";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";
import {
  computeAdminProductionSummary,
  groupMesaEnviosByEtapaActual,
  type AdminMesaEnvioEvent,
  type AdminPrecalEvent,
} from "./metrics";
import { isInstantInPeriod, isMontoMayorA20000 } from "./period";
import type {
  AdminAsesorProductionRow,
  AdminPaginated,
  AdminPrecalSummary,
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

function mapPrecal(e: ExpedienteMock): AdminPrecalEvent | null {
  const at = e.editorDecision.aprobadoAt;
  const monto = e.editorDecision.montoAprobadoAlAprobar;
  if (!at || typeof monto !== "number" || !(monto > 0)) return null;
  return {
    expedienteId: e.id,
    aprobadoAt: at,
    clienteNombre: e.base.cliente_nombre,
    asesorId: e.base.asesorId,
    asesorNombre: e.base.asesorNombre ?? null,
    asesorEmail: e.base.asesorEmail ?? null,
    decision: e.editorDecision.decision,
    montoAprobadoAlAprobar: monto,
    montoAprobadoActual: e.editorDecision.monto_aprobado,
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
    const dec = filters.precalDecision ?? "todas";
    return all
      .map(mapPrecal)
      .filter((r): r is AdminPrecalEvent => r != null)
      .filter((r) => isInstantInPeriod(r.aprobadoAt, filters.bounds))
      .filter((r) => !filters.asesorId || r.asesorId === filters.asesorId)
      .filter((r) => {
        if (!buscar) return true;
        const label = asesorLabel(r.asesorNombre, r.asesorEmail, r.asesorId).toLowerCase();
        return (
          r.clienteNombre.toLowerCase().includes(buscar) ||
          label.includes(buscar) ||
          r.programa.toLowerCase().includes(buscar)
        );
      })
      .filter((r) => {
        if (dec === "todas" || dec === "aprobadas") return true;
        if (dec === "aprobadas_mayor_20000") return isMontoMayorA20000(r.montoAprobadoAlAprobar);
        if (dec === "no_cumple") return r.decision === "no_cumple";
        if (dec === "pendientes") return r.decision === "pendiente";
        return true;
      })
      .sort((a, b) => Date.parse(b.aprobadoAt) - Date.parse(a.aprobadoAt));
  }

  async getSummary(filters: AdminProductionFilters) {
    const all = await this.loadAll();
    return computeAdminProductionSummary({
      bounds: filters.bounds,
      mesaEnvios: this.filterMesa(all, { ...filters, etapaActual: filters.etapaActual }),
      precalAprobadas: this.filterPrecal(all, { ...filters, precalDecision: "aprobadas" }),
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
    const precal = this.filterPrecal(all, {
      ...filters,
      asesorId: null,
      precalDecision: "aprobadas",
    });
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
      const next = {
        ...row,
        enviadosAMesa: row.enviadosAMesa + 1,
        etapas: {
          ...row.etapas,
          [String(r.etapaActual)]: (row.etapas[String(r.etapaActual)] ?? 0) + 1,
        },
      };
      map.set(r.asesorId, next);
    }
    for (const r of precal) {
      const row = ensure(r.asesorId, r.asesorNombre, r.asesorEmail);
      map.set(r.asesorId, {
        ...row,
        precalificacionesAprobadas: row.precalificacionesAprobadas + 1,
        aprobadasMayorA20000:
          row.aprobadasMayorA20000 + (isMontoMayorA20000(r.montoAprobadoAlAprobar) ? 1 : 0),
        montoAprobadoTotal:
          Math.round((row.montoAprobadoTotal + r.montoAprobadoAlAprobar) * 100) / 100,
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
    const summary: AdminPrecalSummary = {
      total: rows.length,
      aprobadas: rows.length,
      aprobadasMayorA20000: rows.filter((r) => isMontoMayorA20000(r.montoAprobadoAlAprobar))
        .length,
      noCumple: rows.filter((r) => r.decision === "no_cumple").length,
      pendientes: rows.filter((r) => r.decision === "pendiente").length,
      montoAprobadoTotal:
        Math.round(rows.reduce((s, r) => s + r.montoAprobadoAlAprobar, 0) * 100) / 100,
      montoPromedioAprobado:
        rows.length === 0
          ? 0
          : Math.round(
              (rows.reduce((s, r) => s + r.montoAprobadoAlAprobar, 0) / rows.length) * 100,
            ) / 100,
    };
    return { ...page, summary };
  }

  async exportAll(filters: AdminProductionFilters) {
    const all = await this.loadAll();
    const mesaEnvios = this.filterMesa(all, filters).slice(0, 5000);
    const precalificaciones = this.filterPrecal(all, {
      ...filters,
      precalDecision: filters.precalDecision ?? "todas",
    }).slice(0, 5000);
    const asesores = await this.listByAsesor(filters);
    const summary = await this.getSummary(filters);
    return { mesaEnvios, precalificaciones, asesores, summary };
  }
}
