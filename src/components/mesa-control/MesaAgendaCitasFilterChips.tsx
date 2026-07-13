"use client";

import type { MesaAgendaFilterChip } from "@/lib/mesaAgendaCitasUi";

type MesaAgendaCitasFilterChipsProps = Readonly<{
  chips: readonly MesaAgendaFilterChip[];
  onClearChip: (chip: MesaAgendaFilterChip) => void;
  onClearAll: () => void;
}>;

export function MesaAgendaCitasFilterChips({
  chips,
  onClearChip,
  onClearAll,
}: MesaAgendaCitasFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-500">Filtros activos:</span>
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          aria-label={`Quitar filtro ${chip.label}`}
          onClick={() => onClearChip(chip)}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {chip.label}
          <span aria-hidden="true">×</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-xs font-medium text-blue-700 underline hover:text-blue-900"
      >
        Limpiar filtros
      </button>
    </div>
  );
}
