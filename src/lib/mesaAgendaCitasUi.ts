import { AgendaBiometricosSupabaseError } from "@/domain/agenda-biometricos";
import { AgendaFirmasSupabaseError } from "@/domain/agenda-firmas";
import { NOTIFICACION_FIXED_TIME_DISPLAY } from "@/domain/agenda-biometricos/notificacion-constants";
import {
  computeCalendarMonthRange,
  normalizeBookingTime,
} from "@/lib/asesorAgendaCalendar";
import {
  compareMesaAgendaBookingEntries,
  mesaAgendaBookingPersonDisplayName,
} from "@/domain/agenda-calendar/mesa.mapper";
import type {
  MesaAgendaBookingEntry,
  MesaAgendaBookingKind,
  MesaAgendaBookingKindFilter,
  MesaAgendaBookingStatus,
} from "@/domain/agenda-calendar/mesa.types";
import {
  canMesaShowCancelCitaButton,
  type MesaAgendaCancelKind,
} from "@/lib/mesaAgendaCancelAccess";

export const MESA_AGENDA_CITAS_ROUTE = "/mesa-control/citas";

export const MESA_AGENDA_MAX_RANGE_DAYS = 62;

export type MesaAgendaCitasKindUiFilter = "all" | MesaAgendaBookingKind;

export type MesaAgendaCitasClientFilters = Readonly<{
  kindUi: MesaAgendaCitasKindUiFilter;
  includeCancelled: boolean;
  locationId: string;
  asesorId: string;
  search: string;
}>;

export type MesaAgendaCitasRangeValidation =
  | { ok: true }
  | { ok: false; message: string };

const MESA_AGENDA_ALLOWED_ROLES = new Set([
  "mesa_admin",
  "mesa_interno",
  "mesa_externo",
  "super_admin",
  "mesa_control",
  "mesa_control_admin",
  "mesa_control_interno",
  "mesa_control_externo",
]);

export function canAccessMesaAgendaCitasPage(role: string | null | undefined): boolean {
  return MESA_AGENDA_ALLOWED_ROLES.has(String(role ?? "").trim());
}

export function defaultMesaAgendaMonthRange(date: Date = new Date()): {
  startDate: string;
  endDate: string;
} {
  return computeCalendarMonthRange(date.getFullYear(), date.getMonth());
}

export function validateMesaAgendaDateRange(
  startDate: string,
  endDate: string,
): MesaAgendaCitasRangeValidation {
  const start = startDate.trim();
  const end = endDate.trim();
  if (!start || !end || end < start) {
    return {
      ok: false,
      message: "Selecciona un rango válido de máximo 62 días.",
    };
  }
  const startDt = new Date(`${start}T12:00:00`);
  const endDt = new Date(`${end}T12:00:00`);
  const diffDays = Math.round((endDt.getTime() - startDt.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays > MESA_AGENDA_MAX_RANGE_DAYS) {
    return {
      ok: false,
      message: "Selecciona un rango válido de máximo 62 días.",
    };
  }
  return { ok: true };
}

export function mesaAgendaKindUiToRpcFilter(
  kindUi: MesaAgendaCitasKindUiFilter,
): MesaAgendaBookingKindFilter {
  return kindUi === "all" ? null : kindUi;
}

export function formatMesaAgendaKind(kind: MesaAgendaBookingKind): string {
  if (kind === "biometricos") return "Biométricos";
  if (kind === "firmas") return "Firma";
  return "Notificación extraordinaria";
}

export function formatMesaAgendaStatus(status: MesaAgendaBookingStatus): string {
  return status === "booked" ? "Agendada" : "Cancelada";
}

export function formatMesaAgendaTime(entry: MesaAgendaBookingEntry): string {
  if (entry.kind === "notificacion") {
    return NOTIFICACION_FIXED_TIME_DISPLAY;
  }
  const [h, m] = entry.bookingTime.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return entry.bookingTime;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function formatMesaAgendaDateTime(entry: MesaAgendaBookingEntry): string {
  return `${entry.bookingDate} · ${formatMesaAgendaTime(entry)}`;
}

export function mesaAgendaKindBadgeClass(kind: MesaAgendaBookingKind): string {
  if (kind === "biometricos") {
    return "bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200";
  }
  if (kind === "notificacion") {
    return "bg-amber-50 text-amber-900 ring-1 ring-amber-200";
  }
  return "bg-violet-50 text-violet-800 ring-1 ring-violet-200";
}

export function mesaAgendaStatusBadgeClass(status: MesaAgendaBookingStatus): string {
  return status === "booked"
    ? "bg-emerald-50 text-emerald-800"
    : "bg-gray-100 text-gray-600";
}

export function buildMesaExpedienteDetailHref(expedienteId: string): string {
  return `/mesa-control/${encodeURIComponent(expedienteId.trim())}`;
}

export function buildMesaAgendaAdvisorOptions(
  entries: readonly MesaAgendaBookingEntry[],
): ReadonlyArray<{ value: string; label: string }> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const id = entry.asesor.id.trim();
    if (!id) continue;
    if (!map.has(id)) {
      map.set(id, mesaAgendaBookingPersonDisplayName(entry.asesor));
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "es"))
    .map(([value, label]) => ({ value, label }));
}

