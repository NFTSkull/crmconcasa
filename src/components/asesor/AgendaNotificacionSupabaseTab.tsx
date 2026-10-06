"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { invokeAgendaSheetLiveSync } from "@/domain/agenda-sheets/live-inventory-sync";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export type AgendaNotificacionSupabaseTabProps = Readonly<{
  expedienteId: string;
  config: AgendaBiometricosWeeklyConfig | null;
  repo: AgendaBiometricosBookingRepo;
  activeNotificacion: AgendaNotificacionActiveBooking | null;
  mode?: "etapa3" | "postBiometricos";
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
  mode = "etapa3",
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
  const [sharedAvailability, setSharedAvailability] = useState<{
    available: number;
    capacity: number;
    verified: boolean;
  } | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  const refreshSharedAvailability = useCallback(async () => {
    if (sedeId !== CYNTHIA_SEDE_MONTERREY_ID || !dateYmd || !supabaseBrowser) {
      setSharedAvailability(null);
      setAvailabilityLoading(false);
      return;
    }

    setAvailabilityLoading(true);
    try {
      // Refresca primero desde Drive; después lee el RPC SQL que aplica el hard-cap
      // compartido Inscripción + Notificación (4 lugares).
      try {
        await invokeAgendaSheetLiveSync(supabaseBrowser, {
          bookingDate: dateYmd,
          kind: "inscripcion",
          locationId: "monterrey",
          mode: "availability",
        });
      } catch {
        // El read-model SQL sigue siendo fail-closed/autoridad si el live-sync falla.
      }

      const { data, error: availabilityError } = await supabaseBrowser.rpc(
        "agenda_sheet_inventory_availability",
        {
          p_kind: "inscripcion",
          p_date: dateYmd,
          p_location_id: "monterrey",
        },
      );

      if (availabilityError || !data || typeof data !== "object") {
        setSharedAvailability({ available: 0, capacity: 4, verified: false });
        return;
      }

      const payload = data as {
        fresh?: boolean;
        daily_capacity?: number | null;
        daily_remaining?: number | null;
        slots?: ReadonlyArray<{
          slot_time?: string;
          sheet_slot_time?: string | null;
          available?: number;
        }>;
      };

      if (payload.fresh !== true) {
        setSharedAvailability({ available: 0, capacity: 4, verified: false });
        return;
      }

      const slot = (payload.slots ?? []).find((row) => {
        const t = String(row.sheet_slot_time ?? row.slot_time ?? "").slice(0, 5);
        return t === "11:00";
      });
      const physicalAvailable = Math.max(0, Number(slot?.available ?? 0));
      const dailyRemaining =
        payload.daily_remaining == null
          ? physicalAvailable
          : Math.max(0, Number(payload.daily_remaining));
      const capacity =
        payload.daily_capacity == null
          ? 4
          : Math.max(0, Number(payload.daily_capacity));
      let available = Math.min(physicalAvailable, dailyRemaining, capacity);

      // Al reagendar la misma cita en la misma fecha/sede, su propio lugar ya está
      // ocupado por ese booking. Se devuelve ese único lugar para no bloquear una
      // reagenda válida del mismo expediente.
      if (
        activeNotificacion &&
        activeNotificacion.bookingDate === dateYmd &&
        String(activeNotificacion.locationId).trim().toLowerCase() === "monterrey"
      ) {
        available = Math.min(capacity, available + 1);
      }

      setSharedAvailability({ available, capacity, verified: true });
    } catch {
      setSharedAvailability({ available: 0, capacity: 4, verified: false });
    } finally {
      setAvailabilityLoading(false);
    }
  }, [activeNotificacion, dateYmd, sedeId]);

  useEffect(() => {
    void refreshSharedAvailability();
  }, [refreshSharedAvailability]);

  const monterreyCupoBlocked = useMemo(
    () =>
      sedeId === CYNTHIA_SEDE_MONTERREY_ID &&
      (availabilityLoading ||
        sharedAvailability?.verified !== true ||
        (sharedAvailability?.available ?? 0) <= 0),
    [availabilityLoading, sedeId, sharedAvailability],
  );

  const cupoStatus = useMemo(() => {
    if (sedeId !== CYNTHIA_SEDE_MONTERREY_ID) return null;
    if (availabilityLoading) return "Verificando cupo real en Drive…";
    if (sharedAvailability?.verified !== true) {
      return "No se pudo verificar el cupo real. Intenta de nuevo.";
    }
    if (sharedAvailability.available <= 0) {
      return "Sin lugares disponibles. Inscripción + Notificación ya llenaron el cupo.";
    }
    return `${sharedAvailability.available} de ${sharedAvailability.capacity} lugar${sharedAvailability.available === 1 ? "" : "es"} disponible${sharedAvailability.available === 1 ? "" : "s"}`;
  }, [availabilityLoading, sedeId, sharedAvailability]);

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
      const book =
        mode === "postBiometricos"
          ? repo.bookNotificacionPostBiometricos.bind(repo)
          : repo.bookNotificacionEtapa3.bind(repo);
      await book({
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
  }, [config, dateYmd, expedienteId, mode, onUpdated, repo, sedeId]);

  const handleCancel = useCallback(async () => {
    if (!window.confirm("¿Confirmas cancelar la notificación agendada?")) return;
    const motivo = window.prompt("Motivo de cancelación (opcional):") ?? "";
    setError(null);
    setSuccessMsg(null);
    setSaving(true);
    try {
      const cancel =
        mode === "postBiometricos"
          ? repo.cancelNotificacionPostBiometricos.bind(repo)
          : repo.cancelNotificacionEtapa3.bind(repo);
      await cancel({
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
  }, [expedienteId, mode, onUpdated, repo]);

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
      const reagendar =
        mode === "postBiometricos"
          ? repo.reagendarNotificacionPostBiometricos.bind(repo)
          : repo.reagendarNotificacionEtapa3.bind(repo);
      await reagendar({
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
  }, [activeNotificacion, config, dateYmd, expedienteId, mode, onUpdated, repo, sedeId]);

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

        {cupoStatus ? (
          <p
            className={`rounded-md border px-3 py-2 text-xs font-medium ${
              sharedAvailability?.verified === true && sharedAvailability.available > 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-950"
            }`}
          >
            Cupo real Drive: {cupoStatus}
          </p>
        ) : null}

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
            disabled={saving || !config?.enabled || !dateYmd || !sedeId || monterreyCupoBlocked}
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
        {mode === "postBiometricos"
          ? "Biométricos ya realizados: esta cita de Notificación se agrega después y conserva intacto el resultado biométrico. No cancela ni reemplaza Biométricos."
          : NOTIFICACION_UI_HINT}
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

      {cupoStatus ? (
        <p
          className={`rounded-md border px-3 py-2 text-xs font-medium ${
            sharedAvailability?.verified === true && sharedAvailability.available > 0
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-950"
          }`}
        >
          Cupo real Drive: {cupoStatus}
        </p>
      ) : null}

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
        disabled={saving || !config?.enabled || !dateYmd || !sedeId || monterreyCupoBlocked}
        onClick={() => void handleBook()}
      >
        {saving ? "Agendando…" : "Agendar notificación"}
      </Button>
    </div>
  );
}
