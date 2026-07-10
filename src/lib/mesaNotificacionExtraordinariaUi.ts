import type { AgendaNotificacionActiveBooking } from "@/domain/agenda-biometricos";
import { NOTIFICACION_FIXED_TIME_DISPLAY } from "@/domain/agenda-biometricos/notificacion-constants";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";

export const MESA_NOTIFICACION_EXTRAORDINARIA_TITLE = "Notificación extraordinaria";

export function formatNotificacionBookingDate(dateYmd: string): string {
  try {
    const [y, mo, d] = dateYmd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
    if (Number.isNaN(dt.getTime())) return dateYmd;
    return dt.toLocaleDateString("es-MX", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateYmd;
  }
}

export function formatNotificacionBookingDateShort(dateYmd: string): string {
  try {
    const [y, mo, d] = dateYmd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
    if (Number.isNaN(dt.getTime())) return dateYmd;
    return dt.toLocaleDateString("es-MX", { dateStyle: "medium" });
  } catch {
    return dateYmd;
  }
}

export function notificacionBookingStatusLabel(status: AgendaNotificacionActiveBooking["status"]): string {
  if (status === "booked") return "Agendada";
  return status;
}

export function buildNotificacionExtraordinariaAccordionSummary(
  booking: AgendaNotificacionActiveBooking | null | undefined,
): string {
  if (!booking) return "Sin notificación agendada";
  return `${formatNotificacionBookingDateShort(booking.bookingDate)} · ${NOTIFICACION_FIXED_TIME_DISPLAY} · ${notificacionBookingStatusLabel(booking.status)}`;
}

export function buildNotificacionBandejaLine(params: {
  booking: AgendaNotificacionActiveBooking;
  agendadoPorLabel: string;
  asesorDueñoLabel: string;
}): string {
  const parts = [
    formatNotificacionBookingDateShort(params.booking.bookingDate),
    NOTIFICACION_FIXED_TIME_DISPLAY,
    notificacionBookingStatusLabel(params.booking.status),
  ];
  if (params.agendadoPorLabel.trim()) {
    parts.push(`Agendada por ${params.agendadoPorLabel.trim()}`);
  }
  if (params.asesorDueñoLabel.trim()) {
    parts.push(`Asesor ${params.asesorDueñoLabel.trim()}`);
  }
  return parts.join(" · ");
}

export function resolveProfileDisplayLabel(fields: {
  fullName?: string | null;
  email?: string | null;
  fallbackId?: string | null;
}): string {
  return formatAsesorExpedienteLabel({
    fullName: fields.fullName,
    email: fields.email,
    fallbackId: fields.fallbackId,
  });
}
