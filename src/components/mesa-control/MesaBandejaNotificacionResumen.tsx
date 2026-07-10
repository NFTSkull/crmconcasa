"use client";

import type { AgendaNotificacionActiveBooking } from "@/domain/agenda-biometricos";
import {
  buildNotificacionBandejaLine,
  MESA_NOTIFICACION_EXTRAORDINARIA_TITLE,
} from "@/lib/mesaNotificacionExtraordinariaUi";

export type MesaBandejaNotificacionResumenProps = Readonly<{
  booking: AgendaNotificacionActiveBooking;
  agendadoPorLabel: string;
  asesorDueñoLabel: string;
}>;

export function MesaBandejaNotificacionResumen({
  booking,
  agendadoPorLabel,
  asesorDueñoLabel,
}: MesaBandejaNotificacionResumenProps) {
  return (
    <div
      className="mt-2 rounded-lg border border-amber-200/90 bg-amber-50/70 px-2.5 py-2"
      data-testid="mesa-bandeja-notificacion-extraordinaria"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-950">
        {MESA_NOTIFICACION_EXTRAORDINARIA_TITLE}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-amber-950/90">
        {buildNotificacionBandejaLine({ booking, agendadoPorLabel, asesorDueñoLabel })}
      </p>
    </div>
  );
}
