"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  ADMIN_REPORT_ALL_PASO_VALUES,
  ADMIN_REPORT_PASO_OPTIONS,
  ADMIN_REPORT_TIPO_FECHA_OPTIONS,
  DEFAULT_ADMIN_REPORT_TIPO_FECHA,
  AdminReportAsesoresEtapasError,
  asesoresCatalogFromReport,
  canConsultAdminReport,
  detalleForResumenRow,
  fetchAdminReportAsesoresCatalog,
  fetchAdminReportExpedientesAsesoresEtapas,
  formatAdminReportMetaSummary,
  adminReportHasFechaRango,
  adminReportShowsEntradaPasoWarning,
  labelDetalleFechaFiltrada,
  resolveDetalleFechaFiltrada,
  groupAdminReportResumenByAsesor,
  validateAdminReportFechaRango,
  type AdminReportDetalleRow,
  type AdminReportEstado,
  type AdminReportFilters,
  type AdminReportResponse,
  type AdminReportResumenRow,
  type AdminReportTipoFecha,
} from "@/domain/admin-report-asesores-etapas";
import {
  buildAdminReportExpedientesFilename,
  buildAdminReportExpedientesWorkbook,
  downloadAdminReportExpedientesWorkbook,
  todayYmdLocal,
} from "@/lib/exportAdminReportExpedientesExcel";

type AsesorOption = Readonly<{ id: string; nombre: string; email: string | null }>;

const ESTADO_OPTIONS: ReadonlyArray<{ value: AdminReportEstado; label: string }> = [
  { value: "vigentes", label: "Vigentes (activos + rechazados)" },
  { value: "activos", label: "Solo activos" },
  { value: "rechazados", label: "Solo rechazados" },
];

