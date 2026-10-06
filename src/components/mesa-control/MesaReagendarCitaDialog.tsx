"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  AgendaBiometricosSupabaseError,
  buildScheduledAtIso,
  computeAdvisorSlotAvailability,
  NOTIFICACION_FIXED_TIME_DISPLAY,
  todayYmdInTimezone,
  useAgendaBiometricosBookingRepo,
  type AgendaBiometricosSlotAvailability,
  type AgendaBiometricosWeeklyConfig,
  type HhmmTime,
  type YmdDate,
} from "@/domain/agenda-biometricos";
import {
  AgendaFirmasSupabaseError,
  useAgendaFirmasBookingRepo,
  type AgendaFirmasWeeklyConfig,
} from "@/domain/agenda-firmas";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import { AdvisorAgendaSlotPicker, buildAdvisorDateAvailabilityInsight } from "@/components/asesor/AdvisorAgendaSlotPicker";
import {
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
import { mesaAgendaCancelDialogKindLabel } from "@/lib/mesaAgendaCitasUi";
import {
  applySheetInventoryToSlots,
  type InventoryAvailabilityResponse,
} from "@/domain/agenda-sheets/apply-inventory-availability";
import {
  fetchBiometricSheetAvailability,
  invokeAgendaSheetLiveSync,
} from "@/domain/agenda-sheets/live-inventory-sync";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export type MesaReagendarConfirmPayload =
  | {
      kind: "biometricos";
      bookingDate: string;
      bookingTime: string;
      locationId: string;
      note: string | null;
    }
  | {
      kind: "firmas";
      scheduledAt: string;
      locationId: string;
      note: string | null;
    }
  | {
      kind: "notificacion";
      bookingDate: string;
      locationId: string;
      note: string | null;
    }
  | {
      kind: "inscripcion";
      bookingDate: string;
      locationId: string;
      note: string | null;
    };

export type MesaReagendarCitaDialogProps = Readonly<{
  open: boolean;
  entry: MesaAgendaBookingEntry | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (payload: MesaReagendarConfirmPayload) => Promise<void>;
}>;

function addDaysYmd(dateYmd: YmdDate, days: number): YmdDate {
  const [y, mo, d] = dateYmd.split("-").map(Number);
  const base = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}` as YmdDate;
}

function adjustSlotsForReagendar(
  slots: readonly AgendaBiometricosSlotAvailability[],
  entry: MesaAgendaBookingEntry | null,
  dateYmd: YmdDate,
  selectedSede: AdvisorSedeOption | null,
  locations: readonly WeeklyLocationLike[],
): readonly AgendaBiometricosSlotAvailability[] {
  if (!entry || entry.status !== "booked" || !selectedSede) return slots;
  if (
    !advisorOptionIncludesBookingLocation(selectedSede, entry.locationId ?? "", locations) ||
    entry.bookingDate !== dateYmd
  ) {
    return slots;
  }
  return slots.map((slot) => {
    if (slot.time !== entry.bookingTime) return slot;
    const bookedCount = Math.max(0, slot.bookedCount - 1);
    const remaining = Math.max(0, slot.capacity - bookedCount);
    return { ...slot, bookedCount, remaining };
  });
}

export function MesaReagendarCitaDialog({
  open,
  entry,
  saving,
  error,
  onClose,
  onConfirm,
}: MesaReagendarCitaDialogProps) {
  const bioRepo = useAgendaBiometricosBookingRepo();
  const firmasRepo = useAgendaFirmasBookingRepo();

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bioConfig, setBioConfig] = useState<AgendaBiometricosWeeklyConfig | null>(null);
  const [firmasConfig, setFirmasConfig] = useState<AgendaFirmasWeeklyConfig | null>(null);
  const [bookedSlots, setBookedSlots] = useState<
    readonly { bookingDate: string; bookingTime: string; locationId: string }[]
  >([]);
  const [sedeCanonicalId, setSedeCanonicalId] = useState("");
  const [notificacionSedeId, setNotificacionSedeId] = useState<CynthiaSedeId>(
    CYNTHIA_SEDE_MONTERREY_ID,
  );
  const [dateYmd, setDateYmd] = useState<YmdDate>("2026-01-01" as YmdDate);
  const [timeHhmm, setTimeHhmm] = useState<HhmmTime | "">("");
  const [note, setNote] = useState("");
  const [sheetInventory, setSheetInventory] =
    useState<InventoryAvailabilityResponse | null>(null);
  const [inventoryRefreshing, setInventoryRefreshing] = useState(false);
  const [fixedSharedAvailability, setFixedSharedAvailability] = useState<{
    available: number;
    capacity: number;
    verified: boolean;
  } | null>(null);

  const kind = entry?.kind ?? "biometricos";
  const activeConfig = kind === "firmas" ? firmasConfig : bioConfig;

  const sedeOptions = useMemo(
    () => buildAdvisorSedeOptions(activeConfig?.locations ?? []),
    [activeConfig],
  );

  const selectedSede = useMemo(
    () => sedeOptions.find((o) => o.canonicalId === sedeCanonicalId) ?? null,
    [sedeCanonicalId, sedeOptions],
  );

  const loadPickerData = useCallback(async () => {
    if (!entry || !open) return;
    setLoading(true);
    setLoadError(null);
    setSheetInventory(null);
    setInventoryRefreshing(true);
    setFixedSharedAvailability(null);
    try {
      if (entry.kind === "firmas") {
        if (!firmasRepo) throw new AgendaFirmasSupabaseError("Modo Supabase requerido.");
        const configRecord = await firmasRepo.getFirmasConfig();
        const weekly = configRecord?.config ?? null;
        setFirmasConfig(weekly);
        const tz = weekly?.timezone ?? "America/Monterrey";
        const today = todayYmdInTimezone(tz);
        const slots = await firmasRepo.listBookedSlots({
          fromDate: today,
          toDate: addDaysYmd(today, 60),
        });
        setBookedSlots(slots);
        const options = buildAdvisorSedeOptions(weekly?.locations ?? []);
        const initialSede =
          mapLocationIdToAdvisorCanonical(entry.locationId ?? "", weekly?.locations ?? []) ??
          options[0]?.canonicalId ??
          "";
        setSedeCanonicalId(initialSede);
        setDateYmd((entry.bookingDate as YmdDate) || today);
        setTimeHhmm("");
      } else if (entry.kind === "biometricos") {
        if (!bioRepo) throw new AgendaBiometricosSupabaseError("Modo Supabase requerido.");
        const configRecord = await bioRepo.getBiometricosConfig();
        const weekly = configRecord?.config ?? null;
        setBioConfig(weekly);
        const tz = weekly?.timezone ?? "America/Monterrey";
        const today = todayYmdInTimezone(tz);
        const slots = await bioRepo.listBookedSlots({
          fromDate: today,
          toDate: addDaysYmd(today, 60),
        });
        setBookedSlots(slots);
        const options = buildAdvisorSedeOptions(weekly?.locations ?? []);
        const initialSede =
          mapLocationIdToAdvisorCanonical(entry.locationId ?? "", weekly?.locations ?? []) ??
          options[0]?.canonicalId ??
          "";
        setSedeCanonicalId(initialSede);
        setDateYmd((entry.bookingDate as YmdDate) || today);
        setTimeHhmm("");
      } else {
        const tz = "America/Monterrey";
        const today = todayYmdInTimezone(tz);
        setDateYmd((entry.bookingDate as YmdDate) || today);
        const loc = String(entry.locationId ?? "").trim().toLowerCase();
        setNotificacionSedeId(
          loc === CYNTHIA_SEDE_APODACA_ID
            ? CYNTHIA_SEDE_APODACA_ID
            : CYNTHIA_SEDE_MONTERREY_ID,
        );
      }
      setNote("");
    } catch (err) {
      setLoadError(
        err instanceof AgendaBiometricosSupabaseError || err instanceof AgendaFirmasSupabaseError
          ? err.message
          : "No se pudo cargar la disponibilidad para reagendar.",
      );
    } finally {
      setLoading(false);
    }
  }, [bioRepo, entry, firmasRepo, open]);

  useEffect(() => {
    if (open && entry) void loadPickerData();
  }, [open, entry, loadPickerData]);

  useEffect(() => {
    let cancelled = false;

    if (
      !open ||
      !entry ||
      (entry.kind !== "biometricos" && entry.kind !== "firmas") ||
      !selectedSede ||
      !dateYmd ||
      !supabaseBrowser
    ) {
      setSheetInventory(null);
      setInventoryRefreshing(false);
      return;
    }

    void (async () => {
      setInventoryRefreshing(true);
      try {
        let inventory: InventoryAvailabilityResponse | null = null;

        if (entry.kind === "biometricos") {
          inventory = await fetchBiometricSheetAvailability(supabaseBrowser, {
            bookingDate: dateYmd,
            locationId: selectedSede.canonicalId,
          });
        } else {
          const live = await invokeAgendaSheetLiveSync(supabaseBrowser, {
            bookingDate: dateYmd,
            kind: "firmas",
            locationId: selectedSede.canonicalId,
            mode: "availability",
          });
          if (live?.fresh === true) {
            inventory = live;
          } else {
            const { data, error: rpcError } = await supabaseBrowser.rpc(
              "agenda_sheet_inventory_availability",
              {
                p_kind: "firmas",
                p_date: dateYmd,
                p_location_id: selectedSede.canonicalId,
              },
            );
            if (!rpcError && data && typeof data === "object") {
              inventory = data as InventoryAvailabilityResponse;
            }
          }
        }

        if (!cancelled) {
          setSheetInventory(
            inventory ?? { fresh: false, enforced: true, slots: [] },
          );
        }
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
  }, [dateYmd, entry, open, selectedSede]);

  useEffect(() => {
    let cancelled = false;
    const isFixedShared =
      entry?.kind === "notificacion" || entry?.kind === "inscripcion";

    if (
      !open ||
      !entry ||
      !isFixedShared ||
      notificacionSedeId !== CYNTHIA_SEDE_MONTERREY_ID ||
      !dateYmd ||
      !supabaseBrowser
    ) {
      setFixedSharedAvailability(null);
      return;
    }

    void (async () => {
      try {
        try {
          await invokeAgendaSheetLiveSync(supabaseBrowser, {
            bookingDate: dateYmd,
            kind: "inscripcion",
            locationId: "monterrey",
            mode: "availability",
          });
        } catch {
          // El RPC SQL conserva el read-model sincronizado y fail-closed.
        }

        const { data, error: rpcError } = await supabaseBrowser.rpc(
          "agenda_sheet_inventory_availability",
          {
            p_kind: "inscripcion",
            p_date: dateYmd,
            p_location_id: "monterrey",
          },
        );

        if (cancelled) return;
        if (rpcError || !data || typeof data !== "object") {
          setFixedSharedAvailability({
            available: 0,
            capacity: 4,
            verified: false,
          });
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
          setFixedSharedAvailability({
            available: 0,
            capacity: 4,
            verified: false,
          });
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

        if (
          entry.bookingDate === dateYmd &&
          String(entry.locationId ?? "").trim().toLowerCase() === "monterrey"
        ) {
          available = Math.min(capacity, available + 1);
        }

        setFixedSharedAvailability({
          available,
          capacity,
          verified: true,
        });
      } catch {
        if (!cancelled) {
          setFixedSharedAvailability({
            available: 0,
            capacity: 4,
            verified: false,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dateYmd, entry, notificacionSedeId, open]);

  const disponibilidadSlots = useMemo(() => {
    if (
      !entry ||
      !activeConfig ||
      entry.kind === "notificacion" ||
      entry.kind === "inscripcion" ||
      !selectedSede
    ) {
      return [];
    }
    const base = computeAdvisorSlotAvailability({
      config: activeConfig,
      bookedSlots,
      date: dateYmd,
      canonicalId: selectedSede.canonicalId,
      sourceLocationIds: selectedSede.sourceLocationIds,
      capacityPerSlot: selectedSede.capacityPerSlot,
      capacityByTime: selectedSede.capacityByTime,
    });
    const adjusted = adjustSlotsForReagendar(
      base,
      entry,
      dateYmd,
      selectedSede,
      activeConfig.locations,
    );
    return applySheetInventoryToSlots(
      adjusted,
      sheetInventory,
      dateYmd,
    ).slots;
  }, [
    activeConfig,
    bookedSlots,
    dateYmd,
    entry,
    selectedSede,
    sheetInventory,
  ]);

  const availabilityInsight = useMemo(() => {
    if (
      !activeConfig ||
      entry?.kind === "notificacion" ||
      entry?.kind === "inscripcion" ||
      !selectedSede
    ) {
      return null;
    }

    const base = buildAdvisorDateAvailabilityInsight({
      config: activeConfig,
      bookedSlots,
      date: dateYmd,
      sede: selectedSede,
    });

    const hasRealSlot = disponibilidadSlots.some((slot) => slot.remaining > 0);
    if (hasRealSlot || sheetInventory?.enforced !== true) return base;

    return {
      emptyReason: "all_full" as const,
      emptyReasonMessage:
        sheetInventory?.fresh === true
          ? "Los cupos reales de esta fecha ya están llenos en Drive."
          : "No se pudo verificar un cupo real en Drive para esta fecha.",
      next: null,
      nextFormatted: null,
      noFutureMessage:
        "Selecciona otra fecha para consultar su disponibilidad real en Drive.",
    };
  }, [
    activeConfig,
    bookedSlots,
    dateYmd,
    disponibilidadSlots,
    entry?.kind,
    selectedSede,
    sheetInventory,
  ]);

  const handleConfirm = useCallback(async () => {
    if (!entry) return;
    if (entry.kind === "notificacion") {
      await onConfirm({
        kind: "notificacion",
        bookingDate: dateYmd,
        locationId: notificacionSedeId,
        note: note.trim() || null,
      });
      return;
    }
    if (entry.kind === "inscripcion") {
      await onConfirm({
        kind: "inscripcion",
        bookingDate: dateYmd,
        locationId: notificacionSedeId,
        note: note.trim() || null,
      });
      return;
    }
    if (!selectedSede || !timeHhmm) return;
    const locationId = selectedSede.sourceLocationIds[0] ?? selectedSede.canonicalId;
    if (entry.kind === "firmas") {
      if (!firmasConfig) return;
      const scheduledAt = buildScheduledAtIso(
        dateYmd,
        timeHhmm as HhmmTime,
        firmasConfig.timezone,
      );
      await onConfirm({
        kind: "firmas",
        scheduledAt,
        locationId,
        note: note.trim() || null,
      });
      return;
    }
    if (!bioConfig) return;
    await onConfirm({
      kind: "biometricos",
      bookingDate: dateYmd,
      bookingTime: timeHhmm,
      locationId,
      note: note.trim() || null,
    });
  }, [
    bioConfig,
    dateYmd,
    entry,
    firmasConfig,
    note,
    notificacionSedeId,
    onConfirm,
    selectedSede,
    timeHhmm,
  ]);

  const handleClose = useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  if (!open || !entry) return null;

  const kindLabel = mesaAgendaCancelDialogKindLabel(entry.kind);
  const fixedSharedBlocked =
    (entry.kind === "notificacion" || entry.kind === "inscripcion") &&
    notificacionSedeId === CYNTHIA_SEDE_MONTERREY_ID &&
    (fixedSharedAvailability?.verified !== true ||
      fixedSharedAvailability.available <= 0);

  const selectedRealSlotAvailable =
    entry.kind === "biometricos" || entry.kind === "firmas"
      ? disponibilidadSlots.some(
          (slot) => slot.time === timeHhmm && slot.remaining > 0,
        )
      : true;

  const canSubmit =
    entry.kind === "notificacion" || entry.kind === "inscripcion"
      ? Boolean(dateYmd) && !fixedSharedBlocked
      : Boolean(selectedSede && dateYmd && timeHhmm) &&
        selectedRealSlotAvailable &&
        !inventoryRefreshing;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={() => {
        if (!saving) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mesa-reagendar-cita-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="mesa-reagendar-cita-title" className="text-base font-semibold text-gray-900">
          Reagendar cita
        </h2>
        <p className="mt-1 text-xs text-gray-600">
          {kindLabel}. La cita anterior quedará cancelada y se creará una nueva.
        </p>

        {loading ? (
          <p className="mt-4 text-sm text-gray-600">Cargando disponibilidad…</p>
        ) : null}

        {loadError ? (
          <p role="alert" className="mt-4 text-xs text-red-700">
            {loadError}
          </p>
        ) : null}

        {!loading && !loadError ? (
          <div className="mt-4 space-y-3">
            {entry.kind === "notificacion" || entry.kind === "inscripcion" ? (
              <>
                <label className="block text-xs font-semibold text-gray-800">
                  Nueva fecha
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    value={dateYmd}
                    min={todayYmdInTimezone("America/Monterrey")}
                    disabled={saving}
                    onChange={(e) => {
                      setFixedSharedAvailability(null);
                      setDateYmd(e.target.value as YmdDate);
                    }}
                  />
                </label>
                <label className="block text-xs font-semibold text-gray-800">
                  Sede
                  <select
                    className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    value={notificacionSedeId}
                    disabled={saving}
                    onChange={(e) => {
                      setFixedSharedAvailability(null);
                      setNotificacionSedeId(e.target.value as CynthiaSedeId);
                    }}
                    data-testid="mesa-reagendar-fixed-sede"
                  >
                    <option value={CYNTHIA_SEDE_MONTERREY_ID}>Monterrey</option>
                    <option value={CYNTHIA_SEDE_APODACA_ID}>Apodaca</option>
                  </select>
                </label>
                <p
                  className={
                    entry.kind === "inscripcion"
                      ? "text-xs text-teal-800"
                      : "text-xs text-amber-800"
                  }
                >
                  Hora fija:{" "}
                  {entry.kind === "inscripcion"
                    ? "11:00 AM"
                    : NOTIFICACION_FIXED_TIME_DISPLAY}
                </p>
                {notificacionSedeId === CYNTHIA_SEDE_MONTERREY_ID ? (
                  <p
                    className={`rounded-md border px-3 py-2 text-xs font-medium ${
                      fixedSharedAvailability?.verified === true &&
                      fixedSharedAvailability.available > 0
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : "border-amber-200 bg-amber-50 text-amber-950"
                    }`}
                  >
                    {fixedSharedAvailability?.verified === true
                      ? fixedSharedAvailability.available > 0
                        ? `Cupo real Drive: ${fixedSharedAvailability.available} de ${fixedSharedAvailability.capacity} disponible${fixedSharedAvailability.available === 1 ? "" : "s"}.`
                        : "Cupo real Drive: sin lugares disponibles."
                      : "Verificando cupo real en Drive…"}
                  </p>
                ) : null}
              </>
            ) : (
              <AdvisorAgendaSlotPicker
                config={activeConfig}
                sedeOptions={sedeOptions}
                selectedSede={selectedSede}
                sedeCanonicalId={sedeCanonicalId}
                dateYmd={dateYmd}
                timeHhmm={timeHhmm}
                disponibilidadSlots={disponibilidadSlots}
                availabilityInsight={availabilityInsight}
                accentRingClass="focus-visible:ring-indigo-500"
                saving={saving}
                onSedeChange={(id) => {
                  setSheetInventory(null);
                  setInventoryRefreshing(true);
                  setSedeCanonicalId(id);
                  setTimeHhmm("");
                }}
                onDateChange={(date) => {
                  setSheetInventory(null);
                  setInventoryRefreshing(true);
                  setDateYmd(date);
                  setTimeHhmm("");
                }}
                onTimeChange={setTimeHhmm}
                onGoToNextAvailability={(date, time) => {
                  setSheetInventory(null);
                  setInventoryRefreshing(true);
                  setDateYmd(date);
                  setTimeHhmm(time);
                }}
              />
            )}

            <label className="block text-xs font-semibold text-gray-800">
              Nota (opcional)
              <textarea
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                rows={2}
                placeholder="Ej. Cliente solicitó cambio de horario."
                value={note}
                disabled={saving}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" className="text-xs" disabled={saving} onClick={handleClose}>
            Cerrar
          </Button>
          <Button
            type="button"
            variant="primary"
            className="text-xs"
            disabled={saving || loading || Boolean(loadError) || !canSubmit}
            onClick={() => void handleConfirm()}
          >
            {saving ? "Reagendando…" : "Confirmar reagenda"}
          </Button>
        </div>
      </div>
    </div>
  );
}