export function buildMesaAgendaLocationOptions(
  entries: readonly MesaAgendaBookingEntry[],
): ReadonlyArray<{ value: string; label: string }> {
  const set = new Set<string>();
  for (const entry of entries) {
    const loc = entry.locationId?.trim();
    if (loc) set.add(loc);
  }
  return [...set]
    .sort((a, b) => a.localeCompare(b, "es"))
    .map((value) => ({ value, label: value }));
}

function normalizeSearchTerm(term: string): string {
  return term.trim().toLowerCase();
}

export function matchesMesaAgendaSearch(
  entry: MesaAgendaBookingEntry,
  search: string,
): boolean {
  const term = normalizeSearchTerm(search);
  if (!term) return true;
  const haystack = [
    entry.clienteNombre,
    entry.nss ?? "",
    mesaAgendaBookingPersonDisplayName(entry.asesor),
    entry.asesor.email ?? "",
    mesaAgendaBookingPersonDisplayName(entry.createdBy),
    entry.createdBy.email ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

export function filterMesaAgendaEntries(
  entries: readonly MesaAgendaBookingEntry[],
  filters: MesaAgendaCitasClientFilters,
): MesaAgendaBookingEntry[] {
  const locationFilter = filters.locationId.trim();
  const asesorFilter = filters.asesorId.trim();

  return entries.filter((entry) => {
    if (locationFilter && (entry.locationId?.trim() ?? "") !== locationFilter) {
      return false;
    }
    if (asesorFilter && entry.asesor.id.trim() !== asesorFilter) {
      return false;
    }
    return matchesMesaAgendaSearch(entry, filters.search);
  });
}

export type MesaAgendaCitasViewMode = "lista" | "dia" | "semana";

export const MESA_AGENDA_DEFAULT_VIEW: MesaAgendaCitasViewMode = "lista";

export type MesaAgendaCitasSortOption =
  | "fecha_proxima"
  | "fecha_lejana"
  | "cliente_az"
  | "asesor_az"
  | "tipo";

export const MESA_AGENDA_DEFAULT_SORT: MesaAgendaCitasSortOption = "fecha_proxima";

export type MesaAgendaHistoryLabel =
  | "Cita actual"
  | "Cita anterior"
  | "Reagendada"
  | "Cancelada";

export type MesaAgendaSummary = Readonly<{
  total: number;
  biometricos: number;
  firmas: number;
  notificacion: number;
  canceladas: number;
}>;

export type MesaAgendaTimeGroup = Readonly<{
  timeKey: string;
  timeLabel: string;
  entries: readonly MesaAgendaBookingEntry[];
}>;

export type MesaAgendaDayGroup = Readonly<{
  date: string;
  entries: readonly MesaAgendaBookingEntry[];
}>;

export type MesaAgendaWeekRange = Readonly<{
  startDate: string;
  endDate: string;
  days: readonly string[];
}>;

export type MesaAgendaWeekDaySummary = Readonly<{
  date: string;
  total: number;
  biometricos: number;
  firmas: number;
  notificacion: number;
  slots: readonly Readonly<{ timeLabel: string; count: number }>[];
}>;

export type MesaAgendaFilterChip = Readonly<{
  id: string;
  label: string;
  clearPatch: Partial<MesaAgendaCitasClientFilters>;
}>;

function padYmdPart(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatMesaAgendaYmd(date: Date): string {
  return `${date.getFullYear()}-${padYmdPart(date.getMonth() + 1)}-${padYmdPart(date.getDate())}`;
}

export function todayMesaAgendaYmd(date: Date = new Date()): string {
  return formatMesaAgendaYmd(date);
}

export function parseMesaAgendaYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

export function shiftMesaAgendaDayYmd(ymd: string, deltaDays: number): string {
  const base = parseMesaAgendaYmd(ymd);
  base.setDate(base.getDate() + deltaDays);
  return formatMesaAgendaYmd(base);
}

/** Semana lun–dom que contiene `anchorYmd`. */
export function buildMesaAgendaWeekRange(anchorYmd: string): MesaAgendaWeekRange {
  const anchor = parseMesaAgendaYmd(anchorYmd);
  const weekday = anchor.getDay();
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + diffToMonday);
  const days: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    days.push(formatMesaAgendaYmd(day));
  }
  return {
    startDate: days[0]!,
    endDate: days[6]!,
    days,
  };
}

export function formatMesaAgendaWeekdayLabel(ymd: string): string {
  const dt = parseMesaAgendaYmd(ymd);
  return dt.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
}

export function formatMesaAgendaDayHeading(ymd: string): string {
  const dt = parseMesaAgendaYmd(ymd);
  return dt.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function resolveMesaAgendaFetchRange(params: Readonly<{
  viewMode: MesaAgendaCitasViewMode;
  listaStartDate: string;
  listaEndDate: string;
  selectedDay: string;
  weekAnchor: string;
}>): { startDate: string; endDate: string } {
  if (params.viewMode === "dia") {
    return { startDate: params.selectedDay, endDate: params.selectedDay };
  }
  if (params.viewMode === "semana") {
    const week = buildMesaAgendaWeekRange(params.weekAnchor);
    return { startDate: week.startDate, endDate: week.endDate };
  }
  return { startDate: params.listaStartDate, endDate: params.listaEndDate };
}

export function filterMesaAgendaEntriesForDay(
  entries: readonly MesaAgendaBookingEntry[],
  dateYmd: string,
): MesaAgendaBookingEntry[] {
  return entries.filter((entry) => entry.bookingDate === dateYmd);
}

export function groupMesaAgendaEntriesByDay(
  entries: readonly MesaAgendaBookingEntry[],
): MesaAgendaDayGroup[] {
  const map = new Map<string, MesaAgendaBookingEntry[]>();
  for (const entry of entries) {
    const list = map.get(entry.bookingDate) ?? [];
    list.push(entry);
    map.set(entry.bookingDate, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayEntries]) => ({
      date,
      entries: sortMesaAgendaEntries(dayEntries, "fecha_proxima"),
    }));
}

export function groupMesaAgendaEntriesByTime(
  entries: readonly MesaAgendaBookingEntry[],
): MesaAgendaTimeGroup[] {
  const map = new Map<string, MesaAgendaBookingEntry[]>();
  for (const entry of entries) {
    const timeKey =
      entry.kind === "notificacion"
        ? "12:00"
        : entry.bookingTime.slice(0, 5);
    const list = map.get(timeKey) ?? [];
    list.push(entry);
    map.set(timeKey, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timeKey, timeEntries]) => ({
      timeKey,
      timeLabel: formatMesaAgendaTime(timeEntries[0]!),
      entries: sortMesaAgendaEntries(timeEntries, "fecha_proxima"),
    }));
}

