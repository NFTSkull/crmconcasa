"use client";

import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import { MesaAgendaCitasDayView } from "@/components/mesa-control/MesaAgendaCitasDayView";
import {
  deriveMesaAgendaWeekDaySummaries,
  filterMesaAgendaEntriesForDay,
  formatMesaAgendaWeekdayLabel,
  type MesaAgendaWeekDaySummary,
} from "@/lib/mesaAgendaCitasUi";

type MesaAgendaCitasWeekViewProps = Readonly<{
  entries: readonly MesaAgendaBookingEntry[];
  weekDays: readonly string[];
  selectedDetailDay: string | null;
  historyGroups: ReadonlyMap<string, readonly MesaAgendaBookingEntry[]>;
  canCancelEntry: (entry: MesaAgendaBookingEntry) => boolean;
  canReagendarEntry: (entry: MesaAgendaBookingEntry) => boolean;
  canDriveValidateEntry: (entry: MesaAgendaBookingEntry) => boolean;
  cancelPendingBookingId?: string | null;
  reagendarPendingBookingId?: string | null;
  drivePendingBookingId?: string | null;
  onSelectDay: (date: string) => void;
  onRequestCancel?: (entry: MesaAgendaBookingEntry) => void;
  onRequestReagendar?: (entry: MesaAgendaBookingEntry) => void;
  onToggleDriveValidation?: (entry: MesaAgendaBookingEntry) => void;
}>;

function WeekDayCard({
  summary,
  selected,
  onSelect,
}: Readonly<{
  summary: MesaAgendaWeekDaySummary;
  selected: boolean;
  onSelect: () => void;
}>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`rounded-xl border p-3 text-left transition-colors ${
        selected
          ? "border-blue-300 bg-blue-50 ring-1 ring-blue-200"
          : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {formatMesaAgendaWeekdayLabel(summary.date)}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{summary.total}</p>
      <p className="mt-1 text-xs text-slate-600">
        Bio {summary.biometricos} · Firma {summary.firmas} · Notif {summary.notificacion}
      </p>
      {summary.slots.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[11px] text-slate-500">
          {summary.slots.slice(0, 4).map((slot) => (
            <li key={`${summary.date}-${slot.timeLabel}`}>
              {slot.timeLabel}: {slot.count}
            </li>
          ))}
          {summary.slots.length > 4 ? <li>…</li> : null}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-slate-400">Sin citas</p>
      )}
    </button>
  );
}

export function MesaAgendaCitasWeekView({
  entries,
  weekDays,
  selectedDetailDay,
  historyGroups,
  canCancelEntry,
  canReagendarEntry,
  canDriveValidateEntry,
  cancelPendingBookingId = null,
  reagendarPendingBookingId = null,
  drivePendingBookingId = null,
  onSelectDay,
  onRequestCancel,
  onRequestReagendar,
  onToggleDriveValidation,
}: MesaAgendaCitasWeekViewProps) {
  const summaries = deriveMesaAgendaWeekDaySummaries(entries, weekDays);
  const detailDay = selectedDetailDay ?? weekDays.find((day) =>
    filterMesaAgendaEntriesForDay(entries, day).length > 0,
  ) ?? weekDays[0] ?? null;
  const detailEntries = detailDay ? filterMesaAgendaEntriesForDay(entries, detailDay) : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {summaries.map((summary) => (
          <WeekDayCard
            key={summary.date}
            summary={summary}
            selected={detailDay === summary.date}
            onSelect={() => onSelectDay(summary.date)}
          />
        ))}
      </div>

      {detailDay ? (
        <section aria-label={`Detalle del ${formatMesaAgendaWeekdayLabel(detailDay)}`}>
          <h3 className="mb-3 text-sm font-semibold text-slate-800">
            Detalle · {formatMesaAgendaWeekdayLabel(detailDay)}
          </h3>
          <MesaAgendaCitasDayView
            entries={detailEntries}
            historyGroups={historyGroups}
            canCancelEntry={canCancelEntry}
            canReagendarEntry={canReagendarEntry}
            canDriveValidateEntry={canDriveValidateEntry}
            cancelPendingBookingId={cancelPendingBookingId}
            reagendarPendingBookingId={reagendarPendingBookingId}
            drivePendingBookingId={drivePendingBookingId}
            onRequestCancel={onRequestCancel}
            onRequestReagendar={onRequestReagendar}
            onToggleDriveValidation={onToggleDriveValidation}
          />
        </section>
      ) : null}
    </div>
  );
}
