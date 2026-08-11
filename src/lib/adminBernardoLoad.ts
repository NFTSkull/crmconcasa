/**
 * Carga read-only del Dashboard Bernardo (B3 + P165 calibración operativa).
 *
 * Ingresos  → AdminProductionRepo.getSummary + listMesaEnviosPage
 *             (misma semántica KPI «Enviados a Mesa» / fecha_envio_mesa) — INTACTO
 * Biométricos / Firmas / Notificaciones → agenda_sheet_operational_results
 *             (resultado Sheet COMPLETED; no agenda_bookings.status=booked)
 */

import {
  emptyAdminMesaSeguimientoFields,
  type AdminMesaEnvioEvent,
  type AdminProductionRepo,
} from "@/domain/admin-production";
import type { AdminPeriodBounds } from "@/domain/admin-production/period";
import type { BernardoPeriodBounds } from "@/lib/adminBernardoPeriod";
import { isDataModeSupabase } from "@/lib/dataMode";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  operationalResultLabel,
  type OperationalResultClass,
} from "@/domain/agenda-sheets/operational-result-classifiers";
import type { MesaAgendaBookingKind } from "@/domain/agenda-calendar/mesa.types";
import { normalizeBookingTime } from "@/lib/asesorAgendaCalendar";
import { getEtapaOperativaNombre } from "@/domain/expedientes/asesor-seguimiento-operativo";

function toAdminBounds(bounds: BernardoPeriodBounds): AdminPeriodBounds {
  return {
    preset: "personalizado",
    fromIso: bounds.fromIso,
    toExclusiveIso: bounds.toExclusiveIso,
    fromDate: bounds.fromDate,
    toDateInclusive: bounds.toDateInclusive,
  };
}

export type BernardoMetricId =
  | "ingresos"
  | "biometricos"
  | "firmas"
  | "notificaciones";

export type BernardoCitaRow = Readonly<{
  /** Null en citas manuales del Sheet sin booking CRM. */
  bookingId: string | null;
  expedienteId: string | null;
  resultId: string;
  clienteNombre: string;
  asesorNombre: string;
  bookingDate: string;
  bookingTime: string;
  status: "completed";
  statusLabel: string;
  resultClass: OperationalResultClass;
  resultRaw: string | null;
  locationId: string;
  sheetRow: number;
  etapaActual: number;
  etapaLabel: string;
  kind: MesaAgendaBookingKind;
}>;

export type BernardoDashboardData = Readonly<{
  ingresosTotal: number;
  ingresosItems: readonly AdminMesaEnvioEvent[];
  biometricosTotal: number;
  biometricosItems: readonly BernardoCitaRow[];
  firmasTotal: number;
  firmasItems: readonly BernardoCitaRow[];
  notificacionesTotal: number;
  notificacionesItems: readonly BernardoCitaRow[];
}>;

type OpsDetailItem = {
  result_id?: string;
  booking_date?: string;
  booking_time?: string | null;
  kind?: string;
  location_id?: string;
  sheet_row?: number;
  booking_id?: string | null;
  expediente_id?: string | null;
  result_class?: string;
  result_raw?: string | null;
  cliente_nombre?: string;
  asesor_nombre?: string;
};

function mapOpsItem(
  item: OpsDetailItem,
  metric: "biometricos" | "firmas" | "notificaciones",
): BernardoCitaRow {
  const resultClass = (item.result_class ?? "UNKNOWN") as OperationalResultClass;
  const kind: MesaAgendaBookingKind =
    metric === "notificaciones"
      ? "notificacion"
      : metric === "firmas"
        ? "firmas"
        : "biometricos";
  const etapaActual =
    metric === "firmas" ? 9 : metric === "notificaciones" ? 3 : 4;
  return {
    bookingId: item.booking_id?.trim() || null,
    expedienteId: item.expediente_id?.trim() || null,
    resultId: String(item.result_id ?? `${metric}-${item.sheet_row ?? 0}`),
    clienteNombre: item.cliente_nombre?.trim() || "Cliente sin nombre",
    asesorNombre: item.asesor_nombre?.trim() || "Asesor sin nombre registrado",
    bookingDate: String(item.booking_date ?? "").slice(0, 10),
    bookingTime: normalizeBookingTime(String(item.booking_time ?? "00:00")),
    status: "completed",
    statusLabel: operationalResultLabel(resultClass),
    resultClass,
    resultRaw: item.result_raw?.trim() || null,
    locationId: String(item.location_id ?? ""),
    sheetRow: Number(item.sheet_row) || 0,
    etapaActual,
    etapaLabel: getEtapaOperativaNombre(etapaActual),
    kind,
  };
}

async function fetchBernardoOpsMetric(params: {
  metric: "biometricos" | "firmas" | "notificaciones";
  fromDate: string;
  toDateInclusive: string;
}): Promise<{ total: number; items: BernardoCitaRow[] }> {
  if (!isDataModeSupabase() || !isSupabaseConfigured() || !supabaseBrowser) {
    return { total: 0, items: [] };
  }

  const {
    data: { session },
  } = await supabaseBrowser.auth.getSession();
  if (!session?.user) return { total: 0, items: [] };

  const { data, error } = await supabaseBrowser.rpc("bernardo_ops_detail", {
    p_metric: params.metric,
    p_fecha_desde: params.fromDate,
    p_fecha_hasta: params.toDateInclusive,
  });
  if (error) {
    console.error("bernardo_ops_detail", error.message);
    return { total: 0, items: [] };
  }
  const payload = (data ?? {}) as {
    total?: number;
    items?: OpsDetailItem[];
  };
  const items = (payload.items ?? []).map((it) =>
    mapOpsItem(it, params.metric),
  );
  const total =
    typeof payload.total === "number" ? payload.total : items.length;
  // KPI == detalle 1:1
  return { total: items.length, items: items.slice(0, total) };
}

