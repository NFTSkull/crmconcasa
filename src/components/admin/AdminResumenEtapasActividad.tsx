"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  ETAPAS_VISUALES_OPERATIVAS,
  mapEtapaInternaAPasoVisual,
} from "@/domain/expedientes/asesor-seguimiento-operativo";
import type {
  AdminEstadoFilter,
  AdminPeriodBounds,
} from "@/domain/admin-production";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

const TOTAL_PASOS = 11;

type MovimientoPaso = Readonly<{
  pasoVisual: number;
  llegaronCount: number;
  venianDeAntesCount: number;
  cohortePeriodoCount: number;
}>;

type StockPaso = Readonly<{
  pasoVisual: number;
  count: number;
  pct: number;
}>;

type ResumenEtapasActividad = Readonly<{
  totalExpedientesMovidos: number;
  movimientos: readonly MovimientoPaso[];
  stockTotal: number;
  stock: readonly StockPaso[];
  generatedAt: string | null;
  historyCoverageFrom: string | null;
  historyCompleteForPeriod: boolean;
}>;

type CohortBucket = Readonly<{
  etapa: number;
  count: number;
  pct: number;
}>;

type Props = Readonly<{
  bounds: AdminPeriodBounds;
  periodoLabel: string;
  asesorId: string | null;
  estado: AdminEstadoFilter;
  buscar: string | null;
  selectedInternalStages?: readonly number[] | null;
  cohortBuckets: readonly CohortBucket[];
  cohortTotal: number;
  cohortLoading: boolean;
  cohortError: string | null;
  cohortGeneratedAt: string | null;
  onRetryCohort: () => void;
  onStagePress: (etapaInterna: number) => void;
}>;

type Lens = "ingresos" | "movimientos" | "actual";

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function parseResumen(raw: unknown): ResumenEtapasActividad {
  const root = record(raw);
  const movimientosRaw = Array.isArray(root.by_paso_visual)
    ? root.by_paso_visual
    : [];
  const snapshot = record(root.snapshot);
  const stockRaw = Array.isArray(snapshot.by_paso_visual)
    ? snapshot.by_paso_visual
    : [];

  const movimientosByPaso = new Map<number, MovimientoPaso>();
  for (const item of movimientosRaw) {
    const r = record(item);
    const pasoVisual = num(r.paso_visual);
    if (pasoVisual < 1 || pasoVisual > TOTAL_PASOS) continue;
    movimientosByPaso.set(pasoVisual, {
      pasoVisual,
      llegaronCount: num(r.llegaron_count),
      venianDeAntesCount: num(r.venian_de_antes_count),
      cohortePeriodoCount: num(r.cohorte_periodo_count),
    });
  }

  const stockByPaso = new Map<number, StockPaso>();
  for (const item of stockRaw) {
    const r = record(item);
    const pasoVisual = num(r.paso_visual);
    if (pasoVisual < 1 || pasoVisual > TOTAL_PASOS) continue;
    stockByPaso.set(pasoVisual, {
      pasoVisual,
      count: num(r.count),
      pct: num(r.pct),
    });
  }

  return {
    totalExpedientesMovidos: num(root.total_expedientes_movidos),
    movimientos: Array.from({ length: TOTAL_PASOS }, (_, i) => {
      const pasoVisual = i + 1;
      return (
        movimientosByPaso.get(pasoVisual) ?? {
          pasoVisual,
          llegaronCount: 0,
          venianDeAntesCount: 0,
          cohortePeriodoCount: 0,
        }
      );
    }),
    stockTotal: num(snapshot.total_actual),
    stock: Array.from({ length: TOTAL_PASOS }, (_, i) => {
      const pasoVisual = i + 1;
      return (
        stockByPaso.get(pasoVisual) ?? {
          pasoVisual,
          count: 0,
          pct: 0,
        }
      );
    }),
    generatedAt:
      strOrNull(root.generated_at) ?? strOrNull(snapshot.generated_at),
    historyCoverageFrom: strOrNull(root.history_coverage_from),
    historyCompleteForPeriod: Boolean(root.history_complete_for_period),
  };
}

