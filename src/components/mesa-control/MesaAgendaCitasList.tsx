"use client";

import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import { mesaAgendaBookingPersonDisplayName } from "@/domain/agenda-calendar/mesa.mapper";
import { MesaAgendaCitaCard, MesaAgendaEntryActions } from "@/components/mesa-control/MesaAgendaCitasEntryParts";
import { Select } from "@/components/ui/Select";
import {
  deriveMesaAgendaHistoryLabel,
  formatMesaAgendaCreatedAt,
  formatMesaAgendaDateTime,
  formatMesaAgendaDriveValidatedMeta,
  formatMesaAgendaKind,
  formatMesaAgendaStatus,
  hasMesaAgendaHistoryGroup,
  mesaAgendaDriveValidatedBadgeClass,
  mesaAgendaDriveValidatedRowClass,
  mesaAgendaHistoryBadgeClass,
  mesaAgendaHistoryGroupKey,
  mesaAgendaKindBadgeClass,
  mesaAgendaStatusBadgeClass,
  MESA_DRIVE_VALIDATED_BADGE,
  type MesaAgendaCitasSortOption,
} from "@/lib/mesaAgendaCitasUi";

const SORT_OPTIONS: ReadonlyArray<{ value: MesaAgendaCitasSortOption; label: string }> = [
  { value: "fecha_proxima", label: "Fecha más próxima" },
  { value: "fecha_lejana", label: "Fecha más lejana" },
  { value: "cliente_az", label: "Cliente A–Z" },
  { value: "asesor_az", label: "Asesor A–Z" },
  { value: "tipo", label: "Tipo" },
];

type MesaAgendaCitasListProps = Readonly<{
  entries: readonly MesaAgendaBookingEntry[];
  historyGroups: ReadonlyMap<string, readonly MesaAgendaBookingEntry[]>;
  sortBy: MesaAgendaCitasSortOption;
  onSortChange: (value: MesaAgendaCitasSortOption) => void;
  canCancelEntry: (entry: MesaAgendaBookingEntry) => boolean;
  canReagendarEntry: (entry: MesaAgendaBookingEntry) => boolean;
  canDriveValidateEntry: (entry: MesaAgendaBookingEntry) => boolean;
  cancelPendingBookingId?: string | null;
  reagendarPendingBookingId?: string | null;
  drivePendingBookingId?: string | null;
  onRequestCancel?: (entry: MesaAgendaBookingEntry) => void;
  onRequestReagendar?: (entry: MesaAgendaBookingEntry) => void;
  onToggleDriveValidation?: (entry: MesaAgendaBookingEntry) => void;
}>;

function historyGroupFor(
  entry: MesaAgendaBookingEntry,
  historyGroups: ReadonlyMap<string, readonly MesaAgendaBookingEntry[]>,
): readonly MesaAgendaBookingEntry[] {
  return historyGroups.get(mesaAgendaHistoryGroupKey(entry.expedienteId, entry.kind)) ?? [entry];
}

