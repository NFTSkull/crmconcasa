"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import {
  AgendaBiometricosSupabaseError,
  buildScheduledAtIso,
  canShowBiometricosManageActions,
  computeAdvisorSlotAvailability,
  todayYmdInTimezone,
  useAgendaBiometricosBookingRepo,
  type AgendaBiometricosSlotAvailability,
  type AgendaBiometricosWeeklyConfig,
  type HhmmTime,
  type YmdDate,
} from "@/domain/agenda-biometricos";
import {
  advisorLabelForLocationId,
  advisorOptionIncludesBookingLocation,
  buildAdvisorSedeOptions,
  mapLocationIdToAdvisorCanonical,
  type AdvisorSedeOption,
} from "@/lib/agendaAdvisorLocations";
import {
  AdvisorAgendaSlotPicker,
  buildAdvisorDateAvailabilityInsight,
} from "@/components/asesor/AdvisorAgendaSlotPicker";
import { AsesorAgendaCitaCanceladaNotice } from "@/components/asesor/AsesorAgendaCitaCanceladaNotice";
import { parseCancelMotivoFromNote } from "@/lib/agendaCancelNote";

export interface AgendaBiometricosSupabaseCardProps {
  expedienteId: string;
  etapaActual?: number | null;
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

function adjustSlotsForReagendar(
  slots: readonly AgendaBiometricosSlotAvailability[],
  reagendar: boolean,
  activeBooking: { bookingDate: string; bookingTime: string; locationId: string } | null,
  dateYmd: YmdDate,
  selectedSede: AdvisorSedeOption | null,
): readonly AgendaBiometricosSlotAvailability[] {
  if (!reagendar || !activeBooking || !selectedSede) return slots;
  if (
    !advisorOptionIncludesBookingLocation(selectedSede, activeBooking.locationId) ||
    activeBooking.bookingDate !== dateYmd
  ) {
    return slots;
  }
  return slots.map((slot) => {
    if (slot.time !== activeBooking.bookingTime) return slot;
    const bookedCount = Math.max(0, slot.bookedCount - 1);
    const remaining = Math.max(0, slot.capacity - bookedCount);
    return { ...slot, bookedCount, remaining };
  });
}

export function AgendaBiometricosSupabaseCard({
  expedienteId,
  etapaActual = 4,
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
  const [lastCancelledBooking, setLastCancelledBooking] = useState<Awaited<
    ReturnType<NonNullable<typeof repo>["getLastCancelledBooking"]>
  > | null>(null);
  const [bookedSlots, setBookedSlots] = useState<
    Awaited<ReturnType<NonNullable<typeof repo>["listBookedSlots"]>>
  >([]);
  const [sedeCanonicalId, setSedeCanonicalId] = useState("");
  const [dateYmd, setDateYmd] = useState<YmdDate>("2026-01-01" as YmdDate);
  const [timeHhmm, setTimeHhmm] = useState<HhmmTime | "">("");
  const [reagendar, setReagendar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const advisorSedeOptions = useMemo(
    () => buildAdvisorSedeOptions(config?.locations ?? []),
    [config],
  );

  const selectedSede = useMemo(
    () => advisorSedeOptions.find((o) => o.canonicalId === sedeCanonicalId) ?? null,
    [advisorSedeOptions, sedeCanonicalId],
  );

  const puedeGestionar = canShowBiometricosManageActions({
    etapaActual,
    hasActiveBooking: activeBooking != null,
  });

  const load = useCallback(async () => {
    if (!repo) {
      setLoadError("Modo Supabase activo pero el repositorio de agenda no está disponible.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [configRecord, booking, cancelled] = await Promise.all([
        repo.getBiometricosConfig(),
        repo.getActiveBooking(expedienteId),
        repo.getLastCancelledBooking(expedienteId),
      ]);
      const weekly = configRecord?.config ?? null;
      setConfig(weekly);
      setActiveBooking(booking);
      setLastCancelledBooking(booking ? null : cancelled);

      const tz = weekly?.timezone ?? "America/Monterrey";
      const today = todayYmdInTimezone(tz);
      const toDate = addDaysYmd(today, 60);
      const slots = await repo.listBookedSlots({ fromDate: today, toDate });
      setBookedSlots(slots);

      const sedeOptions = buildAdvisorSedeOptions(weekly?.locations ?? []);
      setSedeCanonicalId((prev) =>
        prev && sedeOptions.some((o) => o.canonicalId === prev)
          ? prev
          : (sedeOptions[0]?.canonicalId ?? ""),
      );
      setDateYmd(today);
      setTimeHhmm("");
      setReagendar(false);
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

  const disponibilidadSlots = useMemo(() => {
    if (!config || !selectedSede) return [];
    const base = computeAdvisorSlotAvailability({
      config,
      bookedSlots,
      date: dateYmd,
      canonicalId: selectedSede.canonicalId,
      sourceLocationIds: selectedSede.sourceLocationIds,
      capacityPerSlot: selectedSede.capacityPerSlot,
    });
    return adjustSlotsForReagendar(base, reagendar, activeBooking, dateYmd, selectedSede);
  }, [activeBooking, bookedSlots, config, dateYmd, reagendar, selectedSede]);

  const availabilityInsight = useMemo(() => {
    if (!config || !selectedSede) return null;
    return buildAdvisorDateAvailabilityInsight({
      config,
      bookedSlots,
      date: dateYmd,
      sede: selectedSede,
    });
  }, [bookedSlots, config, dateYmd, selectedSede]);

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
      ? advisorLabelForLocationId(activeBooking.locationId, config?.locations ?? [])
      : undefined;

  const startReagendar = useCallback(() => {
    if (!activeBooking || !config) return;
    setReagendar(true);
    setError(null);
    setSuccessMsg(null);
    const canonical =
      mapLocationIdToAdvisorCanonical(activeBooking.locationId, config.locations) ??
      sedeCanonicalId;
    setSedeCanonicalId(canonical);
    setDateYmd(activeBooking.bookingDate as YmdDate);
    setTimeHhmm(activeBooking.bookingTime as HhmmTime);
  }, [activeBooking, config, sedeCanonicalId]);

  const handleCancel = useCallback(async () => {
    if (!repo || !activeBooking) return;
    if (!window.confirm("¿Confirmas cancelar la cita de biométricos?")) return;
    const motivo = window.prompt("Motivo de cancelación (opcional):") ?? "";

    setError(null);
    setSuccessMsg(null);
    setSaving(true);
    try {
      await repo.cancelBiometricos({
        expedienteId,
        motivo: motivo.trim() || null,
      });
      setSuccessMsg("Cita de biométricos cancelada.");
      await load();
      onUpdated();
    } catch (err) {
      setError(
        err instanceof AgendaBiometricosSupabaseError
          ? err.message
          : "No se pudo cancelar la cita. Intenta de nuevo.",
      );
    } finally {
      setSaving(false);
    }
  }, [activeBooking, expedienteId, load, onUpdated, repo]);

  const handleBook = useCallback(async () => {
    if (!repo || !config || !selectedSede || !timeHhmm) return;
    setError(null);
    setSuccessMsg(null);

    const confirmar = window.confirm(
      `¿Confirmas agendar biométricos el ${dateYmd} a las ${timeHhmm} en ${selectedSede.label}?`,
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
        locationId: selectedSede.bookLocationId,
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
    onUpdated,
    repo,
    selectedSede,
    timeHhmm,
  ]);

  const handleReagendar = useCallback(async () => {
    if (!repo || !config || !selectedSede || !timeHhmm || !activeBooking) return;
    setError(null);
    setSuccessMsg(null);

    const confirmar = window.confirm(
      `¿Confirmas reagendar biométricos al ${dateYmd} a las ${timeHhmm} en ${selectedSede.label}?`,
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
      await repo.reagendarBiometricos({
        expedienteId,
        scheduledAt,
        locationId: selectedSede.bookLocationId,
      });
      setSuccessMsg("Cita de biométricos reagendada correctamente.");
      await load();
      onUpdated();
    } catch (err) {
      setError(
        err instanceof AgendaBiometricosSupabaseError
          ? err.message
          : "No se pudo reagendar la cita. Intenta de nuevo.",
      );
    } finally {
      setSaving(false);
    }
  }, [
    activeBooking,
    config,
    dateYmd,
    expedienteId,
    load,
    onUpdated,
    repo,
    selectedSede,
    timeHhmm,
  ]);

  const renderFormShell = (
    title: string,
    subtitle: string,
    submitLabel: string,
    onSubmit: () => void,
    extraActions?: ReactNode,
  ) => (
    <div className="rounded-xl border border-sky-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-1 text-[11px] leading-snug text-gray-600">{subtitle}</p>

      {!config || !config.enabled || advisorSedeOptions.length === 0 ? (
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

      <AdvisorAgendaSlotPicker
        config={config}
        sedeOptions={advisorSedeOptions}
        selectedSede={selectedSede}
        sedeCanonicalId={sedeCanonicalId}
        dateYmd={dateYmd}
        timeHhmm={timeHhmm}
        disponibilidadSlots={disponibilidadSlots}
        availabilityInsight={availabilityInsight}
        saving={saving}
        onSedeChange={(id) => {
          setSedeCanonicalId(id);
          setTimeHhmm("");
          setError(null);
        }}
        onDateChange={(date) => {
          setDateYmd(date);
          setTimeHhmm("");
          setError(null);
        }}
        onTimeChange={(time) => {
          setTimeHhmm(time);
          setError(null);
        }}
        onGoToNextAvailability={(date, time) => {
          setDateYmd(date);
          setTimeHhmm(time);
          setError(null);
        }}
      />

      {error ? (
        <p role="alert" className="mt-3 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {extraActions}

      <Button
        type="button"
        variant="primary"
        className="mt-4 w-full text-xs"
        disabled={
          saving ||
          !config?.enabled ||
          !selectedSede ||
          !timeHhmm ||
          disponibilidadSlots.every((s) => s.remaining <= 0)
        }
        onClick={() => void onSubmit()}
      >
        {saving ? "Guardando…" : submitLabel}
      </Button>
    </div>
  );

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

  if (reagendar && puedeGestionar) {
    return renderFormShell(
      "Reagendar cita de biométricos",
      "Elige nueva sede, fecha y hora según la agenda configurada por Mesa.",
      "Confirmar reagendar",
      handleReagendar,
      (
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full text-xs"
          disabled={saving}
          onClick={() => {
            setReagendar(false);
            setError(null);
            setTimeHhmm("");
          }}
        >
          Cancelar reagendar
        </Button>
      ),
    );
  }

  if (puedeGestionar && citaIso) {
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

        {successMsg ? (
          <p
            role="status"
            className="mt-3 rounded-md border border-emerald-300 bg-white/80 px-3 py-2 text-xs font-medium text-emerald-950"
          >
            {successMsg}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="flex-1 text-xs"
            disabled={saving}
            onClick={() => void startReagendar()}
          >
            Reagendar cita
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="flex-1 text-xs"
            disabled={saving}
            onClick={() => void handleCancel()}
          >
            {saving ? "Procesando…" : "Cancelar cita"}
          </Button>
        </div>
      </div>
    );
  }

  if (citaIso && !activeBooking) {
    return (
      <div className="space-y-3">
        {lastCancelledBooking ? (
          <AsesorAgendaCitaCanceladaNotice
            motivo={parseCancelMotivoFromNote(lastCancelledBooking.note)}
          />
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
            <p className="text-sm font-semibold text-amber-950">Cita biométrica registrada</p>
            <p className="mt-2 text-xs text-amber-900">
              Hay fecha de cita ({formatCitaDisplay(citaIso)}), pero no hay reserva activa en Supabase.
              Agenda de nuevo si corresponde.
            </p>
          </div>
        )}
        {renderFormShell(
          "Agendar cita de biométricos",
          "Horarios y cupos según la agenda semanal configurada por Mesa en Supabase.",
          "Agendar cita biométrica",
          handleBook,
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {lastCancelledBooking ? (
        <AsesorAgendaCitaCanceladaNotice
          motivo={parseCancelMotivoFromNote(lastCancelledBooking.note)}
        />
      ) : null}
      {renderFormShell(
        "Agendar cita de biométricos",
        "Horarios y cupos según la agenda semanal configurada por Mesa en Supabase.",
        "Agendar cita biométrica",
        handleBook,
      )}
    </div>
  );
}
