"use client";

import { useId, useState, type ReactNode } from "react";

type AdminCollapsibleSectionProps = {
  title: string;
  /** Resumen corto visible junto al título (p. ej. total). */
  summary?: ReactNode;
  description?: string;
  /** Por defecto colapsado (divulgación progresiva B2). */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * Bloque colapsable reutilizable (Reportes / Ingresos / detalle).
 * Solo UI: no toca consultas ni estado de dominio.
 */
export function AdminCollapsibleSection({
  title,
  summary,
  description,
  defaultOpen = false,
  children,
  className = "",
}: AdminCollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const buttonId = useId();

  return (
    <div className={`rounded-lg border border-slate-200 bg-white ${className}`}>
      <button
        id={buttonId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          {description ? (
            <p className="mt-0.5 text-xs text-slate-600">{description}</p>
          ) : null}
          {summary ? (
            <div className="mt-1 text-xs text-slate-700">{summary}</div>
          ) : null}
        </div>
        <span
          className="mt-0.5 shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700"
          aria-hidden="true"
        >
          {open ? "Ocultar" : "Ver detalle"}
        </span>
        <span className="sr-only">{open ? "Sección expandida" : "Sección colapsada"}</span>
      </button>
      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!open}>
        <div className="border-t border-slate-100 px-4 py-3">{children}</div>
      </div>
    </div>
  );
}
