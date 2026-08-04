"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  asesoresCatalogFromReport,
  fetchAdminReportAsesoresCatalog,
} from "@/domain/admin-report-asesores-etapas";
import {
  ADMIN_STAGE_HISTORY_ALL_PASO_VALUES,
  ADMIN_STAGE_HISTORY_ESTADO_OPTIONS,
  ADMIN_STAGE_HISTORY_MOVIMIENTO_OPTIONS,
  ADMIN_STAGE_HISTORY_PASO_OPTIONS,
  DEFAULT_ADMIN_STAGE_HISTORY_MOVIMIENTO,
  DEFAULT_ADMIN_STAGE_HISTORY_PAGE_SIZE,
  AdminStageHistoryError,
  adminStageHistoryRequiresFechas,
  canConsultAdminStageHistory,
  fetchAdminStageHistoryAllItems,
  fetchAdminStageHistoryPage,
  fetchAdminStageHistorySummary,
  formatAdminStageHistoryMetaSummary,
  formatAdminStageHistoryTimestamp,
  formatDurationSeconds,
  formatHistoryCoverageFrom,
  labelAdminStageHistoryResultado,
  validateAdminStageHistoryFechaRango,
  type AdminStageHistoryEstado,
  type AdminStageHistoryFilters,
  type AdminStageHistoryItem,
  type AdminStageHistoryMovimiento,
  type AdminStageHistoryPage,
  type AdminStageHistorySummary,
} from "@/domain/admin-stage-history";
import {
  buildAdminStageHistoryFilename,
  buildAdminStageHistoryWorkbook,
  downloadAdminStageHistoryWorkbook,
  todayYmdLocal,
} from "@/lib/exportAdminStageHistoryExcel";

type AsesorOption = Readonly<{ id: string; nombre: string; email: string | null }>;

