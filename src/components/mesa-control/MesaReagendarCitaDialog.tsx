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

  const disponibilidadSlots = useMemo(() => {
    if (!entry || !activeConfig || entry.kind === "notificacion" || !selectedSede) return [];
    const base = computeAdvisorSlotAvailability({
      config: activeConfig,
      bookedSlots,
      date: dateYmd,
      canonicalId: selectedSede.canonicalId,
      sourceLocationIds: selectedSede.sourceLocationIds,
      capacityPerSlot: selectedSede.capacityPerSlot,
      capacityByTime: selectedSede.capacityByTime,
    });
    return adjustSlotsForReagendar(base, entry, dateYmd, selectedSede, activeConfig.locations);
  }, [activeConfig, bookedSlots, dateYmd, entry, selectedSede]);

  const availabilityInsight = useMemo(() => {
    if (!activeConfig || entry?.kind === "notificacion" || !selectedSede) return null;
    return buildAdvisorDateAvailabilityInsight({
      config: activeConfig,
      bookedSlots,
      date: dateYmd,
      sede: selectedSede,
    });
  }, [activeConfig, bookedSlots, dateYmd, entry?.kind, selectedSede]);

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
  const canSubmit =
    entry.kind === "notificacion"
      ? Boolean(dateYmd)
      : Boolean(selectedSede && dateYmd && timeHhmm);

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
            {entry.kind === "notificacion" ? (
              <>
                <label className="block text-xs font-semibold text-gray-800">
                  Nueva fecha
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    value={dateYmd}
                    min={todayYmdInTimezone("America/Monterrey")}
                    disabled={saving}
                    onChange={(e) => setDateYmd(e.target.value as YmdDate)}
                  />
                </label>
                <label className="block text-xs font-semibold text-gray-800">
                  Sede
                  <select
                    className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    value={notificacionSedeId}
                    disabled={saving}
                    onChange={(e) =>
                      setNotificacionSedeId(e.target.value as CynthiaSedeId)
                    }
                    data-testid="mesa-reagendar-notificacion-sede"
                  >
                    <option value={CYNTHIA_SEDE_MONTERREY_ID}>Monterrey</option>
                    <option value={CYNTHIA_SEDE_APODACA_ID}>Apodaca</option>
                  </select>
                </label>
                <p className="text-xs text-amber-800">
                  Hora fija: {NOTIFICACION_FIXED_TIME_DISPLAY}
                </p>
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
                onSedeChange={setSedeCanonicalId}
                onDateChange={setDateYmd}
                onTimeChange={setTimeHhmm}
                onGoToNextAvailability={(date, time) => {
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
