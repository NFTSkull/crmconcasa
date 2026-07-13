"use client";

import type { MesaAgendaSummary } from "@/lib/mesaAgendaCitasUi";

type MesaAgendaCitasSummaryProps = Readonly<{
  summary: MesaAgendaSummary;
  includeCancelled: boolean;
}>;

function SummaryCard({
  label,
  value,
  className,
}: Readonly<{ label: string; value: number; className: string }>) {
  return (
    <div className={`rounded-xl border p-3 shadow-sm ${className}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function MesaAgendaCitasSummary({
  summary,
  includeCancelled,
}: MesaAgendaCitasSummaryProps) {
  return (
    <section
      aria-label="Resumen de citas filtradas"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      <SummaryCard
        label="Total citas"
        value={summary.total}
        className="border-slate-200 bg-white text-slate-900"
      />
      <SummaryCard
        label="Biométricos"
        value={summary.biometricos}
        className="border-indigo-200 bg-indigo-50 text-indigo-900"
      />
      <SummaryCard
        label="Firmas"
        value={summary.firmas}
        className="border-violet-200 bg-violet-50 text-violet-900"
      />
      <SummaryCard
        label="Notificaciones"
        value={summary.notificacion}
        className="border-amber-200 bg-amber-50 text-amber-900"
      />
      {includeCancelled ? (
        <SummaryCard
          label="Canceladas"
          value={summary.canceladas}
          className="border-gray-200 bg-gray-50 text-gray-700"
        />
      ) : null}
    </section>
  );
}