export function MesaAgendaCitasList({
  entries,
  historyGroups,
  sortBy,
  onSortChange,
  canCancelEntry,
  canReagendarEntry,
  canDriveValidateEntry,
  cancelPendingBookingId = null,
  reagendarPendingBookingId = null,
  drivePendingBookingId = null,
  onRequestCancel,
  onRequestReagendar,
  onToggleDriveValidation,
}: MesaAgendaCitasListProps) {
  return (
    <>
      <div className="mb-3 max-w-xs">
        <Select
          id="mesa-citas-sort"
          label="Ordenar por"
          value={sortBy}
          options={[...SORT_OPTIONS]}
          onChange={(e) => onSortChange(e.target.value as MesaAgendaCitasSortOption)}
        />
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm lg:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Fecha y hora</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Cliente / NSS</th>
              <th className="px-4 py-3">Asesor</th>
              <th className="px-4 py-3">Agendada por</th>
              <th className="px-4 py-3">Sede</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((entry) => {
              const historyGroup = historyGroupFor(entry, historyGroups);
              const historyLabel = deriveMesaAgendaHistoryLabel(entry, historyGroup);
              const showHistoryIndicator = hasMesaAgendaHistoryGroup(historyGroup);
              const driveMeta = formatMesaAgendaDriveValidatedMeta(entry);
              const driveRow = mesaAgendaDriveValidatedRowClass(entry);
              return (
                <tr
                  key={entry.bookingId}
                  className={`text-slate-800 ${
                    driveRow
                      ? driveRow
                      : entry.status === "cancelled"
                        ? "bg-gray-50/80"
                        : ""
                  }`}
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div>{formatMesaAgendaDateTime(entry)}</div>
                    {entry.status === "cancelled" && entry.cancelledAt ? (
                      <div className="text-xs text-slate-500">
                        Cancelada: {formatMesaAgendaCreatedAt(entry.cancelledAt)}
                      </div>
                    ) : null}
                    {driveMeta ? (
                      <div className="text-xs text-emerald-800">Drive: {driveMeta}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${mesaAgendaKindBadgeClass(entry.kind)}`}
                    >
                      {formatMesaAgendaKind(entry.kind)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{entry.clienteNombre || "—"}</div>
                    {entry.nss ? (
                      <div className="text-xs text-slate-500">NSS: {entry.nss}</div>
                    ) : null}
                    <div className="text-xs text-slate-500">Etapa {entry.etapaActual}</div>
                    {entry.note ? (
                      <div className="mt-1 text-xs text-slate-500">Nota: {entry.note}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {mesaAgendaBookingPersonDisplayName(entry.asesor)}
                  </td>
                  <td className="px-4 py-3">
                    {mesaAgendaBookingPersonDisplayName(entry.createdBy)}
                  </td>
                  <td className="px-4 py-3">{entry.locationId ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${mesaAgendaStatusBadgeClass(entry.status)}`}
                      >
                        {formatMesaAgendaStatus(entry.status)}
                      </span>
                      {entry.driveValidated ? (
                        <span className={mesaAgendaDriveValidatedBadgeClass()}>
                          {MESA_DRIVE_VALIDATED_BADGE}
                        </span>
                      ) : null}
                      {historyLabel ? (
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${mesaAgendaHistoryBadgeClass(historyLabel)}`}
                        >
                          {historyLabel}
                        </span>
                      ) : null}
                      {showHistoryIndicator ? (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          Historial
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <MesaAgendaEntryActions
                      entry={entry}
                      showCancel={canCancelEntry(entry)}
                      showReagendar={canReagendarEntry(entry)}
                      showDriveValidation={canDriveValidateEntry(entry)}
                      cancelPending={cancelPendingBookingId === entry.bookingId}
                      reagendarPending={reagendarPendingBookingId === entry.bookingId}
                      drivePending={drivePendingBookingId === entry.bookingId}
                      onRequestCancel={onRequestCancel}
                      onRequestReagendar={onRequestReagendar}
                      onToggleDriveValidation={onToggleDriveValidation}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="hidden grid-cols-1 gap-3 md:grid md:grid-cols-2 lg:hidden">
        {entries.map((entry) => (
          <MesaAgendaCitaCard
            key={entry.bookingId}
            entry={entry}
            historyGroup={historyGroupFor(entry, historyGroups)}
            showCancel={canCancelEntry(entry)}
            showReagendar={canReagendarEntry(entry)}
            showDriveValidation={canDriveValidateEntry(entry)}
            cancelPending={cancelPendingBookingId === entry.bookingId}
            reagendarPending={reagendarPendingBookingId === entry.bookingId}
            drivePending={drivePendingBookingId === entry.bookingId}
            onRequestCancel={onRequestCancel}
            onRequestReagendar={onRequestReagendar}
            onToggleDriveValidation={onToggleDriveValidation}
          />
        ))}
      </div>

      <div className="space-y-3 md:hidden">
        {entries.map((entry) => (
          <MesaAgendaCitaCard
            key={entry.bookingId}
            entry={entry}
            historyGroup={historyGroupFor(entry, historyGroups)}
            showCancel={canCancelEntry(entry)}
            showReagendar={canReagendarEntry(entry)}
            showDriveValidation={canDriveValidateEntry(entry)}
            cancelPending={cancelPendingBookingId === entry.bookingId}
            reagendarPending={reagendarPendingBookingId === entry.bookingId}
            drivePending={drivePendingBookingId === entry.bookingId}
            onRequestCancel={onRequestCancel}
            onRequestReagendar={onRequestReagendar}
            onToggleDriveValidation={onToggleDriveValidation}
          />
        ))}
      </div>
    </>
  );
}