async function loadAllMesaEnvios(
  repo: AdminProductionRepo,
  bounds: BernardoPeriodBounds,
): Promise<AdminMesaEnvioEvent[]> {
  const adminBounds = toAdminBounds(bounds);
  const pageSize = 100;
  const first = await repo.listMesaEnviosPage({
    bounds: adminBounds,
    asesorId: null,
    etapaActual: null,
    etapaActuales: null,
    estado: "todos",
    buscar: null,
    precalDecision: "resueltas",
    page: 1,
    pageSize,
  });
  const items = [...first.items];
  const total = first.totalCount;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  for (let page = 2; page <= pages; page += 1) {
    const next = await repo.listMesaEnviosPage({
      bounds: adminBounds,
      asesorId: null,
      etapaActual: null,
      etapaActuales: null,
      estado: "todos",
      buscar: null,
      precalDecision: "resueltas",
      page,
      pageSize,
    });
    items.push(...next.items);
  }
  return items;
}

/**
 * Carga las cuatro métricas Bernardo para el periodo.
 * Ingresos: getSummary.enviadosAMesa (cálculo idéntico al KPI Admin) — sin cambio.
 * Ops: solo COMPLETED desde proyección Sheet.
 */
export async function loadBernardoDashboard(params: {
  repo: AdminProductionRepo;
  bounds: BernardoPeriodBounds;
}): Promise<BernardoDashboardData> {
  const { repo, bounds } = params;
  const filters = {
    bounds: toAdminBounds(bounds),
    asesorId: null as string | null,
    etapaActual: null as number | null,
    etapaActuales: null as number[] | null,
    estado: "todos" as const,
    buscar: null as string | null,
    precalDecision: "resueltas" as const,
  };

  const [summary, ingresosItems, biometricos, firmas, notificaciones] =
    await Promise.all([
      repo.getSummary(filters),
      loadAllMesaEnvios(repo, bounds),
      fetchBernardoOpsMetric({
        metric: "biometricos",
        fromDate: bounds.fromDate,
        toDateInclusive: bounds.toDateInclusive,
      }),
      fetchBernardoOpsMetric({
        metric: "firmas",
        fromDate: bounds.fromDate,
        toDateInclusive: bounds.toDateInclusive,
      }),
      fetchBernardoOpsMetric({
        metric: "notificaciones",
        fromDate: bounds.fromDate,
        toDateInclusive: bounds.toDateInclusive,
      }),
    ]);

  return {
    ingresosTotal: summary.enviadosAMesa,
    ingresosItems,
    biometricosTotal: biometricos.total,
    biometricosItems: biometricos.items,
    firmasTotal: firmas.total,
    firmasItems: firmas.items,
    notificacionesTotal: notificaciones.total,
    notificacionesItems: notificaciones.items,
  };
}

/** Construye fila mínima para abrir el drawer B2 desde una cita con expediente. */
export function bernardoCitaToMesaEnvio(
  cita: BernardoCitaRow,
): AdminMesaEnvioEvent | null {
  if (!cita.expedienteId) return null;
  const fecha = `${cita.bookingDate}T${cita.bookingTime}:00.000Z`;
  return {
    expedienteId: cita.expedienteId,
    fechaEnvioMesa: fecha,
    clienteNombre: cita.clienteNombre,
    asesorId: "—",
    asesorNombre: cita.asesorNombre,
    programa: "—",
    etapaActual: cita.etapaActual,
    subestado: "",
    cicloEstado: "activo",
    ...emptyAdminMesaSeguimientoFields(fecha),
    etapaLabel: cita.etapaLabel,
  };
}

export function sortIngresosDesc(
  items: readonly AdminMesaEnvioEvent[],
): AdminMesaEnvioEvent[] {
  return [...items].sort((a, b) =>
    b.fechaEnvioMesa.localeCompare(a.fechaEnvioMesa),
  );
}

export function sortCitasByTimeAsc(
  items: readonly BernardoCitaRow[],
): BernardoCitaRow[] {
  return [...items].sort((a, b) => {
    const d = a.bookingDate.localeCompare(b.bookingDate);
    if (d !== 0) return d;
    return a.bookingTime.localeCompare(b.bookingTime);
  });
}

export type BernardoDayGroup<T> = Readonly<{
  date: string;
  items: readonly T[];
}>;

export function groupByDayIngresos(
  items: readonly AdminMesaEnvioEvent[],
): BernardoDayGroup<AdminMesaEnvioEvent>[] {
  const map = new Map<string, AdminMesaEnvioEvent[]>();
  for (const it of sortIngresosDesc(items)) {
    const day = it.fechaEnvioMesa.slice(0, 10);
    const bucket = map.get(day) ?? [];
    bucket.push(it);
    map.set(day, bucket);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, dayItems]) => ({ date, items: dayItems }));
}

export function groupByDayCitas(
  items: readonly BernardoCitaRow[],
): BernardoDayGroup<BernardoCitaRow>[] {
  const map = new Map<string, BernardoCitaRow[]>();
  for (const it of sortCitasByTimeAsc(items)) {
    const bucket = map.get(it.bookingDate) ?? [];
    bucket.push(it);
    map.set(it.bookingDate, bucket);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, dayItems]) => ({ date, items: dayItems }));
}
