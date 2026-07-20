"use client";

import Link from "next/link";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import type { BulkDriveValidationSummary } from "@/domain/agenda-calendar/mesa-bulk-actions";
import { buildMesaExpedienteDetailHref, formatMesaAgendaDateTime } from "@/lib/mesaAgendaCitasUi";

export type MesaAgendaBulkDriveResultPanelProps = Readonly<{
  summary: BulkDriveValidationSummary;
  entriesByBookingId: ReadonlyMap<string, MesaAgendaBookingEntry>;
  onDismiss: () => void;
}>;

export function MesaAgendaBulkDriveResultPanel({
  summary,
  entriesByBookingId,
  onDismiss,
}: MesaAgendaBulkDriveResultPanelProps) {
  const hasIncidents = summary.failed > 0 || summary.skipped > 0;
  const title = hasIncidents
    ? "Validación completada con incidencias"
    : "Validación completada";

  const failedOrSkipped = summary.results.filter(
    (r) => r.status === "failed" || (r.status === "skipped" && r.reason),
  );

  return (
    <section
      role="status"
      aria-live="polite"
      className={`rounded-lg border px-4 py-3 text-sm ${
        hasIncidents
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : "border-emerald-200 bg-emerald-50 text-emerald-950"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {!hasIncidents ? (
            <p className="mt-1">
              {summary.succeeded} cita{summary.succeeded === 1 ? "" : "s"}{" "}
              {summary.succeeded === 1 ? "fue validada" : "fueron validadas"} correctamente en
              Drive.
            </p>
          ) : (
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              <li>
                {summary.succeeded} validada{summary.succeeded === 1 ? "" : "s"} correctamente
              </li>
              {summary.failed > 0 ? (
                <li>
                  {summary.failed} no procesada{summary.failed === 1 ? "" : "s"}
                </li>
              ) : null}
              {summary.skipped > 0 ? (
                <li>
                  {summary.skipped} omitida{summary.skipped === 1 ? "" : "s"} por no elegibilidad
                </li>
              ) : null}
            </ul>
          )}
          <p className="mt-2 text-xs opacity-90">
            Esta acción no avanza etapas. Solo actualiza la validación en Drive de cada cita.
          </p>
        </div>
        <button
          type="button"
          className="rounded-md border border-current/20 bg-white/70 px-2 py-1 text-xs font-medium hover:bg-white"
          onClick={onDismiss}
        >
          Cerrar
        </button>
      </div>

      {failedOrSkipped.length > 0 ? (
        <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-md border border-black/5 bg-white/60 p-2 text-xs">
          {failedOrSkipped.map((r) => {
            const entry = entriesByBookingId.get(r.bookingId);
            const label =
              entry?.clienteNombre?.trim() ||
              (r.expedienteId ? `Expediente ${r.expedienteId.slice(0, 8)}…` : r.bookingId);
            const when = entry ? formatMesaAgendaDateTime(entry) : null;
            const href =
              r.expedienteId && r.expedienteId.trim()
                ? buildMesaExpedienteDetailHref(r.expedienteId)
                : entry?.expedienteId
                  ? buildMesaExpedienteDetailHref(entry.expedienteId)
                  : null;
            return (
              <li key={`${r.status}-${r.bookingId}`} className="rounded border border-slate-100 bg-white px-2 py-1.5">
                <p className="font-medium text-slate-900">{label}</p>
                {when ? <p className="text-slate-600">{when}</p> : null}
                <p className="text-slate-700">
                  {r.status === "failed" ? "Error: " : "Omitida: "}
                  {r.reason ?? "Sin detalle"}
                </p>
                {href ? (
                  <Link href={href} className="mt-1 inline-block font-medium text-blue-700 underline">
                    Ver expediente
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