function toggleId(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function togglePaso(list: readonly number[], paso: number): number[] {
  return list.includes(paso) ? list.filter((x) => x !== paso) : [...list, paso].sort((a, b) => a - b);
}

function rowKey(row: AdminReportResumenRow): string {
  return `${row.asesor_id}:${row.paso_visual}`;
}

export function AdminReporteExpedientesSection() {
  const panelId = useId();
  const [panelOpen, setPanelOpen] = useState(false);

  const [asesorOptions, setAsesorOptions] = useState<readonly AsesorOption[]>([]);
  const [asesorSearch, setAsesorSearch] = useState("");
  const [selectedAsesorIds, setSelectedAsesorIds] = useState<readonly string[]>([]);
  const [selectedPasos, setSelectedPasos] = useState<readonly number[]>([]);
  const [estado, setEstado] = useState<AdminReportEstado>("vigentes");
  const [tipoFecha, setTipoFecha] = useState<AdminReportTipoFecha>(
    DEFAULT_ADMIN_REPORT_TIPO_FECHA,
  );
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AdminReportResponse | null>(null);
  const [consultedFilters, setConsultedFilters] = useState<AdminReportFilters | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [exporting, setExporting] = useState(false);
  const exportBusyRef = useRef(false);
  const optionsLoadedRef = useRef(false);

  const filtersDraft: AdminReportFilters = useMemo(
    () => ({
      asesorIds: selectedAsesorIds,
      pasosVisuales: selectedPasos,
      estado,
      tipoFecha,
      fechaDesde: fechaDesde.trim() || null,
      fechaHasta: fechaHasta.trim() || null,
    }),
    [selectedAsesorIds, selectedPasos, estado, tipoFecha, fechaDesde, fechaHasta],
  );

  const consultEnabled = canConsultAdminReport(filtersDraft) && !loading;
  const rangoActivo = adminReportHasFechaRango(filtersDraft);
  const showEntradaPasoWarning = adminReportShowsEntradaPasoWarning(filtersDraft);

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

  const groups = useMemo(
    () => (report ? groupAdminReportResumenByAsesor(report.resumen) : []),
    [report],
  );

  const handleConsultar = useCallback(async () => {
    const fechaCheck = validateAdminReportFechaRango(
      filtersDraft.fechaDesde,
      filtersDraft.fechaHasta,
    );
    if (!fechaCheck.ok) {
      setError(fechaCheck.message);
      return;
    }
    if (!canConsultAdminReport(filtersDraft)) {
      setError("Selecciona al menos un asesor y una etapa (usa Todos/Todas si aplica).");
      return;
    }

    setLoading(true);
    setError(null);
    setExpanded(new Set());
    try {
      const data = await fetchAdminReportExpedientesAsesoresEtapas(filtersDraft);
      setReport(data);
      setConsultedFilters(filtersDraft);
      setAsesorOptions((prev) => {
        const catalog = asesoresCatalogFromReport(data);
        if (catalog.length === 0) return prev;
        const map = new Map(prev.map((a) => [a.id, a]));
        for (const a of catalog) map.set(a.id, a);
        return [...map.values()].sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
      });
    } catch (err) {
      setReport(null);
      setConsultedFilters(null);
      setError(
        err instanceof AdminReportAsesoresEtapasError
          ? err.message
          : "No se pudo cargar el reporte.",
      );
    } finally {
      setLoading(false);
    }
  }, [filtersDraft]);

  const handleLimpiarFiltros = useCallback(() => {
    setSelectedAsesorIds([]);
    setSelectedPasos([]);
    setAsesorSearch("");
    setEstado("vigentes");
    setTipoFecha(DEFAULT_ADMIN_REPORT_TIPO_FECHA);
    setFechaDesde("");
    setFechaHasta("");
    setError(null);
    setReport(null);
    setConsultedFilters(null);
    setExpanded(new Set());
  }, []);

  const handleQuitarRango = useCallback(() => {
    setFechaDesde("");
    setFechaHasta("");
    setError(null);
  }, []);

  const handleToggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleDownload = useCallback(() => {
    if (!report || !consultedFilters || exportBusyRef.current) return;
    exportBusyRef.current = true;
    setExporting(true);
    void (async () => {
      try {
        const wb = buildAdminReportExpedientesWorkbook({
          ...report,
          tipoFecha: consultedFilters.tipoFecha,
        });
        const filename = buildAdminReportExpedientesFilename(todayYmdLocal());
        await downloadAdminReportExpedientesWorkbook(wb, filename);
      } catch {
        setError("No se pudo generar el Excel del reporte.");
      } finally {
        exportBusyRef.current = false;
        setExporting(false);
      }
    })();
  }, [report, consultedFilters]);

  const detalleOf = useCallback(
    (row: AdminReportResumenRow): AdminReportDetalleRow[] =>
      report ? detalleForResumenRow(report.detalle, row) : [],
    [report],
  );

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
              Reporte de expedientes
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Reporte personalizado por asesores y etapas
            </p>
            {report ? (
              <p className="mt-1 text-xs font-medium text-slate-700">
                {formatAdminReportMetaSummary(report.meta, consultedFilters)}
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
        aria-label="Contenido del reporte de expedientes"
        hidden={!panelOpen}
        className={panelOpen ? "space-y-4" : undefined}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Reporte de expedientes
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Fotografía actual por asesor y paso visible (11). Solo Super Admin.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!report || !consultedFilters || exporting || loading}
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
              id="admin-report-asesor-search"
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
                onClick={() => setSelectedPasos([...ADMIN_REPORT_ALL_PASO_VALUES])}
              >
                Todas
              </button>
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto text-sm">
              {ADMIN_REPORT_PASO_OPTIONS.map((opt) => (
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
              id="admin-report-estado"
              label="Estado"
              value={estado}
              options={[...ESTADO_OPTIONS]}
              onChange={(e) => setEstado(e.target.value as AdminReportEstado)}
            />
            <Select
              id="admin-report-tipo-fecha"
              label="Tipo de fecha"
              value={tipoFecha}
              options={[...ADMIN_REPORT_TIPO_FECHA_OPTIONS]}
              onChange={(e) =>
                setTipoFecha(e.target.value as AdminReportTipoFecha)
              }
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800">Rango de fechas</p>
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
                  id="admin-report-fecha-desde"
                  label="Desde"
                  type="date"
                  value={fechaDesde}
                  onChange={(e) => setFechaDesde(e.target.value)}
                />
                <Input
                  id="admin-report-fecha-hasta"
                  label="Hasta"
                  type="date"
                  value={fechaHasta}
                  onChange={(e) => setFechaHasta(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-slate-500">
                {tipoFecha === "envio_mesa"
                  ? "Filtra por la fecha en que el expediente fue enviado a Mesa."
                  : "Filtra por la fecha en que el expediente entró a su paso actual."}
              </p>
              {showEntradaPasoWarning ? (
                <p
                  role="status"
                  className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-950"
                >
                  El rango solo incluye expedientes con fecha canónica registrada.
                  Los expedientes históricos sin esa fecha serán excluidos.
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
                disabled={loading}
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

        {!loading && report && report.meta.expedientes === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
            No hay expedientes para los filtros consultados.
            {(report.meta.excluidos_por_fecha_desconocida ?? 0) > 0
              ? ` ${report.meta.excluidos_por_fecha_desconocida} quedaron fuera por no tener fecha histórica.`
              : ""}
          </p>
        ) : null}

        {!loading && report && report.meta.expedientes > 0 ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-800">
              {formatAdminReportMetaSummary(report.meta, consultedFilters)}
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 w-8" />
                    <th className="px-3 py-2">Asesor</th>
                    <th className="px-3 py-2">Etapa</th>
                    <th className="px-3 py-2 text-right">
                      Cantidad de expedientes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groups.map((group) => (
                    <AsesorGroupRows
                      key={group.asesorId}
                      group={group}
                      expanded={expanded}
                      onToggle={handleToggleExpand}
                      detalleOf={detalleOf}
                      tipoFecha={
                        consultedFilters?.tipoFecha ??
                        report.meta.tipo_fecha ??
                        DEFAULT_ADMIN_REPORT_TIPO_FECHA
                      }
                    />
                  ))}
                  <tr className="bg-slate-100 font-semibold text-slate-900">
                    <td className="px-3 py-2" colSpan={3}>
                      Total general
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {report.meta.expedientes}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!loading && !report && !error ? (
          <p className="text-sm text-slate-500">
            Elige filtros y pulsa «Consultar reporte» para ver la tabla.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function AsesorGroupRows({
  group,
  expanded,
  onToggle,
  detalleOf,
  tipoFecha,
}: Readonly<{
  group: ReturnType<typeof groupAdminReportResumenByAsesor>[number];
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  detalleOf: (row: AdminReportResumenRow) => AdminReportDetalleRow[];
  tipoFecha: AdminReportTipoFecha;
}>) {
  return (
    <>
      {group.rows.map((row) => {
        const key = rowKey(row);
        const open = expanded.has(key);
        const details = open ? detalleOf(row) : [];
        return (
          <FragmentRows
            key={key}
            row={row}
            open={open}
            details={details}
            onToggle={() => onToggle(key)}
            tipoFecha={tipoFecha}
          />
        );
      })}
      <tr className="bg-slate-50 text-slate-700">
        <td className="px-3 py-2" colSpan={3}>
          Subtotal · {group.asesorNombre}
        </td>
        <td className="px-3 py-2 text-right tabular-nums font-medium">
          {group.subtotal}
        </td>
      </tr>
    </>
  );
}

function FragmentRows({
  row,
  open,
  details,
  onToggle,
  tipoFecha,
}: Readonly<{
  row: AdminReportResumenRow;
  open: boolean;
  details: readonly AdminReportDetalleRow[];
  onToggle: () => void;
  tipoFecha: AdminReportTipoFecha;
}>) {
  return (
    <>
      <tr className="text-slate-800">
        <td className="px-3 py-2">
          <button
            type="button"
            className="rounded border border-slate-300 px-1.5 text-xs"
            aria-expanded={open}
            onClick={onToggle}
            title={open ? "Ocultar detalle" : "Ver detalle"}
          >
            {open ? "−" : "+"}
          </button>
        </td>
        <td className="px-3 py-2">{row.asesor_nombre}</td>
        <td className="px-3 py-2">
          Paso {row.paso_visual} · {row.paso_nombre}
          {row.rechazados > 0 ? (
            <span className="ml-2 text-xs font-normal text-slate-500">
              ({row.activos} activos · {row.rechazados} rechazados)
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2 text-right tabular-nums font-medium">
          {row.total}
        </td>
      </tr>
      {open ? (
        <tr className="bg-slate-50/80">
          <td colSpan={4} className="px-3 py-3">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-3">Cliente</th>
                  <th className="py-1 pr-3">NSS</th>
                  <th className="py-1 pr-3">Paso actual</th>
                  <th className="py-1">{labelDetalleFechaFiltrada(tipoFecha)}</th>
                </tr>
              </thead>
              <tbody>
                {details.map((d, idx) => (
                  <tr
                    key={`${d.nss}-${d.cliente_nombre}-${idx}`}
                    className="text-slate-800"
                  >
                    <td className="py-1 pr-3">{d.cliente_nombre}</td>
                    <td className="py-1 pr-3 font-mono">{d.nss || "—"}</td>
                    <td className="py-1 pr-3">
                      Paso {d.paso_visual} · {d.paso_nombre}
                      {d.estado === "rechazado" ? (
                        <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          Rechazado
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1 tabular-nums">
                      {resolveDetalleFechaFiltrada(d, tipoFecha) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}
    </>
  );
}
