"use client";

import type { AgendaBiometricosActiveBooking } from "@/domain/agenda-biometricos";
import { isFechaCitaBiometricaPasada } from "@/domain/expedientes/mesa-avance-integracion";

export type MesaCitaBiometricosResumenSectionProps = {
  etapaActual: number | null;
  fechaCita?: string | null;
  booking: AgendaBiometricosActiveBooking | null;
  locationLabel?: string | null;
};

function formatBookingDate(dateYmd: string): string {
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

function formatFechaCitaIso(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("es-MX", { dateStyle: "full", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function citaEsEtapaBiometrica(etapaActual: number | null): boolean {
  return etapaActual === 4 || etapaActual === 5;
}

export function MesaCitaBiometricosResumenSection({
  etapaActual,
  fechaCita,
  booking,
  locationLabel,
}: MesaCitaBiometricosResumenSectionProps) {
  if (!citaEsEtapaBiometrica(etapaActual)) return null;

  const hasFecha = typeof fechaCita === "string" && fechaCita.trim() !== "";

  if (!booking && !hasFecha) return null;

  if (!booking && hasFecha) {
    return (
      <section
        className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm"
        aria-label="Cita biométrica"
      >
        <p className="text-sm font-semibold text-amber-950">Cita biométrica</p>
        <p className="mt-2 text-xs text-amber-900">
          Hay fecha de cita registrada ({formatFechaCitaIso(fechaCita!)}), pero no hay reserva
          biométrica activa en Supabase. El asesor debe agendar o verificar la cita.
        </p>
      </section>
    );
  }

  if (!booking) return null;

  const sede = locationLabel?.trim() || booking.locationId;
  const citaOcurrida = isFechaCitaBiometricaPasada(fechaCita);
  const enEtapa5 = etapaActual === 5;

  const titulo =
    enEtapa5 && citaOcurrida
      ? "Cita biométrica ya ocurrió"
      : enEtapa5
        ? "Cita biométrica registrada"
        : "Cita biométrica agendada";

  const borderClass =
    enEtapa5 && citaOcurrida
      ? "border-sky-200 bg-sky-50/60"
      : "border-emerald-200 bg-emerald-50/60";

  const titleClass =
    enEtapa5 && citaOcurrida ? "text-sky-900" : "text-emerald-900";

  const bodyClass =
    enEtapa5 && citaOcurrida ? "text-sky-950" : "text-emerald-950";

  const labelClass =
    enEtapa5 && citaOcurrida ? "text-sky-800" : "text-emerald-800";

  return (
    <section
      className={`rounded-xl border p-4 shadow-sm ${borderClass}`}
      aria-label="Resumen cita biométrica"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className={`text-sm font-semibold ${titleClass}`}>{titulo}</p>
        {enEtapa5 ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              citaOcurrida
                ? "bg-sky-100 text-sky-900"
                : "bg-amber-100 text-amber-950"
            }`}
          >
            {citaOcurrida ? "Cita ocurrida" : "Cita pendiente"}
          </span>
        ) : null}
      </div>
      {enEtapa5 ? (
        <p className={`mt-1 text-[11px] leading-snug ${bodyClass}`}>
          {citaOcurrida
            ? "La fecha de cita ya pasó. Mesa puede avanzar a inscripción cuando corresponda (sin registrar resultado formal en P3N.1)."
            : "La cita aún no ocurre. El avance a inscripción se habilitará después de la fecha programada."}
        </p>
      ) : null}
      <dl className={`mt-3 grid gap-2 text-xs sm:grid-cols-2 ${bodyClass}`}>
        <div>
          <dt className={`font-medium ${labelClass}`}>Fecha</dt>
          <dd className="mt-0.5">{formatBookingDate(booking.bookingDate)}</dd>
        </div>
        <div>
          <dt className={`font-medium ${labelClass}`}>Hora</dt>
          <dd className="mt-0.5">{booking.bookingTime}</dd>
        </div>
        <div>
          <dt className={`font-medium ${labelClass}`}>Sede</dt>
          <dd className="mt-0.5">{sede}</dd>
        </div>
        <div>
          <dt className={`font-medium ${labelClass}`}>Estatus reserva</dt>
          <dd className="mt-0.5 capitalize">{booking.status}</dd>
        </div>
      </dl>
    </section>
  );
}