const KIND_SORT_ORDER: Record<MesaAgendaBookingKind, number> = {
  biometricos: 0,
  firmas: 1,
  notificacion: 2,
};

export function sortMesaAgendaEntries(
  entries: readonly MesaAgendaBookingEntry[],
  sortBy: MesaAgendaCitasSortOption,
): MesaAgendaBookingEntry[] {
  const copy = entries.slice();
  if (sortBy === "fecha_proxima") {
    return copy.sort(compareMesaAgendaBookingEntries);
  }
  if (sortBy === "fecha_lejana") {
    return copy.sort((a, b) => compareMesaAgendaBookingEntries(b, a));
  }
  if (sortBy === "cliente_az") {
    return copy.sort((a, b) => {
      const nameCmp = (a.clienteNombre || "—").localeCompare(b.clienteNombre || "—", "es");
      if (nameCmp !== 0) return nameCmp;
      return compareMesaAgendaBookingEntries(a, b);
    });
  }
  if (sortBy === "asesor_az") {
    return copy.sort((a, b) => {
      const asesorCmp = mesaAgendaBookingPersonDisplayName(a.asesor).localeCompare(
        mesaAgendaBookingPersonDisplayName(b.asesor),
        "es",
      );
      if (asesorCmp !== 0) return asesorCmp;
      return compareMesaAgendaBookingEntries(a, b);
    });
  }
  return copy.sort((a, b) => {
    const kindCmp = KIND_SORT_ORDER[a.kind] - KIND_SORT_ORDER[b.kind];
    if (kindCmp !== 0) return kindCmp;
    return compareMesaAgendaBookingEntries(a, b);
  });
}

