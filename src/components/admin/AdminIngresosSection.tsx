"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatMontoMX } from "@/lib/monto";
import { formatDateTimeMx } from "@/lib/filters";
import { ADMIN_REPORT_PASO_OPTIONS } from "@/domain/admin-report-asesores-etapas";
import {
  AdminIngresosError,
  INGRESOS_FECHA_EXPLICACION,
  INGRESOS_HISTORICO_ESTIMADO_TOOLTIP,
  INGRESOS_TOPE_TOOLTIP,
  buildIngresosAlcanceSummary,
  buildIngresosFilterLabelRows,
  fetchIngresosExportBundle,
  fetchIngresosPage,
  fetchIngresosResumen,
  isIngresosFilterUiDefault,
  recommendedIngresosExcelConfig,
  resetIngresosFilterUi,
  resolveIngresosPeriodBounds,
  validateIngresosExcelConfig,
  type IngresosDetalleItem,
  type IngresosEstadoFiltro,
  type IngresosExcelExportConfig,
  type IngresosFilterUiState,
  type IngresosFilters,
  type IngresosPeriodPreset,
  type IngresosResumen,
  type IngresosStageScope,
} from "@/domain/admin-ingresos";
import { AdminIngresosExcelCustomizeModal } from "@/components/admin/AdminIngresosExcelCustomizeModal";
import {
  buildAdminIngresosWorkbook,
  buildIngresosExcelFilename,
  downloadAdminIngresosWorkbook,
} from "@/lib/exportAdminIngresosExcel";

type AsesorOption = Readonly<{ id: string; nombre: string }>;

const PRESET_OPTIONS: ReadonlyArray<{ value: IngresosPeriodPreset; label: string }> = [
  { value: "hoy", label: "Hoy" },
  { value: "semana", label: "Esta semana" },
  { value: "mes_actual", label: "Mes actual" },
  { value: "mes_anterior", label: "Mes anterior" },
  { value: "ultimos_30", label: "Últimos 30 días" },
  { value: "personalizado", label: "Personalizado" },
  { value: "todo", label: "Todo el historial" },
];

const ESTADO_OPTIONS: ReadonlyArray<{ value: IngresosEstadoFiltro; label: string }> = [
  { value: "elegibles", label: "Todos elegibles" },
  { value: "pendientes", label: "Pendientes por cobrar" },
  { value: "pagados", label: "Pagados" },
];

const STAGE_SCOPE_OPTIONS: ReadonlyArray<{
  value: IngresosStageScope;
  label: string;
}> = [
  { value: "all_submitted", label: "Todos los enviados" },
  { value: "from_step", label: "A partir de una etapa" },
  { value: "exact_step", label: "Solo una etapa" },
];

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-800">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-slate-950" title={hint}>
        {value}
      </p>
    </div>
  );
}

