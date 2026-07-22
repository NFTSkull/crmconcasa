"use client";

import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import {
  MESA_AGENDA_REPORT_GROUP_OPTIONS,
  resolveMesaAgendaReportGroup,
  type MesaAgendaReportGroup,
} from "@/domain/agenda-calendar/mesa-report-group";
import { Select } from "@/components/ui/Select";

type MesaAgendaReportGroupControlProps = Readonly<{
  entry: MesaAgendaBookingEntry;
  pending?: boolean;
  disabled?: boolean;
  onChange?: (
    entry: MesaAgendaBookingEntry,
    next: MesaAgendaReportGroup,
  ) => void;
  compact?: boolean;
}>;

/** Clasificación exclusiva para Excel (P109). No altera kind operativo. */
export function MesaAgendaReportGroupControl({
  entry,
  pending = false,
  disabled = false,
  onChange,
  compact = false,
}: MesaAgendaReportGroupControlProps) {
  if (!onChange) return null;

  const value = resolveMesaAgendaReportGroup(entry);
  const busy = pending || disabled;

  return (
    <div className={compact ? "max-w-[14rem]" : "max-w-xs"}>
      <Select
        id={`mesa-report-group-${entry.bookingId}`}
        label="Clasificación para Excel"
        value={value}
        disabled={busy}
        options={[...MESA_AGENDA_REPORT_GROUP_OPTIONS]}
        className={compact ? "py-1.5 text-xs" : undefined}
        onChange={(e) => {
          const next = e.target.value as MesaAgendaReportGroup;
          if (next === value) return;
          onChange(entry, next);
        }}
      />
    </div>
  );
}