export function deriveMesaAgendaSummary(
  entries: readonly MesaAgendaBookingEntry[],
): MesaAgendaSummary {
  let biometricos = 0;
  let firmas = 0;
  let notificacion = 0;
  let canceladas = 0;
  for (const entry of entries) {
    if (entry.kind === "biometricos") biometricos += 1;
    else if (entry.kind === "firmas") firmas += 1;
    else notificacion += 1;
    if (entry.status === "cancelled") canceladas += 1;
  }
  return {
    total: entries.length,
    biometricos,
    firmas,
    notificacion,
    canceladas,
  };
}

export function deriveMesaAgendaWeekDaySummaries(
  entries: readonly MesaAgendaBookingEntry[],
  days: readonly string[],
): MesaAgendaWeekDaySummary[] {
  return days.map((date) => {
    const dayEntries = filterMesaAgendaEntriesForDay(entries, date);
    const summary = deriveMesaAgendaSummary(dayEntries);
    const slots = groupMesaAgendaEntriesByTime(dayEntries).map((group) => ({
      timeLabel: group.timeLabel,
      count: group.entries.length,
    }));
    return {
      date,
      total: summary.total,
      biometricos: summary.biometricos,
      firmas: summary.firmas,
      notificacion: summary.notificacion,
      slots,
    };
  });
}

export function mesaAgendaHistoryGroupKey(
  expedienteId: string,
  kind: MesaAgendaBookingKind,
): string {
  return `${expedienteId.trim()}::${kind}`;
}

