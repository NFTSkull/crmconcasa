"use client";

import type { ReactNode } from "react";

type AdminExpandableAdvisorRowProps = {
  expanded: boolean;
  onToggle: () => void;
  /** Contenido de la fila cerrada (métricas). */
  summary: ReactNode;
  /** Nombre accesible del asesor (para aria-label). */
  advisorLabel: string;
  children: ReactNode;
};

/**
 * Fila/tarjeta expandible de producción por asesor (B2).
 * El chevron no es la única señal: aria-expanded + texto Expandir/Ocultar.
 */
export function AdminExpandableAdvisorRow({
  expanded,
  onToggle,
  summary,
  advisorLabel,
  children,
}: AdminExpandableAdvisorRowProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? `Ocultar detalle de ${advisorLabel}`
              : `Ver detalle de ${advisorLabel}`
          }
          onClick={onToggle}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-800 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-slate-900"
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          {expanded ? "Ocultar" : "Expandir"}
        </button>
        <div className="min-w-0 flex-1">{summary}</div>
      </div>
      {expanded ? (
        <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
