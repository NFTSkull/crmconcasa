import {
  buildLocalIsoFromDateAndTime,
  slotKeyFromFechaCita,
} from "@/lib/agendaBiometricosMock";
import { getEffectiveMockRole } from "@/lib/mockUser";
import type { HhmmTime, YmdDate } from "@/domain/agenda-biometricos";

export const AGENDA_FIRMAS_BOOKINGS_KEY_V1 = "agenda_firmas_bookings_v1";
export const AGENDA_FIRMAS_CONFIG_KEY_V1 = "agenda_firmas_config_v1";

export type FirmasBookingRow = Readonly<{
  id?: string;
  expedienteId?: string;
  status?: string;
  date?: string;
  time?: string;
  locationId?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: Readonly<{ email?: string; role?: string }>;
  cancelledAt?: string;
  cancelledBy?: Readonly<{ email?: string; role?: string }>;
  cancelReason?: string | null;
  note?: string | null;
}>;

export type FirmasBookingsDocV1 = Readonly<{
  version?: number;
  kind?: string;
  updatedAt?: string;
  bookings?: readonly FirmasBookingRow[];
}>;

function safeJsonParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function readFirmasBookingsDoc(): FirmasBookingsDocV1 {
  if (typeof window === "undefined") return { bookings: [] };
  const parsed = safeJsonParse(window.localStorage.getItem(AGENDA_FIRMAS_BOOKINGS_KEY_V1));
  if (!parsed || typeof parsed !== "object") return { bookings: [] };
  return parsed as FirmasBookingsDocV1;
}

/** Rol mock efectivo (`mock_user.role` o `mock_role` legacy). */
export function readActorMockRole(): string | null {
  return getEffectiveMockRole();
}

export function isMesaControlAdminMockRole(): boolean {
  return getEffectiveMockRole() === "mesa_control_admin";
}

/** Solo admin puede montar UI de agenda de firmas y ejecutar booking en cliente mock. */
export function canMountAgendaFirmasAgendaUI(): boolean {
  return isMesaControlAdminMockRole();
}

/** Agenda de biométricos editable: solo asesor (Mesa no agenda; solo consulta cita en detalle). */
export function canMountAgendaBiometricosUI(): boolean {
  return getEffectiveMockRole() === "asesor";
}

/** Tarjeta de agenda biométricos en expediente asesor: etapa operativa 4 (Cita agendada). */
export function canShowAgendaBiometricosForEtapa(etapaActual: number | null | undefined): boolean {
  return etapaActual === 4;
}

/**
 * ¿Existe una reserva `booked` de firmas para este expediente cuya fecha/hora coincide con `fechaCitaIso`?
 * Usa la misma clave de slot que biométricos (`slotKeyFromFechaCita`) para alinear con `updateOperativo`.
 */
export function hasActiveFirmasBookingForCitaInList(
  expedienteId: string,
  fechaCitaIso: string,
  bookings: readonly FirmasBookingRow[],
): boolean {
  const targetKey = slotKeyFromFechaCita(fechaCitaIso);
  if (!targetKey) return false;
  const idNorm = String(expedienteId).trim();
  for (const b of bookings) {
    if (b.status !== "booked") continue;
    if (String(b.expedienteId ?? "").trim() !== idNorm) continue;
    const date = b.date;
    const time = b.time;
    if (!date || !time) continue;
    const iso = buildLocalIsoFromDateAndTime(date as YmdDate, time as HhmmTime);
    if (!iso) continue;
    const k = slotKeyFromFechaCita(iso);
    if (k === targetKey) return true;
  }
  return false;
}

export function hasActiveFirmasBookingForCita(
  expedienteId: string,
  fechaCitaIso: string,
): boolean {
  const doc = readFirmasBookingsDoc();
  const list = Array.isArray(doc.bookings) ? doc.bookings : [];
  return hasActiveFirmasBookingForCitaInList(expedienteId, fechaCitaIso, list);
}
