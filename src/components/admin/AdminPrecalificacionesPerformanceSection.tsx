"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminSectionHeader } from "@/components/admin/AdminSectionHeader";
import { fetchAdminExpedientesOverviewAsesores } from "@/domain/admin-expedientes-overview";
import {
  fetchAdminPrecalPerformance,
  type AdminPrecalPerformanceAdvisor,
  type AdminPrecalPerformanceItem,
  type AdminPrecalPerformanceResult,
  type AdminPrecalPerformanceSegment,
} from "@/domain/admin-precal-performance";
import {
  resolveAdminPeriodBounds,
  type AdminPeriodPreset,
} from "@/domain/admin-production";
import { getAdminEtapaDisplayNombre } from "@/domain/admin-production/admin-visible-stages";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";
import { formatDateTimeMx } from "@/lib/filters";
import { formatMontoMX } from "@/lib/monto";

const PAGE_SIZE = 50;

const SEGMENTS: readonly {
  value: AdminPrecalPerformanceSegment;
  label: string;
}[] = [
  { value: "todos", label: "Todas" },
  { value: "aprobadas", label: "Aprobadas" },
  { value: "no_cumple", label: "No cumple" },
  { value: "pendientes", label: "Pendientes" },
  { value: "repetidos", label: "NSS repetidos" },
  { value: "topados", label: "Topados $169 mil" },
  { value: "mesa", label: "Entraron a trámite" },
];

