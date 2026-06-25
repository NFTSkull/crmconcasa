"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  MockAgendaBiometricosLocalStorageRepo,
  type AgendaBiometricosConfigV1,
  type HhmmTime,
  type YmdDate,
} from "@/domain/agenda-biometricos";
import { isDataModeSupabase } from "@/lib/dataMode";
import { AgendaBiometricosWeeklySupabaseSection } from "@/components/mesa-control/AgendaBiometricosWeeklySupabaseSection";
import {
  readAgendaFirmasConfig,
  writeAgendaFirmasConfig,
  type AgendaFirmasConfigV1,
} from "@/lib/agendaFirmasMock";

type EditableSlot = {
  id: string;
  time: HhmmTime | "";
  capacity: number;
  active: boolean;
};

type EditableLocation = {
  id: string;
  label: string;
  active: boolean;
  slots: EditableSlot[];
};

type Props = Readonly<{
  canEdit: boolean;
  actorEmail: string;
}>;

function slugifyLabel(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `ubicacion-${Date.now()}`;
}

function nextWeekdays(count = 10): YmdDate[] {
  const out: YmdDate[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (out.length < count) {
    const day = d.getDay();
    if (day >= 1 && day <= 5) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      out.push(`${y}-${m}-${dd}` as YmdDate);
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function parseEditable(config: AgendaBiometricosConfigV1 | null): {
  locations: EditableLocation[];
  days: YmdDate[];
  rules: AgendaBiometricosConfigV1["rules"];
} {
  const fallbackRules: AgendaBiometricosConfigV1["rules"] = {
    minLeadDays: 1,
    afterTimeLocal: "14:30",
    minLeadDaysAfterCutoff: 2,
  };
  if (!config) {
    return {
      locations: [],
      days: nextWeekdays(10),
      rules: fallbackRules,
    };
  }
  const dayKeys = Object.keys(config.days).sort() as YmdDate[];
  const locations: EditableLocation[] = config.locations.map((l) => {
    const byTime = new Map<string, EditableSlot>();
    for (const day of dayKeys) {
      const slots = config.days[day]?.[l.id]?.slots ?? [];
      for (const s of slots) {
        if (!byTime.has(s.time)) {
          byTime.set(s.time, {
            id: `${l.id}-${s.time}`,
            time: s.time,
            capacity: Number.isFinite(s.capacity) ? Math.max(0, Math.trunc(s.capacity)) : 0,
            active: s.active !== false,
          });
        }
      }
    }
    return {
      id: l.id,
      label: l.label,
      active: l.active !== false,
      slots: [...byTime.values()].sort((a, b) => String(a.time).localeCompare(String(b.time))),
    };
  });
  return {
    locations,
    days: dayKeys.length ? dayKeys : nextWeekdays(10),
    rules: config.rules ?? fallbackRules,
  };
}

function buildPresetLocations(): EditableLocation[] {
  return [
    {
      id: "monterrey",
      label: "Monterrey",
      active: true,
      slots: [
        { id: "monterrey-0830", time: "08:30", capacity: 5, active: true },
        { id: "monterrey-1100", time: "11:00", capacity: 5, active: true },
      ],
    },
    {
      id: "apodaca",
      label: "Apodaca",
      active: true,
      slots: [
        { id: "apodaca-0800", time: "08:00", capacity: 5, active: true },
        { id: "apodaca-1000", time: "10:00", capacity: 5, active: true },
      ],
    },
  ];
}

function buildPresetFirmasLocations(): EditableLocation[] {
  return [
    {
      id: "monterrey",
      label: "Monterrey",
      active: true,
      slots: [
        { id: "monterrey-0900", time: "09:00", capacity: 5, active: true },
        { id: "monterrey-1200", time: "12:00", capacity: 5, active: true },
      ],
    },
    {
      id: "apodaca",
      label: "Apodaca",
      active: true,
      slots: [
        { id: "apodaca-0930", time: "09:30", capacity: 5, active: true },
        { id: "apodaca-1230", time: "12:30", capacity: 5, active: true },
      ],
    },
  ];
}

function parseEditableFirmas(config: AgendaFirmasConfigV1 | null): {
  locations: EditableLocation[];
  days: YmdDate[];
  rules: AgendaFirmasConfigV1["rules"];
} {
  const fallbackRules: AgendaFirmasConfigV1["rules"] = {
    minLeadDays: 1,
    afterTimeLocal: "14:30",
    minLeadDaysAfterCutoff: 2,
  };
  if (!config) {
    return { locations: [], days: nextWeekdays(10), rules: fallbackRules };
  }
  const dayKeys = Object.keys(config.days).sort() as YmdDate[];
  const locations: EditableLocation[] = config.locations.map((l) => {
    const byTime = new Map<string, EditableSlot>();
    for (const day of dayKeys) {
      const slots = config.days[day]?.[l.id]?.slots ?? [];
      for (const s of slots) {
        if (!byTime.has(s.time)) {
          byTime.set(s.time, {
            id: `${l.id}-${s.time}`,
            time: s.time,
            capacity: Number.isFinite(s.capacity) ? Math.max(0, Math.trunc(s.capacity)) : 0,
            active: s.active !== false,
          });
        }
      }
    }
    return {
      id: l.id,
      label: l.label,
      active: l.active !== false,
      slots: [...byTime.values()].sort((a, b) => String(a.time).localeCompare(String(b.time))),
    };
  });
  return {
    locations,
    days: dayKeys.length ? dayKeys : nextWeekdays(10),
    rules: config.rules ?? fallbackRules,
  };
}

function slugFromAny(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `id-${Date.now()}`;
}

export function AgendaBiometricosConfigPanel({ canEdit, actorEmail }: Props) {
  const dataSupabase = isDataModeSupabase();
  const repo = useMemo(() => new MockAgendaBiometricosLocalStorageRepo(), []);
  const [sourceConfig, setSourceConfig] = useState<AgendaBiometricosConfigV1 | null>(() =>
    repo.readConfig(),
  );
  const [sourceFirmasConfig, setSourceFirmasConfig] = useState<AgendaFirmasConfigV1 | null>(() =>
    readAgendaFirmasConfig(),
  );
  const parsed = useMemo(() => parseEditable(sourceConfig), [sourceConfig]);
  const parsedFirmas = useMemo(
    () => parseEditableFirmas(sourceFirmasConfig),
    [sourceFirmasConfig],
  );
  const [locations, setLocations] = useState<EditableLocation[]>(parsed.locations);
  const [firmasLocations, setFirmasLocations] = useState<EditableLocation[]>(parsedFirmas.locations);
  const [days, setDays] = useState<YmdDate[]>(parsed.days);
  const [firmasDays, setFirmasDays] = useState<YmdDate[]>(parsedFirmas.days);
  const [rules, setRules] = useState(parsed.rules);
  const [firmasRules, setFirmasRules] = useState(parsedFirmas.rules);
  const [newDate, setNewDate] = useState("");
  const [newFirmasDate, setNewFirmasDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [firmasError, setFirmasError] = useState<string | null>(null);
  const [firmasOk, setFirmasOk] = useState<string | null>(null);

  useEffect(() => {
    setLocations(parsed.locations);
    setDays(parsed.days);
    setRules(parsed.rules);
  }, [parsed]);

  useEffect(() => {
    setFirmasLocations(parsedFirmas.locations);
    setFirmasDays(parsedFirmas.days);
    setFirmasRules(parsedFirmas.rules);
  }, [parsedFirmas]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onBiometricosConfig = () => setSourceConfig(repo.readConfig());
    const onFirmasConfig = () => setSourceFirmasConfig(readAgendaFirmasConfig());
    window.addEventListener("agenda_config_updated", onBiometricosConfig);
    window.addEventListener("agenda_firmas_config_updated", onFirmasConfig);
    return () => {
      window.removeEventListener("agenda_config_updated", onBiometricosConfig);
      window.removeEventListener("agenda_firmas_config_updated", onFirmasConfig);
    };
  }, [repo]);

  const resumen = useMemo(() => {
    if (!sourceConfig) return null;
    const locationsActivas = sourceConfig.locations.filter((l) => l.active !== false).length;
    let slotsActivos = 0;
    for (const key of Object.keys(sourceConfig.days)) {
      const day = sourceConfig.days[key as YmdDate];
      if (!day) continue;
      for (const locId of Object.keys(day)) {
        const slots = day[locId]?.slots ?? [];
        slotsActivos += slots.filter((s) => s.active !== false).length;
      }
    }
    return {
      locationsActivas,
      dias: Object.keys(sourceConfig.days).length,
      slotsActivos,
      updatedAt: sourceConfig.updatedAt,
      updatedBy: sourceConfig.updatedBy.email,
    };
  }, [sourceConfig]);

  const resumenFirmas = useMemo(() => {
    if (!sourceFirmasConfig) return null;
    const locationsActivas = sourceFirmasConfig.locations.filter((l) => l.active !== false).length;
    let slotsActivos = 0;
    for (const key of Object.keys(sourceFirmasConfig.days)) {
      const day = sourceFirmasConfig.days[key as YmdDate];
      if (!day) continue;
      for (const locId of Object.keys(day)) {
        const slots = day[locId]?.slots ?? [];
        slotsActivos += slots.filter((s) => s.active !== false).length;
      }
    }
    return {
      locationsActivas,
      dias: Object.keys(sourceFirmasConfig.days).length,
      slotsActivos,
      updatedAt: sourceFirmasConfig.updatedAt,
      updatedBy: sourceFirmasConfig.updatedBy.email,
    };
  }, [sourceFirmasConfig]);

  function addLocation() {
    setLocations((prev) => [
      ...prev,
      {
        id: `ubicacion-${Date.now()}`,
        label: "",
        active: true,
        slots: [],
      },
    ]);
  }

  function addSlot(locationIdx: number) {
    setLocations((prev) =>
      prev.map((loc, idx) =>
        idx === locationIdx
          ? {
              ...loc,
              slots: [
                ...loc.slots,
                {
                  id: `${loc.id}-slot-${Date.now()}`,
                  time: "",
                  capacity: 1,
                  active: true,
                },
              ],
            }
          : loc,
      ),
    );
  }

  function addFirmasLocation() {
    setFirmasLocations((prev) => [
      ...prev,
      { id: `ubicacion-${Date.now()}`, label: "", active: true, slots: [] },
    ]);
  }

  function addFirmasSlot(locationIdx: number) {
    setFirmasLocations((prev) =>
      prev.map((loc, idx) =>
        idx === locationIdx
          ? {
              ...loc,
              slots: [
                ...loc.slots,
                { id: `${loc.id}-slot-${Date.now()}`, time: "", capacity: 1, active: true },
              ],
            }
          : loc,
      ),
    );
  }

  function saveConfig() {
    setError(null);
    setOk(null);
    if (!canEdit) {
      setError("Solo mesa_control_admin puede editar la agenda.");
      return;
    }
    const dayList = [...new Set(days.map((d) => d.trim()).filter(Boolean))].sort() as YmdDate[];
    if (!dayList.length) {
      setError("Agrega al menos un día disponible.");
      return;
    }
    const normalizedLocations: EditableLocation[] = [];
    const usedIds = new Set<string>();
    for (const loc of locations) {
      const label = loc.label.trim();
      if (!label) continue;
      let id = slugifyLabel(loc.id || label);
      while (usedIds.has(id)) id = `${id}-${usedIds.size + 1}`;
      usedIds.add(id);
      const slots = loc.slots
        .filter((s) => s.time)
        .map((s) => ({
          id: s.id,
          time: s.time as HhmmTime,
          capacity: Math.max(0, Math.trunc(Number(s.capacity) || 0)),
          active: s.active,
        }))
        .sort((a, b) => a.time.localeCompare(b.time));
      normalizedLocations.push({
        ...loc,
        id,
        label,
        slots,
      });
    }
    if (!normalizedLocations.length) {
      setError("Agrega al menos una ubicación con nombre.");
      return;
    }
    const next: AgendaBiometricosConfigV1 = {
      version: 1,
      kind: "biometricos",
      updatedAt: new Date().toISOString(),
      updatedBy: { email: actorEmail || "unknown@local", role: "mesa_control_admin" },
      locations: normalizedLocations.map((l) => ({
        id: l.id,
        label: l.label,
        tz: "America/Monterrey",
        active: l.active,
      })),
      rules: {
        minLeadDays: Math.max(0, Math.trunc(Number(rules.minLeadDays) || 0)),
        afterTimeLocal: rules.afterTimeLocal,
        minLeadDaysAfterCutoff: Math.max(0, Math.trunc(Number(rules.minLeadDaysAfterCutoff) || 0)),
      },
      days: Object.fromEntries(
        dayList.map((d) => [
          d,
          Object.fromEntries(
            normalizedLocations.map((loc) => [
              loc.id,
              {
                slots: loc.slots.map((s) => ({
                  time: s.time as HhmmTime,
                  capacity: s.capacity,
                  active: s.active,
                })),
              },
            ]),
          ),
        ]),
      ) as AgendaBiometricosConfigV1["days"],
    };
    repo.writeConfig(next);
    setSourceConfig(next);
    setOk("Configuración guardada en agenda_config_v1.");
  }

  function saveFirmasConfig() {
    setFirmasError(null);
    setFirmasOk(null);
    if (!canEdit) {
      setFirmasError("Solo mesa_control_admin puede editar la agenda de firmas.");
      return;
    }
    const dayList = [...new Set(firmasDays.map((d) => d.trim()).filter(Boolean))].sort() as YmdDate[];
    if (!dayList.length) {
      setFirmasError("Agrega al menos un día disponible para firmas.");
      return;
    }
    const normalizedLocations: EditableLocation[] = [];
    const usedIds = new Set<string>();
    for (const loc of firmasLocations) {
      const label = loc.label.trim();
      if (!label) continue;
      let id = slugFromAny(loc.id || label);
      while (usedIds.has(id)) id = `${id}-${usedIds.size + 1}`;
      usedIds.add(id);
      const slots = loc.slots
        .filter((s) => s.time)
        .map((s) => ({
          id: s.id,
          time: s.time as HhmmTime,
          capacity: Math.max(0, Math.trunc(Number(s.capacity) || 0)),
          active: s.active,
        }))
        .sort((a, b) => a.time.localeCompare(b.time));
      normalizedLocations.push({ ...loc, id, label, slots });
    }
    if (!normalizedLocations.length) {
      setFirmasError("Agrega al menos una ubicación con nombre en firmas.");
      return;
    }
    const next: AgendaFirmasConfigV1 = {
      version: 1,
      kind: "firmas",
      updatedAt: new Date().toISOString(),
      updatedBy: { email: actorEmail || "unknown@local", role: "mesa_control_admin" },
      locations: normalizedLocations.map((l) => ({
        id: l.id,
        label: l.label,
        tz: "America/Monterrey",
        active: l.active,
      })),
      rules: {
        minLeadDays: Math.max(0, Math.trunc(Number(firmasRules.minLeadDays) || 0)),
        afterTimeLocal: firmasRules.afterTimeLocal,
        minLeadDaysAfterCutoff: Math.max(
          0,
          Math.trunc(Number(firmasRules.minLeadDaysAfterCutoff) || 0),
        ),
      },
      days: Object.fromEntries(
        dayList.map((d) => [
          d,
          Object.fromEntries(
            normalizedLocations.map((loc) => [
              loc.id,
              {
                slots: loc.slots.map((s) => ({
                  time: s.time as HhmmTime,
                  capacity: s.capacity,
                  active: s.active,
                })),
              },
            ]),
          ),
        ]),
      ) as AgendaFirmasConfigV1["days"],
    };
    writeAgendaFirmasConfig(next);
    setSourceFirmasConfig(next);
    setFirmasOk("Configuración guardada en agenda_firmas_config_v1.");
  }

  if (!canEdit) {
    return (
      <section className="space-y-4">
        {dataSupabase ? (
          <AgendaBiometricosWeeklySupabaseSection canEdit={false} actorEmail={actorEmail} />
        ) : (
          <div className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm sm:p-4">
            <h2 className="text-sm font-semibold text-slate-900">Configuración de agendas</h2>
            {resumen ? (
              <p className="mt-1 text-xs text-slate-600">
                Biométricos: configurada por {resumen.updatedBy} (
                {new Date(resumen.updatedAt).toLocaleString("es-MX")}). Ubicaciones activas:{" "}
                {resumen.locationsActivas}. Días: {resumen.dias}. Slots activos: {resumen.slotsActivos}.
              </p>
            ) : (
              <p className="mt-1 text-xs text-amber-800">
                Aún no hay configuración de biométricos (`agenda_config_v1`).
              </p>
            )}
          </div>
        )}
        <div className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm sm:p-4">
          <h2 className="text-sm font-semibold text-slate-900">Configuración de agendas</h2>
          {resumenFirmas ? (
            <p className="mt-1 text-xs text-slate-600">
              Firmas: configurada por {resumenFirmas.updatedBy} (
              {new Date(resumenFirmas.updatedAt).toLocaleString("es-MX")}). Ubicaciones activas:{" "}
              {resumenFirmas.locationsActivas}. Días: {resumenFirmas.dias}. Slots activos:{" "}
              {resumenFirmas.slotsActivos}.
            </p>
          ) : (
            <p className="mt-1 text-xs text-amber-800">
              Aún no hay configuración de firmas (`agenda_firmas_config_v1`). Solicita a Mesa Control -
              Admin (Cynthia) que la configure.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <>
      {dataSupabase ? (
        <AgendaBiometricosWeeklySupabaseSection canEdit={canEdit} actorEmail={actorEmail} />
      ) : null}
      <section
        className={`rounded-xl border border-sky-200 bg-sky-50/40 p-3 shadow-sm sm:p-4 ${dataSupabase ? "" : ""}`}
      >
      {!dataSupabase ? (
        <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Configuración de agendas</h2>
          <p className="mt-1 text-[11px] font-semibold text-slate-700">Bloque A: Biométricos</p>
          <p className="mt-1 text-[11px] text-slate-600">
            Solo `mesa_control_admin`. Se guarda en `agenda_config_v1` y dispara `agenda_config_updated`.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="outline"
            className="text-xs"
            onClick={() => {
              setLocations(buildPresetLocations());
              setDays(nextWeekdays(10));
              setOk(null);
              setError(null);
            }}
          >
            Cargar preset Mty/Apodaca
          </Button>
          <Button
            type="button"
            variant="outline"
            className="text-xs"
            onClick={() => {
              setLocations([]);
              setDays([]);
              setOk(null);
              setError(null);
            }}
          >
            Limpiar
          </Button>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-sky-100 bg-white p-3">
        <p className="text-[11px] font-semibold text-slate-700">Días disponibles</p>
        <p className="text-[10px] text-slate-500">Puedes usar fechas específicas o generar Lun-Vie.</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-slate-700">
            Fecha
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="ml-2 rounded-md border border-slate-200 px-2 py-1 text-xs"
            />
          </label>
          <Button
            type="button"
            variant="outline"
            className="text-xs"
            onClick={() => {
              if (!newDate) return;
              setDays((prev) => [...new Set([...prev, newDate as YmdDate])].sort());
              setNewDate("");
            }}
          >
            Agregar fecha
          </Button>
          <Button
            type="button"
            variant="outline"
            className="text-xs"
            onClick={() => setDays(nextWeekdays(10))}
          >
            Lun-Vie (10 días)
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-700"
              onClick={() => setDays((prev) => prev.filter((x) => x !== d))}
              title="Quitar fecha"
            >
              {d} ×
            </button>
          ))}
          {!days.length ? <span className="text-[10px] text-slate-500">Sin fechas configuradas.</span> : null}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-sky-100 bg-white p-3 text-black">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold text-black">Ubicaciones, horarios y cupos</p>
          <Button type="button" variant="outline" className="text-xs text-black" onClick={addLocation}>
            Agregar ubicación
          </Button>
        </div>
        <div className="space-y-3 text-black">
          {locations.map((loc, locIdx) => (
            <div key={loc.id} className="rounded-md border border-slate-200 p-2 text-black">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
                <input
                  type="text"
                  value={loc.label}
                  placeholder="Nombre de ubicación (ej. Monterrey)"
                  onChange={(e) =>
                    setLocations((prev) =>
                      prev.map((x, idx) =>
                        idx === locIdx ? { ...x, label: e.target.value, id: slugifyLabel(e.target.value) } : x,
                      ),
                    )
                  }
                  className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-black placeholder:text-neutral-700"
                />
                <label className="flex items-center gap-1 text-[11px] text-black">
                  <input
                    type="checkbox"
                    checked={loc.active}
                    className="text-black accent-gray-900"
                    onChange={(e) =>
                      setLocations((prev) =>
                        prev.map((x, idx) => (idx === locIdx ? { ...x, active: e.target.checked } : x)),
                      )
                    }
                  />
                  Activa
                </label>
                <Button
                  type="button"
                  variant="outline"
                  className="text-xs text-black"
                  onClick={() => setLocations((prev) => prev.filter((_, idx) => idx !== locIdx))}
                >
                  Eliminar
                </Button>
              </div>
              <div className="mt-2 space-y-1.5">
                {loc.slots.map((slot, slotIdx) => (
                  <div key={slot.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_120px_auto_auto]">
                    <input
                      type="time"
                      value={slot.time}
                      onChange={(e) =>
                        setLocations((prev) =>
                          prev.map((x, idx) =>
                            idx !== locIdx
                              ? x
                              : {
                                  ...x,
                                  slots: x.slots.map((s, sIdx) =>
                                    sIdx === slotIdx ? { ...s, time: e.target.value as HhmmTime } : s,
                                  ),
                                },
                          ),
                        )
                      }
                      className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-black [color-scheme:light]"
                    />
                    <input
                      type="number"
                      min={0}
                      value={slot.capacity}
                      onChange={(e) =>
                        setLocations((prev) =>
                          prev.map((x, idx) =>
                            idx !== locIdx
                              ? x
                              : {
                                  ...x,
                                  slots: x.slots.map((s, sIdx) =>
                                    sIdx === slotIdx ? { ...s, capacity: Number(e.target.value || 0) } : s,
                                  ),
                                },
                          ),
                        )
                      }
                      className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-black [color-scheme:light]"
                      placeholder="Cupos"
                    />
                    <label className="flex items-center gap-1 text-[11px] text-black">
                      <input
                        type="checkbox"
                        checked={slot.active}
                        className="text-black accent-gray-900"
                        onChange={(e) =>
                          setLocations((prev) =>
                            prev.map((x, idx) =>
                              idx !== locIdx
                                ? x
                                : {
                                    ...x,
                                    slots: x.slots.map((s, sIdx) =>
                                      sIdx === slotIdx ? { ...s, active: e.target.checked } : s,
                                    ),
                                  },
                            ),
                          )
                        }
                      />
                      Activo
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      className="text-xs text-black"
                      onClick={() =>
                        setLocations((prev) =>
                          prev.map((x, idx) =>
                            idx !== locIdx
                              ? x
                              : { ...x, slots: x.slots.filter((_, sIdx) => sIdx !== slotIdx) },
                          ),
                        )
                      }
                    >
                      Quitar
                    </Button>
                  </div>
                ))}
              </div>
              <div className="mt-2">
                <Button type="button" variant="outline" className="text-xs text-black" onClick={() => addSlot(locIdx)}>
                  Agregar horario
                </Button>
              </div>
            </div>
          ))}
          {!locations.length ? (
            <p className="text-[11px] text-black">No hay ubicaciones. Agrega al menos una.</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-sky-100 bg-white p-3">
        <p className="text-[11px] font-semibold text-slate-700">Reglas de anticipación</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-[11px] text-slate-700">
            Min días (antes cutoff)
            <input
              type="number"
              min={0}
              value={rules.minLeadDays}
              onChange={(e) =>
                setRules((prev) => ({ ...prev, minLeadDays: Number(e.target.value || 0) }))
              }
              className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
            />
          </label>
          <label className="text-[11px] text-slate-700">
            Hora cutoff
            <input
              type="time"
              value={rules.afterTimeLocal}
              onChange={(e) =>
                setRules((prev) => ({ ...prev, afterTimeLocal: e.target.value as HhmmTime }))
              }
              className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
            />
          </label>
          <label className="text-[11px] text-slate-700">
            Min días (después cutoff)
            <input
              type="number"
              min={0}
              value={rules.minLeadDaysAfterCutoff}
              onChange={(e) =>
                setRules((prev) => ({
                  ...prev,
                  minLeadDaysAfterCutoff: Number(e.target.value || 0),
                }))
              }
              className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
            />
          </label>
        </div>
      </div>

      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      {ok ? (
        <p className="mt-2 text-xs font-medium text-emerald-700" role="status">
          {ok}
        </p>
      ) : null}

      <div className="mt-3">
        <Button type="button" variant="primary" className="text-xs" onClick={saveConfig}>
          Guardar biométricos
        </Button>
      </div>
        </>
      ) : null}

      <div className={`${dataSupabase ? "" : "mt-5 border-t border-sky-200 pt-4"}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold text-slate-700">Bloque B: Firmas</p>
            <p className="mt-1 text-[11px] text-slate-600">
              Solo `mesa_control_admin`. Se guarda en `agenda_firmas_config_v1` y dispara
              `agenda_firmas_config_updated`.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="outline"
              className="text-xs text-black"
              onClick={() => {
                setFirmasLocations(buildPresetFirmasLocations());
                setFirmasDays(nextWeekdays(10));
                setFirmasError(null);
                setFirmasOk(null);
              }}
            >
              Preset firmas Mty/Apodaca
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-xs text-black"
              onClick={() => {
                setFirmasLocations([]);
                setFirmasDays([]);
                setFirmasError(null);
                setFirmasOk(null);
              }}
            >
              Limpiar firmas
            </Button>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-sky-100 bg-white p-3">
          <p className="text-[11px] font-semibold text-slate-700">Días disponibles (firmas)</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-slate-700">
              Fecha
              <input
                type="date"
                value={newFirmasDate}
                onChange={(e) => setNewFirmasDate(e.target.value)}
                className="ml-2 rounded-md border border-slate-200 px-2 py-1 text-xs"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              className="text-xs text-black"
              onClick={() => {
                if (!newFirmasDate) return;
                setFirmasDays((prev) => [...new Set([...prev, newFirmasDate as YmdDate])].sort());
                setNewFirmasDate("");
              }}
            >
              Agregar fecha
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-xs text-black"
              onClick={() => setFirmasDays(nextWeekdays(10))}
            >
              Lun-Vie (10 días)
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {firmasDays.map((d) => (
              <button
                key={d}
                type="button"
                className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-700"
                onClick={() => setFirmasDays((prev) => prev.filter((x) => x !== d))}
              >
                {d} ×
              </button>
            ))}
            {!firmasDays.length ? (
              <span className="text-[10px] text-slate-500">Sin fechas configuradas para firmas.</span>
            ) : null}
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-sky-100 bg-white p-3 text-black">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold text-black">Ubicaciones, horarios y cupos (firmas)</p>
            <Button
              type="button"
              variant="outline"
              className="text-xs text-black"
              onClick={addFirmasLocation}
            >
              Agregar ubicación
            </Button>
          </div>
          <div className="space-y-3">
            {firmasLocations.map((loc, locIdx) => (
              <div key={loc.id} className="rounded-md border border-slate-200 p-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <input
                    type="text"
                    value={loc.label}
                    placeholder="Nombre de ubicación (ej. Monterrey)"
                    onChange={(e) =>
                      setFirmasLocations((prev) =>
                        prev.map((x, idx) =>
                          idx === locIdx
                            ? { ...x, label: e.target.value, id: slugFromAny(e.target.value) }
                            : x,
                        ),
                      )
                    }
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-black placeholder:text-neutral-700"
                  />
                  <label className="flex items-center gap-1 text-[11px] text-black">
                    <input
                      type="checkbox"
                      checked={loc.active}
                      className="accent-gray-900"
                      onChange={(e) =>
                        setFirmasLocations((prev) =>
                          prev.map((x, idx) => (idx === locIdx ? { ...x, active: e.target.checked } : x)),
                        )
                      }
                    />
                    Activa
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-xs text-black"
                    onClick={() => setFirmasLocations((prev) => prev.filter((_, idx) => idx !== locIdx))}
                  >
                    Eliminar
                  </Button>
                </div>
                <div className="mt-2 space-y-1.5">
                  {loc.slots.map((slot, slotIdx) => (
                    <div
                      key={slot.id}
                      className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_120px_auto_auto]"
                    >
                      <input
                        type="time"
                        value={slot.time}
                        onChange={(e) =>
                          setFirmasLocations((prev) =>
                            prev.map((x, idx) =>
                              idx !== locIdx
                                ? x
                                : {
                                    ...x,
                                    slots: x.slots.map((s, sIdx) =>
                                      sIdx === slotIdx ? { ...s, time: e.target.value as HhmmTime } : s,
                                    ),
                                  },
                            ),
                          )
                        }
                        className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-black [color-scheme:light]"
                      />
                      <input
                        type="number"
                        min={0}
                        value={slot.capacity}
                        onChange={(e) =>
                          setFirmasLocations((prev) =>
                            prev.map((x, idx) =>
                              idx !== locIdx
                                ? x
                                : {
                                    ...x,
                                    slots: x.slots.map((s, sIdx) =>
                                      sIdx === slotIdx ? { ...s, capacity: Number(e.target.value || 0) } : s,
                                    ),
                                  },
                            ),
                          )
                        }
                        className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-black [color-scheme:light]"
                        placeholder="Cupos"
                      />
                      <label className="flex items-center gap-1 text-[11px] text-black">
                        <input
                          type="checkbox"
                          checked={slot.active}
                          className="accent-gray-900"
                          onChange={(e) =>
                            setFirmasLocations((prev) =>
                              prev.map((x, idx) =>
                                idx !== locIdx
                                  ? x
                                  : {
                                      ...x,
                                      slots: x.slots.map((s, sIdx) =>
                                        sIdx === slotIdx ? { ...s, active: e.target.checked } : s,
                                      ),
                                    },
                              ),
                            )
                          }
                        />
                        Activo
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        className="text-xs text-black"
                        onClick={() =>
                          setFirmasLocations((prev) =>
                            prev.map((x, idx) =>
                              idx !== locIdx
                                ? x
                                : { ...x, slots: x.slots.filter((_, sIdx) => sIdx !== slotIdx) },
                            ),
                          )
                        }
                      >
                        Quitar
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="text-xs text-black"
                    onClick={() => addFirmasSlot(locIdx)}
                  >
                    Agregar horario
                  </Button>
                </div>
              </div>
            ))}
            {!firmasLocations.length ? (
              <p className="text-[11px] text-black">No hay ubicaciones de firmas. Agrega al menos una.</p>
            ) : null}
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-sky-100 bg-white p-3">
          <p className="text-[11px] font-semibold text-slate-700">Reglas de anticipación (firmas)</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-[11px] text-slate-700">
              Min días (antes cutoff)
              <input
                type="number"
                min={0}
                value={firmasRules.minLeadDays}
                onChange={(e) =>
                  setFirmasRules((prev) => ({ ...prev, minLeadDays: Number(e.target.value || 0) }))
                }
                className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
              />
            </label>
            <label className="text-[11px] text-slate-700">
              Hora cutoff
              <input
                type="time"
                value={firmasRules.afterTimeLocal}
                onChange={(e) =>
                  setFirmasRules((prev) => ({ ...prev, afterTimeLocal: e.target.value as HhmmTime }))
                }
                className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
              />
            </label>
            <label className="text-[11px] text-slate-700">
              Min días (después cutoff)
              <input
                type="number"
                min={0}
                value={firmasRules.minLeadDaysAfterCutoff}
                onChange={(e) =>
                  setFirmasRules((prev) => ({
                    ...prev,
                    minLeadDaysAfterCutoff: Number(e.target.value || 0),
                  }))
                }
                className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
              />
            </label>
          </div>
        </div>

        {firmasError ? <p className="mt-2 text-xs text-red-700">{firmasError}</p> : null}
        {firmasOk ? (
          <p className="mt-2 text-xs font-medium text-emerald-700" role="status">
            {firmasOk}
          </p>
        ) : null}

        <div className="mt-3">
          <Button type="button" variant="primary" className="text-xs" onClick={saveFirmasConfig}>
            Guardar firmas
          </Button>
        </div>
      </div>
    </section>
    </>
  );
}
