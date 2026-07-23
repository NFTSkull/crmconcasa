"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  AgendaBiometricosSupabaseError,
  NOTIFICACION_FIXED_TIME,
  NOTIFICACION_UI_HINT,
  todayYmdInTimezone,
  type AgendaBiometricosWeeklyConfig,
  type AgendaNotificacionActiveBooking,
  type YmdDate,
} from "@/domain/agenda-biometricos";
import type { AgendaBiometricosBookingRepo } from "@/domain/agenda-biometricos/repo";
import {
  CYNTHIA_SEDE_APODACA_ID,
  CYNTHIA_SEDE_MONTERREY_ID,
  type CynthiaSedeId,
} from "@/lib/agendaCynthiaLocations";
import { formatMesaAgendaSedeLabel } from "@/lib/mesaAgendaCitasUi";

export type AgendaNotificacionSupabaseTabProps = Readonly<{
  expedienteId: string;
  config: AgendaBiometricosWeeklyConfig | null;
  repo: AgendaBiometricosBookingRepo;
  activeNotificacion: AgendaNotificacionActiveBooking | null;
  onUpdated: () => void;
}>;

function formatNotificacionDate(dateYmd: string): string {
  try {
    const [y, mo, d] = dateYmd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
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

function resolveInitialSede(
  active: AgendaNotificacionActiveBooking | null,
): CynthiaSedeId {
  const loc = String(active?.locationId ?? "").trim().toLowerCase();
  if (loc === CYNTHIA_SEDE_APODACA_ID) return CYNTHIA_SEDE_APODACA_ID;
  return CYNTHIA_SEDE_MONTERREY_ID;
}

export function AgendaNotificacionSupabaseTab({
  expedienteId,
  config,
  repo,
  activeNotificacion,
  onUpdated,
}: AgendaNotificacionSupabaseTabProps) {
  const [dateYmd, setDateYmd] = useState<YmdDate>(() =>
    (activeNotificacion?.bookingDate as YmdDate | undefined) ??
      (config ? todayYmdInTimezone(config.timezone) : ("2026-01-01" as YmdDate)),
  );
  const [sedeId, setSedeId] = useState<CynthiaSedeId>(() =>
    resolveInitialSede(activeNotificacion),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleBook = useCallback(async () => {
    if (!config || !dateYmd || !sedeId) return;
    setError(null);
    setSuccessMsg(null);

    const confirmar = window.confirm(
      `¿Confirmas agendar notificación el ${dateYmd} a las 12:00 PM en ${formatMesaAgendaSedeLabel(sedeId)}?`,
    );
    if (!confirmar) return;

    setSaving(true);
    try {
      await repo.bookNotificacionEtapa3({
        expedienteId,
        bookingDate: dateYmd,
        locationId: sedeId,
      });
      setSuccessMsg("Notificación agendada correctamente.");
      onUpdated();
    } catch (err) {
      setError(
        err instanceof AgendaBiometricosSupabaseError
          ? err.message
          : "No se pudo agendar la notificación. Intenta de nuevo.",
      );
    } finally {
      setSaving(false);
    }
  }, [config, dateYmd, expedienteId, onUpdated, repo, sedeId]);

  const handleCancel = useCallback(async () => {
    if (!window.confirm("¿Confirmas cancelar la notificación agendada?")) return;
    const motivo = window.prompt("Motivo de cancelación (opcional):") ?? "";
    setError(null);
    setSuccessMsg(null);
    setSaving(true);
    try {
      await repo.cancelNotificacionEtapa3({
        expedienteId,
        motivo: motivo.trim() || null,
      });
      setSuccessMsg("Notificación cancelada. Puedes agendar otra o elegir Biométricos.");
      onUpdated();
    } catch (err) {
      setError(
        err instanceof AgendaBiometricosSupabaseError
          ? err.message
          : "No se pudo cancelar la notificación. Intenta de nuevo.",
      );
    } finally {
      setSaving(false);
    }
  }, [expedienteId, onUpdated, repo]);

  const handleReagendar = useCallback(async () => {
    if (!config || !dateYmd || !activeNotificacion || !sedeId) return;
    setError(null);
    setSuccessMsg(null);

    const confirmar = window.confirm(
      `¿Confirmas reagendar la notificación al ${dateYmd} a las 12:00 PM en ${formatMesaAgendaSedeLabel(sedeId)}?`,
    );
    if (!confirmar) return;

    setSaving(true);
    try {
      await repo.reagendarNotificacionEtapa3({
        expedienteId,
        bookingDate: dateYmd,
        locationId: sedeId,
      });
      setSuccessMsg("Notificación reagendada correctamente.");
      onUpdated();
    } catch (err) {
      setError(
        err instanceof AgendaBiometricosSupabaseError
          ? err.message
          : "No se pudo reagendar la notificación. Intenta de nuevo.",
      );
    } finally {
      setSaving(false);
    }
  }, [activeNotificacion, config, dateYmd, expedienteId, onUpdated, repo, sedeId]);

  const sedeSelect = (
    <label className="block text-[11px] font-semibold text-gray-700">
      Sede
      <select
        className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-900"
        value={sedeId}
        disabled={saving || !config?.enabled}
        onChange={(e) => setSedeId(e.target.value as CynthiaSedeId)}
        data-testid="notificacion-sede-select"
      >
        <option value={CYNTHIA_SEDE_MONTERREY_ID}>Monterrey</option>
        <option value={CYNTHIA_SEDE_APODACA_ID}>Apodaca</option>
      </select>
    </label>
  );

  if (activeNotificacion) {
    return (
      <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
        <p className="text-sm font-semibold text-amber-950">Notificación agendada</p>
        <p className="text-xs text-amber-900">
          <span className="font-medium">Fecha:</span>{" "}
          {formatNotificacionDate(activeNotificacion.bookingDate)}
        </p>
        <p className="text-xs text-amber-900">
          <span className="font-medium">Hora:</span> 12:00 PM
        </p>
        <p className="text-xs text-amber-900">
          <span className="font-medium">Sede:</span>{" "}
          {formatMesaAgendaSedeLabel(activeNotificacion.locationId)}
        </p>
        <p className="text-[11px] text-amber-800">
          El expediente permanece en etapa 3 hasta que Mesa apruebe la notificación.
        </p>

        <label className="block text-[11px] font-semibold text-gray-700">
          Nueva fecha (reagendar)
          <input
            type="date"
            className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-900"
            value={dateYmd}
            min={config ? todayYmdInTimezone(config.timezone) : undefined}
            onChange={(e) => setDateYmd(e.target.value as YmdDate)}
            disabled={saving || !config?.enabled}
          />
        </label>
        {sedeSelect}

        {successMsg ? (
          <p
            role="status"
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-950"
          >
            {successMsg}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="primary"
            className="flex-1 text-xs"
            disabled={saving || !config?.enabled || !dateYmd || !sedeId}
            onClick={() => void handleReagendar()}
          >
            {saving ? "Guardando…" : "Reagendar notificación"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1 text-xs"
            disabled={saving}
            onClick={() => void handleCancel()}
          >
            Cancelar notificación
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-950">
        {NOTIFICACION_UI_HINT}
      </p>

      <label className="block text-[11px] font-semibold text-gray-700">
        Fecha
        <input
          type="date"
          className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-900"
          value={dateYmd}
          min={config ? todayYmdInTimezone(config.timezone) : undefined}
          onChange={(e) => setDateYmd(e.target.value as YmdDate)}
          disabled={saving || !config?.enabled}
        />
      </label>
      {sedeSelect}

      <p className="text-[11px] text-gray-600">
        Hora fija: {NOTIFICACION_FIXED_TIME} (12:00 PM)
      </p>

      {successMsg ? (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-950"
        >
          {successMsg}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        variant="primary"
        className="w-full text-xs"
        disabled={saving || !config?.enabled || !dateYmd || !sedeId}
        onClick={() => void handleBook()}
      >
        {saving ? "Agendando…" : "Agendar notificación"}
      </Button>
    </div>
  );
}
