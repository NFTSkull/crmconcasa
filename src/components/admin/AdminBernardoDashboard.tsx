"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { AdminBernardoPeriodSelector } from "@/components/admin/AdminBernardoPeriodSelector";
import { AdminBernardoMetricCard } from "@/components/admin/AdminBernardoMetricCard";
import { AdminBernardoDetailPanel } from "@/components/admin/AdminBernardoDetailPanel";
import type { AdminMesaEnvioEvent, AdminProductionRepo } from "@/domain/admin-production";
import {
  bernardoPeriodDisplayLabel,
  resolveBernardoPeriodBounds,
  type BernardoPeriodPreset,
} from "@/lib/adminBernardoPeriod";
import {
  bernardoCitaToMesaEnvio,
  loadBernardoDashboard,
  type BernardoCitaRow,
  type BernardoDashboardData,
  type BernardoMetricId,
} from "@/lib/adminBernardoLoad";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

type AdminBernardoDashboardProps = {
  repo: AdminProductionRepo;
  onBack: () => void;
  onOpenExpediente: (row: AdminMesaEnvioEvent, trigger: HTMLButtonElement | null) => void;
};

const EMPTY_DATA: BernardoDashboardData = {
  ingresosTotal: 0,
  ingresosItems: [],
  biometricosTotal: 0,
  biometricosItems: [],
  firmasTotal: 0,
  firmasItems: [],
  notificacionesTotal: 0,
  notificacionesItems: [],
};

const OPS_REFETCH_MS = 25_000;

export function AdminBernardoDashboard({
  repo,
  onBack,
  onOpenExpediente,
}: AdminBernardoDashboardProps) {
  const [preset, setPreset] = useState<BernardoPeriodPreset>("hoy");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BernardoDashboardData>(EMPTY_DATA);
  const [expanded, setExpanded] = useState<BernardoMetricId | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const bounds = useMemo(() => {
    try {
      return resolveBernardoPeriodBounds({
        preset,
        customFrom: preset === "personalizado" ? customFrom : undefined,
        customToInclusive: preset === "personalizado" ? customTo : undefined,
      });
    } catch {
      return null;
    }
  }, [preset, customFrom, customTo]);

  const invalidCustom = preset === "personalizado" && !bounds;

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!bounds) {
        setLoading(false);
        setData(EMPTY_DATA);
        return;
      }
      if (!opts?.quiet) setLoading(true);
      setError(null);
      try {
        const next = await loadBernardoDashboard({ repo, bounds });
        setData(next);
      } catch {
        if (!opts?.quiet) {
          setError("No se pudo cargar la información del periodo.");
          setData(EMPTY_DATA);
        }
      } finally {
        if (!opts?.quiet) setLoading(false);
      }
    },
    [bounds, repo],
  );

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Realtime sobre proyección + refetch moderado + al recuperar foco (quiet).
  useEffect(() => {
    if (!bounds) return;

    const quietReload = () => {
      void load({ quiet: true });
    };

    const onFocus = () => quietReload();
    window.addEventListener("focus", onFocus);

    const interval = window.setInterval(quietReload, OPS_REFETCH_MS);

    let channel: ReturnType<NonNullable<typeof supabaseBrowser>["channel"]> | null =
      null;
    if (isSupabaseConfigured() && supabaseBrowser) {
      channel = supabaseBrowser
        .channel("bernardo-ops-results")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "agenda_sheet_operational_results",
          },
          () => quietReload(),
        )
        .subscribe();
    }

    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
      if (channel && supabaseBrowser) {
        void supabaseBrowser.removeChannel(channel);
      }
    };
  }, [bounds, load]);

  const periodLabel = bounds ? bernardoPeriodDisplayLabel(bounds) : null;

  const handlePresetChange = (next: BernardoPeriodPreset) => {
    setPreset(next);
    setExpanded(null);
  };

  const handleCustomFrom = (value: string) => {
    setCustomFrom(value);
    setExpanded(null);
  };

  const handleCustomTo = (value: string) => {
    setCustomTo(value);
    setExpanded(null);
  };

  const toggleMetric = (id: BernardoMetricId) => {
    setExpanded((cur) => (cur === id ? null : id));
  };

  const openFromIngresos = (
    row: AdminMesaEnvioEvent,
    ev?: React.MouseEvent<HTMLButtonElement>,
  ) => {
    onOpenExpediente(row, ev?.currentTarget ?? null);
  };

  const openFromCita = (cita: BernardoCitaRow) => {
    const row = bernardoCitaToMesaEnvio(cita);
    if (!row) return;
    onOpenExpediente(row, null);
  };

  const metrics: {
    id: BernardoMetricId;
    title: string;
    description: string;
    value: number;
  }[] = [
    {
      id: "ingresos",
      title: "Ingresos",
      description: "Expedientes enviados a Mesa",
      value: data.ingresosTotal,
    },
    {
      id: "biometricos",
      title: "Biométricos",
      description: "Biométricos completados en el periodo",
      value: data.biometricosTotal,
    },
    {
      id: "firmas",
      title: "Firmas",
      description: "Firmas completadas en el periodo",
      value: data.firmasTotal,
    },
    {
      id: "notificaciones",
      title: "Notificaciones a registro",
      description: "Notificaciones enviadas a registro",
      value: data.notificacionesTotal,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Reporte del día
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Resultados operativos reales de CITAS 2026 (completados, no solo
            agendados) e ingresos a Mesa.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={onBack}>
          ← Volver al panel Admin
        </Button>
      </div>

      <AdminBernardoPeriodSelector
        preset={preset}
        customFrom={customFrom}
        customTo={customTo}
        periodLabel={periodLabel}
        invalidCustom={invalidCustom}
        onPresetChange={handlePresetChange}
        onCustomFromChange={handleCustomFrom}
        onCustomToChange={handleCustomTo}
        onRefresh={() => setRefreshKey((k) => k + 1)}
        loading={loading}
      />

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <AdminBernardoMetricCard
            key={m.id}
            id={`bernardo-metric-${m.id}`}
            title={m.title}
            value={loading ? null : m.value}
            description={m.description}
            expanded={expanded === m.id}
            loading={loading}
            onToggle={() => toggleMetric(m.id)}
          />
        ))}
      </div>

      {expanded && bounds ? (
        <AdminBernardoDetailPanel
          metric={expanded}
          total={
            expanded === "ingresos"
              ? data.ingresosTotal
              : expanded === "biometricos"
                ? data.biometricosTotal
                : expanded === "firmas"
                  ? data.firmasTotal
                  : data.notificacionesTotal
          }
          bounds={bounds}
          ingresosItems={data.ingresosItems}
          biometricosItems={data.biometricosItems}
          firmasItems={data.firmasItems}
          notificacionesItems={data.notificacionesItems}
          onHide={() => setExpanded(null)}
          onOpenExpediente={(row) => openFromIngresos(row)}
          onOpenCita={openFromCita}
        />
      ) : null}
    </div>
  );
}
