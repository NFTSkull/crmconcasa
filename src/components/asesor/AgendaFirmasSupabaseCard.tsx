"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import {
  AgendaFirmasSupabaseError,
  buildScheduledAtIso,
  canShowFirmasManageActions,
  computeAdvisorSlotAvailability,
  todayYmdInTimezone,
  useAgendaFirmasBookingRepo,
  type AgendaFirmasSlotAvailability,
  type AgendaFirmasWeeklyConfig,
  type HhmmTime,
  type YmdDate,
} from "@/domain/agenda-firmas";
import {
  AdvisorAgendaSlotPicker,
  buildAdvisorDateAvailabilityInsight,
} from "@/components/asesor/AdvisorAgendaSlotPicker";
import { AsesorAgendaCitaCanceladaNotice } from "@/components/asesor/AsesorAgendaCitaCanceladaNotice";
import { AsesorAgendaDecisionNotice } from "@/components/asesor/AsesorAgendaDecisionNotice";
import { parseCancelMotivoFromNote } from "@/lib/agendaCancelNote";
import {
  advisorLabelForLocationId,
  advisorOptionIncludesBookingLocation,
  buildAdvisorSedeOptions,
  mapLocationIdToAdvisorCanonical,
  type AdvisorSedeOption,
} from "@/lib/agendaAdvisorLocations";
import type { WeeklyLocationLike } from "@/lib/agendaCynthiaLocations";
import {
  buildCapacityByTimeMap,
  buildInactiveSlotTimes,
  listAgendaSlotCapacities,
} from "@/domain/agenda-slot-capacities";
import type { SlotCapacityOverrides } from "@/domain/agenda-biometricos/weekly-availability";