export function groupMesaAgendaHistory(
  entries: readonly MesaAgendaBookingEntry[],
): Map<string, MesaAgendaBookingEntry[]> {
  const map = new Map<string, MesaAgendaBookingEntry[]>();
  for (const entry of entries) {
    const key = mesaAgendaHistoryGroupKey(entry.expedienteId, entry.kind);
    const list = map.get(key) ?? [];
    list.push(entry);
    map.set(key, list);
  }
  for (const [key, list] of map) {
    map.set(
      key,
      list.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }
  return map;
}

function entryTimelineTs(entry: MesaAgendaBookingEntry): string {
  return entry.cancelledAt ?? entry.createdAt;
}

export function deriveMesaAgendaHistoryLabel(
  entry: MesaAgendaBookingEntry,
  group: readonly MesaAgendaBookingEntry[],
): MesaAgendaHistoryLabel | null {
  if (group.length <= 1) return null;

  const activeBooked = [...group]
    .filter((item) => item.status === "booked")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (entry.status === "booked") {
    if (activeBooked && activeBooked.bookingId === entry.bookingId) {
      return "Cita actual";
    }
    return null;
  }

  if (activeBooked) {
    const cancelledTs = entryTimelineTs(entry);
    const activeTs = activeBooked.createdAt;
    if (cancelledTs <= activeTs) {
      const cancelledSorted = group
        .filter((item) => item.status === "cancelled")
        .sort((a, b) => entryTimelineTs(b).localeCompare(entryTimelineTs(a)));
      const mostRecentCancelled = cancelledSorted[0];
      if (mostRecentCancelled && mostRecentCancelled.bookingId !== entry.bookingId) {
        return "Cita anterior";
      }
      return "Reagendada";
    }
  }

  return "Cancelada";
}

export function hasMesaAgendaHistoryGroup(group: readonly MesaAgendaBookingEntry[]): boolean {
  return group.length > 1;
}

export function mesaAgendaHistoryBadgeClass(label: MesaAgendaHistoryLabel): string {
  if (label === "Cita actual") return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200";
  if (label === "Reagendada") return "bg-sky-50 text-sky-800 ring-1 ring-sky-200";
  if (label === "Cita anterior") return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  return "bg-gray-100 text-gray-600 ring-1 ring-gray-200";
}

export function defaultMesaAgendaClientFilters(): MesaAgendaCitasClientFilters {
  return {
    kindUi: "all",
    includeCancelled: false,
    locationId: "",
    asesorId: "",
    search: "",
  };
}

export function clearMesaAgendaClientFilters(): MesaAgendaCitasClientFilters {
  return defaultMesaAgendaClientFilters();
}

export function buildMesaAgendaActiveFilterChips(
  filters: MesaAgendaCitasClientFilters,
  options: Readonly<{
    advisorOptions: ReadonlyArray<{ value: string; label: string }>;
    locationOptions: ReadonlyArray<{ value: string; label: string }>;
  }>,
): MesaAgendaFilterChip[] {
  const chips: MesaAgendaFilterChip[] = [];
  if (filters.kindUi === "biometricos") {
    chips.push({ id: "kind-bio", label: "Biométricos", clearPatch: { kindUi: "all" } });
  } else if (filters.kindUi === "firmas") {
    chips.push({ id: "kind-firma", label: "Firma", clearPatch: { kindUi: "all" } });
  } else if (filters.kindUi === "notificacion") {
    chips.push({
      id: "kind-notif",
      label: "Notificación",
      clearPatch: { kindUi: "all" },
    });
  }
  if (filters.locationId.trim()) {
    const label =
      options.locationOptions.find((opt) => opt.value === filters.locationId)?.label ??
      filters.locationId;
    chips.push({
      id: "location",
      label: `Sede ${label}`,
      clearPatch: { locationId: "" },
    });
  }
  if (filters.asesorId.trim()) {
    const label =
      options.advisorOptions.find((opt) => opt.value === filters.asesorId)?.label ??
      filters.asesorId;
    chips.push({ id: "asesor", label: `Asesor ${label}`, clearPatch: { asesorId: "" } });
  }
  if (filters.includeCancelled) {
    chips.push({
      id: "cancelled",
      label: "Incluye canceladas",
      clearPatch: { includeCancelled: false },
    });
  }
  if (filters.search.trim()) {
    chips.push({
      id: "search",
      label: `Búsqueda “${filters.search.trim()}”`,
      clearPatch: { search: "" },
    });
  }
  return chips;
}

export function applyMesaAgendaClientFiltersAndSort(
  entries: readonly MesaAgendaBookingEntry[],
  filters: MesaAgendaCitasClientFilters,
  sortBy: MesaAgendaCitasSortOption,
): MesaAgendaBookingEntry[] {
  return sortMesaAgendaEntries(filterMesaAgendaEntries(entries, filters), sortBy);
}

export function mapMesaAgendaFetchErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const lower = message.toLowerCase();
  if (lower.includes("permiso")) {
    return "No tienes permiso para consultar la agenda de Mesa.";
  }
  if (lower.includes("sesión") || lower.includes("sesion")) {
    return "Tu sesión expiró. Inicia sesión nuevamente.";
  }
  if (lower.includes("rango")) {
    return "Selecciona un rango válido de máximo 62 días.";
  }
  if (lower.includes("supabase no está configurado")) {
    return "La agenda de citas requiere modo Supabase.";
  }
  return "No fue posible cargar las citas. Intenta nuevamente.";
}