function pct(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function advisorLabel(row: AdminPrecalPerformanceAdvisor): string {
  return formatAsesorExpedienteLabel({
    fullName: row.asesorNombre,
    email: row.asesorEmail,
    fallbackId: row.asesorId,
  });
}

function decisionLabel(decision: string): string {
  if (decision === "aprobado") return "Aprobada";
  if (decision === "no_cumple") return "No cumple";
  if (decision === "pendiente") return "Pendiente";
  return decision || "—";
}

function decisionClass(decision: string): string {
  if (decision === "aprobado") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (decision === "no_cumple") {
    return "border-red-200 bg-red-50 text-red-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function mesaLabel(row: AdminPrecalPerformanceItem): string {
  if (!row.submittedToMesa) return "No enviado";
  return row.etapaActual > 0
    ? `Sí · ${getAdminEtapaDisplayNombre(row.etapaActual)}`
    : "Sí";
}

export function AdminPrecalificacionesPerformanceSection() {
  const [preset, setPreset] = useState<AdminPeriodPreset>("mes");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [asesorId, setAsesorId] = useState("");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [segmento, setSegmento] =
    useState<AdminPrecalPerformanceSegment>("todos");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminPrecalPerformanceResult | null>(null);
  const [asesores, setAsesores] = useState<
    readonly { asesorId: string; asesorNombre: string | null; asesorEmail: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bounds = useMemo(() => {
    try {
      return resolveAdminPeriodBounds({
        preset,
        customFrom: preset === "personalizado" ? customFrom : undefined,
        customToInclusive: preset === "personalizado" ? customTo : undefined,
      });
    } catch {
      return null;
    }
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    const id = window.setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void fetchAdminExpedientesOverviewAsesores()
      .then((rows) => {
        if (cancelled) return;
        setAsesores(rows);
      })
      .catch(() => {
        if (!cancelled) setAsesores([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [preset, customFrom, customTo, asesorId, searchDebounced, segmento]);

  useEffect(() => {
    if (!bounds) {
      setData(null);
      setLoading(false);
      setError(
        preset === "personalizado"
          ? "Selecciona un rango de fechas válido."
          : "No se pudo resolver el periodo.",
      );
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchAdminPrecalPerformance({
      fromIso: bounds.fromIso,
      toExclusiveIso: bounds.toExclusiveIso,
      asesorId: asesorId || null,
      search: searchDebounced || null,
      segmento,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setError(
          e instanceof Error
            ? e.message
            : "No se pudo cargar el rendimiento de precalificaciones.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bounds, asesorId, searchDebounced, segmento, page, preset]);

  const summary = data?.summary;
  const periodLabel = bounds
    ? bounds.fromDate === bounds.toDateInclusive
      ? bounds.fromDate
      : `${bounds.fromDate} — ${bounds.toDateInclusive}`
    : "—";

  const clearFilters = () => {
    setPreset("mes");
    setCustomFrom("");
    setCustomTo("");
    setAsesorId("");
    setSearch("");
    setSearchDebounced("");
    setSegmento("todos");
    setPage(1);
  };

  const topCards = summary
    ? [
        {
          label: "Precalificaciones",
          value: summary.totalPrecalificaciones.toLocaleString("es-MX"),
          sub: "Intentos registrados en el periodo",
        },
        {
          label: "NSS únicos",
          value: summary.nssUnicos.toLocaleString("es-MX"),
          sub: `${summary.nssRepetidosPeriodo.toLocaleString("es-MX")} NSS se repitieron dentro del periodo`,
        },
        {
          label: "Re-precalificaciones / repetidas",
          value: summary.repeticionesExtra.toLocaleString("es-MX"),
          sub: `${summary.nssConHistorialRepetido.toLocaleString("es-MX")} NSS tienen historial repetido`,
        },
        {
          label: "Aprobadas",
          value: summary.aprobadas.toLocaleString("es-MX"),
          sub: `Tasa de aprobación: ${pct(summary.tasaAprobacion)}`,
        },
        {
          label: "No cumple",
          value: summary.noCumple.toLocaleString("es-MX"),
          sub: `${summary.pendientes.toLocaleString("es-MX")} pendientes`,
        },
        {
          label: "Monto promedio aprobado",
          value: formatMontoMX(summary.montoPromedioAprobado),
          sub: "Mejoravit se analiza con tope operativo de $169,000",
        },
        {
          label: "Expedientes únicos",
          value: summary.expedientesUnicos.toLocaleString("es-MX"),
          sub: "Sin duplicar re-precalificaciones",
        },
        {
          label: "Entraron a trámite",
          value: summary.expedientesAMesa.toLocaleString("es-MX"),
          sub: `Conversión a Mesa: ${pct(summary.conversionMesa)}`,
        },
        {
          label: "Topados $169,000",
          value: summary.topados169k.toLocaleString("es-MX"),
          sub: `${summary.topados169kAMesa.toLocaleString("es-MX")} llegaron a Mesa · ${pct(summary.conversionTopadosMesa)}`,
        },
        {
          label: "Monto aprobado total",
          value: formatMontoMX(summary.montoTotalAprobado),
          sub: "Suma operativa del periodo",
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <AdminSectionHeader
          title="Control integral de precalificaciones"
          description="Mide todo lo que precalifica cada asesor, repetición de NSS, aprobación, montos y cuánto realmente termina entrando a Mesa."
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {([
            ["hoy", "Hoy"],
            ["semana", "Esta semana"],
            ["mes", "Este mes"],
            ["personalizado", "Personalizado"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={preset === value}
              onClick={() => setPreset(value)}
              className={
                preset === value
                  ? "rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                  : "rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
              }
            >
              {label}
            </button>
          ))}
          <span className="ml-auto self-center text-sm text-slate-600">
            Periodo: <strong className="text-slate-900">{periodLabel}</strong>
          </span>
        </div>

        {preset === "personalizado" ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              type="date"
              label="Desde"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <Input
              type="date"
              label="Hasta"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Select
            label="Asesor"
            value={asesorId}
            onChange={(e) => setAsesorId(e.target.value)}
            options={[
              { value: "", label: "Todos los asesores" },
              ...asesores.map((a) => ({
                value: a.asesorId,
                label: formatAsesorExpedienteLabel({
                  fullName: a.asesorNombre,
                  email: a.asesorEmail,
                  fallbackId: a.asesorId,
                }),
              })),
            ]}
          />
          <Input
            label="Buscar"
            placeholder="Cliente, NSS, asesor o correo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex items-end">
            <Button type="button" variant="secondary" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {SEGMENTS.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={segmento === s.value}
              onClick={() => setSegmento(s.value)}
              className={
                segmento === s.value
                  ? "rounded-full bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white"
                  : "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      {loading && !data ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-600">Calculando rendimiento…</p>
        </section>
      ) : error ? (
        <section className="rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="font-medium text-red-900">No se pudo cargar el panel.</p>
          <p className="mt-1 text-sm text-red-800">{error}</p>
        </section>
      ) : summary ? (
        <>
          <section>
            <AdminSectionHeader
              title="Foto del periodo"
              description="Los porcentajes de conversión usan expedientes únicos para que una re-precalificación no infle el resultado."
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {topCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {card.label}
                  </p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-slate-950">
                    {card.value}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{card.sub}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <AdminSectionHeader
              title="Rendimiento por asesor"
              description="Compara volumen, repetición, aprobación, monto promedio y conversión real a Mesa. Haz clic en un asesor para aislarlo."
            />
            {data.asesores.length === 0 ? (
              <AdminEmptyState
                title="No hay asesores con precalificaciones en este periodo."
                description="Cambia el periodo o limpia los filtros."
                onClearFilters={clearFilters}
              />
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-[1180px] w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Asesor</th>
                      <th className="py-2 pr-3 text-right">Precal.</th>
                      <th className="py-2 pr-3 text-right">NSS únicos</th>
                      <th className="py-2 pr-3 text-right">Repetidas</th>
                      <th className="py-2 pr-3 text-right">Aprob.</th>
                      <th className="py-2 pr-3 text-right">Tasa aprob.</th>
                      <th className="py-2 pr-3 text-right">Promedio</th>
                      <th className="py-2 pr-3 text-right">Topados</th>
                      <th className="py-2 pr-3 text-right">A Mesa</th>
                      <th className="py-2 text-right">Conversión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.asesores.map((row) => (
                      <tr
                        key={row.asesorId}
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                        onClick={() => setAsesorId(row.asesorId)}
                      >
                        <td className="py-2.5 pr-3">
                          <p className="font-semibold text-slate-900">{advisorLabel(row)}</p>
                          {row.asesorEmail ? (
                            <p className="text-xs text-slate-500">{row.asesorEmail}</p>
                          ) : null}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {row.precalificaciones.toLocaleString("es-MX")}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {row.nssUnicos.toLocaleString("es-MX")}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {row.repeticionesExtra.toLocaleString("es-MX")}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {row.aprobadas.toLocaleString("es-MX")}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-medium tabular-nums">
                          {pct(row.tasaAprobacion)}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {formatMontoMX(row.montoPromedioAprobado)}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {row.topados169k.toLocaleString("es-MX")}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {row.expedientesAMesa.toLocaleString("es-MX")}
                        </td>
                        <td className="py-2.5 text-right font-semibold tabular-nums">
                          {pct(row.conversionMesa)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <AdminSectionHeader
              title="Detalle de precalificaciones"
              description="Cada fila es un intento de precalificación. «Historial NSS» muestra cuántas veces se ha precalificado ese número en total."
            />

            {data.items.length === 0 ? (
              <AdminEmptyState
                title="No hay precalificaciones para este filtro."
                description="Prueba otro segmento, periodo o asesor."
                onClearFilters={clearFilters}
              />
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-[1380px] w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Fecha</th>
                      <th className="py-2 pr-3">NSS</th>
                      <th className="py-2 pr-3">Historial NSS</th>
                      <th className="py-2 pr-3">Cliente</th>
                      <th className="py-2 pr-3">Asesor</th>
                      <th className="py-2 pr-3">Tipo</th>
                      <th className="py-2 pr-3">Resultado</th>
                      <th className="py-2 pr-3 text-right">Monto</th>
                      <th className="py-2 pr-3">Tope</th>
                      <th className="py-2">Trámite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <tr
                        key={row.eventId}
                        className="border-b border-slate-100 align-top hover:bg-slate-50"
                      >
                        <td className="whitespace-nowrap py-2.5 pr-3 text-slate-700">
                          {row.eventAt ? formatDateTimeMx(row.eventAt) : "—"}
                        </td>
                        <td className="whitespace-nowrap py-2.5 pr-3 font-mono font-medium text-slate-900">
                          {row.nss || "—"}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={
                              row.nssPrecalificacionesHistoricas > 1
                                ? "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
                                : "inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                            }
                          >
                            {row.nssPrecalificacionesHistoricas}
                            {row.nssPrecalificacionesHistoricas > 1 ? " · repetido" : ""}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 font-medium text-slate-900">
                          {row.clienteNombre || "POR CAPTURAR"}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-700">
                          {formatAsesorExpedienteLabel({
                            fullName: row.asesorNombre,
                            email: row.asesorEmail,
                            fallbackId: row.asesorId,
                          })}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-700">
                          {row.tipoEvento === "reprecalificacion"
                            ? "Re-precalificación"
                            : "Inicial"}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${decisionClass(
                              row.decision,
                            )}`}
                          >
                            {decisionLabel(row.decision)}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-medium tabular-nums text-slate-900">
                          {row.montoOperativo == null
                            ? "—"
                            : formatMontoMX(row.montoOperativo)}
                        </td>
                        <td className="py-2.5 pr-3">
                          {row.topado169k ? (
                            <span className="inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-900">
                              $169 mil
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <span
                            className={
                              row.submittedToMesa
                                ? "font-semibold text-emerald-700"
                                : "text-slate-500"
                            }
                          >
                            {mesaLabel(row)}
                          </span>
                          {row.fechaEnvioMesa ? (
                            <p className="mt-0.5 text-xs text-slate-500">
                              {formatDateTimeMx(row.fechaEnvioMesa)}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
              <span>
                {data.totalCount.toLocaleString("es-MX")} resultado
                {data.totalCount === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </Button>
                <span>
                  Página {page} / {Math.max(1, Math.ceil(data.totalCount / PAGE_SIZE))}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loading || page * PAGE_SIZE >= data.totalCount}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </section>

          <p className="text-xs leading-5 text-slate-500">
            Nota: para rendimiento, los montos de Mejoravit se analizan con tope operativo
            de $169,000. El dato original permanece intacto en la base. «Entró a trámite»
            significa que el expediente asociado ya fue enviado a Mesa.
          </p>
        </>
      ) : null}
    </div>
  );
}