export interface AgendaFirmasSupabaseCardProps {
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
  slots: readonly AgendaFirmasSlotAvailability[],
  reagendar: boolean,
  activeBooking: { bookingDate: string; bookingTime: string; locationId: string } | null,
  dateYmd: YmdDate,
  selectedSede: AdvisorSedeOption | null,
  locations: readonly WeeklyLocationLike[],
): readonly AgendaFirmasSlotAvailability[] {
  if (!reagendar || !activeBooking || !selectedSede) return slots;
  if (
    !advisorOptionIncludesBookingLocation(selectedSede, activeBooking.locationId, locations) ||
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

export function AgendaFirmasSupabaseCard({
  expedienteId,
  etapaActual = 9,
  fechaCita,
  onUpdated,
}: AgendaFirmasSupabaseCardProps) {
  const repo = useAgendaFirmasBookingRepo();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<AgendaFirmasWeeklyConfig | null>(null);
  const [activeBooking, setActiveBooking] = useState<Awaited<
    ReturnType<NonNullable<typeof repo>["getActiveBooking"]>
  > | null>(null);
  const [lastCancelledBooking, setLastCancelledBooking] = useState<Awaited<
    ReturnType<NonNullable<typeof repo>["getLastCancelledBooking"]>
  > | null>(null);
  const [bookedSlots, setBookedSlots] = useState<
    Awaited<ReturnType<NonNullable<typeof repo>["listBookedSlots"]>>
  >([]);
  const [capacityOverrides, setCapacityOverrides] = useState<SlotCapacityOverrides | null>(null);
  const [capacitiesTick, setCapacitiesTick] = useState(0);
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

  const puedeGestionar = canShowFirmasManageActions({
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
        repo.getFirmasConfig(),
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
      setCapacitiesTick((n) => n + 1);
    } catch (err) {
      setLoadError(
        err instanceof AgendaFirmasSupabaseError
          ? err.message
          : "No se pudo cargar la agenda firma.",
      );
    } finally {
      setLoading(false);
    }
  }, [expedienteId, repo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedSede || !dateYmd) {
      setCapacityOverrides(null);
      return;
    }
    void (async () => {
      try {
        const rows = await listAgendaSlotCapacities({
          kind: "firmas",
          slotDate: dateYmd,
          locationId: selectedSede.canonicalId,
        });
        if (cancelled) return;
        setCapacityOverrides({
          capacityByTime: buildCapacityByTimeMap(rows),
          inactiveTimes: buildInactiveSlotTimes(rows),
          hideInactive: true,
        });
      } catch {
        if (!cancelled) setCapacityOverrides(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [capacitiesTick, dateYmd, selectedSede]);

  const disponibilidadSlots = useMemo(() => {
    if (!config || !selectedSede) return [];
    const base = computeAdvisorSlotAvailability({
      config,
      bookedSlots,
      date: dateYmd,
      canonicalId: selectedSede.canonicalId,
      sourceLocationIds: selectedSede.sourceLocationIds,
      capacityPerSlot: selectedSede.capacityPerSlot,
      capacityOverrides,
    });
    return adjustSlotsForReagendar(
      base,
      reagendar,
      activeBooking,
      dateYmd,
      selectedSede,
      config.locations,
    );
  }, [activeBooking, bookedSlots, capacityOverrides, config, dateYmd, reagendar, selectedSede]);

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
    if (!window.confirm("¿Confirmas cancelar la cita de firmas?")) return;
    const motivo = window.prompt("Motivo de cancelación (opcional):") ?? "";

    setError(null);
    setSuccessMsg(null);
    setSaving(true);
    try {
      await repo.cancelFirmas({
        expedienteId,
        motivo: motivo.trim() || null,
      });
      setSuccessMsg("Cita de firmas cancelada.");
      await load();
      onUpdated();
    } catch (err) {
      setError(
        err instanceof AgendaFirmasSupabaseError
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
      `¿Confirmas agendar firmas el ${dateYmd} a las ${timeHhmm} en ${selectedSede.label}?`,
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
      await repo.bookFirmas({
        expedienteId,
        scheduledAt,
        locationId: selectedSede.bookLocationId,
      });
      setSuccessMsg("Cita de firmas agendada correctamente.");
      await load();
      onUpdated();
    } catch (err) {
      setError(
        err instanceof AgendaFirmasSupabaseError
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
      `¿Confirmas reagendar firmas al ${dateYmd} a las ${timeHhmm} en ${selectedSede.label}?`,
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
      await repo.reagendarFirmas({
        expedienteId,
        scheduledAt,
        locationId: selectedSede.bookLocationId,
      });
      setSuccessMsg("Cita de firmas reagendada correctamente.");
      await load();
      onUpdated();
    } catch (err) {
      setError(
        err instanceof AgendaFirmasSupabaseError
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
    <div className="rounded-xl border border-violet-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-1 text-[11px] leading-snug text-gray-600">{subtitle}</p>

      {!config || !config.enabled || advisorSedeOptions.length === 0 ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          La agenda firma aún no está configurada o está deshabilitada. Solicita a Mesa Admin
          que configure sedes, días y horarios.
        </p>
      ) : null}

      {successMsg ? (
        <p
          role="status"
          className="mt-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-950"
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
        accentRingClass="focus-visible:ring-violet-500"
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
      <div className="rounded-lg border border-violet-200 bg-white p-4 text-sm text-gray-600">
        Cargando agenda firmas…
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
      "Reagendar cita de firmas",
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
      <div className="space-y-3">
        <AsesorAgendaDecisionNotice expedienteId={expedienteId} kinds={["firmas"]} />
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 shadow-sm">
        <p className="text-sm font-semibold text-violet-900">Cita de firmas agendada</p>
        <p className="mt-2 text-xs text-violet-950">
          <span className="font-medium">Fecha y hora:</span>{" "}
          {formatCitaDisplay(citaIso, locationLabel)}
        </p>
        <p className="mt-1 text-xs text-violet-800">
          <span className="font-medium">Estatus:</span> Cita agendada — etapa 9 (sin avance automático)
        </p>

        {successMsg ? (
          <p
            role="status"
            className="mt-3 rounded-md border border-violet-300 bg-white/80 px-3 py-2 text-xs font-medium text-violet-950"
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
      </div>
    );
  }

  if (citaIso && !activeBooking) {
    return (
      <div className="space-y-3">
        <AsesorAgendaDecisionNotice expedienteId={expedienteId} kinds={["firmas"]} />
        {lastCancelledBooking ? (
          <AsesorAgendaCitaCanceladaNotice
            motivo={parseCancelMotivoFromNote(lastCancelledBooking.note)}
          />
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
            <p className="text-sm font-semibold text-amber-950">Cita firma registrada</p>
            <p className="mt-2 text-xs text-amber-900">
              Hay fecha de cita ({formatCitaDisplay(citaIso)}), pero no hay reserva activa en Supabase.
              Agenda de nuevo si corresponde.
            </p>
          </div>
        )}
        {renderFormShell(
          "Agendar cita de firma",
          "Horarios y cupos según la agenda semanal configurada por Mesa en Supabase.",
          "Agendar firma",
          handleBook,
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <AsesorAgendaDecisionNotice expedienteId={expedienteId} kinds={["firmas"]} />
      {lastCancelledBooking ? (
        <AsesorAgendaCitaCanceladaNotice
          motivo={parseCancelMotivoFromNote(lastCancelledBooking.note)}
        />
      ) : null}
      {renderFormShell(
        "Agendar cita de firma",
        "Horarios y cupos según la agenda semanal configurada por Mesa en Supabase.",
        "Agendar firma",
        handleBook,
      )}
    </div>
  );
}
