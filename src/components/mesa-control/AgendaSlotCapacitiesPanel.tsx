"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { canManageAgendaConfig } from "@/lib/canManageAgendaConfig";
import {
  CYNTHIA_SEDE_APODACA_ID,
  CYNTHIA_SEDE_MONTERREY_ID,
  parseHhmmSlotInput,
} from "@/lib/agendaCynthiaLocations";
import { formatMesaAgendaSedeLabel } from "@/lib/mesaAgendaCitasUi";
import {
  useAgendaSlotCapacities,
  type AgendaSlotCapacity,
  type AgendaSlotCapacityKind,
} from "@/domain/agenda-slot-capacities";
import { todayYmdInTimezone, type YmdDate } from "@/domain/agenda-biometricos";

type Props = Readonly<{
  role: string | null | undefined;
}>;

const KIND_OPTIONS: ReadonlyArray<{ value: AgendaSlotCapacityKind; label: string }> = [
  { value: "biometricos", label: "Biométricos" },
  { value: "firmas", label: "Firmas" },
];

const SEDE_OPTIONS = [
  { value: CYNTHIA_SEDE_MONTERREY_ID, label: "Monterrey" },
  { value: CYNTHIA_SEDE_APODACA_ID, label: "Apodaca" },
] as const;

function kindLabel(kind: AgendaSlotCapacityKind): string {
  return kind === "firmas" ? "Firmas" : "Biométricos";
}

function formatTimeShort(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function AgendaSlotCapacitiesPanel({ role }: Props) {
  const canManage = canManageAgendaConfig(role);
  const today = useMemo(() => todayYmdInTimezone("America/Monterrey"), []);
  const [slotDate, setSlotDate] = useState<YmdDate>(today);
  const [locationId, setLocationId] = useState<string>(CYNTHIA_SEDE_MONTERREY_ID);
  const [kind, setKind] = useState<AgendaSlotCapacityKind>("biometricos");
  const [timeInput, setTimeInput] = useState("09:00");
  const [capacity, setCapacity] = useState(5);
  const [active, setActive] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const { rows, loading, error, saving, save, setError } = useAgendaSlotCapacities({
    kind,
    slotDate,
    locationId,
    enabled: canManage,
  });

  const applyRowToForm = useCallback((row: AgendaSlotCapacity) => {
    setEditingId(row.id);
    setKind(row.kind);
    setLocationId(row.locationId);
    setSlotDate(row.slotDate as YmdDate);
    setTimeInput(row.slotTime);
    setCapacity(row.capacity);
    setActive(row.active);
    setOkMsg(null);
    setError(null);
  }, [setError]);

  const handleSave = useCallback(async () => {
    setOkMsg(null);
    const hhmm = parseHhmmSlotInput(timeInput);
    if (!hhmm) {
      setError("Hora inválida. Usa formato HH:MM.");
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1) {
      setError("La capacidad debe ser un entero mayor a 0.");
      return;
    }
    try {
      await save({
        kind,
        locationId,
        slotDate,
        slotTime: hhmm,
        capacity,
        active,
      });
      setOkMsg(editingId ? "Cupo actualizado." : "Cupo guardado.");
      setEditingId(null);
    } catch {
      // error ya en hook
    }
  }, [active, capacity, editingId, kind, locationId, save, setError, slotDate, timeInput]);

  if (!canManage) return null;

  return (
    <section className="mt-4 rounded-xl border border-violet-200 bg-violet-50/30 p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Cupos por horario</h2>
          <p className="mt-1 text-[11px] text-slate-600">
            Define cupos puntuales por fecha, sede y tipo. Si no hay fila, aplica el cupo de la
            configuración semanal.
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-[11px] font-semibold text-slate-700">
          Fecha
          <input
            type="date"
            className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            value={slotDate}
            onChange={(e) => {
              setSlotDate(e.target.value as YmdDate);
              setEditingId(null);
            }}
            disabled={saving}
          />
        </label>
        <label className="block text-[11px] font-semibold text-slate-700">
          Sede
          <select
            className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              setEditingId(null);
            }}
            disabled={saving}
          >
            {SEDE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-slate-700">
          Tipo
          <select
            className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as AgendaSlotCapacityKind);
              setEditingId(null);
            }}
            disabled={saving}
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-semibold text-slate-700">
          Hora (HH:MM)
          <input
            type="text"
            inputMode="numeric"
            placeholder="09:00"
            className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            value={timeInput}
            onChange={(e) => setTimeInput(e.target.value)}
            disabled={saving}
          />
        </label>
        <label className="block text-[11px] font-semibold text-slate-700">
          Capacidad
          <input
            type="number"
            min={1}
            className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            disabled={saving}
          />
        </label>
        <label className="flex items-end gap-2 pb-1 text-[11px] font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            disabled={saving}
          />
          Activo
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          className="text-xs"
          disabled={saving || loading}
          onClick={() => void handleSave()}
        >
          {saving ? "Guardando…" : editingId ? "Actualizar cupo" : "Guardar cupo"}
        </Button>
        {editingId ? (
          <Button
            type="button"
            variant="outline"
            className="text-xs"
            disabled={saving}
            onClick={() => {
              setEditingId(null);
              setOkMsg(null);
            }}
          >
            Cancelar edición
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
      {okMsg ? <p className="mt-2 text-xs text-emerald-800">{okMsg}</p> : null}

      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-xs">
          <thead className="bg-slate-50 text-left font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Hora</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Sede</th>
              <th className="px-3 py-2">Ocupados</th>
              <th className="px-3 py-2">Capacidad</th>
              <th className="px-3 py-2">Disponibles</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-slate-500">
                  Cargando cupos…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-slate-500">
                  Sin cupos definidos para estos filtros.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="text-slate-800">
                  <td className="px-3 py-2 whitespace-nowrap">{formatTimeShort(row.slotTime)}</td>
                  <td className="px-3 py-2">{kindLabel(row.kind)}</td>
                  <td className="px-3 py-2">{formatMesaAgendaSedeLabel(row.locationId)}</td>
                  <td className="px-3 py-2 tabular-nums">{row.occupied}</td>
                  <td className="px-3 py-2 tabular-nums">{row.capacity}</td>
                  <td className="px-3 py-2 tabular-nums">{row.available}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        row.active
                          ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                          : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
                      }`}
                    >
                      {row.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        className="text-[10px]"
                        disabled={saving}
                        onClick={() => applyRowToForm(row)}
                      >
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="text-[10px]"
                        disabled={saving}
                        onClick={() => {
                          void save({
                            kind: row.kind,
                            locationId: row.locationId,
                            slotDate: row.slotDate,
                            slotTime: row.slotTime,
                            capacity: row.capacity,
                            active: !row.active,
                          }).then(() => {
                            setOkMsg(row.active ? "Cupo desactivado." : "Cupo activado.");
                          }).catch(() => undefined);
                        }}
                      >
                        {row.active ? "Desactivar" : "Activar"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
