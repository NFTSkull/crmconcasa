"use client";

import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import { mesaAgendaBookingPersonDisplayName } from "@/domain/agenda-calendar/mesa.mapper";
import {
  MesaAgendaEntryActions,
  MesaAgendaEntryBadges,
} from "@/components/mesa-control/MesaAgendaCitasEntryParts";
import { MesaAgendaBulkRowCheckbox } from "@/components/mesa-control/MesaAgendaBulkSelectionBar";
import {
  deriveMesaAgendaHistoryLabel,
  formatMesaAgendaSedeLabel,
  groupMesaAgendaEntriesByTime,
  hasMesaAgendaHistoryGroup,
  mesaAgendaDriveValidatedRowClass,
  mesaAgendaHistoryGroupKey,
} from "@/lib/mesaAgendaCitasUi";

type MesaAgendaCitasDayViewProps = Readonly<{
  entries: readonly MesaAgendaBookingEntry[];
  historyGroups: ReadonlyMap<string, readonly MesaAgendaBookingEntry[]>;
  canCancelEntry: (entry: MesaAgendaBookingEntry) => boolean;
  canReagendarEntry: (entry: MesaAgendaBookingEntry) => boolean;
  canDriveValidateEntry: (entry: MesaAgendaBookingEntry) => boolean;
  canGestionarEntry?: (entry: MesaAgendaBookingEntry) => boolean;
  cancelPendingBookingId?: string | null;
  reagendarPendingBookingId?: string | null;
  drivePendingBookingId?: string | null;
  gestionarPendingBookingId?: string | null;
  onRequestCancel?: (entry: MesaAgendaBookingEntry) => void;
  onRequestReagendar?: (entry: MesaAgendaBookingEntry) => void;
  onRequestGestionar?: (entry: MesaAgendaBookingEntry) => void;
  onToggleDriveValidation?: (entry: MesaAgendaBookingEntry) => void;
  selectedBookingIds?: ReadonlySet<string>;
  isBulkRowSelectable?: (entry: MesaAgendaBookingEntry) => boolean;
  bulkNotSelectableReason?: (entry: MesaAgendaBookingEntry) => string;
  onBulkRowCheckedChange?: (entry: MesaAgendaBookingEntry, checked: boolean) => void;
  bulkBusy?: boolean;
}>;


function historyGroupFor(
  entry: MesaAgendaBookingEntry,
  historyGroups: ReadonlyMap<string, readonly MesaAgendaBookingEntry[]>,
): readonly MesaAgendaBookingEntry[] {
  return historyGroups.get(mesaAgendaHistoryGroupKey(entry.expedienteId, entry.kind)) ?? [entry];
}

export function MesaAgendaCitasDayView({
  entries,
  historyGroups,
  canCancelEntry,
  canReagendarEntry,
  canDriveValidateEntry,
  canGestionarEntry,
  cancelPendingBookingId = null,
  reagendarPendingBookingId = null,
  drivePendingBookingId = null,
  gestionarPendingBookingId = null,
  onRequestCancel,
  onRequestReagendar,
  onRequestGestionar,
  onToggleDriveValidation,
  selectedBookingIds,
  isBulkRowSelectable,
  bulkNotSelectableReason,
  onBulkRowCheckedChange,
  bulkBusy = false,
}: MesaAgendaCitasDayViewProps) {
  const groups = groupMesaAgendaEntriesByTime(entries);
  const showBulk = Boolean(selectedBookingIds && onBulkRowCheckedChange && isBulkRowSelectable);

  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
        No hay citas para este día con los filtros actuales.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section
          key={group.timeKey}
          aria-label={`Citas a las ${group.timeLabel}`}
          className="rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <header className="border-b border-slate-100 bg-slate-50 px-4 py-2">
            <h3 className="text-sm font-semibold text-slate-800">{group.timeLabel}</h3>
            <p className="text-xs text-slate-500">
              {group.entries.length} cita{group.entries.length === 1 ? "" : "s"}
            </p>
          </header>
          <div className="divide-y divide-slate-100">
            {group.entries.map((entry) => {
              const historyGroup = historyGroupFor(entry, historyGroups);
              const historyLabel = deriveMesaAgendaHistoryLabel(entry, historyGroup);
              const showHistoryIndicator = hasMesaAgendaHistoryGroup(historyGroup);
              const driveRow = mesaAgendaDriveValidatedRowClass(entry);
              const selectable = showBulk ? Boolean(isBulkRowSelectable?.(entry)) : false;
              const checked = Boolean(selectedBookingIds?.has(entry.bookingId));
              const reason =
                showBulk && !selectable
                  ? bulkNotSelectableReason?.(entry) ?? "No disponible para acciones masivas."
                  : "Seleccionar cita";
              return (
                <div
                  key={entry.bookingId}
                  className={`px-4 py-3 ${driveRow ? `${driveRow} rounded-none` : ""}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      {showBulk ? (
                        <MesaAgendaBulkRowCheckbox
                          bookingId={entry.bookingId}
                          checked={checked}
                          disabled={!selectable || bulkBusy}
                          title={
                            bulkBusy
                              ? "Operación masiva en curso"
                              : reason
                          }
                          onCheckedChange={(next) => onBulkRowCheckedChange?.(entry, next)}
                        />
                      ) : null}
                      <div>
                        <p className="font-medium text-slate-900">{entry.clienteNombre || "—"}</p>
                        {entry.nss ? (
                          <p className="text-xs text-slate-500">NSS: {entry.nss}</p>
                        ) : null}
                        <p className="mt-1 text-xs text-slate-600">
                          {mesaAgendaBookingPersonDisplayName(entry.asesor)} ·{" "}
                          {formatMesaAgendaSedeLabel(entry.locationId)}
                        </p>
                      </div>
                    </div>
                    <MesaAgendaEntryBadges
                      entry={entry}
                      historyLabel={historyLabel}
                      showHistoryIndicator={showHistoryIndicator}
                    />
                  </div>
                  <div className="mt-2">
                    <MesaAgendaEntryActions
                      entry={entry}
                      showCancel={canCancelEntry(entry)}
                      showReagendar={canReagendarEntry(entry)}
                      showDriveValidation={canDriveValidateEntry(entry)}
                      showGestionar={Boolean(canGestionarEntry?.(entry))}
                      cancelPending={cancelPendingBookingId === entry.bookingId}
                      reagendarPending={reagendarPendingBookingId === entry.bookingId}
                      drivePending={
                        drivePendingBookingId === entry.bookingId || bulkBusy
                      }
                      gestionarPending={gestionarPendingBookingId === entry.bookingId}
                      onRequestCancel={onRequestCancel}
                      onRequestReagendar={onRequestReagendar}
                      onRequestGestionar={onRequestGestionar}
                      onToggleDriveValidation={onToggleDriveValidation}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
