"use client";

import { Button } from "@/components/ui/Button";
import type { AgendaNotificacionActiveBooking } from "@/domain/agenda-biometricos";
import { NOTIFICACION_FIXED_TIME_DISPLAY } from "@/domain/agenda-biometricos/notificacion-constants";
import {
  formatNotificacionBookingDate,
  MESA_NOTIFICACION_EXTRAORDINARIA_TITLE,
  notificacionBookingStatusLabel,
} from "@/lib/mesaNotificacionExtraordinariaUi";
import {
  canMesaShowCancelCitaButton,
  MESA_CANCEL_NOTIFICACION_BUTTON_LABEL,
} from "@/lib/mesaAgendaCancelAccess";

export type MesaNotificacionExtraordinariaSectionProps = Readonly<{
  booking: AgendaNotificacionActiveBooking;
  asesorDueñoLabel: string;
  agendadoPorLabel: string;
  etapaActual: number | null;
  fechaCita?: string | null;
  submittedToMesa?: boolean;
  subestado?: string | null;
  cicloEstado?: string | null;
  mockRole?: string | null;
  sessionRole?: string | null;
  cancelSuccess?: string | null;
  onRequestCancel?: () => void;
  embedded?: boolean;
}>;

export function MesaNotificacionExtraordinariaSection({
  booking,
  asesorDueñoLabel,
  agendadoPorLabel,
  etapaActual,
  fechaCita,
  submittedToMesa = true,
  subestado = "en_proceso",
  cicloEstado = "activo",
  mockRole = null,
  sessionRole = null,
  cancelSuccess = null,
  onRequestCancel,
  embedded = false,
}: MesaNotificacionExtraordinariaSectionProps) {
  const puedeCancelar = canMesaShowCancelCitaButton({
    kind: "notificacion",
    mockRole,
    sessionRole,
    etapaActual,
    hasActiveBooking: true,
    fechaCita,
    submittedToMesa,
    subestado,
    cicloEstado,
  });

  const wrapperClass = embedded
    ? "rounded-lg border border-amber-200 bg-amber-50/50 p-4"
    : "rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm";

  return (
    <section className={wrapperClass} aria-label={MESA_NOTIFICACION_EXTRAORDINARIA_TITLE}>
      <p className="text-sm font-semibold text-amber-950">{MESA_NOTIFICACION_EXTRAORDINARIA_TITLE}</p>
      <p className="mt-1 text-[11px] leading-snug text-amber-900/90">
        Rama alternativa en etapa 3. No es cita biométrica; Mesa puede avanzar 3→5 cuando corresponda.
      </p>

      {cancelSuccess ? (
        <p
          role="status"
          className="mt-3 rounded-md border border-amber-300 bg-white/80 px-3 py-2 text-xs font-medium text-amber-950"
        >
          {cancelSuccess}
        </p>
      ) : null}

      <dl className="mt-3 grid gap-2 text-xs text-gray-800 sm:grid-cols-2">
        <div>
          <dt className="font-medium text-gray-600">Fecha</dt>
          <dd className="mt-0.5">{formatNotificacionBookingDate(booking.bookingDate)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-600">Hora</dt>
          <dd className="mt-0.5">{NOTIFICACION_FIXED_TIME_DISPLAY}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-600">Estado</dt>
          <dd className="mt-0.5">{notificacionBookingStatusLabel(booking.status)}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-600">Agendada por</dt>
          <dd className="mt-0.5">{agendadoPorLabel || "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-medium text-gray-600">Asesor dueño del expediente</dt>
          <dd className="mt-0.5">{asesorDueñoLabel || "—"}</dd>
        </div>
      </dl>

      {puedeCancelar && onRequestCancel ? (
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full text-xs sm:w-auto"
          onClick={onRequestCancel}
        >
          {MESA_CANCEL_NOTIFICACION_BUTTON_LABEL}
        </Button>
      ) : null}
    </section>
  );
}