export type MesaAgendaListCancelRoleParams = Readonly<{
  mockRole?: string | null;
  sessionRole?: string | null;
}>;

/** Gate de cancelación por fila en `/mesa-control/citas` (solo citas `booked`). */
export function canMesaCancelAgendaListEntry(
  entry: MesaAgendaBookingEntry,
  params: MesaAgendaListCancelRoleParams,
): boolean {
  if (entry.status !== "booked") return false;
  return canMesaShowCancelCitaButton({
    kind: entry.kind as MesaAgendaCancelKind,
    mockRole: params.mockRole,
    sessionRole: params.sessionRole,
    etapaActual: entry.etapaActual,
    hasActiveBooking: true,
    submittedToMesa: entry.submittedToMesa,
    subestado: entry.subestado ?? "en_proceso",
  });
}

export function mesaAgendaCancelDialogKindLabel(kind: MesaAgendaBookingKind): string {
  return formatMesaAgendaKind(kind);
}

export function mapMesaAgendaCancelErrorMessage(
  error: unknown,
  kind: MesaAgendaBookingKind,
): string {
  if (kind === "firmas" && error instanceof AgendaFirmasSupabaseError) {
    return error.message;
  }
  if (error instanceof AgendaBiometricosSupabaseError) {
    return error.message;
  }
  if (kind === "firmas") return "No se pudo cancelar la cita de firma.";
  if (kind === "notificacion") return "No se pudo cancelar la notificación.";
  return "No se pudo cancelar la cita biométrica.";
}

/** Roles RPC reales (`app_role` en Postgres). */
export type MesaReagendarRpcRole = "mesa_admin" | "super_admin";

/**
 * `mesa_control_admin` es alias UI de `mesa_admin` (ver `mapAppRoleToMockRole`).
 * No existe en el enum `app_role`; la RPC 068 solo acepta `mesa_admin` | `super_admin`.
 */
export function normalizeMesaReagendarGateRole(
  role: string | null | undefined,
): MesaReagendarRpcRole | null {
  const trimmed = String(role ?? "").trim();
  if (trimmed === "mesa_admin" || trimmed === "mesa_control_admin") {
    return "mesa_admin";
  }
  if (trimmed === "super_admin") {
    return "super_admin";
  }
  return null;
}

export const MESA_REAGENDAR_ADMIN_ROLES = new Set<string>([
  "mesa_admin",
  "mesa_control_admin",
  "super_admin",
]);

export type MesaReagendarGateResult = Readonly<{
  allowed: boolean;
  reason: string | null;
}>;

export type MesaAgendaListReagendarRoleParams = Readonly<{
  mockRole?: string | null;
  sessionRole?: string | null;
}>;

/** Resuelve rol admin para gate UI; normaliza alias UI → rol RPC. */
export function resolveMesaReagendarAdminRole(
  params: MesaAgendaListReagendarRoleParams,
): MesaReagendarRpcRole | null {
  const fromMock = normalizeMesaReagendarGateRole(params.mockRole);
  if (fromMock) return fromMock;
  const fromSession = normalizeMesaReagendarGateRole(params.sessionRole);
  if (fromSession) return fromSession;
  return null;
}

/** Indica si el gate UI coincide con lo que aceptará la RPC (068 / reagendar_firmas). */
export function mesaReagendarGateMatchesRpcRole(
  params: MesaAgendaListReagendarRoleParams,
): boolean {
  return resolveMesaReagendarAdminRole(params) != null;
}

