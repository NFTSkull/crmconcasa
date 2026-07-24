"use client";

import { useState } from "react";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import {
  mapMesaSetNotificacionLocationError,
  mesaSetNotificacionBookingLocation,
} from "@/domain/agenda-calendar/mesa-set-notificacion-location";
import {
  formatMesaAgendaSedeLabel,
  MESA_NOTIFICACION_SEDE_ASSIGN_LABEL,
  MESA_NOTIFICACION_SEDE_OPTIONS,
  MESA_NOTIFICACION_SEDE_SAVE_CONFIRM,
  needsMesaNotificacionSedeAssignment,
} from "@/lib/mesaAgendaCitasUi";
import { Button } from "@/components/ui/Button";

type MesaAgendaNotificacionSedeCellProps = Readonly<{
  entry: MesaAgendaBookingEntry;
  onLocationSaved?: (bookingId: string, locationId: string) => void;
  compact?: boolean;
}>;

/**
 * P131 — sede de Notificación en Lista/Día/Semana.
 * Canónica → etiqueta; inválida → selector Monterrey/Apodaca + Guardar.
 */
export function MesaAgendaNotificacionSedeCell({
  entry,
  onLocationSaved,
  compact = false,
}: MesaAgendaNotificacionSedeCellProps) {
  const needsAssign = needsMesaNotificacionSedeAssignment(
    entry.kind,
    entry.locationId,
  );
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!needsAssign) {
    return (
      <span data-testid="mesa-notif-sede-label">
        {formatMesaAgendaSedeLabel(entry.locationId)}
      </span>
    );
  }

  const canSave = draft === "monterrey" || draft === "apodaca";

  async function handleSave() {
    if (!canSave || saving) return;
    const ok = window.confirm(MESA_NOTIFICACION_SEDE_SAVE_CONFIRM);
    if (!ok) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await mesaSetNotificacionBookingLocation(
        entry.bookingId,
        draft,
      );
      onLocationSaved?.(result.bookingId, result.locationId);
      setSuccess(
        result.locationId === "monterrey" ? "Monterrey" : "Apodaca",
      );
      setDraft("");
    } catch (err) {
      setError(mapMesaSetNotificacionLocationError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={compact ? "space-y-1" : "space-y-1.5"}
      data-testid="mesa-notif-sede-assign"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <p className="text-[11px] font-medium text-amber-900">
        {MESA_NOTIFICACION_SEDE_ASSIGN_LABEL}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900"
          value={draft}
          disabled={saving}
          aria-label={MESA_NOTIFICACION_SEDE_ASSIGN_LABEL}
          data-testid="mesa-notif-sede-select"
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
            setSuccess(null);
          }}
        >
          <option value="">Seleccionar…</option>
          {MESA_NOTIFICACION_SEDE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="secondary"
          disabled={!canSave || saving}
          className="px-2 py-1 text-xs"
          data-testid="mesa-notif-sede-save"
          onClick={() => void handleSave()}
        >
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
      {error ? (
        <p className="text-[11px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="text-[11px] text-emerald-800" role="status">
          Sede: {success}
        </p>
      ) : null}
    </div>
  );
}
