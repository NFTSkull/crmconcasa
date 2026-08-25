"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import {
  AgendaBiometricosSupabaseError,
  buildScheduledAtIso,
  canShowBiometricosManageActions,
  canShowConvertBiometricosToNotificacion,
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
  CYNTHIA_SEDE_APODACA_ID,
  CYNTHIA_SEDE_MONTERREY_ID,
  type CynthiaSedeId,
  type WeeklyLocationLike,
} from "@/lib/agendaCynthiaLocations";
import { AdvisorAgendaSlotPicker, buildAdvisorDateAvailabilityInsight } from "@/components/asesor/AdvisorAgendaSlotPicker";
import { AgendaInscripcionSupabaseCard } from "@/components/asesor/AgendaInscripcionSupabaseCard";
import { AgendaNotificacionSupabaseTab } from "@/components/asesor/AgendaNotificacionSupabaseTab";
import { AsesorAgendaCitaCanceladaNotice } from "@/components/asesor/AsesorAgendaCitaCanceladaNotice";
import { AsesorAgendaDecisionNotice } from "@/components/asesor/AsesorAgendaDecisionNotice";
import { parseCancelMotivoFromNote } from "@/lib/agendaCancelNote";
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
import {
  BOOK_SLOT_JUST_TAKEN_MESSAGE,
  LIVE_SYNC_LOADING_LABEL,
  invokeAgendaSheetLiveSync,
} from "@/domain/agenda-sheets/live-inventory-sync";
import {
  LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE,
  shouldBlockBookWithoutLiveSync,
} from "@/domain/agenda-sheets/daily-capacity";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { fetchAgendaBookingSheetSyncStatus } from "@/domain/agenda-sheets/booking-sheet-sync-status";
import {
  AGENDA_SHEET_SYNC_POLL,
  agendaBookingCrmSuccessCopy,
  nextAgendaBookingSheetSyncUi,
  type AgendaBookingSheetSyncKind,
} from "@/lib/agendaBookingSheetSyncUi";

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
  locations: readonly WeeklyLocationLike[],
): readonly AgendaBiometricosSlotAvailability[] {
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

type AgendaEtapa3Tab = "biometricos" | "notificacion" | "inscripcion";

const AGENDA_TAB_ITEMS: ReadonlyArray<{
  id: AgendaEtapa3Tab;
  label: string;
  activeClass: string;
}> = [
  { id: "biometricos", label: "Biométricos", activeClass: "bg-sky-600 text-white" },
  { id: "notificacion", label: "Notificación", activeClass: "bg-sky-600 text-white" },
  {
    id: "inscripcion",
    label: "Inscripción",
    activeClass: "bg-teal-700 text-white",
  },
];

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
  const [activeNotificacion, setActiveNotificacion] = useState<Awaited<
    ReturnType<NonNullable<typeof repo>["getActiveNotificacionBooking"]>
  > | null>(null);
  const [agendaTab, setAgendaTab] = useState<AgendaEtapa3Tab>("biometricos");
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
  const [convertMode, setConvertMode] = useState(false);
  const [convertDateYmd, setConvertDateYmd] = useState<YmdDate>("2026-01-01" as YmdDate);
  const [convertSedeId, setConvertSedeId] = useState<CynthiaSedeId>(CYNTHIA_SEDE_MONTERREY_ID);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [sheetInventory, setSheetInventory] = useState<InventoryAvailabilityResponse | null>(
    null,
  );
  const [inventoryRefreshing, setInventoryRefreshing] = useState(false);
  const syncWatchGen = useRef(0);

  const watchSheetSync = useCallback(
    async (bookingId: string, kind: AgendaBookingSheetSyncKind) => {
      const id = String(bookingId ?? "").trim();
      const gen = ++syncWatchGen.current;
      setSuccessMsg(agendaBookingCrmSuccessCopy(kind));
      if (!id) return;
      const max = AGENDA_SHEET_SYNC_POLL.maxAttempts;
      for (let attempts = 1; attempts <= max; attempts++) {
        if (gen !== syncWatchGen.current) return;
        if (attempts > 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, AGENDA_SHEET_SYNC_POLL.intervalMs),
          );
        }
        if (gen !== syncWatchGen.current) return;
        const status = await fetchAgendaBookingSheetSyncStatus(
          supabaseBrowser,
          id,
        );
        if (gen !== syncWatchGen.current) return;
        const ui = nextAgendaBookingSheetSyncUi({
          kind,
          status,
          attempts,
          maxAttempts: max,
        });
        setSuccessMsg(ui.message);
        if (!ui.continuePolling) return;
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      syncWatchGen.current += 1;
    };
  }, []);

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

  const puedeConvertir = canShowConvertBiometricosToNotificacion({
    etapaActual,
    hasActiveBiometricosBooking: activeBooking != null,
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
      const [configRecord, booking, notificacion, cancelled] = await Promise.all([
        repo.getBiometricosConfig(),
        repo.getActiveBooking(expedienteId),
        repo.getActiveNotificacionBooking(expedienteId),
        repo.getLastCancelledBooking(expedienteId),
      ]);
      const weekly = configRecord?.config ?? null;
      setConfig(weekly);
      setActiveBooking(booking);
      setActiveNotificacion(notificacion);
      setLastCancelledBooking(booking || notificacion ? null : cancelled);
      if (notificacion && !booking) setAgendaTab("notificacion");
      if (booking) setAgendaTab("biometricos");

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
      setConvertMode(false);
      setConvertDateYmd(today);
      setCapacitiesTick((n) => n + 1);
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
          kind: "biometricos",
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
      setInventoryRefreshing(false);
      return;
    }
    void (async () => {
      setInventoryRefreshing(true);
      try {
        // Obligatorio: refrescar Sheet → inventario ANTES de mostrar disponibilidad.
        const live = await invokeAgendaSheetLiveSync(supabaseBrowser, {
          bookingDate: dateYmd,
          kind: "biometricos",
          locationId: selectedSede.canonicalId,
          mode: "availability",
        });
        if (cancelled) return;
        if (live) {
          setSheetInventory(live);
          return;
        }
        const { data, error } = await supabaseBrowser.rpc(
          "agenda_sheet_inventory_availability",
          {
            p_kind: "biometricos",
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
      } finally {
        if (!cancelled) setInventoryRefreshing(false);
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
      // Hard gate: releer Sheet del horario elegido antes de crear booking.
      if (supabaseBrowser && selectedSede) {
        const gate = await invokeAgendaSheetLiveSync(supabaseBrowser, {
          bookingDate: dateYmd,
          kind: "biometricos",
          locationId: selectedSede.canonicalId,
          mode: "book_gate",
          slotTime: timeHhmm,
        });
        const blocked = shouldBlockBookWithoutLiveSync({
          kind: "biometricos",
          locationId: selectedSede.canonicalId,
          bookingDate: dateYmd,
          gate,
        });
        if (blocked.block) {
          if (gate) setSheetInventory(gate);
          setError(
            blocked.message ??
              gate?.gateMessage ??
              LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE,
          );
          await refreshAvailability();
          return;
        }
        if (gate) {
          setSheetInventory(gate);
          if (gate.canBook === false) {
            setError(gate.gateMessage ?? BOOK_SLOT_JUST_TAKEN_MESSAGE);
            await refreshAvailability();
            return;
          }
        }
      } else {
        const blocked = shouldBlockBookWithoutLiveSync({
          kind: "biometricos",
          locationId: selectedSede.canonicalId,
          bookingDate: dateYmd,
          gate: null,
        });
        if (blocked.block) {
          setError(blocked.message ?? LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE);
          return;
        }
      }
      const booked = await repo.bookBiometricos({
        expedienteId,
        scheduledAt,
        locationId: selectedSede.bookLocationId,
      });
      setSuccessMsg(agendaBookingCrmSuccessCopy("book"));
      await load();
      onUpdated();
      void watchSheetSync(booked.bookingId, "book");
    } catch (err) {
      setError(
        err instanceof AgendaBiometricosSupabaseError
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
    watchSheetSync,
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
      if (supabaseBrowser && selectedSede) {
        const gate = await invokeAgendaSheetLiveSync(supabaseBrowser, {
          bookingDate: dateYmd,
          kind: "biometricos",
          locationId: selectedSede.canonicalId,
          mode: "book_gate",
          slotTime: timeHhmm,
        });
        const blocked = shouldBlockBookWithoutLiveSync({
          kind: "biometricos",
          locationId: selectedSede.canonicalId,
          bookingDate: dateYmd,
          gate,
        });
        if (blocked.block) {
          if (gate) setSheetInventory(gate);
          setError(
            blocked.message ??
              gate?.gateMessage ??
              LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE,
          );
          await refreshAvailability();
          return;
        }
        if (gate) {
          setSheetInventory(gate);
          if (gate.canBook === false) {
            setError(gate.gateMessage ?? BOOK_SLOT_JUST_TAKEN_MESSAGE);
            await refreshAvailability();
            return;
          }
        }
      } else {
        const blocked = shouldBlockBookWithoutLiveSync({
          kind: "biometricos",
          locationId: selectedSede.canonicalId,
          bookingDate: dateYmd,
          gate: null,
        });
        if (blocked.block) {
          setError(blocked.message ?? LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE);
          return;
        }
      }
      const res = await repo.reagendarBiometricos({
        expedienteId,
        scheduledAt,
        locationId: selectedSede.bookLocationId,
      });
      setSuccessMsg(agendaBookingCrmSuccessCopy("reagendar"));
      await load();
      onUpdated();
      void watchSheetSync(res.bookingNuevoId, "reagendar");
    } catch (err) {
      setError(
        err instanceof AgendaBiometricosSupabaseError
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
    watchSheetSync,
  ]);

  const handleConvertToNotificacion = useCallback(async () => {
    if (!repo || !config || !convertDateYmd || !activeBooking || !convertSedeId) return;
    setError(null);
    setSuccessMsg(null);

    const confirmar = window.confirm(
      `¿Confirmas cambiar a Notificación extraordinaria el ${convertDateYmd} a las 12:00 PM?\n\nLa cita biométrica actual será cancelada. El expediente volverá a etapa 3 para que Mesa apruebe 3→5.`,
    );
    if (!confirmar) return;

    setSaving(true);
    try {
      await repo.convertBiometricosToNotificacion({
        expedienteId,
        bookingDate: convertDateYmd,
        locationId: convertSedeId,
      });
      setSuccessMsg(
        "Convertido a Notificación extraordinaria. El expediente quedó en etapa 3.",
      );
      setConvertMode(false);
      await load();
      onUpdated();
    } catch (err) {
      setError(
        err instanceof AgendaBiometricosSupabaseError
          ? err.message
          : "No se pudo convertir a notificación. Intenta de nuevo.",
      );
    } finally {
      setSaving(false);
    }
  }, [
    activeBooking,
    config,
    convertDateYmd,
    convertSedeId,
    expedienteId,
    load,
    onUpdated,
    repo,
  ]);

  const renderAgendaTabs = () => (
    <div
      className="mt-3 flex flex-wrap gap-1 border-b border-gray-100 pb-2"
      data-testid="agenda-asesor-tabs"
    >
      {AGENDA_TAB_ITEMS.map(({ id, label, activeClass }) => (
        <button
          key={id}
          type="button"
          data-testid={`agenda-tab-${id}`}
          onClick={() => {
            setAgendaTab(id);
            setError(null);
            setSuccessMsg(null);
          }}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
            agendaTab === id
              ? activeClass
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const renderInscripcionTab = () => (
    <div className="mt-3" data-testid="agenda-tab-panel-inscripcion">
      <AgendaInscripcionSupabaseCard
        expedienteId={expedienteId}
        embedded
        onUpdated={() => {
          void load();
          onUpdated();
        }}
      />
    </div>
  );

  const renderNotificacionTab = () =>
    repo ? (
      <div className="mt-3" data-testid="agenda-tab-panel-notificacion">
        <AgendaNotificacionSupabaseTab
          expedienteId={expedienteId}
          config={config}
          repo={repo}
          activeNotificacion={activeNotificacion}
          onUpdated={() => {
            void load();
            onUpdated();
          }}
        />
      </div>
    ) : null;

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

      {renderAgendaTabs()}

      {agendaTab === "inscripcion" ? (
        renderInscripcionTab()
      ) : agendaTab === "notificacion" ? (
        renderNotificacionTab()
      ) : (
        <>
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

      {inventoryRefreshing ? (
        <p role="status" className="mt-2 text-[11px] text-gray-500">
          {LIVE_SYNC_LOADING_LABEL}
        </p>
      ) : null}
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
        </>
      )}
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

  if (etapaActual === 3 && activeNotificacion && !activeBooking) {
    return (
      <div className="space-y-3">
        <AsesorAgendaDecisionNotice
          expedienteId={expedienteId}
          kinds={["biometricos", "notificacion"]}
        />
        {lastCancelledBooking ? (
          <AsesorAgendaCitaCanceladaNotice
            motivo={parseCancelMotivoFromNote(lastCancelledBooking.note)}
          />
        ) : null}
        <div className="rounded-xl border border-sky-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-900">Agendar cita</p>
          <p className="mt-1 text-[11px] leading-snug text-gray-600">
            Consulta horarios y cupos disponibles sincronizados con la agenda.
          </p>
          {renderAgendaTabs()}
          {agendaTab === "inscripcion" ? (
            renderInscripcionTab()
          ) : agendaTab === "biometricos" ? (
            <p className="mt-3 rounded-md border border-sky-100 bg-sky-50/60 px-3 py-2 text-xs text-sky-950">
              Hay una notificación extraordinaria activa. Usa el tab Notificación para
              gestionarla, o Inscripción si ya está requerida.
            </p>
          ) : (
            renderNotificacionTab()
          )}
        </div>
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
      <div className="space-y-3">
        <AsesorAgendaDecisionNotice
          expedienteId={expedienteId}
          kinds={["biometricos", "notificacion"]}
        />
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
        <p className="text-sm font-semibold text-emerald-900">Agendar cita</p>
        <p className="mt-1 text-[11px] leading-snug text-emerald-900/80">
          Consulta horarios y cupos disponibles sincronizados con la agenda.
        </p>
        {renderAgendaTabs()}
        {agendaTab === "inscripcion" ? (
          renderInscripcionTab()
        ) : agendaTab === "notificacion" ? (
          renderNotificacionTab()
        ) : (
          <>
        <p className="mt-3 text-sm font-semibold text-emerald-900">Cita de biométricos agendada</p>
        <p className="mt-2 text-xs text-emerald-950">
          <span className="font-medium">Fecha y hora:</span>{" "}
          {formatCitaDisplay(citaIso, locationLabel)}
        </p>
        <p className="mt-1 text-xs text-emerald-800">
          <span className="font-medium">Estatus:</span> Cita agendada — sin avance automático de etapa
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

        {convertMode && puedeConvertir ? (
          <div className="mt-3 space-y-3 rounded-lg border border-amber-300 bg-amber-50/80 p-3">
            <p className="text-xs font-semibold text-amber-950">
              Cambiar a Notificación extraordinaria
            </p>
            <p className="text-[11px] leading-snug text-amber-900">
              Se cancelará la cita biométrica actual y se creará una Notificación con hora fija
              12:00 PM. El expediente quedará en etapa 3 para que Mesa apruebe 3→5.
            </p>
            <label className="block text-[11px] font-semibold text-gray-700">
              Fecha de notificación
              <input
                type="date"
                className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-900"
                value={convertDateYmd}
                min={config ? todayYmdInTimezone(config.timezone) : undefined}
                onChange={(e) => setConvertDateYmd(e.target.value as YmdDate)}
                disabled={saving || !config?.enabled}
              />
            </label>
            <label className="block text-[11px] font-semibold text-gray-700">
              Sede
              <select
                className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-900"
                value={convertSedeId}
                disabled={saving || !config?.enabled}
                onChange={(e) => setConvertSedeId(e.target.value as CynthiaSedeId)}
                data-testid="convert-notificacion-sede"
              >
                <option value={CYNTHIA_SEDE_MONTERREY_ID}>Monterrey</option>
                <option value={CYNTHIA_SEDE_APODACA_ID}>Apodaca</option>
              </select>
            </label>
            <div className="rounded-md border border-gray-200 bg-white/70 px-3 py-2 text-xs text-gray-800">
              Hora: <span className="font-semibold">12:00 PM</span> (fija)
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="primary"
                className="flex-1 text-xs"
                disabled={saving || !config?.enabled || !convertDateYmd || !convertSedeId}
                onClick={() => void handleConvertToNotificacion()}
              >
                {saving ? "Convirtiendo…" : "Confirmar conversión"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1 text-xs"
                disabled={saving}
                onClick={() => {
                  setConvertMode(false);
                  setError(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row">
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
            {puedeConvertir ? (
              <Button
                type="button"
                variant="outline"
                className="w-full border-amber-400 text-xs text-amber-950 hover:bg-amber-50"
                disabled={saving}
                onClick={() => {
                  setError(null);
                  setSuccessMsg(null);
                  setConvertMode(true);
                  if (config) setConvertDateYmd(todayYmdInTimezone(config.timezone));
                }}
              >
                Cambiar a Notificación extraordinaria
              </Button>
            ) : null}
          </div>
        )}
          </>
        )}
      </div>
      </div>
    );
  }

  if (citaIso && !activeBooking) {
    return (
      <div className="space-y-3">
        <AsesorAgendaDecisionNotice
          expedienteId={expedienteId}
          kinds={["biometricos", "notificacion"]}
        />
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
          "Agendar cita",
          "Consulta horarios y cupos disponibles sincronizados con la agenda.",
          "Agendar cita biométrica",
          handleBook,
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <AsesorAgendaDecisionNotice
        expedienteId={expedienteId}
        kinds={["biometricos", "notificacion"]}
      />
      {lastCancelledBooking ? (
        <AsesorAgendaCitaCanceladaNotice
          motivo={parseCancelMotivoFromNote(lastCancelledBooking.note)}
        />
      ) : null}
      {renderFormShell(
        "Agendar cita",
        "Consulta horarios y cupos disponibles sincronizados con la agenda.",
        "Agendar cita biométrica",
        handleBook,
      )}
    </div>
  );
}
