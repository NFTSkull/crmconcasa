"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgendaWeeklyConfigForm } from "@/components/mesa-control/AgendaWeeklyConfigForm";
import {
  AGENDA_FIRMAS_WEEKDAY_OPTIONS,
  AgendaFirmasSupabaseError,
  emptyAgendaFirmasWeeklyConfig,
  useAgendaFirmasConfigRepo,
  type AgendaFirmasWeeklyConfig,
  type HhmmTime,
} from "@/domain/agenda-firmas";
import {
  cynthiaFormToWeeklyLocations,
  weeklyLocationsToCynthiaForm,
  type CynthiaSedeFormState,
  type CynthiaSedeId,
} from "@/lib/agendaCynthiaLocations";

type Props = Readonly<{
  canEdit: boolean;
  actorEmail?: string;
}>;

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

export function AgendaFirmasWeeklySupabaseSection({ canEdit }: Props) {
  const repo = useAgendaFirmasConfigRepo();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [meta, setMeta] = useState<{ updatedAt: string; updatedBy: string | null } | null>(
    null,
  );
  const [slotInputError, setSlotInputError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [minLeadHours, setMinLeadHours] = useState(24);
  const [allowedWeekdays, setAllowedWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [slots, setSlots] = useState<HhmmTime[]>(["09:00", "10:00"]);
  const [sedes, setSedes] = useState<Record<CynthiaSedeId, CynthiaSedeFormState>>(() =>
    weeklyLocationsToCynthiaForm([]),
  );

  const applyConfig = useCallback((config: AgendaFirmasWeeklyConfig) => {
    setEnabled(config.enabled);
    setMinLeadHours(config.minLeadHours);
    setAllowedWeekdays([...config.allowedWeekdays]);
    setSlots([...config.slots]);
    setSedes(weeklyLocationsToCynthiaForm(config.locations));
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
      const row = await repo.getFirmasConfig();
      if (row) {
        applyConfig(row.config);
        setMeta({ updatedAt: row.updatedAt, updatedBy: row.updatedBy });
      } else {
        applyConfig(emptyAgendaFirmasWeeklyConfig());
        setMeta(null);
      }
      setWarnings([]);
    } catch (err) {
      setLoadError(
        err instanceof AgendaFirmasSupabaseError
          ? err.message
          : "No se pudo cargar la configuración de firmas.",
      );
    } finally {
      setLoading(false);
    }
  }, [applyConfig, repo]);

  useEffect(() => {
    void load();
  }, [load]);

  const resumen = useMemo(() => {
    const activeLocations = Object.values(sedes).filter((s) => s.enabled).length;
    const weekdayLabels = allowedWeekdays
      .map((d) => AGENDA_FIRMAS_WEEKDAY_OPTIONS.find((o) => o.value === d)?.label ?? String(d))
      .join(", ");
    return { activeLocations, weekdayLabels };
  }, [allowedWeekdays, sedes]);

  function toggleWeekday(day: number) {
    setAllowedWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  function addSlot(slot: HhmmTime) {
    setSlots((prev) => [...new Set([...prev, slot])].sort() as HhmmTime[]);
  }

  function removeSlot(slot: HhmmTime) {
    setSlots((prev) => prev.filter((s) => s !== slot));
  }

  function patchSede(id: CynthiaSedeId, patch: Partial<CynthiaSedeFormState>) {
    setSedes((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function save() {
    if (!repo || !canEdit) return;
    setSaveError(null);
    setSaveOk(null);
    setWarnings([]);
    setSlotInputError(null);

    const normalizedLocations = cynthiaFormToWeeklyLocations(sedes);
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

    const payload: AgendaFirmasWeeklyConfig = {
      enabled,
      timezone: "America/Monterrey",
      minLeadHours: Math.max(0, Math.trunc(Number(minLeadHours) || 0)),
      allowedWeekdays,
      slots: normalizedSlots,
      locations: normalizedLocations,
    };

    setSaving(true);
    try {
      const result = await repo.upsertFirmasConfig(payload);
      applyConfig(result.config);
      setMeta({ updatedAt: result.updatedAt, updatedBy: result.updatedBy });
      setWarnings(result.warnings);
      setSaveOk("Configuración guardada correctamente.");
    } catch (err) {
      setSaveError(
        err instanceof AgendaFirmasSupabaseError
          ? err.message
          : "No se pudo guardar la configuración de firmas.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 sm:p-5">
        Cargando configuración de firmas…
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:p-5"
      >
        {loadError}
      </div>
    );
  }

  if (!canEdit) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold text-slate-900">Configuración de agendas</h2>
        <p className="mt-1 text-sm text-slate-700">Firmas — solo lectura</p>
        <p className="mt-2 text-sm text-slate-700">
          {meta
            ? `Última actualización: ${formatDateTime(meta.updatedAt)}.`
            : "Sin configuración guardada todavía."}
        </p>
        <p className="mt-2 text-sm text-slate-800">
          Estado: {enabled ? "activa" : "inactiva"} · Zona: America/Monterrey · Anticipación mínima:{" "}
          {minLeadHours} h · Días: {resumen.weekdayLabels || "—"} · Horarios: {slots.join(", ") ||
            "—"} · Sedes activas: {resumen.activeLocations}
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Solo Mesa Admin o Super Admin pueden editar esta configuración.
        </p>
      </section>
    );
  }

  return (
    <AgendaWeeklyConfigForm
      variant="violet"
      agendaKindLabel="Firmas"
      canEdit={canEdit}
      enabled={enabled}
      onEnabledChange={setEnabled}
      minLeadHours={minLeadHours}
      onMinLeadHoursChange={setMinLeadHours}
      allowedWeekdays={allowedWeekdays}
      onToggleWeekday={toggleWeekday}
      weekdayOptions={AGENDA_FIRMAS_WEEKDAY_OPTIONS}
      slots={slots}
      onAddSlot={addSlot}
      onRemoveSlot={removeSlot}
      sedes={sedes}
      onSedeChange={patchSede}
      metaUpdatedAt={meta?.updatedAt ?? null}
      formatDateTime={formatDateTime}
      warnings={warnings}
      saveError={saveError}
      saveOk={saveOk}
      saving={saving}
      onSave={() => void save()}
      onReload={() => void load()}
      slotInputError={slotInputError}
      onSlotInputError={setSlotInputError}
    />
  );
}
