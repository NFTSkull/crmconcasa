"use client";

import Link from "next/link";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import {
  mesaAgendaKindBulkLabel,
  type BulkStageAdvanceSummary,
} from "@/domain/agenda-calendar/mesa-bulk-actions";
import { buildMesaExpedienteDetailHref, formatMesaAgendaDateTime } from "@/lib/mesaAgendaCitasUi";

export type MesaAgendaBulkAdvanceResultPanelProps = Readonly<{
  summary: BulkStageAdvanceSummary;
  entriesByBookingId: ReadonlyMap<string, MesaAgendaBookingEntry>;
  onDismiss: () => void;
}>;

export function MesaAgendaBulkAdvanceResultPanel({
  summary,
  entriesByBookingId,
  onDismiss,
}: MesaAgendaBulkAdvanceResultPanelProps) {
  const hasIncidents = summary.failed > 0 || summary.skippedExpedientes > 0;
  const title = hasIncidents
    ? "Avance completado con incidencias"
    : "Avance completado";

  const detailRows = summary.results.filter(
    (r) => r.status === "failed" || r.status === "skipped",
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
              {summary.succeeded} expediente{summary.succeeded === 1 ? "" : "s"}{" "}
              {summary.succeeded === 1 ? "pasó" : "pasaron"} correctamente a la siguiente etapa.
            </p>
          ) : (
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              <li>
                {summary.succeeded} expediente{summary.succeeded === 1 ? "" : "s"} avanzado
                {summary.succeeded === 1 ? "" : "s"}
              </li>
              {summary.failed > 0 ? (
                <li>
                  {summary.failed} expediente{summary.failed === 1 ? "" : "s"} no procesado
                  {summary.failed === 1 ? "" : "s"}
                </li>
              ) : null}
              {summary.skippedExpedientes > 0 ? (
                <li>
                  {summary.skippedExpedientes} expediente
                  {summary.skippedExpedientes === 1 ? "" : "s"} omitido
                  {summary.skippedExpedientes === 1 ? "" : "s"} por cambio de elegibilidad
                </li>
              ) : null}
            </ul>
          )}
          <p className="mt-2 text-xs opacity-90">
            Esta acción no valida Drive. Usa las reglas actuales de{" "}
            <code className="text-[11px]">avanzar_etapa_operativa</code>.
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

      {detailRows.length > 0 ? (
        <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-md border border-black/5 bg-white/60 p-2 text-xs">
          {detailRows.map((r) => {
            const entry =
              r.bookingIds
                .map((id) => entriesByBookingId.get(id))
                .find((e): e is MesaAgendaBookingEntry => Boolean(e)) ?? null;
            const label =
              entry?.clienteNombre?.trim() ||
              `Expediente ${r.expedienteId.slice(0, 8)}…`;
            const when = entry ? formatMesaAgendaDateTime(entry) : null;
            const transition =
              r.fromStage != null && r.toStage != null && r.kind
                ? `${mesaAgendaKindBulkLabel(r.kind)} ${r.fromStage} → ${r.toStage}`
                : null;
            const href = buildMesaExpedienteDetailHref(r.expedienteId);
            return (
              <li
                key={`${r.status}-${r.expedienteId}`}
                className="rounded border border-slate-100 bg-white px-2 py-1.5"
              >
                <p className="font-medium text-slate-900">{label}</p>
                <p className="text-slate-600">Expediente: {r.expedienteId}</p>
                {when ? <p className="text-slate-600">Cita: {when}</p> : null}
                {transition ? (
                  <p className="text-slate-600">Transición esperada: {transition}</p>
                ) : null}
                <p className="text-slate-700">
                  {r.status === "failed" ? "Error: " : "Omitido: "}
                  {r.reason ?? "Sin detalle"}
                </p>
                <Link href={href} className="mt-1 inline-block font-medium text-blue-700 underline">
                  Ver expediente
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
