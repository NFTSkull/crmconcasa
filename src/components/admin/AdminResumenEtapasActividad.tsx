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

function progressClass(paso: number): string {
  if (paso <= 2) return "bg-slate-500";
  if (paso <= 4) return "bg-cyan-500";
  if (paso <= 7) return "bg-amber-500";
  if (paso <= 9) return "bg-violet-500";
  return "bg-emerald-500";
}

function percent(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count * 1000) / total) / 10;
}

export function AdminResumenEtapasActividad({
  bounds,
  periodoLabel,
  asesorId,
  estado,
  buscar,
  selectedInternalStages,
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
  const seqRef = useRef(0);

  const selectedVisualSteps = useMemo(() => {
    const out = new Set<number>();
    for (const etapa of selectedInternalStages ?? []) {
      out.add(mapEtapaInternaAPasoVisual(etapa));
    }
    return out;
  }, [selectedInternalStages]);

  const selectedStage = useMemo(
    () =>
      ETAPAS_VISUALES_OPERATIVAS.find((etapa) =>
        selectedVisualSteps.has(etapa.pasoVisual),
      ) ?? null,
    [selectedVisualSteps],
  );

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

  const cohortTotalDisplay =
    cohortLoading && cohortBuckets.length === 0 ? "…" : String(cohortTotal);
  const movementsTotalDisplay =
    loading && !data ? "…" : error ? "—" : String(data?.totalExpedientesMovidos ?? 0);
  const stockTotalDisplay =
    loading && !data ? "…" : error ? "—" : String(data?.stockTotal ?? 0);

  const selectedMovement = selectedStage
    ? movimientosByPaso.get(selectedStage.pasoVisual)
    : null;
  const selectedCohortCount = selectedStage
    ? cohortByPaso.get(selectedStage.pasoVisual) ?? 0
    : 0;
  const selectedStockCount = selectedStage
    ? stockByPaso.get(selectedStage.pasoVisual)?.count ?? 0
    : 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Resumen operativo
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              {selectedStage
                ? `${selectedStage.nombre}: lectura clara del filtro`
                : "¿Dónde están hoy los expedientes que ingresaron en el periodo?"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {selectedStage
                ? `${periodoLabel} · Los tres números de abajo responden preguntas distintas sobre esta misma etapa.`
                : `${periodoLabel} · La cifra principal siempre parte de los expedientes que entraron a Mesa en este rango.`}
            </p>
          </div>
          {updatedAt ? (
            <p className="text-xs text-slate-500">
              Actualizado {formatUpdatedAt(updatedAt)}
            </p>
          ) : null}
        </div>

        {selectedStage ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                De los ingresos del periodo
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                {cohortLoading && cohortBuckets.length === 0
                  ? "…"
                  : cohortError
                    ? "—"
                    : selectedCohortCount}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                de {cohortTotalDisplay} están hoy en {selectedStage.nombre}
                {cohortTotal > 0 ? ` · ${percent(selectedCohortCount, cohortTotal)}%` : ""}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Pasaron por esta etapa
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                {loading && !data ? "…" : error ? "—" : selectedMovement?.llegaronCount ?? 0}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                durante el periodo · {selectedMovement?.cohortePeriodoCount ?? 0} ingresaron en el rango y {selectedMovement?.venianDeAntesCount ?? 0} venían de antes
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Total CRM hoy
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                {loading && !data ? "…" : error ? "—" : selectedStockCount}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                todos los expedientes que hoy están en {selectedStage.nombre}, sin importar cuándo ingresaron
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Ingresaron a Mesa
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                {cohortTotalDisplay}
              </p>
              <p className="mt-1 text-xs text-slate-500">Base de este resumen</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Tuvieron movimiento
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                {movementsTotalDisplay}
              </p>
              <p className="mt-1 text-xs text-slate-500">Incluye expedientes que venían de antes</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Total actual del CRM
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                {stockTotalDisplay}
              </p>
              <p className="mt-1 text-xs text-slate-500">No depende de la fecha seleccionada</p>
            </div>
          </div>
        )}
      </div>

      {error ? (
        <div className="mx-5 mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>No fue posible cargar los movimientos y el total actual.</span>
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Reintentar
          </Button>
        </div>
      ) : null}

      {cohortError ? (
        <div className="mx-5 mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>No fue posible cargar dónde están hoy los ingresos del periodo.</span>
          <Button type="button" variant="secondary" onClick={onRetryCohort}>
            Reintentar
          </Button>
        </div>
      ) : null}

      {data && !data.historyCompleteForPeriod ? (
        <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          El historial de movimientos existe desde <strong>{formatCoverageDate(data.historyCoverageFrom)}</strong>. La ubicación actual sigue siendo válida; solo puede faltar actividad anterior a esa fecha.
        </div>
      ) : null}

      <div className="px-5 py-5">
        {selectedStage ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-1 text-[10px] font-semibold uppercase ${stageBadgeClass(selectedStage.pasoVisual)}`}>
                    Paso {selectedStage.pasoVisual}
                  </span>
                  <h3 className="text-base font-semibold text-slate-950">{selectedStage.nombre}</h3>
                </div>
                <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-600">
                  La primera cifra coincide con la pregunta “de los que ingresaron en el periodo, ¿cuántos siguen hoy aquí?”. La segunda mide actividad dentro del rango. La tercera es la carga total vigente de esta etapa.
                </p>
              </div>
              <Button type="button" onClick={() => onStagePress(selectedStage.etapaInterna)}>
                Ver expedientes de esta etapa
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-950">
                  Distribución actual de los ingresos del periodo
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Cada barra responde: de los {cohortTotalDisplay} que ingresaron a Mesa, ¿cuántos están hoy en esta etapa?
                </p>
              </div>
              <p className="text-xs text-slate-500">Haz clic en una etapa para abrir sus expedientes</p>
            </div>

            <div className="mt-4 grid gap-2 lg:grid-cols-2">
              {ETAPAS_VISUALES_OPERATIVAS.map((etapa) => {
                const siguenAqui = cohortByPaso.get(etapa.pasoVisual) ?? 0;
                const siguenPct = percent(siguenAqui, cohortTotal);
                const stock = stockByPaso.get(etapa.pasoVisual);
                const totalActual = stock?.count ?? 0;
                const ubicacionDisponible = !cohortError && !(cohortLoading && cohortBuckets.length === 0);
                const stockDisponible = !error && (data != null || !loading);

                return (
                  <button
                    key={etapa.pasoVisual}
                    type="button"
                    onClick={() => onStagePress(etapa.etapaInterna)}
                    className="group rounded-lg border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-slate-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    title={`Ver expedientes de ${etapa.nombre}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${stageBadgeClass(
                              etapa.pasoVisual,
                            )}`}
                          >
                            Paso {etapa.pasoVisual}
                          </span>
                          <span className="truncate text-sm font-semibold text-slate-900 group-hover:text-blue-700">
                            {etapa.nombre}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-lg font-semibold leading-none tabular-nums text-slate-950">
                          {cohortLoading && cohortBuckets.length === 0
                            ? "…"
                            : ubicacionDisponible
                              ? `${siguenAqui}`
                              : "—"}
                          {ubicacionDisponible && cohortTotal > 0 ? (
                            <span className="ml-1 text-xs font-medium text-slate-400">/ {cohortTotal}</span>
                          ) : null}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-slate-500">
                          {ubicacionDisponible && cohortTotal > 0
                            ? `${siguenPct}% del periodo`
                            : cohortTotal === 0 && ubicacionDisponible
                              ? "Sin ingresos"
                              : "Sin dato"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all ${progressClass(etapa.pasoVisual)}`}
                        style={{ width: `${Math.min(100, Math.max(0, siguenPct))}%` }}
                      />
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                      <span>
                        {ubicacionDisponible
                          ? `${siguenAqui} de los ingresos siguen aquí`
                          : "Ubicación no disponible"}
                      </span>
                      <span className="shrink-0">
                        CRM hoy: <strong className="font-semibold tabular-nums text-slate-700">{stockDisponible ? totalActual : "—"}</strong>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50/70">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-800 hover:text-slate-950">
            Ver actividad del periodo por etapa
            <span className="ml-2 text-xs font-normal text-slate-500">
              (qué pasó por cada etapa, incluyendo expedientes de meses anteriores)
            </span>
          </summary>
          <div className="border-t border-slate-200 bg-white p-4">
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              Esta tabla responde una pregunta distinta: <strong className="font-semibold text-slate-700">qué expedientes pasaron por cada etapa durante el periodo</strong>. Un mismo expediente puede aparecer en varias etapas si avanzó durante el rango.
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-[680px] w-full border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5 font-semibold">Etapa</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Pasaron por aquí</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Ingresaron en el periodo</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Venían de antes</th>
                  </tr>
                </thead>
                <tbody>
                  {ETAPAS_VISUALES_OPERATIVAS.map((etapa) => {
                    const mov = movimientosByPaso.get(etapa.pasoVisual);
                    const llegaron = mov?.llegaronCount ?? 0;
                    const delPeriodo = mov?.cohortePeriodoCount ?? 0;
                    const anteriores = mov?.venianDeAntesCount ?? 0;
                    const disponible = !error && (data != null || !loading);

                    return (
                      <tr key={etapa.pasoVisual} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${stageBadgeClass(
                                etapa.pasoVisual,
                              )}`}
                            >
                              {etapa.pasoVisual}
                            </span>
                            <span className="font-medium text-slate-800">{etapa.nombre}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-950">
                          {loading && !data ? "…" : disponible ? llegaron : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {loading && !data ? "…" : disponible ? delPeriodo : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {loading && !data ? "…" : disponible ? anteriores : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}
