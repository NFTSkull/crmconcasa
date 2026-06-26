"use client";

import type { AgendaFirmasActiveBooking } from "@/domain/agenda-firmas";

export type MesaCitaFirmasResumenSectionProps = {
  etapaActual: number | null;
  fechaCita?: string | null;
  booking: AgendaFirmasActiveBooking | null;
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

function normalizeBookingTime(time: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(String(time).trim());
  return m ? `${m[1]}:${m[2]}` : String(time).trim();
}

export function MesaCitaFirmasResumenSection({
  etapaActual,
  fechaCita,
  booking,
  locationLabel,
}: MesaCitaFirmasResumenSectionProps) {
  if (etapaActual !== 9) return null;

  const hasFecha = typeof fechaCita === "string" && fechaCita.trim() !== "";

  if (!booking && !hasFecha) return null;

  if (!booking && hasFecha) {
    return (
      <section
        className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm"
        aria-label="Cita de firma"
      >
        <p className="text-sm font-semibold text-amber-950">Cita de firma</p>
        <p className="mt-2 text-xs text-amber-900">
          Hay fecha de cita registrada ({formatFechaCitaIso(fechaCita!)}), pero no hay reserva de
          firma activa en Supabase. El asesor debe agendar o verificar la cita.
        </p>
      </section>
    );
  }

  if (!booking) return null;

  const sede = locationLabel?.trim() || booking.locationId;
  const hora = normalizeBookingTime(booking.bookingTime);

  return (
    <section
      className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 shadow-sm"
      aria-label="Resumen cita de firma"
    >
      <p className="text-sm font-semibold text-violet-900">Cita de firma agendada</p>
      <p className="mt-1 text-[11px] leading-snug text-violet-950">
        El asesor agendó la firma. Mesa puede avanzar a etapa 10 cuando corresponda.
      </p>
      <dl className="mt-3 grid gap-2 text-xs text-violet-950 sm:grid-cols-2">
        <div>
          <dt className="font-medium text-violet-800">Fecha</dt>
          <dd className="mt-0.5">{formatBookingDate(booking.bookingDate)}</dd>
        </div>
        <div>
          <dt className="font-medium text-violet-800">Hora</dt>
          <dd className="mt-0.5">{hora}</dd>
        </div>
        <div>
          <dt className="font-medium text-violet-800">Sede</dt>
          <dd className="mt-0.5">{sede}</dd>
        </div>
        <div>
          <dt className="font-medium text-violet-800">Estatus reserva</dt>
          <dd className="mt-0.5 capitalize">{booking.status}</dd>
        </div>
        {booking.note?.trim() ? (
          <div className="sm:col-span-2">
            <dt className="font-medium text-violet-800">Nota</dt>
            <dd className="mt-0.5 whitespace-pre-wrap">{booking.note.trim()}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