function formatCoverageDate(iso: string | null): string {
  if (!iso) return "fecha no disponible";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "fecha no disponible";
  return dt.toLocaleDateString("es-MX", {
    timeZone: "America/Monterrey",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleTimeString("es-MX", {
    timeZone: "America/Monterrey",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function newestIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const aMs = new Date(a).getTime();
  const bMs = new Date(b).getTime();
  if (Number.isNaN(aMs)) return b;
  if (Number.isNaN(bMs)) return a;
  return aMs >= bMs ? a : b;
}

function stageBadgeClass(paso: number): string {
  if (paso <= 2) return "bg-slate-100 text-slate-700";
  if (paso <= 4) return "bg-cyan-50 text-cyan-800";
  if (paso <= 7) return "bg-amber-50 text-amber-900";
  if (paso <= 9) return "bg-violet-50 text-violet-800";
  return "bg-emerald-50 text-emerald-800";
}

function stageBarClass(paso: number): string {
  if (paso <= 2) return "bg-slate-600";
  if (paso <= 4) return "bg-cyan-600";
  if (paso <= 7) return "bg-amber-500";
  if (paso <= 9) return "bg-violet-600";
  return "bg-emerald-600";
}

function percent(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count * 1000) / total) / 10;
}

function safeWidth(value: number): string {
  return `${Math.max(0, Math.min(100, value))}%`;
}

export function AdminResumenEtapasActividad({
  bounds,
  periodoLabel,
  asesorId,
  estado,
  buscar,
  cohortBuckets,
  cohortTotal,
  cohortLoading,
  cohortError,
  cohortGeneratedAt,
  onRetryCohort,
  onStagePress,
}: Props) {
  const [data, setData] = useState<ResumenEtapasActividad | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("ingresos");
  const seqRef = useRef(0);

  const cohortByPaso = useMemo(() => {
    const out = new Map<number, number>();
    for (const bucket of cohortBuckets) {
      const pasoVisual = mapEtapaInternaAPasoVisual(bucket.etapa);
      out.set(pasoVisual, (out.get(pasoVisual) ?? 0) + bucket.count);
    }
    return out;
  }, [cohortBuckets]);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);

    if (!isSupabaseConfigured() || !supabaseBrowser) {
      setError("Supabase no configurado");
      setLoading(false);
      return;
    }

    try {
      const { data: raw, error: rpcError } = await supabaseBrowser.rpc(
        "admin_resumen_movimientos_etapas",
        {
          p_from: bounds.fromIso,
          p_to_exclusive: bounds.toExclusiveIso,
          p_asesor_id: asesorId,
          p_estado: estado === "todos" ? null : estado,
          p_buscar: buscar?.trim() || null,
        },
      );
      if (rpcError) throw new Error(rpcError.message || "No se pudo cargar el resumen");
      if (seq !== seqRef.current) return;
      setData(parseResumen(raw));
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(
        e instanceof Error
          ? e.message
          : "No fue posible cargar movimientos y foto actual por etapa",
      );
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [bounds.fromIso, bounds.toExclusiveIso, asesorId, estado, buscar]);

  useEffect(() => {
    void load();
    return () => {
      seqRef.current += 1;
    };
  }, [load]);

  const movimientosByPaso = useMemo(
    () => new Map((data?.movimientos ?? []).map((r) => [r.pasoVisual, r])),
    [data],
  );
  const stockByPaso = useMemo(
    () => new Map((data?.stock ?? []).map((r) => [r.pasoVisual, r])),
    [data],
  );
  const updatedAt = newestIso(data?.generatedAt ?? null, cohortGeneratedAt);

  const maxMovimientos = useMemo(
    () => Math.max(1, ...(data?.movimientos ?? []).map((r) => r.llegaronCount)),
    [data],
  );

  const lensCards: ReadonlyArray<{
    id: Lens;
    eyebrow: string;
    value: string;
    title: string;
    description: string;
  }> = [
    {
      id: "ingresos",
      eyebrow: "Periodo seleccionado",
      value:
        cohortLoading && cohortBuckets.length === 0 ? "…" : String(cohortTotal),
      title: "Ingresos del periodo",
      description: "Dónde están hoy los expedientes que entraron a Mesa en este rango.",
    },
    {
      id: "movimientos",
      eyebrow: "Actividad del rango",
      value:
        loading && !data
          ? "…"
          : error
            ? "—"
            : String(data?.totalExpedientesMovidos ?? 0),
      title: "Movimientos del periodo",
      description: "Qué avanzó o se movió, aunque el expediente hubiera entrado antes.",
    },
    {
      id: "actual",
      eyebrow: "Hoy",
      value:
        loading && !data ? "…" : error ? "—" : String(data?.stockTotal ?? 0),
      title: "Foto actual",
      description: "Dónde están hoy todos los expedientes vigentes del CRM.",
    },
  ];

  const lensTitle =
    lens === "ingresos"
      ? `¿Dónde están hoy los ${cohortTotal} ingresos del periodo?`
      : lens === "movimientos"
        ? "¿Qué etapas tuvieron movimiento durante el periodo?"
        : "¿Dónde están hoy todos los expedientes del CRM?";

  const lensDescription =
    lens === "ingresos"
      ? `Solo toma los expedientes enviados a Mesa en ${periodoLabel} y muestra su etapa actual.`
      : lens === "movimientos"
        ? `Cuenta expedientes que entraron a cada etapa durante ${periodoLabel}. Incluye los que ya venían de periodos anteriores.`
        : "Esta vista no depende de la fecha: es la distribución vigente por etapa en este momento.";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="text-lg font-semibold text-slate-950">Expedientes por etapa</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Elige una lectura. Cada opción responde una pregunta distinta para no mezclar
            ingresos, movimientos históricos y la foto actual.
          </p>
        </div>
        {updatedAt ? (
          <p className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
            Actualizado {formatUpdatedAt(updatedAt)}
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3" role="group" aria-label="Vista del resumen por etapas">
        {lensCards.map((card) => {
          const active = lens === card.id;
          return (
            <button
              key={card.id}
              type="button"
              aria-pressed={active}
              onClick={() => setLens(card.id)}
              className={`rounded-xl border p-4 text-left transition ${
                active
                  ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
                      active ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    {card.eyebrow}
                  </p>
                  <p className="mt-1 text-sm font-semibold">{card.title}</p>
                </div>
                <p className="shrink-0 text-3xl font-semibold leading-none tabular-nums">
                  {card.value}
                </p>
              </div>
              <p
                className={`mt-2 text-xs leading-relaxed ${
                  active ? "text-slate-300" : "text-slate-500"
                }`}
              >
                {card.description}
              </p>
            </button>
          );
        })}
      </div>

      {lens === "ingresos" && cohortError ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>No fue posible cargar la ubicación actual de los ingresos del periodo.</span>
          <Button type="button" variant="secondary" onClick={onRetryCohort}>
            Reintentar
          </Button>
        </div>
      ) : null}

      {(lens === "movimientos" || lens === "actual") && error ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>No fue posible cargar esta vista.</span>
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Reintentar
          </Button>
        </div>
      ) : null}

      {lens === "movimientos" && data && !data.historyCompleteForPeriod ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950">
          El historial de movimientos existe desde{" "}
          <strong>{formatCoverageDate(data.historyCoverageFrom)}</strong>. Si el rango empieza
          antes de esa fecha, los movimientos previos no pueden reconstruirse; las vistas de
          ingresos y foto actual siguen disponibles.
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-950">{lensTitle}</h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
              {lensDescription}
            </p>
          </div>
          {lens === "ingresos" ? (
            <p className="text-xs font-medium text-blue-700">
              Pulsa una etapa para ver sus expedientes →
            </p>
          ) : null}
        </div>

        <div className="mt-2 divide-y divide-slate-200">
          {ETAPAS_VISUALES_OPERATIVAS.map((etapa) => {
            const mov = movimientosByPaso.get(etapa.pasoVisual);
            const stock = stockByPaso.get(etapa.pasoVisual);
            const cohortCount = cohortByPaso.get(etapa.pasoVisual) ?? 0;
            const cohortPct = percent(cohortCount, cohortTotal);
            const movimientoCount = mov?.llegaronCount ?? 0;
            const movimientoPct = percent(movimientoCount, maxMovimientos);
            const stockCount = stock?.count ?? 0;
            const stockPct =
              typeof stock?.pct === "number"
                ? stock.pct
                : percent(stockCount, data?.stockTotal ?? 0);

            const count =
              lens === "ingresos"
                ? cohortCount
                : lens === "movimientos"
                  ? movimientoCount
                  : stockCount;
            const visualPct =
              lens === "ingresos"
                ? cohortPct
                : lens === "movimientos"
                  ? movimientoPct
                  : stockPct;

            const countDisplay =
              lens === "ingresos"
                ? cohortLoading && cohortBuckets.length === 0
                  ? "…"
                  : cohortError
                    ? "—"
                    : String(count)
                : loading && !data
                  ? "…"
                  : error
                    ? "—"
                    : String(count);

            const rowContent = (
              <>
                <div className="flex min-w-0 items-center gap-2 md:w-[18rem] md:shrink-0">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${stageBadgeClass(
                      etapa.pasoVisual,
                    )}`}
                  >
                    Paso {etapa.pasoVisual}
                  </span>
                  <span className="truncate text-sm font-semibold text-slate-900">
                    {etapa.nombre}
                  </span>
                </div>

                <div className="mt-2 min-w-0 flex-1 md:mt-0">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all ${stageBarClass(
                        etapa.pasoVisual,
                      )}`}
                      style={{ width: safeWidth(visualPct) }}
                    />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                    {lens === "ingresos" ? (
                      <span>{cohortTotal > 0 ? `${cohortPct}% de los ingresos` : "Sin ingresos"}</span>
                    ) : lens === "movimientos" ? (
                      <>
                        <span>
                          <strong className="font-medium text-slate-700">
                            {mov?.cohortePeriodoCount ?? 0}
                          </strong>{" "}
                          ingresaron en el rango
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          <strong className="font-medium text-slate-700">
                            {mov?.venianDeAntesCount ?? 0}
                          </strong>{" "}
                          venían de antes
                        </span>
                      </>
                    ) : (
                      <span>{data?.stockTotal ? `${stockPct}% del total actual` : "Sin expedientes"}</span>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex items-baseline justify-between gap-2 md:mt-0 md:w-20 md:shrink-0 md:justify-end">
                  <span className="text-xs text-slate-500 md:hidden">Expedientes</span>
                  <span className="text-2xl font-semibold leading-none tabular-nums text-slate-950">
                    {countDisplay}
                  </span>
                </div>
              </>
            );

            if (lens === "ingresos") {
              return (
                <button
                  key={etapa.pasoVisual}
                  type="button"
                  onClick={() => onStagePress(etapa.etapaInterna)}
                  className="flex w-full flex-col py-3 text-left transition hover:bg-white/80 md:flex-row md:items-center md:gap-4 md:px-2"
                  title={`Ver expedientes actualmente en ${etapa.nombre}`}
                >
                  {rowContent}
                </button>
              );
            }

            return (
              <div
                key={etapa.pasoVisual}
                className="flex flex-col py-3 md:flex-row md:items-center md:gap-4 md:px-2"
              >
                {rowContent}
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        En “Movimientos del periodo”, un expediente cuenta una sola vez por etapa aunque
        reingrese, y puede aparecer en varias etapas si pasó por ellas durante el rango.
        Por eso esa vista no es un embudo de conversión.
      </p>
    </section>
  );
}
