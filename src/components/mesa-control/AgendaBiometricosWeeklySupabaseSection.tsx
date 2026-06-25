"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  AGENDA_BIOMETRICOS_WEEKDAY_OPTIONS,
  AgendaBiometricosSupabaseError,
  emptyAgendaBiometricosWeeklyConfig,
  slugifyAgendaLocationId,
  useAgendaBiometricosConfigRepo,
  type AgendaBiometricosWeeklyConfig,
  type AgendaBiometricosWeeklyLocation,
  type HhmmTime,
} from "@/domain/agenda-biometricos";

type Props = Readonly<{
  canEdit: boolean;
  actorEmail?: string;
}>;

type EditableLocation = AgendaBiometricosWeeklyLocation & { key: string };

function toEditableLocations(
  locations: AgendaBiometricosWeeklyConfig["locations"],
): EditableLocation[] {
  return locations.map((loc) => ({
    ...loc,
    key: loc.id,
  }));
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-MX", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

export function AgendaBiometricosWeeklySupabaseSection({ canEdit }: Props) {
  const repo = useAgendaBiometricosConfigRepo();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [meta, setMeta] = useState<{ updatedAt: string; updatedBy: string | null } | null>(
    null,
  );

  const [enabled, setEnabled] = useState(true);
  const [timezone, setTimezone] = useState("America/Monterrey");
  const [minLeadHours, setMinLeadHours] = useState(24);
  const [allowedWeekdays, setAllowedWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [slots, setSlots] = useState<HhmmTime[]>(["09:00", "10:00"]);
  const [locations, setLocations] = useState<EditableLocation[]>([]);
  const [newSlot, setNewSlot] = useState("");

  const applyConfig = useCallback((config: AgendaBiometricosWeeklyConfig) => {
    setEnabled(config.enabled);
    setTimezone(config.timezone);
    setMinLeadHours(config.minLeadHours);
    setAllowedWeekdays([...config.allowedWeekdays]);
    setSlots([...config.slots]);
    setLocations(toEditableLocations(config.locations));
  }, []);

  const load = useCallback(async () => {
    if (!repo) {
      setLoadError("Modo Supabase activo pero el repositorio no está disponible.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const row = await repo.getBiometricosConfig();
      if (row) {
        applyConfig(row.config);
        setMeta({ updatedAt: row.updatedAt, updatedBy: row.updatedBy });
      } else {
        applyConfig(emptyAgendaBiometricosWeeklyConfig());
        setMeta(null);
      }
      setWarnings([]);
    } catch (err) {
      setLoadError(
        err instanceof AgendaBiometricosSupabaseError
          ? err.message
          : "No se pudo cargar la configuración biométrica.",
      );
    } finally {
      setLoading(false);
    }
  }, [applyConfig, repo]);

  useEffect(() => {
    void load();
  }, [load]);

  const resumen = useMemo(() => {
    const activeLocations = locations.filter((l) => l.enabled).length;
    const weekdayLabels = allowedWeekdays
      .map((d) => AGENDA_BIOMETRICOS_WEEKDAY_OPTIONS.find((o) => o.value === d)?.label ?? String(d))
      .join(", ");
    return {
      activeLocations,
      weekdayLabels,
      slotsCount: slots.length,
    };
  }, [allowedWeekdays, locations, slots.length]);

  function toggleWeekday(day: number) {
    setAllowedWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  function addLocation() {
    const id = `ubicacion-${Date.now()}`;
    setLocations((prev) => [
      ...prev,
      { key: id, id, label: "", enabled: true, capacityPerSlot: 1 },
    ]);
  }

  async function save() {
    if (!repo || !canEdit) return;
    setSaveError(null);
    setSaveOk(null);
    setWarnings([]);

    const normalizedLocations: AgendaBiometricosWeeklyLocation[] = [];
    const usedIds = new Set<string>();
    for (const loc of locations) {
      const label = loc.label.trim();
      if (!label) continue;
      let id = slugifyAgendaLocationId(loc.id || label);
      while (usedIds.has(id)) id = `${id}-${usedIds.size + 1}`;
      usedIds.add(id);
      normalizedLocations.push({
        id,
        label,
        enabled: loc.enabled,
        capacityPerSlot: Math.max(1, Math.trunc(Number(loc.capacityPerSlot) || 1)),
      });
    }

    const normalizedSlots = [...new Set(slots.map((s) => s.trim()).filter(Boolean))].sort() as HhmmTime[];
    if (!normalizedSlots.length) {
      setSaveError("Agrega al menos un horario (HH:mm).");
      return;
    }
    if (!allowedWeekdays.length) {
      setSaveError("Selecciona al menos un día de la semana.");
      return;
    }
    if (enabled && !normalizedLocations.some((l) => l.enabled)) {
      setSaveError("Si la agenda está activa, necesitas al menos una sede habilitada.");
      return;
    }

    const payload: AgendaBiometricosWeeklyConfig = {
      enabled,
      timezone: timezone.trim() || "America/Monterrey",
      minLeadHours: Math.max(0, Math.trunc(Number(minLeadHours) || 0)),
      allowedWeekdays,
      slots: normalizedSlots,
      locations: normalizedLocations,
    };

    setSaving(true);
    try {
      const result = await repo.upsertBiometricosConfig(payload);
      applyConfig(result.config);
      setMeta({ updatedAt: result.updatedAt, updatedBy: result.updatedBy });
      setWarnings(result.warnings);
      setSaveOk(
        result.created
          ? "Configuración biométrica creada en Supabase."
          : "Configuración biométrica actualizada en Supabase.",
      );
    } catch (err) {
      setSaveError(
        err instanceof AgendaBiometricosSupabaseError
          ? err.message
          : "No se pudo guardar la configuración biométrica.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200/90 bg-white p-3 text-xs text-slate-600 sm:p-4">
        Cargando configuración biométrica (Supabase)…
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 sm:p-4"
      >
        {loadError}
      </div>
    );
  }

  if (!canEdit) {
    return (
      <section className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm sm:p-4">
        <h2 className="text-sm font-semibold text-slate-900">Agenda biométricos (Supabase)</h2>
        <p className="mt-1 text-xs text-slate-600">
          {meta
            ? `Última actualización: ${formatDateTime(meta.updatedAt)}.`
            : "Sin configuración guardada todavía."}
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Estado: {enabled ? "activa" : "inactiva"} · Zona: {timezone} · Anticipación mínima:{" "}
          {minLeadHours} h · Días: {resumen.weekdayLabels || "—"} · Horarios: {slots.join(", ") ||
            "—"} · Sedes activas: {resumen.activeLocations}
        </p>
        <p className="mt-2 text-[11px] text-slate-500">
          Solo Mesa Admin o Super Admin pueden editar esta configuración.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-3 shadow-sm sm:p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Configuración de agendas</h2>
        <p className="mt-1 text-[11px] font-semibold text-slate-700">Bloque A: Biométricos (Supabase)</p>
        <p className="mt-1 text-[11px] text-slate-600">
          Modelo semanal canónico vía RPC `upsert_agenda_config_biometricos`. Sin calendario por día.
        </p>
        {meta ? (
          <p className="mt-1 text-[10px] text-slate-500">
            Última actualización: {formatDateTime(meta.updatedAt)}
          </p>
        ) : null}
      </div>

      <div className="mt-3 space-y-3">
        <label className="flex items-center gap-2 text-xs text-slate-800">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-sky-700"
          />
          Agenda biométricos activa
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-[11px] text-slate-700">
            Zona horaria
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
              placeholder="America/Monterrey"
            />
          </label>
          <label className="text-[11px] text-slate-700">
            Anticipación mínima (horas)
            <input
              type="number"
              min={0}
              value={minLeadHours}
              onChange={(e) => setMinLeadHours(Number(e.target.value || 0))}
              className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
            />
          </label>
        </div>

        <div className="rounded-lg border border-sky-100 bg-white p-3">
          <p className="text-[11px] font-semibold text-slate-700">Días permitidos (semana)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {AGENDA_BIOMETRICOS_WEEKDAY_OPTIONS.map((day) => (
              <label key={day.value} className="flex items-center gap-1 text-[11px] text-slate-700">
                <input
                  type="checkbox"
                  checked={allowedWeekdays.includes(day.value)}
                  onChange={() => toggleWeekday(day.value)}
                  className="accent-sky-700"
                />
                {day.label}
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-sky-100 bg-white p-3">
          <p className="text-[11px] font-semibold text-slate-700">Horarios semanales (HH:mm)</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <input
              type="time"
              value={newSlot}
              onChange={(e) => setNewSlot(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-xs [color-scheme:light]"
            />
            <Button
              type="button"
              variant="outline"
              className="text-xs"
              onClick={() => {
                if (!newSlot) return;
                setSlots((prev) =>
                  [...new Set([...prev, newSlot as HhmmTime])].sort() as HhmmTime[],
                );
                setNewSlot("");
              }}
            >
              Agregar horario
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {slots.map((slot) => (
              <button
                key={slot}
                type="button"
                className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-700"
                onClick={() => setSlots((prev) => prev.filter((s) => s !== slot))}
              >
                {slot} ×
              </button>
            ))}
            {!slots.length ? (
              <span className="text-[10px] text-slate-500">Sin horarios configurados.</span>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-sky-100 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold text-slate-700">Sedes y cupo por horario</p>
            <Button type="button" variant="outline" className="text-xs" onClick={addLocation}>
              Agregar sede
            </Button>
          </div>
          <div className="space-y-3">
            {locations.map((loc, idx) => (
              <div key={loc.key} className="rounded-md border border-slate-200 p-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_auto_auto]">
                  <input
                    type="text"
                    value={loc.label}
                    placeholder="Nombre sede"
                    onChange={(e) =>
                      setLocations((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                label: e.target.value,
                                id: slugifyAgendaLocationId(e.target.value || x.id),
                              }
                            : x,
                        ),
                      )
                    }
                    className="rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                  />
                  <input
                    type="text"
                    value={loc.id}
                    placeholder="location_id"
                    onChange={(e) =>
                      setLocations((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, id: e.target.value } : x)),
                      )
                    }
                    className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-mono"
                  />
                  <label className="flex items-center gap-1 text-[11px]">
                    <input
                      type="checkbox"
                      checked={loc.enabled}
                      onChange={(e) =>
                        setLocations((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, enabled: e.target.checked } : x)),
                        )
                      }
                    />
                    Activa
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-xs"
                    onClick={() => setLocations((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    Eliminar
                  </Button>
                </div>
                <label className="mt-2 block text-[11px] text-slate-700">
                  Cupo por horario
                  <input
                    type="number"
                    min={1}
                    value={loc.capacityPerSlot}
                    onChange={(e) =>
                      setLocations((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? { ...x, capacityPerSlot: Math.max(1, Number(e.target.value || 1)) }
                            : x,
                        ),
                      )
                    }
                    className="mt-0.5 w-full max-w-[8rem] rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                  />
                </label>
              </div>
            ))}
            {!locations.length ? (
              <p className="text-[11px] text-slate-500">Agrega al menos una sede.</p>
            ) : null}
          </div>
        </div>
      </div>

      {warnings.length ? (
        <div
          role="status"
          className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
        >
          <p className="font-semibold">Advertencias (no bloquean el guardado)</p>
          <ul className="mt-1 list-disc pl-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {saveError ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {saveError}
        </p>
      ) : null}
      {saveOk ? (
        <p role="status" className="mt-2 text-xs font-medium text-emerald-700">
          {saveOk}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          className="text-xs"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Guardando…" : "Guardar biométricos (Supabase)"}
        </Button>
        <Button type="button" variant="outline" className="text-xs" disabled={saving} onClick={() => void load()}>
          Recargar
        </Button>
      </div>
    </section>
  );
}
