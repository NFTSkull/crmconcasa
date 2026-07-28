"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatMontoMX } from "@/lib/monto";
import { formatDateTimeMx } from "@/lib/filters";
import {
  ADMIN_REPORT_PASO_OPTIONS,
} from "@/domain/admin-report-asesores-etapas";
import {
  AdminIngresosError,
  INGRESOS_FECHA_EXPLICACION,
  INGRESOS_HISTORICO_ESTIMADO_TOOLTIP,
  INGRESOS_TOPE_TOOLTIP,
  fetchIngresosPage,
  fetchIngresosResumen,
  resolveIngresosPeriodBounds,
  type IngresosDetalleItem,
  type IngresosEstadoFiltro,
  type IngresosFilters,
  type IngresosPeriodPreset,
  type IngresosResumen,
} from "@/domain/admin-ingresos";

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

function fuenteLabel(f: string | null | undefined): string {
  if (f === "mesa_actualizado") return "Actualizado por Mesa";
  if (f === "datos_generales") return "Datos Generales";
  return "—";
}

export function AdminIngresosSection({
  asesorOptions,
}: {
  asesorOptions: readonly AsesorOption[];
}) {
  const panelId = useId();
  const [panelOpen, setPanelOpen] = useState(false);

  const [preset, setPreset] = useState<IngresosPeriodPreset>("mes_actual");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedAsesorIds, setSelectedAsesorIds] = useState<readonly string[]>([]);
  const [selectedPasos, setSelectedPasos] = useState<readonly number[]>([]);
  const [montoFuente, setMontoFuente] = useState<
    IngresosFilters["montoFuente"]
  >("todas");
  const [estado, setEstado] = useState<IngresosEstadoFiltro>("elegibles");
  const [buscar, setBuscar] = useState("");
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<IngresosResumen | null>(null);
  const [items, setItems] = useState<readonly IngresosDetalleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(25);

  const filters: IngresosFilters = useMemo(() => {
    const bounds = resolveIngresosPeriodBounds({
      preset,
      customFrom,
      customTo,
    });
    return {
      fechaDesde: bounds.fechaDesde,
      fechaHasta: bounds.fechaHasta,
      asesorIds: selectedAsesorIds,
      montoFuente,
      porcentajes: [],
      pasosVisuales: selectedPasos,
      estado,
      buscar,
    };
  }, [
    preset,
    customFrom,
    customTo,
    selectedAsesorIds,
    montoFuente,
    selectedPasos,
    estado,
    buscar,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (preset === "personalizado") {
        resolveIngresosPeriodBounds({ preset, customFrom, customTo });
      }
      const [r, p] = await Promise.all([
        fetchIngresosResumen(filters),
        fetchIngresosPage(filters, page, pageSize),
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
  }, [filters, page, pageSize, preset, customFrom, customTo]);

  useEffect(() => {
    if (!panelOpen) return;
    void load();
  }, [panelOpen, load]);

  const toggleAsesor = (id: string) => {
    setPage(1);
    setSelectedAsesorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const togglePaso = (paso: number) => {
    setPage(1);
    setSelectedPasos((prev) =>
      prev.includes(paso) ? prev.filter((x) => x !== paso) : [...prev, paso].sort((a, b) => a - b),
    );
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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

      {panelOpen ? (
        <div id={panelId} className="mt-4 space-y-4">
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 text-slate-900 md:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs font-semibold text-slate-900">
              Periodo
              <Select
                className="mt-1 text-slate-900"
                value={preset}
                options={[...PRESET_OPTIONS]}
                onChange={(e) => {
                  setPage(1);
                  setPreset(e.target.value as IngresosPeriodPreset);
                }}
                data-testid="admin-ingresos-preset"
              />
            </label>
            {preset === "personalizado" ? (
              <>
                <label className="block text-xs font-semibold text-slate-900">
                  Desde
                  <Input
                    type="date"
                    className="mt-1 text-slate-900"
                    value={customFrom}
                    onChange={(e) => {
                      setPage(1);
                      setCustomFrom(e.target.value);
                    }}
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-900">
                  Hasta
                  <Input
                    type="date"
                    className="mt-1 text-slate-900"
                    value={customTo}
                    onChange={(e) => {
                      setPage(1);
                      setCustomTo(e.target.value);
                    }}
                  />
                </label>
              </>
            ) : null}
            <label className="block text-xs font-semibold text-slate-900">
              Estado
              <Select
                className="mt-1 text-slate-900"
                value={estado}
                options={[...ESTADO_OPTIONS]}
                onChange={(e) => {
                  setPage(1);
                  setEstado(e.target.value as IngresosEstadoFiltro);
                }}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-900">
              Fuente del monto
              <Select
                className="mt-1 text-slate-900"
                value={montoFuente}
                options={[
                  { value: "todas", label: "Todas" },
                  { value: "mesa_actualizado", label: "Actualizado por Mesa" },
                  { value: "datos_generales", label: "Datos Generales" },
                ]}
                onChange={(e) => {
                  setPage(1);
                  setMontoFuente(e.target.value as IngresosFilters["montoFuente"]);
                }}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-900 md:col-span-2">
              Buscar cliente / NSS
              <Input
                className="mt-1 text-slate-900"
                value={buscar}
                onChange={(e) => {
                  setPage(1);
                  setBuscar(e.target.value);
                }}
                placeholder="Nombre o NSS"
              />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 text-slate-900">
            <p className="text-xs font-semibold text-slate-950">Asesores</p>
            <div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto">
              {asesorOptions.map((a) => {
                const on = selectedAsesorIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`rounded-md px-2 py-1 text-[11px] font-medium ring-1 ${
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
            <p className="mt-3 text-xs font-semibold text-slate-950">Etapa visible</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {ADMIN_REPORT_PASO_OPTIONS.map((p) => {
                const on = selectedPasos.includes(p.value);
                return (
                  <button
                    key={p.value}
                    type="button"
                    className={`rounded-md px-2 py-1 text-[11px] font-medium ring-1 ${
                      on
                        ? "bg-sky-100 text-sky-950 ring-sky-400"
                        : "bg-slate-100 text-slate-950 ring-slate-300"
                    }`}
                    onClick={() => togglePaso(p.value)}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-slate-700">
              Sin selección = todos. Rechazados activos y cancelados quedan fuera.
            </p>
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
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Anterior
                    </Button>
                    <span className="font-medium text-slate-900">
                      {page} / {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      disabled={page >= totalPages || loading}
                      onClick={() => setPage((p) => p + 1)}
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
                        <th className="py-1 pr-2 font-semibold">Bio</th>
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
                            </div>
                          </td>
                          <td className="py-1 pr-2 text-slate-900">{it.asesor_nombre ?? "—"}</td>
                          <td className="py-1 pr-2 text-slate-900">
                            {it.bio_aprobacion_at
                              ? formatDateTimeMx(it.bio_aprobacion_at)
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
