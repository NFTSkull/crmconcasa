"use client";

import type { BernardoPeriodPreset } from "@/lib/adminBernardoPeriod";
import { bernardoPresetLabel } from "@/lib/adminBernardoPeriod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const PRESETS: BernardoPeriodPreset[] = [
  "hoy",
  "semana",
  "mes",
  "mes_pasado",
  "personalizado",
];

type AdminBernardoPeriodSelectorProps = {
  preset: BernardoPeriodPreset;
  customFrom: string;
  customTo: string;
  periodLabel: string | null;
  invalidCustom: boolean;
  onPresetChange: (preset: BernardoPeriodPreset) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  onRefresh: () => void;
  loading?: boolean;
};

export function AdminBernardoPeriodSelector({
  preset,
  customFrom,
  customTo,
  periodLabel,
  invalidCustom,
  onPresetChange,
  onCustomFromChange,
  onCustomToChange,
  onRefresh,
  loading = false,
}: AdminBernardoPeriodSelectorProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const selected = preset === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={selected}
              onClick={() => onPresetChange(p)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${
                selected
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {bernardoPresetLabel(p)}
            </button>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          onClick={onRefresh}
          disabled={loading || invalidCustom}
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </Button>
      </div>

      {preset === "personalizado" ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-700">
            Desde
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => onCustomFromChange(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="text-sm text-slate-700">
            Hasta
            <Input
              type="date"
              value={customTo}
              onChange={(e) => onCustomToChange(e.target.value)}
              className="mt-1"
            />
          </label>
        </div>
      ) : null}

      {invalidCustom ? (
        <p className="mt-3 text-sm text-amber-800" role="status">
          Selecciona una fecha inicial y una fecha final válidas.
        </p>
      ) : periodLabel ? (
        <p className="mt-3 text-sm text-slate-600">
          Mostrando información del {periodLabel}
        </p>
      ) : null}
    </div>
  );
}
