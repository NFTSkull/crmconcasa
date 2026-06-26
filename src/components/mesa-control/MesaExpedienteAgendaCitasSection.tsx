"use client";

import type { ReactNode } from "react";
import type { AgendaBiometricosActiveBooking } from "@/domain/agenda-biometricos";
import type { AgendaFirmasActiveBooking } from "@/domain/agenda-firmas";
import { MESA_ETAPA_FIRMA_P3Q_NOTA } from "@/domain/expedientes/mesa-decision-ux";

export type MesaExpedienteAgendaCitasSectionProps = Readonly<{
  etapaActual: number | null;
  fechaCita?: string | null;
  biometricBooking: AgendaBiometricosActiveBooking | null;
  biometricLocationLabel?: string | null;
  firmasBooking: AgendaFirmasActiveBooking | null;
  firmasLocationLabel?: string | null;
  embedded?: boolean;
}>;

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

function CitaBlock({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "sky" | "violet" | "amber";
  children: ReactNode;
}) {
  const tones = {
    sky: "border-sky-200 bg-sky-50/50",
    violet: "border-violet-200 bg-violet-50/50",
    amber: "border-amber-200 bg-amber-50/50",
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function MesaExpedienteAgendaCitasSection({
  etapaActual,
  fechaCita,
  biometricBooking,
  biometricLocationLabel,
  firmasBooking,
  firmasLocationLabel,
  embedded = false,
}: MesaExpedienteAgendaCitasSectionProps) {
  const hasFecha = typeof fechaCita === "string" && fechaCita.trim() !== "";
  const showBio = Boolean(biometricBooking) || (hasFecha && (etapaActual === 4 || etapaActual === 5));
  const showFirma =
    Boolean(firmasBooking) ||
    etapaActual === 9 ||
    etapaActual === 10 ||
    (hasFecha && (etapaActual === 9 || etapaActual === 10));

  if (!showBio && !showFirma) {
    return (
      <p className={embedded ? "px-4 py-3 text-sm text-gray-500" : "text-sm text-gray-500"}>
        No hay citas biométricas ni de firma registradas en este expediente.
      </p>
    );
  }

  const wrapperClass = embedded ? "space-y-3 p-4" : "space-y-3";

  return (
    <div className={wrapperClass}>
      {showBio ? (
        <CitaBlock title="Cita biométricos" tone="sky">
          {biometricBooking ? (
            <dl className="grid gap-2 text-xs text-gray-800 sm:grid-cols-2">
              <div>
                <dt className="font-medium text-gray-600">Fecha</dt>
                <dd className="mt-0.5">{formatBookingDate(biometricBooking.bookingDate)}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-600">Hora</dt>
                <dd className="mt-0.5">{normalizeBookingTime(biometricBooking.bookingTime)}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-600">Sede</dt>
                <dd className="mt-0.5">
                  {biometricLocationLabel?.trim() || biometricBooking.locationId}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-600">Estatus</dt>
                <dd className="mt-0.5 capitalize">{biometricBooking.status}</dd>
              </div>
            </dl>
          ) : hasFecha ? (
            <p className="text-xs text-amber-900">
              Fecha en expediente: {formatFechaCitaIso(fechaCita!)}. Sin reserva activa en agenda.
            </p>
          ) : (
            <p className="text-xs text-gray-600">Sin cita biométrica registrada.</p>
          )}
        </CitaBlock>
      ) : null}

      {showFirma ? (
        <CitaBlock
          title={
            etapaActual === 10
              ? "Cita de firma — pendiente de resultado"
              : "Cita de firma"
          }
          tone="violet"
        >
          {etapaActual === 10 ? (
            <p className="mb-2 text-[11px] leading-snug text-violet-950">{MESA_ETAPA_FIRMA_P3Q_NOTA}</p>
          ) : null}
          {firmasBooking ? (
            <dl className="grid gap-2 text-xs text-gray-800 sm:grid-cols-2">
              <div>
                <dt className="font-medium text-gray-600">Fecha</dt>
                <dd className="mt-0.5">{formatBookingDate(firmasBooking.bookingDate)}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-600">Hora</dt>
                <dd className="mt-0.5">{normalizeBookingTime(firmasBooking.bookingTime)}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-600">Sede</dt>
                <dd className="mt-0.5">{firmasLocationLabel?.trim() || firmasBooking.locationId}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-600">Estatus</dt>
                <dd className="mt-0.5 capitalize">{firmasBooking.status}</dd>
              </div>
              {hasFecha ? (
                <div className="sm:col-span-2">
                  <dt className="font-medium text-gray-600">Fecha en expediente</dt>
                  <dd className="mt-0.5">{formatFechaCitaIso(fechaCita!)}</dd>
                </div>
              ) : null}
            </dl>
          ) : hasFecha ? (
            <p className="text-xs text-amber-900">
              Fecha en expediente: {formatFechaCitaIso(fechaCita!)}. Sin reserva activa en agenda.
            </p>
          ) : (
            <p className="text-xs text-gray-600">Sin cita de firma registrada.</p>
          )}
        </CitaBlock>
      ) : null}
    </div>
  );
}
