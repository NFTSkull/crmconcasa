"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import {
  CYNTHIA_SEDE_APODACA_ID,
  CYNTHIA_SEDE_MONTERREY_ID,
  resolveSedeSlotCapacityDraft,
  type CynthiaSedeFormState,
  type CynthiaSedeId,
} from "@/lib/agendaCynthiaLocations";
import {
  CYNTHIA_QUICK_SLOT_TIMES,
  CYNTHIA_STANDARD_WORKDAY_SLOTS,
  tryAddManualSlotTime,
  type CynthiaQuickSlotTime,
} from "@/lib/agendaCynthiaSlots";
import type { HhmmTime } from "@/domain/agenda-biometricos";

export type AgendaWeekdayOption = Readonly<{ value: number; label: string }>;

type Variant = "sky" | "violet";

const VARIANT_STYLES: Record<
  Variant,
  { card: string; pillOn: string; pillOff: string; accent: string; quickOn: string; quickOff: string }
> = {
  sky: {
    card: "border-sky-200/80 bg-white",
    pillOn: "border-sky-600 bg-sky-600 text-white shadow-sm",
    pillOff: "border-slate-300 bg-white text-slate-800 hover:border-sky-300",
    accent: "accent-sky-600",
    quickOn: "border-sky-600 bg-sky-100 text-sky-900",
    quickOff: "border-slate-300 bg-white text-slate-800 hover:border-sky-400 hover:bg-sky-50",
  },
  violet: {
    card: "border-violet-200/80 bg-white",
    pillOn: "border-violet-600 bg-violet-600 text-white shadow-sm",
    pillOff: "border-slate-300 bg-white text-slate-800 hover:border-violet-300",
    accent: "accent-violet-600",
    quickOn: "border-violet-600 bg-violet-100 text-violet-900",
    quickOff: "border-slate-300 bg-white text-slate-800 hover:border-violet-400 hover:bg-violet-50",
  },
};

export type AgendaWeeklyConfigFormProps = Readonly<{
  variant: Variant;
  agendaKindLabel: string;
  canEdit: boolean;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  minLeadHours: number;
  onMinLeadHoursChange: (value: number) => void;
  allowedWeekdays: number[];
  onToggleWeekday: (day: number) => void;
  weekdayOptions: readonly AgendaWeekdayOption[];
  slots: readonly HhmmTime[];
  onAddSlot: (slot: HhmmTime) => void;
  onMergeSlots: (slots: readonly HhmmTime[]) => void;
  onRemoveSlot: (slot: HhmmTime) => void;
  sedes: Record<CynthiaSedeId, CynthiaSedeFormState>;
  onSedeChange: (id: CynthiaSedeId, patch: Partial<CynthiaSedeFormState>) => void;
  metaUpdatedAt: string | null;
  formatDateTime: (iso: string | null | undefined) => string;
  warnings: readonly string[];
  saveError: string | null;
  saveOk: string | null;
  saving: boolean;
  onSave: () => void;
  onReload: () => void;
  slotInputError: string | null;
  onSlotInputError: (message: string | null) => void;
  /** Excepciones por fecha (colapsable) dentro de Horarios disponibles. */
  exceptionsPanel?: ReactNode;
}>;

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

const SLOT_HELPER =
  "Elige un horario rápido o escribe uno personalizado.";
const SLOT_INVALID_MSG = "Usa formato de hora válido, por ejemplo 09:00.";
const SLOT_DUPLICATE_MSG = "Ese horario ya está en la lista.";

