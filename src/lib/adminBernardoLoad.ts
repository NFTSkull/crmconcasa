/**
 * Carga read-only del Dashboard Bernardo (B3).
 * Fuentes canónicas existentes — cero escrituras / cero RPC nuevas.
 *
 * Ingresos  → AdminProductionRepo.getSummary + listMesaEnviosPage
 *             (misma semántica KPI «Enviados a Mesa» / fecha_envio_mesa)
 * Citas     → get_mesa_agenda_bookings (bio / firmas / notificacion)
 *             o localStorage mock en modo demo.
 */

import {
  emptyAdminMesaSeguimientoFields,
  type AdminMesaEnvioEvent,
  type AdminProductionRepo,
} from "@/domain/admin-production";
import type { AdminPeriodBounds } from "@/domain/admin-production/period";
import type { BernardoPeriodBounds } from "@/lib/adminBernardoPeriod";
import { chunkInclusiveDateRange } from "@/lib/adminBernardoPeriod";
import { isDataModeSupabase } from "@/lib/dataMode";
import {
  fetchMesaAgendaBookings,
  MesaAgendaBookingsSupabaseError,
} from "@/domain/agenda-calendar/mesa.repo";
import type {
  MesaAgendaBookingEntry,
  MesaAgendaBookingKind,
} from "@/domain/agenda-calendar/mesa.types";
import { MockAgendaBiometricosLocalStorageRepo } from "@/domain/agenda-biometricos/mock-localstorage.repo";
import { NOTIFICACION_LOCATION_ID } from "@/domain/agenda-biometricos/notificacion-constants";
import { readFirmasBookingsDoc } from "@/lib/agendaFirmasBookingsGuard";
import {
  formatAgendaCalendarStatusLabel,
  isDateWithinInclusiveRange,
  normalizeBookingTime,
} from "@/lib/asesorAgendaCalendar";
import { getEtapaOperativaNombre } from "@/domain/expedientes/asesor-seguimiento-operativo";

/** El repo Admin solo usa fromIso/toExclusiveIso; el preset se normaliza a personalizado. */
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
  bookingId: string;
  expedienteId: string;
  clienteNombre: string;
  asesorNombre: string;
  bookingDate: string;
  bookingTime: string;
  status: "booked" | "cancelled";
  statusLabel: string;
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

function mapBookingToCita(entry: MesaAgendaBookingEntry): BernardoCitaRow {
  const asesorNombre =
    entry.asesor.fullName?.trim() ||
    entry.asesor.email?.trim() ||
    "Asesor sin nombre registrado";
  return {
    bookingId: entry.bookingId,
    expedienteId: entry.expedienteId,
    clienteNombre: entry.clienteNombre?.trim() || "Cliente sin nombre",
    asesorNombre,
    bookingDate: entry.bookingDate,
    bookingTime: normalizeBookingTime(entry.bookingTime),
    status: entry.status,
    statusLabel: formatAgendaCalendarStatusLabel(entry.status),
    etapaActual: entry.etapaActual,
    etapaLabel: getEtapaOperativaNombre(entry.etapaActual),
    kind: entry.kind,
  };
}

/** Principal: solo citas booked (excluye canceladas del total). */
function bookedOnly(items: readonly BernardoCitaRow[]): BernardoCitaRow[] {
  return items.filter((i) => i.status === "booked");
}

async function fetchAgendaKindChunked(params: {
  kind: MesaAgendaBookingKind;
  fromDate: string;
  toDateInclusive: string;
  includeCancelled: boolean;
}): Promise<MesaAgendaBookingEntry[]> {
  const chunks = chunkInclusiveDateRange(
    params.fromDate,
    params.toDateInclusive,
    62,
  );
  const all: MesaAgendaBookingEntry[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const rows = await fetchMesaAgendaBookings({
      startDate: chunk.startDate,
      endDate: chunk.endDate,
      includeCancelled: params.includeCancelled,
      kind: params.kind,
    });
    for (const row of rows) {
      if (seen.has(row.bookingId)) continue;
      seen.add(row.bookingId);
      all.push(row);
    }
  }
  return all;
}

