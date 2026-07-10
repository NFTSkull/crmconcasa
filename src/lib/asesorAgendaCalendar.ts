import { MockAgendaBiometricosLocalStorageRepo } from "@/domain/agenda-biometricos/mock-localstorage.repo";
import {
  readFirmasBookingsDoc,
  type FirmasBookingRow,
} from "@/lib/agendaFirmasBookingsGuard";

export type AgendaCalendarKind = "biometricos" | "firmas" | "notificacion";
export type AgendaCalendarStatus = "booked" | "cancelled";
export type AgendaCalendarKindFilter = "all" | AgendaCalendarKind;

export type AsesorAgendaCalendarEntry = Readonly<{
  bookingId: string;
  bookingDate: string;
  bookingTime: string;
  kind: AgendaCalendarKind;
  status: AgendaCalendarStatus;
  locationId: string;
  asesorId: string;
  asesorFullName: string | null;
  asesorEmail: string | null;
}>;

export type AsesorAgendaCalendarFilters = Readonly<{
  kind: AgendaCalendarKindFilter;
  includeCancelled: boolean;
  selectedDate: string;
}>;

const MAX_RANGE_DAYS = 62;

/** Fecha YYYY-MM-DD desde DATE o ISO datetime. */
export function normalizeBookingDate(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return m ? m[1]! : String(value).trim();
}

/** Hora HH:mm desde TIME (`08:00:00`), HH:mm o H:mm. */
export function normalizeBookingTime(value: string): string {
  const raw = String(value).trim();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?/.exec(raw);
  if (!m) return raw;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return raw;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function formatAgendaCalendarKindLabel(kind: AgendaCalendarKind): string {
  if (kind === "biometricos") return "Biométricos";
  if (kind === "notificacion") return "Notificación";
  return "Firma";
}

export function formatAgendaCalendarStatusLabel(status: AgendaCalendarStatus): string {
  return status === "booked" ? "Agendada" : "Cancelada";
}

export function asesorAgendaCalendarDisplayName(entry: AsesorAgendaCalendarEntry): string {
  const name = entry.asesorFullName?.trim();
  if (name) return name;
  const email = entry.asesorEmail?.trim();
  if (email) return email;
  return "Asesor";
}

export function compareCalendarEntries(
  a: AsesorAgendaCalendarEntry,
  b: AsesorAgendaCalendarEntry,
): number {
  const dateCmp = a.bookingDate.localeCompare(b.bookingDate);
  if (dateCmp !== 0) return dateCmp;
  const timeCmp = a.bookingTime.localeCompare(b.bookingTime);
  if (timeCmp !== 0) return timeCmp;
  return a.kind.localeCompare(b.kind);
}

export function isDateWithinInclusiveRange(
  dateYmd: string,
  startYmd: string,
  endYmd: string,
): boolean {
  return dateYmd >= startYmd && dateYmd <= endYmd;
}

export function computeCalendarMonthRange(year: number, monthIndex: number): {
  startDate: string;
  endDate: string;
} {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const startDate = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const endDate = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
  return { startDate, endDate };
}

export function assertCalendarDateRange(startDate: string, endDate: string): void {
  if (!startDate || !endDate || endDate < startDate) {
    throw new Error("Rango de fechas inválido.");
  }
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const diffDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays > MAX_RANGE_DAYS) {
    throw new Error(`El rango no puede superar ${MAX_RANGE_DAYS} días.`);
  }
}

export function filterCalendarEntries(
  entries: readonly AsesorAgendaCalendarEntry[],
  filters: Pick<AsesorAgendaCalendarFilters, "kind" | "includeCancelled" | "selectedDate">,
): AsesorAgendaCalendarEntry[] {
  return entries
    .filter((entry) => entry.bookingDate === filters.selectedDate)
    .filter((entry) => filters.includeCancelled || entry.status === "booked")
    .filter((entry) => filters.kind === "all" || entry.kind === filters.kind)
    .slice()
    .sort(compareCalendarEntries);
}

export function groupCalendarEntriesByDate(
  entries: readonly AsesorAgendaCalendarEntry[],
): Readonly<Record<string, readonly AsesorAgendaCalendarEntry[]>> {
  const out: Record<string, AsesorAgendaCalendarEntry[]> = {};
  for (const entry of [...entries].sort(compareCalendarEntries)) {
    const bucket = out[entry.bookingDate] ?? [];
    bucket.push(entry);
    out[entry.bookingDate] = bucket;
  }
  return out;
}

function mapFirmasRow(row: FirmasBookingRow, index: number): AsesorAgendaCalendarEntry | null {
  const date = row.date?.trim();
  const time = row.time?.trim();
  if (!date || !time) return null;
  const status = row.status === "cancelled" ? "cancelled" : "booked";
  const email = row.createdBy?.email?.trim() ?? null;
  return {
    bookingId: row.id?.trim() || `firmas-mock-${index}`,
    bookingDate: date,
    bookingTime: normalizeBookingTime(time),
    kind: "firmas",
    status,
    locationId: row.locationId?.trim() || "—",
    asesorId: email ?? "mock-firmas",
    asesorFullName: null,
    asesorEmail: email,
  };
}

/** Lectura mock org-wide desde localStorage (solo desarrollo). */
export function loadMockAgendaCalendarEntries(params: {
  startDate: string;
  endDate: string;
  includeCancelled: boolean;
}): AsesorAgendaCalendarEntry[] {
  assertCalendarDateRange(params.startDate, params.endDate);

  const bioRepo = new MockAgendaBiometricosLocalStorageRepo();
  const bioRows = bioRepo.readBookings().bookings ?? [];
  const firmaRows = readFirmasBookingsDoc().bookings ?? [];

  const entries: AsesorAgendaCalendarEntry[] = [];

  for (const [index, row] of bioRows.entries()) {
    const date = row.date?.trim();
    const time = row.time?.trim();
    if (!date || !time) continue;
    if (!isDateWithinInclusiveRange(date, params.startDate, params.endDate)) continue;
    const status = row.status === "cancelled" ? "cancelled" : "booked";
    if (!params.includeCancelled && status !== "booked") continue;
    const email = row.createdBy?.email?.trim() ?? null;
    entries.push({
      bookingId: row.id?.trim() || `bio-mock-${index}`,
      bookingDate: date,
      bookingTime: normalizeBookingTime(time),
      kind: "biometricos",
      status,
      locationId: row.locationId?.trim() || "—",
      asesorId: email ?? "mock-biometricos",
      asesorFullName: null,
      asesorEmail: email,
    });
  }

  for (const [index, row] of firmaRows.entries()) {
    const mapped = mapFirmasRow(row, index);
    if (!mapped) continue;
    if (!isDateWithinInclusiveRange(mapped.bookingDate, params.startDate, params.endDate)) continue;
    if (!params.includeCancelled && mapped.status !== "booked") continue;
    entries.push(mapped);
  }

  return entries.sort(compareCalendarEntries);
}

export function todayYmdLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function shiftYmd(dateYmd: string, deltaDays: number): string {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + deltaDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