function toggleId(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function togglePaso(list: readonly number[], paso: number): number[] {
  return list.includes(paso) ? list.filter((x) => x !== paso) : [...list, paso].sort((a, b) => a - b);
}

function etapaActualLabel(item: AdminStageHistoryItem): string {
  if (item.paso_actual != null) {
    return `Paso ${item.paso_actual}`;
  }
  if (item.etapa_actual != null) {
    return `Etapa ${item.etapa_actual}`;
  }
  return "—";
}

export function AdminReporteExpedientesSection() {
  const panelId = useId();
  const [panelOpen, setPanelOpen] = useState(false);

  const [asesorOptions, setAsesorOptions] = useState<readonly AsesorOption[]>([]);
  const [asesorSearch, setAsesorSearch] = useState("");
  const [selectedAsesorIds, setSelectedAsesorIds] = useState<readonly string[]>([]);
  const [selectedPasos, setSelectedPasos] = useState<readonly number[]>([]);
  const [movimiento, setMovimiento] = useState<AdminStageHistoryMovimiento>(
    DEFAULT_ADMIN_STAGE_HISTORY_MOVIMIENTO,
  );
  const [estadoActual, setEstadoActual] = useState<AdminStageHistoryEstado>("todos");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [buscar, setBuscar] = useState("");

  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AdminStageHistorySummary | null>(null);
  const [pageData, setPageData] = useState<AdminStageHistoryPage | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [consultedFilters, setConsultedFilters] = useState<AdminStageHistoryFilters | null>(
    null,
  );
  const [exporting, setExporting] = useState(false);
  const exportBusyRef = useRef(false);
  const optionsLoadedRef = useRef(false);

  const filtersDraft: AdminStageHistoryFilters = useMemo(
    () => ({
      asesorIds: selectedAsesorIds,
      pasosVisuales: selectedPasos,
      movimiento,
      estadoActual,
      fechaDesde: fechaDesde.trim() || null,
      fechaHasta: fechaHasta.trim() || null,
      buscar: buscar.trim() || null,
    }),
    [
      selectedAsesorIds,
      selectedPasos,
      movimiento,
      estadoActual,
      fechaDesde,
      fechaHasta,
      buscar,
    ],
  );

  const consultEnabled = canConsultAdminStageHistory(filtersDraft) && !loading && !loadingPage;
  const requiereFechas = adminStageHistoryRequiresFechas(movimiento);
  const rangoActivo = Boolean(fechaDesde.trim() || fechaHasta.trim());

  useEffect(() => {
    if (optionsLoadedRef.current) return;
    optionsLoadedRef.current = true;
    let cancelled = false;
    void (async () => {
      setLoadingOptions(true);
      try {
        const data = await fetchAdminReportAsesoresCatalog();
        if (!cancelled) {
          setAsesorOptions(asesoresCatalogFromReport(data));
        }
      } catch {
        if (!cancelled) setAsesorOptions([]);
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredAsesorOptions = useMemo(() => {
    const q = asesorSearch.trim().toLowerCase();
    if (!q) return asesorOptions;
    return asesorOptions.filter(
      (a) =>
        a.nombre.toLowerCase().includes(q) ||
        (a.email ?? "").toLowerCase().includes(q),
    );
  }, [asesorOptions, asesorSearch]);

  const coverageLabel = useMemo(() => {
    const from = summary?.history_coverage_from ?? pageData?.history_coverage_from;
    return from ? formatHistoryCoverageFrom(from) : null;
  }, [summary, pageData]);

  const loadPage = useCallback(
    async (filters: AdminStageHistoryFilters, page: number) => {
      setLoadingPage(true);
      setError(null);
      try {
        const data = await fetchAdminStageHistoryPage(
          filters,
          page,
          DEFAULT_ADMIN_STAGE_HISTORY_PAGE_SIZE,
        );
        setPageData(data);
        setCurrentPage(page);
      } catch (err) {
        setError(
          err instanceof AdminStageHistoryError
            ? err.message
            : "No se pudo cargar el detalle paginado.",
        );
      } finally {
        setLoadingPage(false);
      }
    },
    [],
  );

  const handleConsultar = useCallback(async () => {
    const fechaCheck = validateAdminStageHistoryFechaRango(
      filtersDraft.fechaDesde,
      filtersDraft.fechaHasta,
    );
    if (!fechaCheck.ok) {
      setError(fechaCheck.message);
      return;
    }
    if (!canConsultAdminStageHistory(filtersDraft)) {
      setError(
        requiereFechas
          ? "Selecciona asesores, etapas y rango de fechas (usa Todos/Todas si aplica)."
          : "Selecciona al menos un asesor y una etapa (usa Todos/Todas si aplica).",
      );
      return;
    }

    setLoading(true);
    setError(null);
    setCurrentPage(1);
    try {
      const [summaryData, pageResult] = await Promise.all([
        fetchAdminStageHistorySummary(filtersDraft),
        fetchAdminStageHistoryPage(
          filtersDraft,
          1,
          DEFAULT_ADMIN_STAGE_HISTORY_PAGE_SIZE,
        ),
      ]);
      setSummary(summaryData);
      setPageData(pageResult);
      setConsultedFilters(filtersDraft);
    } catch (err) {
      setSummary(null);
      setPageData(null);
      setConsultedFilters(null);
      setError(
        err instanceof AdminStageHistoryError
          ? err.message
          : "No se pudo cargar el reporte.",
      );
    } finally {
      setLoading(false);
    }
  }, [filtersDraft, requiereFechas]);

  const handleLimpiarFiltros = useCallback(() => {
    setSelectedAsesorIds([]);
    setSelectedPasos([]);
    setAsesorSearch("");
    setMovimiento(DEFAULT_ADMIN_STAGE_HISTORY_MOVIMIENTO);
    setEstadoActual("todos");
    setFechaDesde("");
    setFechaHasta("");
    setBuscar("");
    setError(null);
    setSummary(null);
    setPageData(null);
    setConsultedFilters(null);
    setCurrentPage(1);
  }, []);

  const handleQuitarRango = useCallback(() => {
    setFechaDesde("");
    setFechaHasta("");
    setError(null);
  }, []);

  const handlePageChange = useCallback(
    (page: number) => {
      if (!consultedFilters || loading || loadingPage) return;
      void loadPage(consultedFilters, page);
    },
    [consultedFilters, loadPage, loading, loadingPage],
  );

  const handleDownload = useCallback(() => {
    if (!summary || !consultedFilters || exportBusyRef.current) return;
    exportBusyRef.current = true;
    setExporting(true);
    void (async () => {
      try {
        const items = await fetchAdminStageHistoryAllItems(consultedFilters);
        const wb = buildAdminStageHistoryWorkbook({ summary, items });
        const filename = buildAdminStageHistoryFilename(todayYmdLocal());
        await downloadAdminStageHistoryWorkbook(wb, filename);
      } catch {
        setError("No se pudo generar el Excel del reporte histórico.");
      } finally {
        exportBusyRef.current = false;
        setExporting(false);
      }
    })();
  }, [summary, consultedFilters]);

  const totalPages = pageData
    ? Math.max(1, Math.ceil(pageData.total / pageData.page_size))
    : 1;

  const hasResults =
    summary != null && summary.totales.total_visitas > 0;

  return (
    <section
      id="admin-reporte-expedientes"
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${
        panelOpen ? "p-4" : "px-4 py-3"
      }`}
    >
      {!panelOpen ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              Reporte histórico de etapas
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Entradas, avances y permanencia por etapa
            </p>
            {summary ? (
              <p className="mt-1 text-xs font-medium text-slate-700">
                {formatAdminStageHistoryMetaSummary(summary, consultedFilters)}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            aria-expanded={false}
            aria-controls={panelId}
            onClick={() => setPanelOpen(true)}
          >
            Abrir reporte
          </Button>
        </div>
      ) : null}

      <div
        id={panelId}
        role="region"
        aria-label="Contenido del reporte histórico de etapas"
        hidden={!panelOpen}
        className={panelOpen ? "space-y-4" : undefined}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Reporte histórico de etapas
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Consulta qué expedientes entraron, avanzaron o permanecieron en cada
              etapa durante el periodo seleccionado.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!summary || !consultedFilters || exporting || loading}
              onClick={handleDownload}
            >
              {exporting ? "Generando…" : "Descargar Excel"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              aria-expanded={true}
              aria-controls={panelId}
              onClick={() => setPanelOpen(false)}
              className="inline-flex items-center gap-1.5"
            >
              <span aria-hidden="true" className="text-base leading-none">
                ×
              </span>
              Cerrar
            </Button>
          </div>
        </div>

        {coverageLabel ? (
          <p
            role="status"
            className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-950"
          >
            Historial disponible desde {coverageLabel}
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-800">Asesores</p>
              <button
                type="button"
                className="text-xs text-blue-700 underline"
                onClick={() =>
                  setSelectedAsesorIds(asesorOptions.map((a) => a.id))
                }
              >
                Todos
              </button>
            </div>
            <Input
              id="admin-stage-history-asesor-search"
              label="Buscar asesor"
              value={asesorSearch}
              onChange={(e) => setAsesorSearch(e.target.value)}
              placeholder="Nombre o correo"
            />
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
              {loadingOptions ? (
                <p className="text-xs text-slate-500">Cargando asesores…</p>
              ) : filteredAsesorOptions.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Sin asesores con expedientes vigentes.
                </p>
              ) : (
                filteredAsesorOptions.map((a) => (
                  <label
                    key={a.id}
                    className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedAsesorIds.includes(a.id)}
                      onChange={() =>
                        setSelectedAsesorIds((prev) => toggleId(prev, a.id))
                      }
                    />
                    <span>
                      <span className="block text-slate-800">{a.nombre}</span>
                      {a.email ? (
                        <span className="block text-xs text-slate-500">
                          {a.email}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))
              )}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {selectedAsesorIds.length === 0
                ? "Selección: ninguna"
                : `Seleccionados: ${selectedAsesorIds.length}`}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-800">Etapas</p>
              <button
                type="button"
                className="text-xs text-blue-700 underline"
                onClick={() =>
                  setSelectedPasos([...ADMIN_STAGE_HISTORY_ALL_PASO_VALUES])
                }
              >
                Todas
              </button>
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto text-sm">
              {ADMIN_STAGE_HISTORY_PASO_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedPasos.includes(opt.value)}
                    onChange={() =>
                      setSelectedPasos((prev) => togglePaso(prev, opt.value))
                    }
                  />
                  <span className="text-slate-800">{opt.label}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {selectedPasos.length === 0
                ? "Selección: ninguna"
                : `Seleccionados: ${selectedPasos.length}`}
              {" · "}Paso 3 incluye internas 3 y 4
            </p>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <Select
              id="admin-stage-history-movimiento"
              label="Tipo de movimiento"
              value={movimiento}
              options={[...ADMIN_STAGE_HISTORY_MOVIMIENTO_OPTIONS]}
              onChange={(e) =>
                setMovimiento(e.target.value as AdminStageHistoryMovimiento)
              }
            />
            <Select
              id="admin-stage-history-estado"
              label="Estado actual"
              value={estadoActual}
              options={[...ADMIN_STAGE_HISTORY_ESTADO_OPTIONS]}
              onChange={(e) =>
                setEstadoActual(e.target.value as AdminStageHistoryEstado)
              }
            />
            <Input
              id="admin-stage-history-buscar"
              label="Búsqueda"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Cliente, NSS, asesor, programa…"
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800">
                  Rango de fechas
                  {requiereFechas ? (
                    <span className="ml-1 text-red-600">*</span>
                  ) : (
                    <span className="ml-1 text-xs font-normal text-slate-500">
                      (no aplica en referencia)
                    </span>
                  )}
                </p>
                {rangoActivo ? (
                  <button
                    type="button"
                    className="text-xs text-blue-700 underline"
                    onClick={handleQuitarRango}
                  >
                    Quitar rango
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  id="admin-stage-history-fecha-desde"
                  label="Desde"
                  type="date"
                  value={fechaDesde}
                  onChange={(e) => setFechaDesde(e.target.value)}
                />
                <Input
                  id="admin-stage-history-fecha-hasta"
                  label="Hasta"
                  type="date"
                  value={fechaHasta}
                  onChange={(e) => setFechaHasta(e.target.value)}
                />
              </div>
              {requiereFechas ? (
                <p className="text-[11px] text-slate-500">
                  Obligatorio para Entraron, Avanzaron y Estuvieron. Calendario
                  America/Monterrey.
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className="w-full"
                disabled={!consultEnabled}
                onClick={() => void handleConsultar()}
              >
                {loading ? "Consultando…" : "Consultar reporte"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={loading || loadingPage}
                onClick={handleLimpiarFiltros}
              >
                Limpiar filtros
              </Button>
            </div>
            <p className="text-[11px] text-slate-500">
              La consulta no se ejecuta al cambiar filtros; solo al pulsar el botón.
              Usa Todos/Todas para selección explícita completa.
            </p>
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-600" role="status">
            Cargando reporte…
          </p>
        ) : null}

        {!loading && summary && !hasResults ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
            No hay visitas para los filtros consultados.
          </p>
        ) : null}

        {!loading && summary && hasResults ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-slate-800">
              {formatAdminStageHistoryMetaSummary(summary, consultedFilters)}
            </p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <SummaryCard
                label="Expedientes únicos"
                value={summary.totales.total_expedientes_unicos}
              />
              <SummaryCard label="Visitas" value={summary.totales.total_visitas} />
              <SummaryCard label="Avanzaron" value={summary.totales.advanced_count} />
              <SummaryCard label="Continúan" value={summary.totales.current_count} />
              <SummaryCard label="Rechazados" value={summary.totales.rejected_count} />
              <SummaryCard
                label="Permanencia prom."
                value={formatDurationSeconds(summary.totales.avg_duration_seconds)}
                isText
              />
            </div>

            {summary.nota ? (
              <p className="text-xs text-slate-500">{summary.nota}</p>
            ) : null}

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Etapa</th>
                    <th className="px-3 py-2 text-right">Entraron</th>
                    <th className="px-3 py-2 text-right">Avanzaron</th>
                    <th className="px-3 py-2 text-right">Continúan</th>
                    <th className="px-3 py-2 text-right">Rechazados</th>
                    <th className="px-3 py-2 text-right">Visitas</th>
                    <th className="px-3 py-2 text-right">Únicos</th>
                    <th className="px-3 py-2 text-right">Perm. prom.</th>
                    <th className="px-3 py-2 text-right">Tasa avance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.resumen_por_etapa.map((row) => (
                    <tr key={row.paso_visual} className="text-slate-800">
                      <td className="px-3 py-2">
                        Paso {row.paso_visual} · {row.paso_nombre}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.entered_count}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.advanced_count}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.current_count}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.rejected_count}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.visitas}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.expedientes_unicos}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatDurationSeconds(row.avg_duration_seconds)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.tasa_avance != null ? `${row.tasa_avance}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  Detalle de visitas
                </h3>
                {pageData ? (
                  <p className="text-xs text-slate-500">
                    {pageData.total} visita{pageData.total === 1 ? "" : "s"} · página{" "}
                    {currentPage} de {totalPages}
                  </p>
                ) : null}
              </div>

              {loadingPage ? (
                <p className="text-sm text-slate-600" role="status">
                  Cargando detalle…
                </p>
              ) : null}

              {!loadingPage && pageData ? (
                <>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Cliente</th>
                          <th className="px-3 py-2">NSS</th>
                          <th className="px-3 py-2">Asesor</th>
                          <th className="px-3 py-2">Etapa</th>
                          <th className="px-3 py-2">Entrada</th>
                          <th className="px-3 py-2">Salida</th>
                          <th className="px-3 py-2">Permanencia</th>
                          <th className="px-3 py-2">Resultado</th>
                          <th className="px-3 py-2">Etapa actual</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pageData.items.map((item) => (
                          <tr key={item.visita_id} className="text-slate-800">
                            <td className="px-3 py-2">{item.cliente_nombre}</td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {item.nss || "—"}
                            </td>
                            <td className="px-3 py-2">
                              {item.asesor_nombre ?? "—"}
                            </td>
                            <td className="px-3 py-2">
                              Paso {item.paso_visual} · {item.paso_nombre}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-xs">
                              {formatAdminStageHistoryTimestamp(item.entered_at)}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-xs">
                              {formatAdminStageHistoryTimestamp(item.exited_at)}
                            </td>
                            <td className="px-3 py-2 tabular-nums">
                              {formatDurationSeconds(item.duration_seconds)}
                            </td>
                            <td className="px-3 py-2">
                              {labelAdminStageHistoryResultado(item.resultado)}
                            </td>
                            <td className="px-3 py-2">{etapaActualLabel(item)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {totalPages > 1 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="px-3 py-1.5 text-xs"
                        disabled={currentPage <= 1 || loadingPage}
                        onClick={() => handlePageChange(currentPage - 1)}
                      >
                        Anterior
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="px-3 py-1.5 text-xs"
                        disabled={currentPage >= totalPages || loadingPage}
                        onClick={() => handlePageChange(currentPage + 1)}
                      >
                        Siguiente
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {!loading && !summary && !error ? (
          <p className="text-sm text-slate-500">
            Elige filtros y pulsa «Consultar reporte» para ver el resumen y detalle.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  isText = false,
}: Readonly<{
  label: string;
  value: number | string;
  isText?: boolean;
}>) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-0.5 font-semibold text-slate-900 ${
          isText ? "text-sm" : "text-lg tabular-nums"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
