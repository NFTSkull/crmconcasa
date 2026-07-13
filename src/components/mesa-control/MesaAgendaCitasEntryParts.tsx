"use client";

import Link from "next/link";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import { mesaAgendaBookingPersonDisplayName } from "@/domain/agenda-calendar/mesa.mapper";
import {
  buildMesaExpedienteDetailHref,
  deriveMesaAgendaHistoryLabel,
  formatMesaAgendaCreatedAt,
  formatMesaAgendaDateTime,
  formatMesaAgendaKind,
  formatMesaAgendaStatus,
  hasMesaAgendaHistoryGroup,
  mesaAgendaHistoryBadgeClass,
  mesaAgendaKindBadgeClass,
  mesaAgendaStatusBadgeClass,
  type MesaAgendaHistoryLabel,
} from "@/lib/mesaAgendaCitasUi";

export function MesaAgendaEntryBadges({
  entry,
  historyLabel,
  showHistoryIndicator,
}: Readonly<{
  entry: MesaAgendaBookingEntry;
  historyLabel: MesaAgendaHistoryLabel | null;
  showHistoryIndicator: boolean;
}>) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span
        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${mesaAgendaKindBadgeClass(entry.kind)}`}
      >
        {formatMesaAgendaKind(entry.kind)}
      </span>
      <span
        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${mesaAgendaStatusBadgeClass(entry.status)}`}
      >
        {formatMesaAgendaStatus(entry.status)}
      </span>
      {historyLabel ? (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${mesaAgendaHistoryBadgeClass(historyLabel)}`}
        >
          {historyLabel}
        </span>
      ) : null}
      {showHistoryIndicator ? (
        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
          Historial
        </span>
      ) : null}
    </div>
  );
}

export function MesaAgendaEntryDetails({
  entry,
}: Readonly<{ entry: MesaAgendaBookingEntry }>) {
  return (
    <dl className="grid gap-1 text-xs text-slate-600">
      <div>
        <dt className="inline font-medium text-slate-700">Asesor: </dt>
        <dd className="inline">{mesaAgendaBookingPersonDisplayName(entry.asesor)}</dd>
      </div>
      <div>
        <dt className="inline font-medium text-slate-700">Agendada por: </dt>
        <dd className="inline">{mesaAgendaBookingPersonDisplayName(entry.createdBy)}</dd>
      </div>
      <div>
        <dt className="inline font-medium text-slate-700">Sede: </dt>
        <dd className="inline">{entry.locationId ?? "—"}</dd>
      </div>
      <div>
        <dt className="inline font-medium text-slate-700">Etapa: </dt>
        <dd className="inline">{entry.etapaActual}</dd>
      </div>
      <div>
        <dt className="inline font-medium text-slate-700">Creada: </dt>
        <dd className="inline">{formatMesaAgendaCreatedAt(entry.createdAt)}</dd>
      </div>
      {entry.status === "cancelled" && entry.cancelledAt ? (
        <div>
          <dt className="inline font-medium text-slate-700">Cancelada: </dt>
          <dd className="inline">{formatMesaAgendaCreatedAt(entry.cancelledAt)}</dd>
        </div>
      ) : null}
      {entry.note ? (
        <div>
          <dt className="inline font-medium text-slate-700">Nota: </dt>
          <dd className="inline">{entry.note}</dd>
        </div>
      ) : null}
    </dl>
  );
}

type MesaAgendaEntryActionsProps = Readonly<{
  entry: MesaAgendaBookingEntry;
  showCancel: boolean;
  showReagendar: boolean;
  cancelPending: boolean;
  reagendarPending: boolean;
  compact?: boolean;
  onRequestCancel?: (entry: MesaAgendaBookingEntry) => void;
  onRequestReagendar?: (entry: MesaAgendaBookingEntry) => void;
}>;

export function MesaAgendaEntryActions({
  entry,
  showCancel,
  showReagendar,
  cancelPending,
  reagendarPending,
  compact = false,
  onRequestCancel,
  onRequestReagendar,
}: MesaAgendaEntryActionsProps) {
  const linkClass = compact
    ? "inline-flex w-full justify-center rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
    : "font-medium text-blue-700 hover:text-blue-900";

  const mutationButtons = (
    <>
      {showReagendar && onRequestReagendar ? (
        <button
          type="button"
          aria-label={`Reagendar cita de ${entry.clienteNombre || "cliente"}`}
          disabled={reagendarPending}
          onClick={() => onRequestReagendar(entry)}
          className={
            compact
              ? "inline-flex w-full justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
              : "text-left text-xs font-medium text-indigo-700 hover:text-indigo-900 disabled:opacity-50"
          }
        >
          {reagendarPending ? "Reagendando…" : "Reagendar"}
        </button>
      ) : null}
      {showCancel && onRequestCancel ? (
        <button
          type="button"
          aria-label={`Cancelar cita de ${entry.clienteNombre || "cliente"}`}
          disabled={cancelPending}
          onClick={() => onRequestCancel(entry)}
          className={
            compact
              ? "inline-flex w-full justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
              : "text-left text-xs font-medium text-red-700 hover:text-red-900 disabled:opacity-50"
          }
        >
          {cancelPending ? "Cancelando…" : "Cancelar"}
        </button>
      ) : null}
    </>
  );

  if (compact) {
    return (
      <div className="mt-3 flex flex-col gap-2">
        <Link href={buildMesaExpedienteDetailHref(entry.expedienteId)} className={linkClass}>
          Ver expediente
        </Link>
        {mutationButtons}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Link href={buildMesaExpedienteDetailHref(entry.expedienteId)} className={linkClass}>
        Ver expediente
      </Link>
      {mutationButtons}
    </div>
  );
}

export function MesaAgendaCitaCard({
  entry,
  historyGroup,
  showCancel,
  showReagendar,
  cancelPending,
  reagendarPending,
  onRequestCancel,
  onRequestReagendar,
}: Readonly<{
  entry: MesaAgendaBookingEntry;
  historyGroup: readonly MesaAgendaBookingEntry[];
  showCancel: boolean;
  showReagendar: boolean;
  cancelPending: boolean;
  reagendarPending: boolean;
  onRequestCancel?: (entry: MesaAgendaBookingEntry) => void;
  onRequestReagendar?: (entry: MesaAgendaBookingEntry) => void;
}>) {
  const historyLabel = deriveMesaAgendaHistoryLabel(entry, historyGroup);
  const showHistoryIndicator = hasMesaAgendaHistoryGroup(historyGroup);

  return (
    <article
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        entry.status === "cancelled" ? "border-gray-200 opacity-90" : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{formatMesaAgendaDateTime(entry)}</p>
          <p className="mt-1 text-sm text-slate-800">{entry.clienteNombre || "—"}</p>
          {entry.nss ? <p className="text-xs text-slate-500">NSS: {entry.nss}</p> : null}
        </div>
        <MesaAgendaEntryBadges
          entry={entry}
          historyLabel={historyLabel}
          showHistoryIndicator={showHistoryIndicator}
        />
      </div>
      <div className="mt-3">
        <MesaAgendaEntryDetails entry={entry} />
      </div>
      <MesaAgendaEntryActions
        entry={entry}
        showCancel={showCancel}
        showReagendar={showReagendar}
        cancelPending={cancelPending}
        reagendarPending={reagendarPending}
        compact
        onRequestCancel={onRequestCancel}
        onRequestReagendar={onRequestReagendar}
      />
    </article>
  );
}
