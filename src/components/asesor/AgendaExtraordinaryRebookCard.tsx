"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  AgendaContingenciaError,
  agendarCitaExtraordinaria,
  formatContingenciaKindLabel,
  formatContingenciaSedeLabel,
  normalizeExtraordinarySlots,
  type AsesorContingenciaExpedienteItem,
} from "@/domain/agenda-contingencia";

export type AgendaExtraordinaryRebookCardProps = Readonly<{
  item: AsesorContingenciaExpedienteItem;
  /** Catálogo de horas (sin remaining). */
  timeSlots?: readonly string[] | null;
  onRebooked?: () => void;
}>;

export function AgendaExtraordinaryRebookCard({
  item,
  timeSlots,
  onRebooked,
}: AgendaExtraordinaryRebookCardProps) {
  const slots = useMemo(
    () => normalizeExtraordinarySlots(timeSlots),
    [timeSlots],
  );
  const [date, setDate] = useState("");
  const [time, setTime] = useState(slots[0] ?? "09:00");
  const [sede, setSede] = useState<"monterrey" | "apodaca">(
    item.original_location_id === "apodaca" ? "apodaca" : "monterrey",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const kindLabel = formatContingenciaKindLabel(item.kind);
  const isPending = item.item_status === "pending_rebook";
  const isRebooked = item.item_status === "rebooked";

  const handleSave = useCallback(async () => {
    if (!isPending || busyRef.current) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      setError("Selecciona una fecha válida.");
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await agendarCitaExtraordinaria({
        contingency_item_id: item.contingency_item_id,
        booking_date: date.trim(),
        booking_time: time,
        location_id: sede,
      });
      onRebooked?.();
    } catch (e) {
      setError(
        e instanceof AgendaContingenciaError
          ? e.message
          : "No se pudo agendar la cita extraordinaria.",
      );
    } finally {
      setSaving(false);
      busyRef.current = false;
    }
  }, [isPending, date, time, sede, item.contingency_item_id, onRebooked]);

  if (isRebooked) {
    return (
      <section
        className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3"
        data-testid="extraordinary-rebook-success"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-emerald-950">
            Reagenda extraordinaria confirmada
          </h3>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-900 ring-1 ring-emerald-200">
            Extraordinaria
          </span>
        </div>
        <dl className="mt-2 grid gap-1 text-xs text-emerald-950 sm:grid-cols-3">
          <div>
            <dt className="text-emerald-800">Fecha</dt>
            <dd className="font-medium">{item.extraordinary_date ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-emerald-800">Hora</dt>
            <dd className="font-medium">
              {String(item.extraordinary_time ?? "").slice(0, 5) || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-emerald-800">Sede</dt>
            <dd className="font-medium">
              {formatContingenciaSedeLabel(item.extraordinary_location_id)}
            </dd>
          </div>
        </dl>
      </section>
    );
  }

  if (!isPending) return null;

  return (
    <section
      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-sm"
      data-testid="extraordinary-rebook-card"
      id={`contingencia-${item.contingency_item_id}`}
    >
      <h3 className="text-sm font-semibold text-amber-950">
        Reagenda extraordinaria requerida
      </h3>
      <p className="mt-1 text-xs text-amber-900">
        Por una contingencia general, la cita de {kindLabel} del{" "}
        {item.affected_date} no se realizó. Selecciona una nueva fecha. Esta
        cita extraordinaria no consume cupo de la agenda normal.
      </p>
      <dl className="mt-2 grid gap-1 text-xs text-amber-950 sm:grid-cols-2">
        <div>
          <dt className="font-medium text-amber-800">Tipo</dt>
          <dd>{kindLabel}</dd>
        </div>
        <div>
          <dt className="font-medium text-amber-800">Fecha original</dt>
          <dd>
            {item.original_date ?? item.affected_date}
            {item.original_time
              ? ` · ${String(item.original_time).slice(0, 5)}`
              : ""}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-amber-800">Sede original</dt>
          <dd>{formatContingenciaSedeLabel(item.original_location_id)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-medium text-amber-800">Motivo Mesa</dt>
          <dd>{item.reason}</dd>
        </div>
      </dl>

      <p className="mt-3 rounded-md border border-amber-200 bg-white/70 px-2 py-1.5 text-xs font-medium text-amber-950">
        Cita extraordinaria: no ocupa un espacio de la agenda ordinaria.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="text-xs font-semibold text-amber-950">
          Fecha
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-amber-200 px-2 py-1.5 text-sm"
            value={date}
            disabled={saving}
            onChange={(e) => setDate(e.target.value)}
            data-testid="extraordinary-date"
          />
        </label>
        <label className="text-xs font-semibold text-amber-950">
          Hora
          <select
            className="mt-1 w-full rounded-md border border-amber-200 px-2 py-1.5 text-sm"
            value={time}
            disabled={saving}
            onChange={(e) => setTime(e.target.value)}
            data-testid="extraordinary-time"
          >
            {slots.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-amber-950">
          Sede
          <select
            className="mt-1 w-full rounded-md border border-amber-200 px-2 py-1.5 text-sm"
            value={sede}
            disabled={saving}
            onChange={(e) =>
              setSede(e.target.value as "monterrey" | "apodaca")
            }
            data-testid="extraordinary-sede"
          >
            <option value="monterrey">Monterrey</option>
            <option value="apodaca">Apodaca</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-3">
        <Button
          type="button"
          className="bg-amber-600 text-white hover:bg-amber-700"
          disabled={saving || !date}
          onClick={() => void handleSave()}
          data-testid="extraordinary-save"
        >
          {saving ? "Guardando…" : "Confirmar cita extraordinaria"}
        </Button>
      </div>
    </section>
  );
}
