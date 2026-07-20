"use client";

import { useEffect, useRef } from "react";
import type { BulkSelectionSummary } from "@/domain/agenda-calendar/mesa-bulk-actions";

type MesaAgendaBulkSelectionBarProps = Readonly<{
  summary: BulkSelectionSummary;
  busy?: boolean;
  progressLabel?: string | null;
  onSelectAllEligible: () => void;
  onClearSelection: () => void;
  onHeaderCheckedChange: (checked: boolean) => void;
  onRequestBulkDriveValidate: () => void;
  onRequestBulkStageAdvance: () => void;
}>;

export function MesaAgendaBulkSelectionBar({
  summary,
  busy = false,
  progressLabel = null,
  onSelectAllEligible,
  onClearSelection,
  onHeaderCheckedChange,
  onRequestBulkDriveValidate,
  onRequestBulkStageAdvance,
}: MesaAgendaBulkSelectionBarProps) {
  const headerRef = useRef<HTMLInputElement>(null);
  const driveEligible = summary.eligibleDriveCount;
  const advanceEligible = summary.eligibleAdvanceExpedienteCount;

  useEffect(() => {
    if (headerRef.current) {
      headerRef.current.indeterminate = summary.headerState === "some";
    }
  }, [summary.headerState]);

  return (
    <section
      aria-label="Selección múltiple de citas"
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
          <input
            ref={headerRef}
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            checked={summary.headerState === "all"}
            disabled={busy || summary.eligibleVisibleCount === 0}
            onChange={(e) => onHeaderCheckedChange(e.target.checked)}
            aria-label="Seleccionar o deseleccionar elegibles visibles"
          />
          Selección
        </label>

        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || summary.eligibleVisibleCount === 0}
          onClick={onSelectAllEligible}
        >
          Seleccionar elegibles visibles
        </button>

        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || summary.selectedBookingCount === 0}
          onClick={onClearSelection}
        >
          Limpiar selección
        </button>

        <span className="hidden h-5 w-px bg-slate-200 sm:inline-block" aria-hidden />

        <button
          type="button"
          className="rounded-md border border-emerald-600 bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || driveEligible === 0}
          onClick={onRequestBulkDriveValidate}
        >
          Validar en Drive ({driveEligible})
        </button>

        <button
          type="button"
          className="rounded-md border border-indigo-700 bg-indigo-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || advanceEligible === 0}
          onClick={onRequestBulkStageAdvance}
        >
          Pasar a siguiente etapa ({advanceEligible})
        </button>
      </div>

      <dl className="mt-3 grid gap-1 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="inline font-medium text-slate-700">Citas seleccionadas: </dt>
          <dd className="inline tabular-nums">{summary.selectedBookingCount}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-slate-700">Expedientes únicos: </dt>
          <dd className="inline tabular-nums">{summary.uniqueExpedienteCount}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-slate-700">Elegibles para validar en Drive: </dt>
          <dd className="inline tabular-nums">{summary.eligibleDriveCount}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-slate-700">
            Expedientes elegibles para avanzar:{" "}
          </dt>
          <dd className="inline tabular-nums">{summary.eligibleAdvanceExpedienteCount}</dd>
        </div>
      </dl>

      {progressLabel ? (
        <p role="status" className="mt-2 text-xs font-medium text-blue-800">
          {progressLabel}
        </p>
      ) : null}

      {summary.limitNotice ? (
        <p role="status" className="mt-2 text-xs text-amber-800">
          {summary.limitNotice}
        </p>
      ) : null}
    </section>
  );
}

type MesaAgendaBulkRowCheckboxProps = Readonly<{
  bookingId: string;
  checked: boolean;
  disabled: boolean;
  title: string;
  onCheckedChange: (checked: boolean) => void;
}>;

export function MesaAgendaBulkRowCheckbox({
  bookingId,
  checked,
  disabled,
  title,
  onCheckedChange,
}: MesaAgendaBulkRowCheckboxProps) {
  return (
    <input
      type="checkbox"
      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      checked={checked}
      disabled={disabled}
      title={title}
      aria-label={
        disabled
          ? title
          : checked
            ? `Quitar selección de cita ${bookingId}`
            : `Seleccionar cita ${bookingId}`
      }
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        onCheckedChange(e.target.checked);
      }}
    />
  );
}
