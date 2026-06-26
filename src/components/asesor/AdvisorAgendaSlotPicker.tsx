"use client";

import { Button } from "@/components/ui/Button";
import {
  buildAdvisorDateAvailabilityInsight,
  type AdvisorDateAvailabilityInsight,
} from "@/lib/agendaAdvisorNextAvailability";
import { todayYmdInTimezone } from "@/domain/agenda-biometricos";
import type { AgendaBiometricosSlotAvailability } from "@/domain/agenda-biometricos";
import type { AgendaBiometricosWeeklyConfig } from "@/domain/agenda-biometricos/map-agenda-config";
import type { HhmmTime, YmdDate } from "@/domain/agenda-biometricos/types";
import type { AdvisorSedeOption } from "@/lib/agendaAdvisorLocations";

export type AdvisorAgendaSlotPickerProps = Readonly<{
  config: AgendaBiometricosWeeklyConfig | null;
  sedeOptions: readonly AdvisorSedeOption[];
  selectedSede: AdvisorSedeOption | null;
  sedeCanonicalId: string;
  dateYmd: YmdDate;
  timeHhmm: HhmmTime | "";
  disponibilidadSlots: readonly AgendaBiometricosSlotAvailability[];
  availabilityInsight: AdvisorDateAvailabilityInsight | null;
  accentRingClass?: string;
  saving: boolean;
  onSedeChange: (canonicalId: string) => void;
  onDateChange: (date: YmdDate) => void;
  onTimeChange: (time: HhmmTime) => void;
  onGoToNextAvailability: (date: YmdDate, time: HhmmTime) => void;
}>;

export function AdvisorAgendaSlotPicker({
  config,
  sedeOptions,
  selectedSede,
  sedeCanonicalId,
  dateYmd,
  timeHhmm,
  disponibilidadSlots,
  availabilityInsight,
  accentRingClass = "focus-visible:ring-sky-500",
  saving,
  onSedeChange,
  onDateChange,
  onTimeChange,
  onGoToNextAvailability,
}: AdvisorAgendaSlotPickerProps) {
  const hasBookableNow = disponibilidadSlots.some((s) => s.remaining > 0);

  return (
    <div className="mt-3 space-y-3">
      <label className="block text-[11px] font-semibold text-gray-700">
        Sede
        <select
          className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-900"
          value={sedeCanonicalId}
          onChange={(e) => onSedeChange(e.target.value)}
          disabled={!config?.enabled || saving}
        >
          {sedeOptions.map((opt) => (
            <option key={opt.canonicalId} value={opt.canonicalId}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-[11px] font-semibold text-gray-700">
        Fecha
        <input
          type="date"
          className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-900"
          value={dateYmd}
          min={config ? todayYmdInTimezone(config.timezone) : undefined}
          onChange={(e) => onDateChange(e.target.value as YmdDate)}
          disabled={saving || !config?.enabled}
        />
      </label>

      <div>
        <p className="text-[11px] font-semibold text-gray-700">Horario</p>
        <p className="mt-0.5 text-[10px] text-gray-500">
          Verde: disponible · Gris: lleno o no permitido
        </p>
        <div className="mt-1.5 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-gray-100 bg-gray-50/80 p-2">
          {disponibilidadSlots.length === 0 || !hasBookableNow ? (
            <div className="w-full space-y-2">
              <p className="text-[11px] font-medium text-gray-700">
                No hay horarios disponibles para esta fecha.
              </p>
              {availabilityInsight?.emptyReasonMessage ? (
                <p className="text-[11px] text-gray-600">{availabilityInsight.emptyReasonMessage}</p>
              ) : null}
              {availabilityInsight?.nextFormatted ? (
                <p className="text-[11px] text-gray-800">
                  <span className="font-medium">Próxima disponibilidad:</span>{" "}
                  {availabilityInsight.nextFormatted}
                </p>
              ) : null}
              {availabilityInsight?.noFutureMessage ? (
                <p className="text-[11px] text-amber-900">{availabilityInsight.noFutureMessage}</p>
              ) : null}
              {availabilityInsight?.next ? (
                <Button
                  type="button"
                  variant="outline"
                  className="text-xs"
                  disabled={saving}
                  onClick={() =>
                    onGoToNextAvailability(
                      availabilityInsight.next!.date,
                      availabilityInsight.next!.time,
                    )
                  }
                >
                  Ir a próxima disponibilidad
                </Button>
              ) : null}
            </div>
          ) : (
            disponibilidadSlots.map((slot) => {
              const lleno = slot.remaining <= 0;
              const selected = timeHhmm === slot.time;
              return (
                <button
                  key={slot.time}
                  type="button"
                  disabled={lleno || saving}
                  onClick={() => onTimeChange(slot.time)}
                  className={`rounded-md border px-2 py-1 text-left text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 ${accentRingClass} disabled:cursor-not-allowed ${
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
  );
}

export { buildAdvisorDateAvailabilityInsight };
