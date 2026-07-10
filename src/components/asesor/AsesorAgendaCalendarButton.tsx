"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { isDataModeSupabase } from "@/lib/dataMode";
import {
  AsesorAgendaCalendarSupabaseError,
  fetchAsesorAgendaCalendarEntries,
} from "@/domain/agenda-calendar/supabase.repo";
import {
  asesorAgendaCalendarDisplayName,
  computeCalendarMonthRange,
  filterCalendarEntries,
  formatAgendaCalendarKindLabel,
  formatAgendaCalendarStatusLabel,
  loadMockAgendaCalendarEntries,
  shiftYmd,
  todayYmdLocal,
  type AgendaCalendarKindFilter,
  type AsesorAgendaCalendarEntry,
} from "@/lib/asesorAgendaCalendar";

type AsesorAgendaCalendarDialogProps = Readonly<{
  open: boolean;
  onClose: () => void;
}>;

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function kindBadgeClass(kind: AsesorAgendaCalendarEntry["kind"]): string {
  if (kind === "biometricos") {
    return "bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200";
  }
  if (kind === "notificacion") {
    return "bg-amber-50 text-amber-900 ring-1 ring-amber-200";
  }
  return "bg-violet-50 text-violet-800 ring-1 ring-violet-200";
}

function statusBadgeClass(status: AsesorAgendaCalendarEntry["status"]): string {
  return status === "booked"
    ? "bg-emerald-50 text-emerald-800"
    : "bg-gray-100 text-gray-600 line-through";
}

export function AsesorAgendaCalendarDialog({ open, onClose }: AsesorAgendaCalendarDialogProps) {
  const dataSupabase = isDataModeSupabase();
  const [selectedDate, setSelectedDate] = useState(todayYmdLocal);
  const [kindFilter, setKindFilter] = useState<AgendaCalendarKindFilter>("all");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [entries, setEntries] = useState<AsesorAgendaCalendarEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthRange = useMemo(() => {
    const [y, m] = selectedDate.split("-").map(Number);
    return computeCalendarMonthRange(y ?? new Date().getFullYear(), (m ?? 1) - 1);
  }, [selectedDate]);

  const reload = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const rows = dataSupabase
        ? await fetchAsesorAgendaCalendarEntries({
            startDate: monthRange.startDate,
            endDate: monthRange.endDate,
            includeCancelled,
          })
        : loadMockAgendaCalendarEntries({
            startDate: monthRange.startDate,
            endDate: monthRange.endDate,
            includeCancelled,
          });
      setEntries(rows);
    } catch (err) {
      setEntries([]);
      if (err instanceof AsesorAgendaCalendarSupabaseError) {
        setError(err.message);
      } else {
        setError("No se pudo cargar el calendario de citas.");
      }
    } finally {
      setLoading(false);
    }
  }, [open, dataSupabase, monthRange.startDate, monthRange.endDate, includeCancelled]);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onUpdated = () => {
      void reload();
    };
    window.addEventListener("agenda_bookings_updated", onUpdated);
    window.addEventListener("agenda_config_updated", onUpdated);
    return () => {
      window.removeEventListener("agenda_bookings_updated", onUpdated);
      window.removeEventListener("agenda_config_updated", onUpdated);
    };
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const dayEntries = useMemo(
    () =>
      filterCalendarEntries(entries, {
        kind: kindFilter,
        includeCancelled,
        selectedDate,
      }),
    [entries, kindFilter, includeCancelled, selectedDate],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="asesor-agenda-calendar-title"
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl border border-gray-200 bg-white shadow-xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div>
            <h2 id="asesor-agenda-calendar-title" className="text-base font-semibold text-gray-900">
              Calendario de citas
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Solo lectura · horarios ocupados de la organización
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar calendario"
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-9 px-2 text-xs"
              onClick={() => setSelectedDate((d) => shiftYmd(d, -1))}
            >
              ←
            </Button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="min-h-9 flex-1 rounded-md border border-gray-200 px-2 text-sm text-gray-900"
            />
            <Button
              type="button"
              variant="outline"
              className="min-h-9 px-2 text-xs"
              onClick={() => setSelectedDate((d) => shiftYmd(d, 1))}
            >
              →
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-9 text-xs"
              onClick={() => setSelectedDate(todayYmdLocal())}
            >
              Hoy
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", "Todos"],
                ["biometricos", "Biométricos"],
                ["firmas", "Firma"],
                ["notificacion", "Notificación"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setKindFilter(id)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  kindFilter === id
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={includeCancelled}
              onChange={(e) => setIncludeCancelled(e.target.checked)}
              className="rounded border-gray-300"
            />
            Incluir canceladas
          </label>

          {loading ? (
            <p className="text-sm text-gray-500">Cargando citas…</p>
          ) : error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : dayEntries.length === 0 ? (
            <p className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
              No hay citas para este día con los filtros actuales.
            </p>
          ) : (
            <ul className="space-y-2">
              {dayEntries.map((item) => (
                <li
                  key={item.bookingId}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-gray-900">
                      {item.bookingTime}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${kindBadgeClass(item.kind)}`}
                    >
                      {formatAgendaCalendarKindLabel(item.kind)}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadgeClass(item.status)}`}
                    >
                      {formatAgendaCalendarStatusLabel(item.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-800">
                    Asesor:{" "}
                    <span className="font-medium">{asesorAgendaCalendarDisplayName(item)}</span>
                  </p>
                  <p className="text-xs text-gray-500">Ubicación: {item.locationId}</p>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[11px] leading-relaxed text-gray-500">
            Los horarios listados están ocupados. Los demás aparecen libres según la agenda
            configurada por Mesa. Desde aquí no puedes editar ni cancelar citas.
          </p>
        </div>

        <div className="border-t border-gray-100 px-4 py-3">
          <Button type="button" variant="outline" className="w-full" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AsesorAgendaCalendarButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Calendario de citas"
        title="Calendario de citas"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 sm:px-3"
      >
        <CalendarIcon className="h-[18px] w-[18px]" />
        <span className="hidden text-xs font-medium sm:inline">Calendario</span>
      </button>
      <AsesorAgendaCalendarDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
