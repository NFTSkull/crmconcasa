"use client";

import Link from "next/link";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import { mesaAgendaBookingPersonDisplayName } from "@/domain/agenda-calendar/mesa.mapper";
import { MesaAgendaBulkRowCheckbox } from "@/components/mesa-control/MesaAgendaBulkSelectionBar";
import { formatPasoOperativoLabel } from "@/domain/expedientes/etapa-numeracion-ux";
import {
  buildMesaExpedienteDetailHref,
  deriveMesaAgendaHistoryLabel,
  formatMesaAgendaCreatedAt,
  formatMesaAgendaDateTime,
  formatMesaAgendaDriveValidatedMeta,
  formatMesaAgendaKind,
  formatMesaAgendaStatus,
  hasMesaAgendaHistoryGroup,
  mesaAgendaActionExpedienteCellClass,
  MESA_AGENDA_ACTION_CANCEL_CLASS,
  MESA_AGENDA_ACTION_EXPEDIENTE_CLASS,
  MESA_AGENDA_ACTION_REAGENDAR_CLASS,
  mesaAgendaActionsLayoutClass,
  mesaAgendaActionsRowBusy,
  mesaAgendaCancelActionLabel,
  mesaAgendaDriveActionClass,
  mesaAgendaDriveActionLabel,
  mesaAgendaDriveValidatedBadgeClass,
  mesaAgendaDriveValidatedRowClass,
  mesaAgendaHistoryBadgeClass,
  mesaAgendaKindBadgeClass,
  mesaAgendaReagendarActionLabel,
  mesaAgendaStatusBadgeClass,
  MESA_DRIVE_VALIDATED_BADGE,
  resolveMesaAgendaVisibleActions,
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
      {entry.driveValidated ? (
        <span className={mesaAgendaDriveValidatedBadgeClass()}>{MESA_DRIVE_VALIDATED_BADGE}</span>
      ) : null}
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
  const driveMeta = formatMesaAgendaDriveValidatedMeta(entry);
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
        <dt className="inline font-medium text-slate-700">Paso: </dt>
        <dd className="inline">
          {typeof entry.etapaActual === "number"
            ? formatPasoOperativoLabel(entry.etapaActual)
            : "—"}
        </dd>
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
      {driveMeta ? (
        <div>
          <dt className="inline font-medium text-emerald-800">Drive: </dt>
          <dd className="inline text-emerald-900">{driveMeta}</dd>
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
  showDriveValidation: boolean;
  cancelPending: boolean;
  reagendarPending: boolean;
  drivePending: boolean;
  compact?: boolean;
  onRequestCancel?: (entry: MesaAgendaBookingEntry) => void;
  onRequestReagendar?: (entry: MesaAgendaBookingEntry) => void;
  onToggleDriveValidation?: (entry: MesaAgendaBookingEntry) => void;
}>;

export function MesaAgendaEntryActions({
  entry,
  showCancel,
  showReagendar,
  showDriveValidation,
  cancelPending,
  reagendarPending,
  drivePending,
  compact = false,
  onRequestCancel,
  onRequestReagendar,
  onToggleDriveValidation,
}: MesaAgendaEntryActionsProps) {
  const visible = resolveMesaAgendaVisibleActions({
    status: entry.status,
    showDriveValidation: Boolean(showDriveValidation && onToggleDriveValidation),
    showReagendar: Boolean(showReagendar && onRequestReagendar),
    showCancel: Boolean(showCancel && onRequestCancel),
  });
  const onlyExpediente = visible.length === 1 && visible[0] === "expediente";
  const rowBusy = mesaAgendaActionsRowBusy({
    cancelPending,
    reagendarPending,
    drivePending,
  });

  return (
    <div className={mesaAgendaActionsLayoutClass(compact)}>
      {visible.includes("expediente") ? (
        <Link
          href={buildMesaExpedienteDetailHref(entry.expedienteId)}
          className={[
            MESA_AGENDA_ACTION_EXPEDIENTE_CLASS,
            rowBusy ? "pointer-events-none opacity-50" : "",
            mesaAgendaActionExpedienteCellClass(compact, onlyExpediente),
          ]
            .filter(Boolean)
            .join(" ")}
          aria-disabled={rowBusy || undefined}
          tabIndex={rowBusy ? -1 : undefined}
          onClick={(e) => {
            if (rowBusy) e.preventDefault();
          }}
        >
          Ver expediente
        </Link>
      ) : null}

      {visible.includes("drive") && onToggleDriveValidation ? (
        <button
          type="button"
          aria-label={`${mesaAgendaDriveActionLabel(entry.driveValidated, false)} — ${entry.clienteNombre || "cliente"}`}
          disabled={rowBusy}
          onClick={() => onToggleDriveValidation(entry)}
          className={mesaAgendaDriveActionClass(entry.driveValidated)}
        >
          {mesaAgendaDriveActionLabel(entry.driveValidated, drivePending)}
        </button>
      ) : null}

      {visible.includes("reagendar") && onRequestReagendar ? (
        <button
          type="button"
          aria-label={`Reagendar cita de ${entry.clienteNombre || "cliente"}`}
          disabled={rowBusy}
          onClick={() => onRequestReagendar(entry)}
          className={MESA_AGENDA_ACTION_REAGENDAR_CLASS}
        >
          {mesaAgendaReagendarActionLabel(reagendarPending)}
        </button>
      ) : null}

      {visible.includes("cancelar") && onRequestCancel ? (
        <button
          type="button"
          aria-label={`Cancelar cita de ${entry.clienteNombre || "cliente"}`}
          disabled={rowBusy}
          onClick={() => onRequestCancel(entry)}
          className={MESA_AGENDA_ACTION_CANCEL_CLASS}
        >
          {mesaAgendaCancelActionLabel(cancelPending)}
        </button>
      ) : null}
    </div>
  );
}

export function MesaAgendaCitaCard({
  entry,
  historyGroup,
  showCancel,
  showReagendar,
  showDriveValidation,
  cancelPending,
  reagendarPending,
  drivePending,
  onRequestCancel,
  onRequestReagendar,
  onToggleDriveValidation,
  bulkSelected = false,
  bulkSelectable = false,
  bulkDisabledReason,
  onBulkCheckedChange,
}: Readonly<{
  entry: MesaAgendaBookingEntry;
  historyGroup: readonly MesaAgendaBookingEntry[];
  showCancel: boolean;
  showReagendar: boolean;
  showDriveValidation: boolean;
  cancelPending: boolean;
  reagendarPending: boolean;
  drivePending: boolean;
  onRequestCancel?: (entry: MesaAgendaBookingEntry) => void;
  onRequestReagendar?: (entry: MesaAgendaBookingEntry) => void;
  onToggleDriveValidation?: (entry: MesaAgendaBookingEntry) => void;
  bulkSelected?: boolean;
  bulkSelectable?: boolean;
  bulkDisabledReason?: string;
  onBulkCheckedChange?: (entry: MesaAgendaBookingEntry, checked: boolean) => void;
}>) {
  const historyLabel = deriveMesaAgendaHistoryLabel(entry, historyGroup);
  const showHistoryIndicator = hasMesaAgendaHistoryGroup(historyGroup);
  const driveRow = mesaAgendaDriveValidatedRowClass(entry);
  const showBulk = Boolean(onBulkCheckedChange);

  return (
    <article
      className={`rounded-xl border p-4 shadow-sm ${
        driveRow
          ? driveRow
          : entry.status === "cancelled"
            ? "border-gray-200 bg-white opacity-90"
            : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {showBulk ? (
            <MesaAgendaBulkRowCheckbox
              bookingId={entry.bookingId}
              checked={bulkSelected}
              disabled={!bulkSelectable}
              title={
                bulkSelectable
                  ? "Seleccionar cita"
                  : bulkDisabledReason ?? "No disponible para acciones masivas."
              }
              onCheckedChange={(next) => onBulkCheckedChange?.(entry, next)}
            />
          ) : null}
          <div>
            <p className="text-sm font-semibold text-slate-900">{formatMesaAgendaDateTime(entry)}</p>
            <p className="mt-1 text-sm text-slate-800">{entry.clienteNombre || "—"}</p>
            {entry.nss ? <p className="text-xs text-slate-500">NSS: {entry.nss}</p> : null}
          </div>
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
        showDriveValidation={showDriveValidation}
        cancelPending={cancelPending}
        reagendarPending={reagendarPending}
        drivePending={drivePending}
        compact
        onRequestCancel={onRequestCancel}
        onRequestReagendar={onRequestReagendar}
        onToggleDriveValidation={onToggleDriveValidation}
      />
    </article>
  );
}
