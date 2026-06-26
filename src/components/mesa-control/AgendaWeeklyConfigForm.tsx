"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  CYNTHIA_SEDE_APODACA_ID,
  CYNTHIA_SEDE_MONTERREY_ID,
  parseHhmmSlotInput,
  type CynthiaSedeFormState,
  type CynthiaSedeId,
} from "@/lib/agendaCynthiaLocations";
import type { HhmmTime } from "@/domain/agenda-biometricos";

export type AgendaWeekdayOption = Readonly<{ value: number; label: string }>;

type Variant = "sky" | "violet";

const VARIANT_STYLES: Record<
  Variant,
  { card: string; pillOn: string; pillOff: string; accent: string }
> = {
  sky: {
    card: "border-sky-200/80 bg-white",
    pillOn: "border-sky-600 bg-sky-600 text-white shadow-sm",
    pillOff: "border-slate-300 bg-white text-slate-800 hover:border-sky-300",
    accent: "accent-sky-600",
  },
  violet: {
    card: "border-violet-200/80 bg-white",
    pillOn: "border-violet-600 bg-violet-600 text-white shadow-sm",
    pillOff: "border-slate-300 bg-white text-slate-800 hover:border-violet-300",
    accent: "accent-violet-600",
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
}>;

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

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
}: AgendaWeeklyConfigFormProps) {
  const styles = VARIANT_STYLES[variant];

  function handleAddSlot(raw: string) {
    const parsed = parseHhmmSlotInput(raw);
    if (!parsed) {
      onSlotInputError("Usa formato de hora válido, por ejemplo 09:00.");
      return;
    }
    if (slots.includes(parsed as HhmmTime)) {
      onSlotInputError("Ese horario ya está en la lista.");
      return;
    }
    onSlotInputError(null);
    onAddSlot(parsed as HhmmTime);
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
          <p className="mt-1 text-xs text-slate-600">Estos horarios aplican para las sedes activas.</p>
          {canEdit ? (
            <SlotAdder
              inputClass={INPUT_CLASS}
              onAdd={handleAddSlot}
              error={slotInputError}
            />
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {slots.map((slot) => (
              <span
                key={slot}
                className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-900 shadow-sm"
              >
                {slot}
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`Quitar horario ${slot}`}
                    className="ml-0.5 text-slate-500 hover:text-red-600"
                    onClick={() => onRemoveSlot(slot)}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
            {!slots.length ? (
              <span className="text-sm text-slate-600">Sin horarios configurados.</span>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          <p className="text-sm font-semibold text-slate-900">Sedes para citas</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SedeCard
              title="Monterrey"
              state={sedes[CYNTHIA_SEDE_MONTERREY_ID]}
              canEdit={canEdit}
              inputClass={INPUT_CLASS}
              accent={styles.accent}
              onChange={(patch) => onSedeChange(CYNTHIA_SEDE_MONTERREY_ID, patch)}
            />
            <SedeCard
              title="Apodaca"
              state={sedes[CYNTHIA_SEDE_APODACA_ID]}
              canEdit={canEdit}
              inputClass={INPUT_CLASS}
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
          <Button type="button" variant="primary" disabled={saving} onClick={onSave}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={onReload}>
            Recargar
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function SlotAdder({
  inputClass,
  onAdd,
  error,
}: Readonly<{
  inputClass: string;
  onAdd: (raw: string) => void;
  error: string | null;
}>) {
  const [draft, setDraft] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="min-w-[10rem] flex-1 text-sm font-medium text-slate-900">
        Agregar horario
        <input
          type="text"
          placeholder="Ej. 09:00"
          value={draft}
          className={inputClass}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd(draft);
              setDraft("");
            }
          }}
        />
      </label>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          onAdd(draft);
          setDraft("");
        }}
      >
        Agregar
      </Button>
      {error ? (
        <p className="w-full text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SedeCard({
  title,
  state,
  canEdit,
  inputClass,
  accent,
  onChange,
}: Readonly<{
  title: string;
  state: CynthiaSedeFormState;
  canEdit: boolean;
  inputClass: string;
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
      <label className="mt-3 block text-sm font-medium text-slate-900">
        Cupo por horario
        <input
          type="number"
          min={1}
          disabled={!canEdit}
          value={state.capacityPerSlot}
          onChange={(e) =>
            onChange({ capacityPerSlot: Math.max(1, Number(e.target.value || 1)) })
          }
          className={inputClass}
        />
      </label>
    </article>
  );
}
