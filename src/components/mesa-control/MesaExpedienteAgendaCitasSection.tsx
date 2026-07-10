"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type { AgendaBiometricosActiveBooking } from "@/domain/agenda-biometricos";
import type { AgendaFirmasActiveBooking } from "@/domain/agenda-firmas";
import { MESA_ETAPA_FIRMA_P3Q_NOTA } from "@/domain/expedientes/mesa-decision-ux";
import {
  canMesaShowCancelCitaButton,
  MESA_CANCEL_BIO_BUTTON_LABEL,
  MESA_CANCEL_FIRMAS_BUTTON_LABEL,
} from "@/lib/mesaAgendaCancelAccess";

export type MesaExpedienteAgendaCitasSectionProps = Readonly<{
  etapaActual: number | null;
  fechaCita?: string | null;
  submittedToMesa?: boolean;
  subestado?: string | null;
  cicloEstado?: string | null;
  hasActiveNotificacionBooking?: boolean;
  biometricBooking: AgendaBiometricosActiveBooking | null;
  biometricLocationLabel?: string | null;
  firmasBooking: AgendaFirmasActiveBooking | null;
  firmasLocationLabel?: string | null;
  mockRole?: string | null;
  sessionRole?: string | null;
  biometricosCancelSuccess?: string | null;
  biometricosCancelledMotivo?: string | null;
  firmasCancelSuccess?: string | null;
  firmasCancelledMotivo?: string | null;
  onRequestCancelBiometricos?: () => void;
  onRequestCancelFirmas?: () => void;
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
  tone: "sky" | "violet";
  children: ReactNode;
}) {
  const tones = {
    sky: "border-sky-200 bg-sky-50/50",
    violet: "border-violet-200 bg-violet-50/50",
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function CancelledSummary({
  motivo,
  tone,
}: {
  motivo: string | null;
  tone: "sky" | "violet";
}) {
  const textClass = tone === "sky" ? "text-sky-950" : "text-violet-950";
  return (
    <div className={`text-xs ${textClass}`}>
      <p className="font-medium">Cita cancelada</p>
      {motivo ? (
        <p className="mt-1">
          <span className="font-medium">Motivo para el asesor:</span> {motivo}
        </p>
      ) : null}
    </div>
  );
}

export function MesaExpedienteAgendaCitasSection({
  etapaActual,
  fechaCita,
  submittedToMesa = true,
  subestado = "en_proceso",
  cicloEstado = "activo",
  hasActiveNotificacionBooking = false,
  biometricBooking,
  biometricLocationLabel,
  firmasBooking,
  firmasLocationLabel,
  mockRole = null,
  sessionRole = null,
  biometricosCancelSuccess = null,
  biometricosCancelledMotivo = null,
  firmasCancelSuccess = null,
  firmasCancelledMotivo = null,
  onRequestCancelBiometricos,
  onRequestCancelFirmas,
  embedded = false,
}: MesaExpedienteAgendaCitasSectionProps) {
  const hasFecha = typeof fechaCita === "string" && fechaCita.trim() !== "";
  const showBio =
    Boolean(biometricBooking) ||
    Boolean(biometricosCancelledMotivo) ||
    (hasFecha &&
      !hasActiveNotificacionBooking &&
      (etapaActual === 3 || etapaActual === 4 || etapaActual === 5));
  const showFirma =
    Boolean(firmasBooking) ||
    etapaActual === 9 ||
    etapaActual === 10 ||
    (hasFecha && (etapaActual === 9 || etapaActual === 10)) ||
    Boolean(firmasCancelledMotivo);

  const puedeCancelarBiometricos = canMesaShowCancelCitaButton({
    kind: "biometricos",
    mockRole,
    sessionRole,
    etapaActual,
    hasActiveBooking: biometricBooking != null,
    fechaCita,
    submittedToMesa,
    subestado,
    cicloEstado,
  });
  const puedeCancelarFirmas = canMesaShowCancelCitaButton({
    kind: "firmas",
    mockRole,
    sessionRole,
    etapaActual,
    hasActiveBooking: firmasBooking != null,
    fechaCita,
    submittedToMesa,
    subestado,
    cicloEstado,
  });

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
          {biometricosCancelSuccess ? (
            <p
              role="status"
              className="mb-3 rounded-md border border-sky-300 bg-white/80 px-3 py-2 text-xs font-medium text-sky-950"
            >
              {biometricosCancelSuccess}
            </p>
          ) : null}
          {biometricBooking ? (
            <>
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
              {puedeCancelarBiometricos && onRequestCancelBiometricos ? (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 w-full text-xs"
                  onClick={onRequestCancelBiometricos}
                >
                  {MESA_CANCEL_BIO_BUTTON_LABEL}
                </Button>
              ) : null}
            </>
          ) : biometricosCancelledMotivo || biometricosCancelSuccess ? (
            <CancelledSummary motivo={biometricosCancelledMotivo} tone="sky" />
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
          {firmasCancelSuccess ? (
            <p
              role="status"
              className="mb-3 rounded-md border border-violet-300 bg-white/80 px-3 py-2 text-xs font-medium text-violet-950"
            >
              {firmasCancelSuccess}
            </p>
          ) : null}
          {firmasBooking ? (
            <>
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
              {puedeCancelarFirmas && onRequestCancelFirmas ? (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 w-full text-xs"
                  onClick={onRequestCancelFirmas}
                >
                  {MESA_CANCEL_FIRMAS_BUTTON_LABEL}
                </Button>
              ) : null}
            </>
          ) : firmasCancelledMotivo || firmasCancelSuccess ? (
            <CancelledSummary motivo={firmasCancelledMotivo} tone="violet" />
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