function formatPeriodoLabel(filters: IngresosFilters): string {
  if (!filters.fechaDesde && !filters.fechaHasta) return "Todo el historial";
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}/${y}`;
  };
  if (filters.fechaDesde && filters.fechaHasta) {
    return `${fmt(filters.fechaDesde)} — ${fmt(filters.fechaHasta)}`;
  }
  return filters.fechaDesde ?? filters.fechaHasta ?? "—";
}

function fuenteLabel(f: string | null | undefined): string {
  if (f === "mesa_actualizado") return "Actualizado por Mesa";
  if (f === "datos_generales") return "Datos Generales";
  return "—";
}

function filtersFromUi(ui: IngresosFilterUiState): IngresosFilters {
  const bounds = resolveIngresosPeriodBounds({
    preset: ui.preset,
    customFrom: ui.customFrom,
    customTo: ui.customTo,
  });
  return {
    fechaDesde: bounds.fechaDesde,
    fechaHasta: bounds.fechaHasta,
    asesorIds: ui.selectedAsesorIds,
    montoFuente: ui.montoFuente,
    porcentajes: ui.porcentajes,
    stageScope: ui.stageScope,
    visibleStep:
      ui.stageScope === "all_submitted" ? null : ui.visibleStep,
    estado: ui.estado,
    buscar: ui.buscar,
  };
}

export function AdminIngresosSection({
  asesorOptions,
}: {
  asesorOptions: readonly AsesorOption[];
}) {
  const panelId = useId();
  const [panelOpen, setPanelOpen] = useState(false);
  const [ui, setUi] = useState<IngresosFilterUiState>(() =>
    resetIngresosFilterUi(),
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<IngresosResumen | null>(null);
  const [items, setItems] = useState<readonly IngresosDetalleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(25);
  const [excelBusy, setExcelBusy] = useState(false);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [excelModalOpen, setExcelModalOpen] = useState(false);
  const [excelConfig, setExcelConfig] = useState<IngresosExcelExportConfig>(() =>
    recommendedIngresosExcelConfig(),
  );

  const filters = useMemo(() => filtersFromUi(ui), [ui]);
  const filtersDefault = isIngresosFilterUiDefault(ui);

  const pasoLabel = useMemo(() => {
    if (ui.visibleStep == null) return null;
    return (
      ADMIN_REPORT_PASO_OPTIONS.find((p) => p.value === ui.visibleStep)?.label ??
      `Paso ${ui.visibleStep}`
    );
  }, [ui.visibleStep]);

  const alcanceSummary = buildIngresosAlcanceSummary({
    stageScope: ui.stageScope,
    visibleStep: ui.visibleStep,
    pasoLabel,
  });

  const patchUi = useCallback(
    (patch: Partial<IngresosFilterUiState>, resetPage = true) => {
      setUi((prev) => ({
        ...prev,
        ...patch,
        ...(resetPage ? { page: 1 } : {}),
      }));
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (ui.preset === "personalizado") {
        resolveIngresosPeriodBounds({
          preset: ui.preset,
          customFrom: ui.customFrom,
          customTo: ui.customTo,
        });
      }
      if (
        (ui.stageScope === "from_step" || ui.stageScope === "exact_step") &&
        (ui.visibleStep == null || ui.visibleStep < 1 || ui.visibleStep > 11)
      ) {
        throw new AdminIngresosError(
          "Selecciona una etapa visible (1–11) para el alcance elegido.",
        );
      }
      const [r, p] = await Promise.all([
        fetchIngresosResumen(filters),
        fetchIngresosPage(filters, ui.page, pageSize),
      ]);
      setResumen(r);
      setItems(p.items);
      setTotal(p.total);
    } catch (err) {
      setResumen(null);
      setItems([]);
      setTotal(0);
      setError(
        err instanceof AdminIngresosError
          ? err.message
          : err instanceof Error
            ? err.message
            : "No se pudieron cargar los ingresos.",
      );
    } finally {
      setLoading(false);
    }
  }, [filters, ui.page, pageSize, ui.preset, ui.customFrom, ui.customTo, ui.stageScope, ui.visibleStep]);

  useEffect(() => {
    if (!panelOpen) return;
    void load();
  }, [panelOpen, load]);

  const toggleAsesor = (id: string) => {
    patchUi({
      selectedAsesorIds: ui.selectedAsesorIds.includes(id)
        ? ui.selectedAsesorIds.filter((x) => x !== id)
        : [...ui.selectedAsesorIds, id],
    });
  };

  const selectAllAsesores = () => {
    patchUi({ selectedAsesorIds: asesorOptions.map((a) => a.id) });
  };

  const clearAsesores = () => {
    patchUi({ selectedAsesorIds: [] });
  };

  const handleResetFilters = () => {
    setUi(resetIngresosFilterUi());
  };

  const runExcelExport = useCallback(
    async (config: IngresosExcelExportConfig) => {
      const validation = validateIngresosExcelConfig(config);
      if (!validation.ok) {
        setExcelError(validation.message);
        return;
      }
      if (excelBusy) return;

      const filterSnapshot = filtersFromUi(ui);
      const asesorNombres = asesorOptions
        .filter((a) => filterSnapshot.asesorIds.includes(a.id))
        .map((a) => a.nombre);
      const alcanceLabel = buildIngresosAlcanceSummary({
        stageScope: filterSnapshot.stageScope,
        visibleStep: filterSnapshot.visibleStep,
        pasoLabel:
          filterSnapshot.visibleStep != null
            ? ADMIN_REPORT_PASO_OPTIONS.find(
                (p) => p.value === filterSnapshot.visibleStep,
              )?.label
            : null,
      });

      setExcelBusy(true);
      setExcelError(null);
      try {
        const bundle = await fetchIngresosExportBundle(filterSnapshot);
        const now = new Date();
        const generatedAtLabel = now.toLocaleString("es-MX", {
          timeZone: "America/Monterrey",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const wb = buildAdminIngresosWorkbook({
          config,
          resumen: bundle.resumen,
          items: bundle.items,
          filterRows: buildIngresosFilterLabelRows({
            filters: filterSnapshot,
            asesorNombres,
            alcanceLabel,
            periodoLabel: formatPeriodoLabel(filterSnapshot),
          }),
          meta: {
            generatedAtLabel,
            actorNombre: bundle.exportMeta.actor_nombre?.trim() || "Super Admin",
            orgNombre:
              bundle.exportMeta.organization_nombre?.trim() || "ConCasa",
            periodoLabel: formatPeriodoLabel(filterSnapshot),
            timezone: bundle.exportMeta.timezone || "America/Monterrey",
          },
          filters: filterSnapshot,
        });
        const filename = buildIngresosExcelFilename({
          now,
          reportName: config.reportName,
          asesorSlug:
            asesorNombres.length === 1 ? asesorNombres[0] : null,
        });
        await downloadAdminIngresosWorkbook(wb, filename);
        setExcelModalOpen(false);
        setExcelConfig(config);
      } catch (err) {
        setExcelError(
          err instanceof AdminIngresosError
            ? err.message
            : "No se pudo generar el Excel. Intenta nuevamente.",
        );
      } finally {
        setExcelBusy(false);
      }
    },
    [asesorOptions, excelBusy, ui],
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const needsStepSelector =
    ui.stageScope === "from_step" || ui.stageScope === "exact_step";

  return (
    <section
      className="mt-8 rounded-xl border border-emerald-200/80 bg-emerald-50/30 p-4"
      data-testid="admin-ingresos-section"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Ingresos</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-800">
            Proyectado y real por expediente (`monto × %`). Independiente de
            producción y del tope administrativo Mejoravit.
          </p>
          <p className="mt-1 text-xs text-slate-700" title={INGRESOS_TOPE_TOOLTIP}>
            {INGRESOS_FECHA_EXPLICACION}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {panelOpen ? (
            <>
              <Button
                type="button"
                className="h-9"
                disabled={excelBusy || loading}
                onClick={() => void runExcelExport(recommendedIngresosExcelConfig())}
                data-testid="admin-ingresos-excel-download"
              >
                {excelBusy ? "Preparando Excel…" : "Descargar Excel"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={excelBusy || loading}
                onClick={() => {
                  setExcelConfig(recommendedIngresosExcelConfig());
                  setExcelModalOpen(true);
                }}
                data-testid="admin-ingresos-excel-customize"
              >
                Personalizar Excel
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-9"
            aria-expanded={panelOpen}
            aria-controls={panelId}
            onClick={() => setPanelOpen((v) => !v)}
            data-testid="admin-ingresos-toggle"
          >
            {panelOpen ? "Ocultar ingresos" : "Ver ingresos"}
          </Button>
        </div>
      </div>

      {excelError ? (
        <p className="mt-2 text-sm text-red-700" data-testid="admin-ingresos-excel-error">
          {excelError}
        </p>
      ) : null}

      <AdminIngresosExcelCustomizeModal
        open={excelModalOpen}
        initialConfig={excelConfig}
        busy={excelBusy}
        onClose={() => {
          if (!excelBusy) setExcelModalOpen(false);
        }}
        onConfirm={(cfg) => void runExcelExport(cfg)}
      />

      {panelOpen ? (
        <div id={panelId} className="mt-4 space-y-4">
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 text-slate-900 md:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs font-semibold text-slate-900">
              Periodo
              <Select
                className="mt-1 text-slate-900"
                value={ui.preset}
                options={[...PRESET_OPTIONS]}
                onChange={(e) => {
                  patchUi({
                    preset: e.target.value as IngresosPeriodPreset,
                  });
                }}
                data-testid="admin-ingresos-preset"
              />
            </label>
            {ui.preset === "personalizado" ? (
              <>
                <label className="block text-xs font-semibold text-slate-900">
                  Desde
                  <Input
                    type="date"
                    className="mt-1 text-slate-900"
                    value={ui.customFrom}
                    onChange={(e) => patchUi({ customFrom: e.target.value })}
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-900">
                  Hasta
                  <Input
                    type="date"
                    className="mt-1 text-slate-900"
                    value={ui.customTo}
                    onChange={(e) => patchUi({ customTo: e.target.value })}
                  />
                </label>
              </>
            ) : null}

            <label className="block text-xs font-semibold text-slate-900">
              Alcance de etapa
              <Select
                className="mt-1 text-slate-900"
                value={ui.stageScope}
                options={[...STAGE_SCOPE_OPTIONS]}
                onChange={(e) => {
                  const next = e.target.value as IngresosStageScope;
                  patchUi({
                    stageScope: next,
                    visibleStep:
                      next === "all_submitted"
                        ? null
                        : (ui.visibleStep ?? 1),
                  });
                }}
                data-testid="admin-ingresos-stage-scope"
              />
            </label>

            {needsStepSelector ? (
              <label className="block text-xs font-semibold text-slate-900">
                {ui.stageScope === "from_step" ? "Etapa mínima" : "Etapa exacta"}
                <Select
                  className="mt-1 text-slate-900"
                  value={String(ui.visibleStep ?? "")}
                  options={ADMIN_REPORT_PASO_OPTIONS.map((p) => ({
                    value: String(p.value),
                    label: p.label,
                  }))}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    patchUi({
                      visibleStep: Number.isFinite(n) ? n : null,
                    });
                  }}
                  data-testid="admin-ingresos-visible-step"
                />
              </label>
            ) : null}

            <label className="block text-xs font-semibold text-slate-900">
              Fuente del monto
              <Select
                className="mt-1 text-slate-900"
                value={ui.montoFuente}
                options={[
                  { value: "todas", label: "Todas" },
                  { value: "mesa_actualizado", label: "Actualizado por Mesa" },
                  { value: "datos_generales", label: "Datos Generales" },
                ]}
                onChange={(e) => {
                  patchUi({
                    montoFuente: e.target.value as IngresosFilters["montoFuente"],
                  });
                }}
              />
            </label>

            <label className="block text-xs font-semibold text-slate-900">
              Estado
              <Select
                className="mt-1 text-slate-900"
                value={ui.estado}
                options={[...ESTADO_OPTIONS]}
                onChange={(e) => {
                  patchUi({
                    estado: e.target.value as IngresosEstadoFiltro,
                  });
                }}
              />
            </label>

            <label className="block text-xs font-semibold text-slate-900 md:col-span-2">
              Buscar cliente / NSS
              <Input
                className="mt-1 text-slate-900"
                value={ui.buscar}
                onChange={(e) => patchUi({ buscar: e.target.value })}
                placeholder="Nombre o NSS"
              />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 text-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-950">Asesores</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={selectAllAsesores}
                  disabled={asesorOptions.length === 0}
                  data-testid="admin-ingresos-asesores-all"
                >
                  Seleccionar todos
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={clearAsesores}
                  disabled={ui.selectedAsesorIds.length === 0}
                  data-testid="admin-ingresos-asesores-clear"
                >
                  Limpiar selección
                </Button>
              </div>
            </div>
            <div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto">
              {asesorOptions.map((a) => {
                const on = ui.selectedAsesorIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={on}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium ring-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
                      on
                        ? "bg-emerald-100 text-emerald-950 ring-emerald-400"
                        : "bg-slate-100 text-slate-950 ring-slate-300"
                    }`}
                    onClick={() => toggleAsesor(a.id)}
                  >
                    {a.nombre}
                  </button>
                );
              })}
              {asesorOptions.length === 0 ? (
                <span className="text-xs text-slate-700">Sin catálogo de asesores</span>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] text-slate-700">
              Sin selección = todos los asesores.
            </p>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-3xl text-xs text-slate-800" data-testid="admin-ingresos-alcance-summary">
              <p>{alcanceSummary}</p>
              <p className="mt-1 text-slate-700">
                Rechazados activos y cancelados quedan fuera.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={filtersDefault || loading}
              onClick={handleResetFilters}
              data-testid="admin-ingresos-reset"
            >
              Restablecer filtros
            </Button>
          </div>

          {loading ? (
            <p className="text-sm text-slate-800" data-testid="admin-ingresos-loading">
              Cargando ingresos…
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-red-700" data-testid="admin-ingresos-error">
              {error}
            </p>
          ) : null}

          {!loading && !error && resumen ? (
            <>
              <div
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                data-testid="admin-ingresos-kpis"
                title={INGRESOS_TOPE_TOOLTIP}
              >
                <KpiCard
                  label="Ingreso proyectado"
                  value={formatMontoMX(resumen.ingreso_proyectado)}
                />
                <KpiCard
                  label="Ingreso real"
                  value={formatMontoMX(resumen.ingreso_real)}
                />
                <KpiCard
                  label="Pendiente por cobrar"
                  value={formatMontoMX(resumen.pendiente_por_cobrar)}
                />
                <KpiCard
                  label="Cumplimiento"
                  value={`${resumen.cumplimiento_pct}%`}
                />
                <KpiCard
                  label="Expedientes proyectados"
                  value={String(resumen.expedientes_proyectados)}
                />
                <KpiCard
                  label="Expedientes pagados"
                  value={String(resumen.expedientes_pagados)}
                />
              </div>

              {resumen.sin_datos_cobro.total > 0 ? (
                <div
                  className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
                  data-testid="admin-ingresos-incompletos"
                >
                  <p className="font-semibold">Expedientes sin datos de cobro</p>
                  <p className="mt-1 text-xs">
                    Sin %: {resumen.sin_datos_cobro.sin_porcentaje} · Sin monto:{" "}
                    {resumen.sin_datos_cobro.sin_monto} · Sin ambos:{" "}
                    {resumen.sin_datos_cobro.sin_ambos}
                  </p>
                  <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs">
                    {resumen.sin_datos_cobro.items.slice(0, 20).map((it) => (
                      <li key={it.expediente_id}>
                        <Link
                          className="underline"
                          href={`/admin/${it.expediente_id}`}
                        >
                          {it.cliente_nombre ?? it.expediente_id}
                        </Link>{" "}
                        ({it.reason})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-slate-900">
                  <h3 className="text-sm font-semibold text-slate-950">Por asesor</h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full text-left text-xs text-slate-900">
                      <thead className="text-slate-800">
                        <tr>
                          <th className="py-1 pr-2 font-semibold">Asesor</th>
                          <th className="py-1 pr-2 font-semibold">Exp.</th>
                          <th className="py-1 pr-2 font-semibold">Proyectado</th>
                          <th className="py-1 pr-2 font-semibold">Real</th>
                          <th className="py-1 pr-2 font-semibold">Pendiente</th>
                          <th className="py-1 font-semibold">%</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-900">
                        {resumen.por_asesor.map((r) => (
                          <tr key={r.asesor_id} className="border-t border-slate-100">
                            <td className="py-1 pr-2 text-slate-900">{r.asesor_nombre}</td>
                            <td className="py-1 pr-2 text-slate-900">{r.expedientes}</td>
                            <td className="py-1 pr-2 text-slate-950 font-medium">
                              {formatMontoMX(r.ingreso_proyectado)}
                            </td>
                            <td className="py-1 pr-2 text-slate-950 font-medium">
                              {formatMontoMX(r.ingreso_real)}
                            </td>
                            <td className="py-1 pr-2 text-slate-950 font-medium">
                              {formatMontoMX(r.pendiente)}
                            </td>
                            <td className="py-1 text-slate-950 font-medium">
                              {r.cumplimiento_pct}%
                            </td>
                          </tr>
                        ))}
                        {resumen.por_asesor.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-2 text-slate-700">
                              Sin datos
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-slate-900">
                    <h3 className="text-sm font-semibold text-slate-950">
                      Por % de cobro
                    </h3>
                    <ul className="mt-2 space-y-1 text-xs text-slate-900">
                      {resumen.por_porcentaje.map((r) => (
                        <li key={String(r.porcentaje_cobro)} className="text-slate-900">
                          {r.porcentaje_cobro}% · {r.expedientes} exp. ·{" "}
                          {formatMontoMX(r.ingreso_proyectado)}
                        </li>
                      ))}
                      {resumen.por_porcentaje.length === 0 ? (
                        <li className="text-slate-700">Sin datos</li>
                      ) : null}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-slate-900">
                    <h3 className="text-sm font-semibold text-slate-950">
                      Por fuente de monto
                    </h3>
                    <ul className="mt-2 space-y-1 text-xs text-slate-900">
                      {resumen.por_fuente_monto.map((r) => (
                        <li key={r.monto_fuente} className="text-slate-900">
                          {fuenteLabel(r.monto_fuente)} · {r.expedientes} exp. ·{" "}
                          {formatMontoMX(r.ingreso_proyectado)}
                        </li>
                      ))}
                      {resumen.por_fuente_monto.length === 0 ? (
                        <li className="text-slate-700">Sin datos</li>
                      ) : null}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3 text-slate-900">
                    <h3 className="text-sm font-semibold text-slate-950">Tendencia</h3>
                    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-slate-900">
                      {resumen.tendencia.map((t) => (
                        <li key={t.fecha} className="text-slate-900">
                          {t.fecha}: proy {formatMontoMX(t.proyectado)} · real{" "}
                          {formatMontoMX(t.real)}
                        </li>
                      ))}
                      {resumen.tendencia.length === 0 ? (
                        <li className="text-slate-700">Sin puntos en el rango</li>
                      ) : null}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3 text-slate-900">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">
                    Detalle ({total})
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-900">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      disabled={ui.page <= 1 || loading}
                      onClick={() => patchUi({ page: Math.max(1, ui.page - 1) }, false)}
                    >
                      Anterior
                    </Button>
                    <span className="font-medium text-slate-900">
                      {ui.page} / {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      disabled={ui.page >= totalPages || loading}
                      onClick={() => patchUi({ page: ui.page + 1 }, false)}
                    >
                      Siguiente
                    </Button>
                  </div>
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-left text-xs text-slate-900" data-testid="admin-ingresos-detalle">
                    <thead className="text-slate-800">
                      <tr>
                        <th className="py-1 pr-2 font-semibold">Cliente</th>
                        <th className="py-1 pr-2 font-semibold">Asesor</th>
                        <th className="py-1 pr-2 font-semibold">Envío Mesa</th>
                        <th className="py-1 pr-2 font-semibold">Fuente</th>
                        <th className="py-1 pr-2 font-semibold">Cálculo</th>
                        <th className="py-1 pr-2 font-semibold">Proyectado</th>
                        <th className="py-1 pr-2 font-semibold">Real</th>
                        <th className="py-1 font-semibold">Pendiente</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-900">
                      {items.map((it) => (
                        <tr key={it.expediente_id} className="border-t border-slate-100">
                          <td className="py-1 pr-2">
                            <Link
                              className="font-medium text-sky-900 underline"
                              href={`/admin/${it.expediente_id}`}
                            >
                              {it.cliente_nombre ?? "—"}
                            </Link>
                            <div className="text-[10px] text-slate-700">
                              {it.nss ?? ""}
                              {it.paso_visual != null
                                ? ` · Paso ${it.paso_visual}`
                                : ""}
                            </div>
                          </td>
                          <td className="py-1 pr-2 text-slate-900">{it.asesor_nombre ?? "—"}</td>
                          <td className="py-1 pr-2 text-slate-900">
                            {it.fecha_envio_mesa
                              ? formatDateTimeMx(it.fecha_envio_mesa)
                              : "—"}
                          </td>
                          <td className="py-1 pr-2 text-slate-900">
                            {fuenteLabel(it.monto_fuente)}
                            {it.is_historical_estimate ? (
                              <span
                                className="ml-1 font-medium text-amber-900"
                                title={INGRESOS_HISTORICO_ESTIMADO_TOOLTIP}
                              >
                                (est.)
                              </span>
                            ) : null}
                          </td>
                          <td className="py-1 pr-2 text-slate-900" title={INGRESOS_TOPE_TOOLTIP}>
                            {it.calculo ?? "—"}
                          </td>
                          <td className="py-1 pr-2 font-medium text-slate-950">
                            {it.ingreso_proyectado != null
                              ? formatMontoMX(it.ingreso_proyectado)
                              : "—"}
                          </td>
                          <td className="py-1 pr-2 font-medium text-slate-950">
                            {it.ingreso_real != null
                              ? formatMontoMX(it.ingreso_real)
                              : "—"}
                          </td>
                          <td className="py-1 font-medium text-slate-950">
                            {it.pendiente != null ? formatMontoMX(it.pendiente) : "—"}
                          </td>
                        </tr>
                      ))}
                      {items.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-3 text-slate-700" data-testid="admin-ingresos-empty">
                            Sin expedientes en el rango.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
