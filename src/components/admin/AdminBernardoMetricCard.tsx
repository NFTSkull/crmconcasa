"use client";

type AdminBernardoMetricCardProps = {
  id: string;
  title: string;
  value: number | null;
  description: string;
  expanded: boolean;
  loading?: boolean;
  onToggle: () => void;
};

/**
 * Tarjeta KPI del Dashboard Bernardo.
 * Enter/Espacio vía button nativo; aria-expanded refleja el detalle.
 */
export function AdminBernardoMetricCard({
  id,
  title,
  value,
  description,
  expanded,
  loading = false,
  onToggle,
}: AdminBernardoMetricCardProps) {
  return (
    <button
      type="button"
      id={id}
      aria-expanded={expanded}
      aria-controls={`${id}-detail`}
      onClick={onToggle}
      className={`flex min-h-[9.5rem] w-full flex-col rounded-xl border p-5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 ${
        expanded
          ? "border-slate-900 bg-slate-50 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-400 hover:shadow-sm"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm text-slate-600"
        >
          {title.slice(0, 1)}
        </span>
      </div>
      <p className="mt-3 text-4xl font-semibold tabular-nums text-slate-900">
        {loading ? "…" : (value ?? 0)}
      </p>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      <p className="mt-auto pt-3 text-sm font-medium text-blue-700">
        {expanded ? "Ocultar detalle" : "Ver detalle"}
      </p>
    </button>
  );
}
