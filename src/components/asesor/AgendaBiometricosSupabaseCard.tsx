"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  AgendaBiometricosSupabaseError,
  buildScheduledAtIso,
  computeWeeklySlotAvailability,
  todayYmdInTimezone,
  useAgendaBiometricosBookingRepo,
  type AgendaBiometricosWeeklyConfig,
  type HhmmTime,
  type YmdDate,
} from "@/domain/agenda-biometricos";

export interface AgendaBiometricosSupabaseCardProps {
  expedienteId: string;
  fechaCita?: string | null;
  onUpdated: () => void;
}

function formatCitaDisplay(iso: string, locationLabel?: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const when = d.toLocaleString("es-MX", {
      dateStyle: "full",
      timeStyle: "short",
    });
    return locationLabel ? `${when} · ${locationLabel}` : when;
  } catch {
    return iso;
  }
}

function addDaysYmd(dateYmd: YmdDate, days: number): YmdDate {
  const [y, mo, d] = dateYmd.split("-").map(Number);
  const base = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}` as YmdDate;
}

export function AgendaBiometricosSupabaseCard({
  expedienteId,
  fechaCita,
  onUpdated,
}: AgendaBiometricosSupabaseCardProps) {
  const repo = useAgendaBiometricosBookingRepo();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<AgendaBiometricosWeeklyConfig | null>(null);
  const [activeBooking, setActiveBooking] = useState<Awaited<
    ReturnType<NonNullable<typeof repo>["getActiveBooking"]>
  > | null>(null);
  const [bookedSlots, setBookedSlots] = useState<
    Awaited<ReturnType<NonNullable<typeof repo>["listBookedSlots"]>>
  >([]);
  const [locationId, setLocationId] = useState("");
  const [dateYmd, setDateYmd] = useState<YmdDate>("2026-01-01" as YmdDate);
  const [timeHhmm, setTimeHhmm] = useState<HhmmTime | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const locationOptions = useMemo(
    () => (config?.locations ?? []).filter((l) => l.enabled),
    [config],
  );

  const selectedLocation = useMemo(
    () => locationOptions.find((l) => l.id === locationId) ?? null,
    [locationId, locationOptions],
  );

  const load = useCallback(async () => {
    if (!repo) {
      setLoadError("Modo Supabase activo pero el repositorio de agenda no está disponible.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [configRecord, booking] = await Promise.all([
        repo.getBiometricosConfig(),
        repo.getActiveBooking(expedienteId),
      ]);
      const weekly = configRecord?.config ?? null;
      setConfig(weekly);
      setActiveBooking(booking);

      const tz = weekly?.timezone ?? "America/Monterrey";
      const today = todayYmdInTimezone(tz);
      const toDate = addDaysYmd(today, 60);
      const slots = await repo.listBookedSlots({ fromDate: today, toDate });
      setBookedSlots(slots);

      const firstLocation = weekly?.locations.find((l) => l.enabled)?.id ?? "";
      setLocationId((prev) =>
        prev && weekly?.locations.some((l) => l.id === prev && l.enabled) ? prev : firstLocation,
      );
      setDateYmd(today);
      setTimeHhmm("");
    } catch (err) {
      setLoadError(
        err instanceof AgendaBiometricosSupabaseError
          ? err.message
          : "No se pudo cargar la agenda biométrica.",
      );
    } finally {
      setLoading(false);
    }
  }, [expedienteId, repo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!repo || !config || !locationId) return;
    const today = todayYmdInTimezone(config.timezone);
    const toDate = addDaysYmd(today, 60);
    void repo
      .listBookedSlots({ fromDate: today, toDate, locationId })
      .then(setBookedSlots)
      .catch(() => {
        /* mantener último snapshot */
      });
  }, [config, dateYmd, locationId, repo]);

  const disponibilidadSlots = useMemo(() => {
    if (!config || !locationId) return [];
    return computeWeeklySlotAvailability({
      config,
      bookedSlots,
      date: dateYmd,
      locationId,
    });
  }, [bookedSlots, config, dateYmd, locationId]);

  const tieneCita = Boolean(
    activeBooking || (fechaCita && String(fechaCita).trim() !== ""),
  );

  const citaIso =
    activeBooking && config
      ? buildScheduledAtIso(
          activeBooking.bookingDate as YmdDate,
          activeBooking.bookingTime as HhmmTime,
          config.timezone,
        )
      : fechaCita && String(fechaCita).trim() !== ""
        ? String(fechaCita)
        : null;

  const locationLabel =
    activeBooking?.locationId
      ? config?.locations.find((l) => l.id === activeBooking.locationId)?.label ??
        activeBooking.locationId
      : undefined;

  const handleBook = useCallback(async () => {
    if (!repo || !config || !locationId || !timeHhmm) return;
    setError(null);
    setSuccessMsg(null);

    const confirmar = window.confirm(
      `¿Confirmas agendar biométricos el ${dateYmd} a las ${timeHhmm} en ${selectedLocation?.label ?? locationId}?`,
    );
    if (!confirmar) return;

    let scheduledAt: string;
    try {
      scheduledAt = buildScheduledAtIso(dateYmd, timeHhmm as HhmmTime, config.timezone);
    } catch {
      setError("Horario inválido.");
      return;
    }

    setSaving(true);
    try {
      await repo.bookBiometricos({
        expedienteId,
        scheduledAt,
        locationId,
      });
      setSuccessMsg("Cita de biométricos agendada correctamente.");
      await load();
      onUpdated();
    } catch (err) {
      setError(
        err instanceof AgendaBiometricosSupabaseError
          ? err.message
          : "No se pudo agendar la cita. Intenta de nuevo.",
      );
    } finally {
      setSaving(false);
    }
  }, [
    config,
    dateYmd,
    expedienteId,
    load,
    locationId,
    onUpdated,
    repo,
    selectedLocation?.label,
    timeHhmm,
  ]);

  if (loading) {
    return (
      <div className="rounded-lg border border-sky-200 bg-white p-4 text-sm text-gray-600">
        Cargando agenda biométricos…
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      >
        {loadError}
      </div>
    );
  }

  if (tieneCita && citaIso) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
        <p className="text-sm font-semibold text-emerald-900">Cita de biométricos agendada</p>
        <p className="mt-2 text-xs text-emerald-950">
          <span className="font-medium">Fecha y hora:</span>{" "}
          {formatCitaDisplay(citaIso, locationLabel)}
        </p>
        <p className="mt-1 text-xs text-emerald-800">
          <span className="font-medium">Estatus:</span> Cita agendada — etapa 4 (sin avance automático)
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-gray-900">Agendar cita de biométricos</p>
      <p className="mt-1 text-[11px] leading-snug text-gray-600">
        Horarios y cupos según la agenda semanal configurada por Mesa en Supabase.
      </p>

      {!config || !config.enabled || locationOptions.length === 0 ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          La agenda biométrica aún no está configurada o está deshabilitada. Solicita a Mesa Admin
          que configure sedes, días y horarios.
        </p>
      ) : null}

      {successMsg ? (
        <p
          role="status"
          className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-950"
        >
          {successMsg}
        </p>
      ) : null}

      <div className="mt-3 space-y-3">
        <label className="block text-[11px] font-semibold text-gray-700">
          Sede
          <select
            className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs"
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              setTimeHhmm("");
              setError(null);
            }}
            disabled={!config?.enabled || saving}
          >
            {locationOptions.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-[11px] font-semibold text-gray-700">
          Fecha
          <input
            type="date"
            className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs"
            value={dateYmd}
            min={config ? todayYmdInTimezone(config.timezone) : undefined}
            onChange={(e) => {
              setDateYmd(e.target.value as YmdDate);
              setTimeHhmm("");
              setError(null);
            }}
            disabled={saving || !config?.enabled}
          />
        </label>

        <div>
          <p className="text-[11px] font-semibold text-gray-700">Horario</p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            Verde: disponible · Gris: lleno o no permitido
          </p>
          <div className="mt-1.5 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-gray-100 bg-gray-50/80 p-2">
            {disponibilidadSlots.length === 0 ? (
              <span className="text-[11px] text-gray-500">
                Sin horarios disponibles para esta fecha y sede.
              </span>
            ) : (
              disponibilidadSlots.map((slot) => {
                const lleno = slot.remaining <= 0;
                const selected = timeHhmm === slot.time;
                return (
                  <button
                    key={slot.time}
                    type="button"
                    disabled={lleno || saving}
                    onClick={() => {
                      setTimeHhmm(slot.time);
                      setError(null);
                    }}
                    className={`rounded-md border px-2 py-1 text-left text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed ${
                      lleno
                        ? "border-gray-200 bg-gray-100 text-gray-400"
                        : selected
                          ? "border-sky-600 bg-sky-600 text-white shadow-sm"
                          : "border-emerald-200/80 bg-emerald-50 text-emerald-950 hover:border-emerald-300 hover:bg-emerald-100/80"
                    }`}
                  >
                    <span className="block">{slot.time}</span>
                    <span className="block text-[9px] font-normal opacity-90">
                      {lleno ? "Lleno" : `${slot.remaining} disp.`}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        variant="primary"
        className="mt-4 w-full text-xs"
        disabled={
          saving ||
          !config?.enabled ||
          !locationId ||
          !timeHhmm ||
          disponibilidadSlots.every((s) => s.remaining <= 0)
        }
        onClick={() => void handleBook()}
      >
        {saving ? "Agendando…" : "Agendar cita biométrica"}
      </Button>
    </div>
  );
}
