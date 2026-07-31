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
import {
  applySheetInventoryToSlots,
  type InventoryAvailabilityResponse,
} from "@/domain/agenda-sheets/apply-inventory-availability";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export interface AgendaFirmasSupabaseCardProps {
  expedienteId: string;
  etapaActual?: number | null;
  fechaCita?: string | null;
  /** P132: fecha local mínima agendable (YYYY-MM-DD); null/omit = sin filtro extra. */
  firmaAgendableDesde?: string | null;
  /** P132: aviso no bloqueante si falta Acuse en etapa ≥ 9. */
  acusePendienteSubir?: boolean;
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

/** Mayor de dos fechas YYYY-MM-DD; ignora inválidas. */
export function maxYmdDate(a: string | null | undefined, b: string | null | undefined): YmdDate | null {
  const norm = (v: string | null | undefined): string | null => {
    const s = String(v ?? "").trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const left = norm(a);
  const right = norm(b);
  if (!left) return right as YmdDate | null;
  if (!right) return left as YmdDate | null;
  return (left >= right ? left : right) as YmdDate;
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
  firmaAgendableDesde = null,
  acusePendienteSubir = false,
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
  const [sheetInventory, setSheetInventory] = useState<InventoryAvailabilityResponse | null>(
    null,
  );

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

  const pickerMinDate = useMemo(() => {
    const tz = config?.timezone ?? "America/Monterrey";
    // Tras quitar el mínimo de 5 hábiles: hoy, o firma_agendable_desde si aún fuera futura (Cloud viejo).
    return maxYmdDate(todayYmdInTimezone(tz), firmaAgendableDesde);
  }, [config?.timezone, firmaAgendableDesde]);

  const firmaAgendableDesdeLabel = useMemo(() => {
    const s = String(firmaAgendableDesde ?? "").trim().slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return `${m[3]}/${m[2]}/${m[1]}`;
  }, [firmaAgendableDesde]);

  const firmaAgendableBanner = useMemo(() => {
    const tz = config?.timezone ?? "America/Monterrey";
    const today = todayYmdInTimezone(tz);
    const minYmd = String(firmaAgendableDesde ?? "").trim().slice(0, 10);
    if (!firmaAgendableDesdeLabel || !minYmd || minYmd <= today) return null;
    return (
      <div
        role="status"
        className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950"
      >
        Podrás agendar la firma a partir del {firmaAgendableDesdeLabel}.
      </div>
    );
  }, [config?.timezone, firmaAgendableDesde, firmaAgendableDesdeLabel]);

  const showAcusePendienteAviso =
    acusePendienteSubir && typeof etapaActual === "number" && etapaActual >= 9;

  const acusePendienteBanner = showAcusePendienteAviso ? (
    <div
      role="status"
      className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
    >
      <p className="font-semibold">Acuse pendiente de subir</p>
      <p className="mt-0.5">
        Puedes agendar o reagendar la firma; completa el Acuse cuando puedas.{" "}
        <a
          href="#asesor-retencion-acuse"
          className="font-medium text-violet-800 underline underline-offset-2"
        >
          Ir al panel de retención
        </a>
      </p>
    </div>
  ) : null;

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
      const minBookable = maxYmdDate(today, firmaAgendableDesde) ?? today;
      const toDate = addDaysYmd(today, 60);
      const slots = await repo.listBookedSlots({ fromDate: today, toDate });
      setBookedSlots(slots);

      const sedeOptions = buildAdvisorSedeOptions(weekly?.locations ?? []);
      setSedeCanonicalId((prev) =>
        prev && sedeOptions.some((o) => o.canonicalId === prev)
          ? prev
          : (sedeOptions[0]?.canonicalId ?? ""),
      );
      setDateYmd(minBookable);
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
  }, [expedienteId, firmaAgendableDesde, repo]);

  /** Recarga cupos/bookings sin resetear la selección del asesor (p. ej. tras carrera por último cupo). */
  const refreshAvailability = useCallback(async () => {
    if (!repo) return;
    try {
      const tz = config?.timezone ?? "America/Monterrey";
      const today = todayYmdInTimezone(tz);
      const slots = await repo.listBookedSlots({
        fromDate: today,
        toDate: addDaysYmd(today, 60),
      });
      setBookedSlots(slots);
      setCapacitiesTick((n) => n + 1);
    } catch {
      /* el error de reserva ya se muestra; no tapar con fallo de refresh */
    }
  }, [config?.timezone, repo]);

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

  useEffect(() => {
    let cancelled = false;
    if (!selectedSede || !dateYmd || !supabaseBrowser) {
      setSheetInventory(null);
      return;
    }
    void (async () => {
      try {
        const { data, error } = await supabaseBrowser.rpc(
          "agenda_sheet_inventory_availability",
          {
            p_kind: "firmas",
            p_date: dateYmd,
            p_location_id: selectedSede.canonicalId,
          },
        );
        if (cancelled) return;
        if (error || !data || typeof data !== "object") {
          setSheetInventory({ fresh: false, enforced: true, slots: [] });
          return;
        }
        setSheetInventory(data as InventoryAvailabilityResponse);
      } catch {
        if (!cancelled) {
          setSheetInventory({ fresh: false, enforced: true, slots: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dateYmd, selectedSede]);

  const disponibilidadSlots = useMemo(() => {
    if (!config || !selectedSede) return [];
    const base = computeAdvisorSlotAvailability({
      config,
      bookedSlots,
      date: dateYmd,
      canonicalId: selectedSede.canonicalId,
      sourceLocationIds: selectedSede.sourceLocationIds,
      capacityPerSlot: selectedSede.capacityPerSlot,
      capacityByTime: selectedSede.capacityByTime,
      capacityOverrides,
    });
    const adjusted = adjustSlotsForReagendar(
      base,
      reagendar,
      activeBooking,
      dateYmd,
      selectedSede,
      config.locations,
    );
    return applySheetInventoryToSlots(adjusted, sheetInventory, dateYmd).slots;
  }, [
    activeBooking,
    bookedSlots,
    capacityOverrides,
    config,
    dateYmd,
    reagendar,
    selectedSede,
    sheetInventory,
  ]);

  const inventoryUi = useMemo(
    () => applySheetInventoryToSlots([], sheetInventory, dateYmd),
    [dateYmd, sheetInventory],
  );

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
      await refreshAvailability();
    } finally {
      setSaving(false);
    }
  }, [
    config,
    dateYmd,
    expedienteId,
    load,
    onUpdated,
    refreshAvailability,
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
      await refreshAvailability();
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
    refreshAvailability,
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

      {firmaAgendableBanner}
      {acusePendienteBanner}

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
        minDateYmd={pickerMinDate}
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

      {inventoryUi.inventoryLabel ? (
        <p className="mt-2 text-[11px] text-gray-500">{inventoryUi.inventoryLabel}</p>
      ) : null}
      {inventoryUi.blockedReason ? (
        <p
          role="status"
          className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700"
        >
          {inventoryUi.blockedReason}
        </p>
      ) : null}

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
          Boolean(inventoryUi.blockedReason) ||
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
        {firmaAgendableBanner}
        {acusePendienteBanner}
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
