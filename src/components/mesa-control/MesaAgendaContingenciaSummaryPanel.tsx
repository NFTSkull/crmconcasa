"use client";

import type { MesaContingenciaHeader } from "@/domain/agenda-contingencia";
import {
  formatContingenciaDayLabel,
  formatContingenciaKindLabel,
  formatContingenciaSedeLabel,
} from "@/domain/agenda-contingencia";

export function MesaAgendaContingenciaSummaryPanel({
  headers,
}: Readonly<{ headers: readonly MesaContingenciaHeader[] }>) {
  if (!headers.length) return null;

  return (
    <section
      className="space-y-2"
      aria-label="Contingencias del periodo"
      data-testid="mesa-contingencia-summary"
    >
      {headers.map((h) => {
        const rebooked = h.rebooked_count ?? 0;
        const allRebooked =
          h.affected_count > 0 && h.pending_count === 0 && rebooked === h.affected_count;
        return (
          <article
            key={h.contingency_id}
            className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 shadow-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-950">
                Contingencia — {formatContingenciaKindLabel(h.kind)}
              </h3>
              <span className="text-xs font-medium text-amber-900">
                {h.status === "active" ? "Activa" : "Cerrada"}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-amber-900">
              {formatContingenciaDayLabel(h.affected_date)} ·{" "}
              {formatContingenciaSedeLabel(h.location_id)}
            </p>
            <p className="mt-1 text-sm font-medium text-amber-950">No hubo citas</p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-amber-950">
              <div>
                <dt className="text-amber-800">Afectadas</dt>
                <dd className="text-base font-semibold">{h.affected_count}</dd>
              </div>
              <div>
                <dt className="text-amber-800">Reagendadas</dt>
                <dd className="text-base font-semibold">{rebooked}</dd>
              </div>
              <div>
                <dt className="text-amber-800">Pendientes</dt>
                <dd className="text-base font-semibold">{h.pending_count}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-amber-900">
              <span className="font-semibold">Motivo:</span> {h.reason}
            </p>
            {allRebooked ? (
              <p className="mt-2 text-xs font-medium text-emerald-800">
                Todas las citas fueron reagendadas
              </p>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