export function AgendaWeeklyConfigForm({
  variant,
  agendaKindLabel,
  canEdit,
  enabled,
  onEnabledChange,
  minLeadHours,
  onMinLeadHoursChange,
  allowedWeekdays,
  onToggleWeekday,
  weekdayOptions,
  slots,
  onAddSlot,
  onMergeSlots,
  onRemoveSlot,
  sedes,
  onSedeChange,
  metaUpdatedAt,
  formatDateTime,
  warnings,
  saveError,
  saveOk,
  saving,
  onSave,
  onReload,
  slotInputError,
  onSlotInputError,
  exceptionsPanel,
}: AgendaWeeklyConfigFormProps) {
  const styles = VARIANT_STYLES[variant];

  const activeSedeColumns = (
    [
      { id: CYNTHIA_SEDE_MONTERREY_ID, title: "Monterrey" },
      { id: CYNTHIA_SEDE_APODACA_ID, title: "Apodaca" },
    ] as const
  ).filter((s) => sedes[s.id].enabled);

  function setSlotCapacity(sedeId: CynthiaSedeId, slot: HhmmTime, raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      const next = { ...sedes[sedeId].capacityByTime };
      delete next[slot];
      onSedeChange(sedeId, { capacityByTime: next });
      return;
    }
    const next = Math.max(1, Math.trunc(Number(trimmed) || 0));
    if (!Number.isFinite(next) || next < 1) return;
    onSedeChange(sedeId, {
      capacityByTime: {
        ...sedes[sedeId].capacityByTime,
        [slot]: next,
      },
    });
  }

  function handleQuickSlot(time: CynthiaQuickSlotTime) {
    if (slots.includes(time)) return;
    onSlotInputError(null);
    onAddSlot(time);
  }

  function handleStandardWorkday() {
    onSlotInputError(null);
    onMergeSlots(CYNTHIA_STANDARD_WORKDAY_SLOTS);
  }

  function handleAddManualSlot(raw: string): boolean {
    const result = tryAddManualSlotTime(raw, slots);
    if (result.kind === "empty") {
      onSlotInputError(null);
      return false;
    }
    if (result.kind === "invalid") {
      onSlotInputError(SLOT_INVALID_MSG);
      return false;
    }
    if (result.kind === "duplicate") {
      onSlotInputError(SLOT_DUPLICATE_MSG);
      return false;
    }
    onSlotInputError(null);
    onAddSlot(result.slot as HhmmTime);
    return true;
  }

  return (
    <section className={`rounded-xl border p-4 shadow-sm sm:p-5 ${styles.card}`}>
      <header className="border-b border-slate-200 pb-4">
        <h2 className="text-base font-semibold text-slate-900">Configuración de agendas</h2>
        <p className="mt-1 text-sm text-slate-700">
          Define los días, horarios y sedes disponibles para citas.
        </p>
        <p className="mt-2 text-sm font-medium text-slate-800">{agendaKindLabel}</p>
        {metaUpdatedAt ? (
          <p className="mt-1 text-xs text-slate-500">
            Última actualización: {formatDateTime(metaUpdatedAt)}
          </p>
        ) : null}
      </header>

      <div className="mt-4 space-y-5">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            className={`h-4 w-4 ${styles.accent}`}
            disabled={!canEdit}
          />
          Agenda activa
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-slate-900">Zona horaria</p>
            <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
              America/Monterrey
            </p>
          </div>
          <label className="text-sm font-medium text-slate-900">
            Anticipación mínima (horas)
            <input
              type="number"
              min={0}
              value={minLeadHours}
              onChange={(e) => onMinLeadHoursChange(Number(e.target.value || 0))}
              className={INPUT_CLASS}
              disabled={!canEdit}
            />
            <span className="mt-1 block text-xs text-slate-600">Recomendado: 24 horas</span>
          </label>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          <p className="text-sm font-semibold text-slate-900">Días disponibles</p>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Días disponibles">
            {weekdayOptions.map((day) => {
              const active = allowedWeekdays.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={active}
                  onClick={() => onToggleWeekday(day.value)}
                  className={`min-w-[3rem] rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                    active ? styles.pillOn : styles.pillOff
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          <p className="text-sm font-semibold text-slate-900">Horarios disponibles</p>
          <p className="mt-1 text-sm text-slate-600">
            Selecciona horarios rápidos o agrega uno personalizado.
          </p>

          {canEdit ? (
            <>
              <div className="mt-4">
                <p className="text-sm font-medium text-slate-900">Horarios rápidos</p>
                <div
                  className="mt-2 flex flex-wrap gap-2"
                  role="group"
                  aria-label="Horarios rápidos"
                >
                  {CYNTHIA_QUICK_SLOT_TIMES.map((time) => {
                    const selected = slots.includes(time);
                    return (
                      <button
                        key={time}
                        type="button"
                        disabled={selected}
                        aria-pressed={selected}
                        onClick={() => handleQuickSlot(time)}
                        className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-default ${
                          selected ? styles.quickOn : styles.quickOff
                        }`}
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <Button type="button" variant="outline" onClick={handleStandardWorkday}>
                    Usar jornada estándar
                  </Button>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-sm font-medium text-slate-900">Horarios seleccionados</p>
                {slots.length ? (
                  <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="min-w-full divide-y divide-slate-100 text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Hora</th>
                          {activeSedeColumns.map((s) => (
                            <th key={s.id} className="px-3 py-2">
                              {s.title}
                            </th>
                          ))}
                          <th className="px-3 py-2">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {slots.map((slot) => (
                          <tr key={slot}>
                            <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">
                              {slot}
                            </td>
                            {activeSedeColumns.map((s) => (
                              <td key={s.id} className="px-3 py-2">
                                <label className="block text-[11px] font-semibold text-slate-600">
                                  Cupo
                                  <input
                                    type="number"
                                    min={1}
                                    disabled={!canEdit}
                                    className="mt-0.5 w-full min-w-[4.5rem] rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                                    value={resolveSedeSlotCapacityDraft(sedes[s.id], slot)}
                                    onChange={(e) => setSlotCapacity(s.id, slot, e.target.value)}
                                    placeholder="—"
                                  />
                                </label>
                              </td>
                            ))}
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
                                disabled={!canEdit}
                                onClick={() => onRemoveSlot(slot)}
                              >
                                Quitar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">Sin horarios configurados.</p>
                )}
                <p className="mt-2 text-xs text-slate-600">
                  El asesor verá los lugares restantes según las reservas de cada fecha.
                </p>
                {canEdit ? (
                  <div className="mt-3">
                    <Button type="button" variant="primary" disabled={saving} onClick={onSave}>
                      {saving ? "Guardando…" : "Guardar horarios y cupos"}
                    </Button>
                  </div>
                ) : null}
              </div>

              <ManualSlotAdder
                inputClass={INPUT_CLASS}
                helperText={SLOT_HELPER}
                error={slotInputError}
                onAdd={handleAddManualSlot}
              />

              {exceptionsPanel ? <div className="mt-4">{exceptionsPanel}</div> : null}
            </>
          ) : (
            <div className="mt-3 space-y-3">
              {slots.length ? (
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Hora</th>
                        {activeSedeColumns.map((s) => (
                          <th key={s.id} className="px-3 py-2">
                            {s.title}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {slots.map((slot) => (
                        <tr key={slot}>
                          <td className="px-3 py-2 font-medium text-slate-900">{slot}</td>
                          {activeSedeColumns.map((s) => {
                            const draft = resolveSedeSlotCapacityDraft(sedes[s.id], slot);
                            return (
                              <td key={s.id} className="px-3 py-2 text-slate-800">
                                {draft === "" ? "Sin cupo" : `Cupo: ${draft}`}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <span className="text-sm text-slate-600">Sin horarios configurados.</span>
              )}
              {exceptionsPanel ? <div>{exceptionsPanel}</div> : null}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          <p className="text-sm font-semibold text-slate-900">Sedes para citas</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SedeCard
              title="Monterrey"
              state={sedes[CYNTHIA_SEDE_MONTERREY_ID]}
              canEdit={canEdit}
              accent={styles.accent}
              onChange={(patch) => onSedeChange(CYNTHIA_SEDE_MONTERREY_ID, patch)}
            />
            <SedeCard
              title="Apodaca"
              state={sedes[CYNTHIA_SEDE_APODACA_ID]}
              canEdit={canEdit}
              accent={styles.accent}
              onChange={(patch) => onSedeChange(CYNTHIA_SEDE_APODACA_ID, patch)}
            />
          </div>
        </div>
      </div>

      {warnings.length ? (
        <div
          role="status"
          className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
        >
          <p className="font-semibold">Advertencias</p>
          <ul className="mt-1 list-disc pl-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {saveError ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {saveError}
        </p>
      ) : null}
      {saveOk ? (
        <p role="status" className="mt-3 text-sm font-medium text-emerald-700">
          {saveOk}
        </p>
      ) : null}

      {canEdit ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onReload}>
            Recargar
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ManualSlotAdder({
  inputClass,
  helperText,
  error,
  onAdd,
}: Readonly<{
  inputClass: string;
  helperText: string;
  error: string | null;
  onAdd: (raw: string) => boolean;
}>) {
  const [draft, setDraft] = useState("");
  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <p className="text-sm font-medium text-slate-900">Horario personalizado</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="min-w-[10rem] flex-1 text-sm font-medium text-slate-900">
          <span className="sr-only">Horario personalizado</span>
          <input
            type="text"
            placeholder="Ej. 13:30"
            value={draft}
            className={inputClass}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (onAdd(draft)) setDraft("");
              }
            }}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (onAdd(draft)) setDraft("");
          }}
        >
          Agregar horario personalizado
        </Button>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-600">{helperText}</p>
      )}
    </div>
  );
}

function SedeCard({
  title,
  state,
  canEdit,
  accent,
  onChange,
}: Readonly<{
  title: string;
  state: CynthiaSedeFormState;
  canEdit: boolean;
  accent: string;
  onChange: (patch: Partial<CynthiaSedeFormState>) => void;
}>) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <label className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-900">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={!canEdit}
          className={`h-4 w-4 ${accent}`}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        Sede activa
      </label>
    </article>
  );
}
