"use client";

import { Input } from "@/components/ui/Input";
import type { MesaAgendaCitasViewMode } from "@/lib/mesaAgendaCitasUi";
import {
  formatMesaAgendaDayHeading,
  formatMesaAgendaWeekdayLabel,
  todayMesaAgendaYmd,
} from "@/lib/mesaAgendaCitasUi";

const VIEW_OPTIONS: ReadonlyArray<{ value: MesaAgendaCitasViewMode; label: string }> = [
  { value: "lista", label: "Lista" },
  { value: "dia", label: "Día" },
  { value: "semana", label: "Semana" },
];

type MesaAgendaCitasViewControlsProps = Readonly<{
  viewMode: MesaAgendaCitasViewMode;
  startDate: string;
  endDate: string;
  selectedDay: string;
  weekDays: readonly string[];
  loading: boolean;
  /** Error de rango Lista (inicial > final, vacío, >62 días). */
  rangeError?: string | null;
  /** Si false, deshabilita «Actualizar citas» sin mutar fechas. */
  canRefreshLista?: boolean;
  onViewModeChange: (mode: MesaAgendaCitasViewMode) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onSelectedDayChange: (value: string) => void;
  onShiftDay: (delta: number) => void;
  onShiftWeek: (delta: number) => void;
  onGoToday: () => void;
  onRefresh: () => void;
}>;

function NavButton({
  label,
  onClick,
  disabled,
}: Readonly<{ label: string; onClick: () => void; disabled?: boolean }>) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:text-sm"
    >
      {label}
    </button>
  );
}

export function MesaAgendaCitasViewControls({
  viewMode,
  startDate,
  endDate,
  selectedDay,
  weekDays,
  loading,
  rangeError = null,
  canRefreshLista = true,
  onViewModeChange,
  onStartDateChange,
  onEndDateChange,
  onSelectedDayChange,
  onShiftDay,
  onShiftWeek,
  onGoToday,
  onRefresh,
}: MesaAgendaCitasViewControlsProps) {
  const today = todayMesaAgendaYmd();
  const refreshDisabled = loading || !canRefreshLista;

  return (
    <section className="space-y-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Vista:</span>
        <div
          role="tablist"
          aria-label="Modo de vista de citas"
          className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-0.5"
        >
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={viewMode === option.value}
              disabled={loading}
              onClick={() => onViewModeChange(option.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium sm:text-sm ${
                viewMode === option.value
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {viewMode === "lista" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            id="mesa-citas-start"
            label="Fecha inicial"
            type="date"
            value={startDate}
            disabled={loading}
            onChange={(e) => onStartDateChange(e.target.value)}
          />
          <Input
            id="mesa-citas-end"
            label="Fecha final"
            type="date"
            value={endDate}
            disabled={loading}
            onChange={(e) => onEndDateChange(e.target.value)}
          />
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
            <NavButton label="Hoy" disabled={loading} onClick={onGoToday} />
            <button
              type="button"
              disabled={refreshDisabled}
              onClick={onRefresh}
              aria-label="Actualizar citas"
              className="inline-flex h-[42px] w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
            >
              {loading ? "Actualizando…" : "Actualizar citas"}
            </button>
          </div>
          {rangeError ? (
            <p
              className="text-xs font-medium text-red-700 sm:col-span-2 lg:col-span-4"
              role="alert"
              data-testid="mesa-citas-range-error"
            >
              {rangeError}
            </p>
          ) : startDate === endDate && startDate === today ? (
            <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">
              Mostrando citas de hoy (America/Monterrey).
            </p>
          ) : startDate === endDate ? (
            <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">
              Consulta de un solo día: {startDate}.
            </p>
          ) : startDate && endDate ? (
            <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">
              Rango libre: {startDate} → {endDate}. Pulsa «Actualizar citas» para consultar.
            </p>
          ) : null}
        </div>
      ) : null}

      {viewMode === "dia" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800">{formatMesaAgendaDayHeading(selectedDay)}</p>
          <div className="flex flex-wrap items-end gap-2">
            <NavButton label="Día anterior" disabled={loading} onClick={() => onShiftDay(-1)} />
            <NavButton label="Hoy" disabled={loading} onClick={onGoToday} />
            <NavButton label="Día siguiente" disabled={loading} onClick={() => onShiftDay(1)} />
            <Input
              id="mesa-citas-selected-day"
              label="Seleccionar día"
              type="date"
              value={selectedDay}
              disabled={loading}
              onChange={(e) => onSelectedDayChange(e.target.value)}
            />
          </div>
          {selectedDay === today ? (
            <p className="text-xs text-slate-500">Mostrando citas de hoy.</p>
          ) : null}
        </div>
      ) : null}

      {viewMode === "semana" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800">
            Semana {formatMesaAgendaWeekdayLabel(weekDays[0] ?? selectedDay)} –{" "}
            {formatMesaAgendaWeekdayLabel(weekDays[6] ?? selectedDay)}
          </p>
          <div className="flex flex-wrap gap-2">
            <NavButton label="Semana anterior" disabled={loading} onClick={() => onShiftWeek(-1)} />
            <NavButton label="Semana actual" disabled={loading} onClick={onGoToday} />
            <NavButton label="Semana siguiente" disabled={loading} onClick={() => onShiftWeek(1)} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