function mesaReagendarEtapaOk(
  kind: MesaAgendaBookingKind,
  etapaActual: number,
): boolean {
  if (kind === "firmas") return etapaActual === 9 || etapaActual === 10;
  if (kind === "notificacion") return etapaActual === 3;
  return etapaActual === 3 || etapaActual === 4 || etapaActual === 5;
}

export function canMesaReagendarAgendaListEntry(
  entry: MesaAgendaBookingEntry,
  params: MesaAgendaListReagendarRoleParams,
): MesaReagendarGateResult {
  if (entry.status !== "booked") {
    return { allowed: false, reason: "Solo citas agendadas pueden reagendarse." };
  }
  if (!entry.submittedToMesa) {
    return { allowed: false, reason: "El expediente no está enviado a Mesa." };
  }
  if ((entry.subestado ?? "en_proceso") !== "en_proceso") {
    return { allowed: false, reason: "El expediente no está en subestado en_proceso." };
  }
  const role = resolveMesaReagendarAdminRole(params);
  if (!role) {
    return { allowed: false, reason: "Solo Mesa administrativa puede reagendar citas." };
  }
  if (!mesaReagendarEtapaOk(entry.kind, entry.etapaActual)) {
    return { allowed: false, reason: "La etapa actual no permite reagendar este tipo de cita." };
  }
  return { allowed: true, reason: null };
}

export const MESA_REAGENDAR_SUCCESS_MESSAGE =
  "Cita reagendada. El historial anterior quedó como cancelado.";

export function mapMesaAgendaReagendarErrorMessage(
  error: unknown,
  kind: MesaAgendaBookingKind,
): string {
  if (kind === "firmas" && error instanceof AgendaFirmasSupabaseError) {
    return error.message;
  }
  if (error instanceof AgendaBiometricosSupabaseError) {
    return error.message;
  }
  if (kind === "firmas") return "No se pudo reagendar la cita de firma.";
  if (kind === "notificacion") return "No se pudo reagendar la notificación.";
  return "No se pudo reagendar la cita biométrica.";
}

/** B4: cancelación; B5: reagenda admin. */
export function mesaAgendaHasMutationActions(): boolean {
  return true;
}

export function mesaAgendaHasReagendaActions(): boolean {
  return true;
}

export function formatMesaAgendaCreatedAt(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "—";
  try {
    const dt = new Date(trimmed);
    if (Number.isNaN(dt.getTime())) return trimmed;
    return dt.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return trimmed;
  }
}

export const MESA_DRIVE_VALIDATED_BADGE = "Validado en Drive";
export const MESA_DRIVE_VALIDATE_BUTTON = "Validar en Drive";
export const MESA_DRIVE_CLEAR_BUTTON = "Quitar validación";

/**
 * Botón Validar/Quitar Drive: solo citas `booked`.
 * Roles: los mismos que pueden ver `/mesa-control/citas`.
 */
export function canMesaShowDriveValidationActions(
  entry: MesaAgendaBookingEntry,
  role: string | null | undefined,
): boolean {
  if (entry.status !== "booked") return false;
  return canAccessMesaAgendaCitasPage(role);
}

export function mesaAgendaDriveValidatedRowClass(entry: MesaAgendaBookingEntry): string {
  if (!entry.driveValidated) return "";
  return "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200 shadow-sm";
}

export function mesaAgendaDriveValidatedBadgeClass(): string {
  return "inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-300";
}

export function formatMesaAgendaDriveValidatedMeta(entry: MesaAgendaBookingEntry): string | null {
  if (!entry.driveValidated) return null;
  const who = entry.driveValidatedBy
    ? mesaAgendaBookingPersonDisplayName(entry.driveValidatedBy)
    : "Mesa";
  const when = entry.driveValidatedAt
    ? formatMesaAgendaCreatedAt(entry.driveValidatedAt)
    : "—";
  return `${who} · ${when}`;
}

export function normalizeMesaAgendaBookingTimeForDisplay(
  kind: MesaAgendaBookingKind,
  bookingTime: string,
): string {
  if (kind === "notificacion") return NOTIFICACION_FIXED_TIME_DISPLAY;
  return normalizeBookingTime(bookingTime);
}