function loadMockAgendaKind(params: {
  kind: MesaAgendaBookingKind;
  fromDate: string;
  toDateInclusive: string;
  includeCancelled: boolean;
}): MesaAgendaBookingEntry[] {
  if (typeof window === "undefined") return [];

  const out: MesaAgendaBookingEntry[] = [];

  if (params.kind === "firmas") {
    const firmaRows = readFirmasBookingsDoc().bookings ?? [];
    for (const [index, row] of firmaRows.entries()) {
      const date = row.date?.trim();
      const time = row.time?.trim();
      if (!date || !time) continue;
      if (!isDateWithinInclusiveRange(date, params.fromDate, params.toDateInclusive)) {
        continue;
      }
      const status = row.status === "cancelled" ? "cancelled" : "booked";
      if (!params.includeCancelled && status !== "booked") continue;
      const email = row.createdBy?.email?.trim() ?? null;
      out.push({
        bookingId: row.id?.trim() || `firmas-mock-${index}`,
        expedienteId: row.expedienteId?.trim() || `mock-exp-firmas-${index}`,
        bookingDate: date,
        bookingTime: normalizeBookingTime(time),
        kind: "firmas",
        status,
        locationId: row.locationId?.trim() || null,
        note: null,
        createdAt: row.createdAt ?? new Date().toISOString(),
        cancelledAt: null,
        clienteNombre: "Cliente",
        nss: null,
        etapaActual: 9,
        subestado: null,
        submittedToMesa: true,
        asesor: { id: email ?? "mock", fullName: null, email },
        createdBy: { id: email ?? "mock", fullName: null, email },
        driveValidated: false,
        driveValidatedAt: null,
        driveValidatedBy: null,
        reportGroup: null,
      });
    }
    return out;
  }

  const bioRepo = new MockAgendaBiometricosLocalStorageRepo();
  const bioRows = bioRepo.readBookings().bookings ?? [];
  for (const [index, row] of bioRows.entries()) {
    const date = row.date?.trim();
    const time = row.time?.trim();
    if (!date || !time) continue;
    if (!isDateWithinInclusiveRange(date, params.fromDate, params.toDateInclusive)) {
      continue;
    }
    const isNotif = row.locationId === NOTIFICACION_LOCATION_ID;
    const kind: MesaAgendaBookingKind = isNotif ? "notificacion" : "biometricos";
    if (kind !== params.kind) continue;
    const status = row.status === "cancelled" ? "cancelled" : "booked";
    if (!params.includeCancelled && status !== "booked") continue;
    const email = row.createdBy?.email?.trim() ?? null;
    out.push({
      bookingId: row.id?.trim() || `${kind}-mock-${index}`,
      expedienteId: row.expedienteId,
      bookingDate: date,
      bookingTime: normalizeBookingTime(time),
      kind,
      status,
      locationId: row.locationId,
      note: row.note,
      createdAt: row.createdAt,
      cancelledAt: null,
      clienteNombre: "Cliente",
      nss: null,
      etapaActual: kind === "notificacion" ? 3 : 4,
      subestado: null,
      submittedToMesa: true,
      asesor: { id: email ?? "mock", fullName: null, email },
      createdBy: { id: email ?? "mock", fullName: null, email },
      driveValidated: false,
      driveValidatedAt: null,
      driveValidatedBy: null,
      reportGroup: null,
    });
  }
  return out;
}

async function loadAgendaKind(params: {
  kind: MesaAgendaBookingKind;
  fromDate: string;
  toDateInclusive: string;
}): Promise<BernardoCitaRow[]> {
  // Detalle con estado real: incluir canceladas; el total principal usa bookedOnly.
  try {
    const raw = isDataModeSupabase()
      ? await fetchAgendaKindChunked({
          ...params,
          includeCancelled: true,
        })
      : loadMockAgendaKind({ ...params, includeCancelled: true });
    return raw.map(mapBookingToCita);
  } catch (e) {
    if (e instanceof MesaAgendaBookingsSupabaseError) {
      // Sin Supabase / sin sesión: degradar a vacío (UI empty state).
      return [];
    }
    throw e;
  }
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
 * Ingresos: getSummary.enviadosAMesa (cálculo idéntico al KPI Admin).
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

  const [summary, ingresosItems, biometricosAll, firmasAll, notifAll] =
    await Promise.all([
      repo.getSummary(filters),
      loadAllMesaEnvios(repo, bounds),
      loadAgendaKind({
        kind: "biometricos",
        fromDate: bounds.fromDate,
        toDateInclusive: bounds.toDateInclusive,
      }),
      loadAgendaKind({
        kind: "firmas",
        fromDate: bounds.fromDate,
        toDateInclusive: bounds.toDateInclusive,
      }),
      loadAgendaKind({
        kind: "notificacion",
        fromDate: bounds.fromDate,
        toDateInclusive: bounds.toDateInclusive,
      }),
    ]);

  const biometricosItems = bookedOnly(biometricosAll);
  const firmasItems = bookedOnly(firmasAll);
  const notificacionesItems = bookedOnly(notifAll);

  return {
    ingresosTotal: summary.enviadosAMesa,
    ingresosItems,
    biometricosTotal: biometricosItems.length,
    biometricosItems,
    firmasTotal: firmasItems.length,
    firmasItems,
    notificacionesTotal: notificacionesItems.length,
    notificacionesItems,
  };
}

/** Construye fila mínima para abrir el drawer B2 desde una cita. */
export function bernardoCitaToMesaEnvio(
  cita: BernardoCitaRow,
): AdminMesaEnvioEvent {
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
