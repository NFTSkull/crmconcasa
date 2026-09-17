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

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Flujo de expedientes</h2>
          <p className="mt-1 text-sm text-slate-600">
            Periodo: <strong className="font-medium text-slate-800">{periodoLabel}</strong> ·
            compara lo que se movió en el rango con la ubicación actual.
          </p>
        </div>
        {updatedAt ? (
          <p className="text-xs text-slate-500">
            Actualizado: {formatUpdatedAt(updatedAt)}
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-800">
          <strong className="tabular-nums">{cohortTotalDisplay}</strong> ingresos del periodo
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-800">
          <strong className="tabular-nums">{movementsTotalDisplay}</strong> expedientes con movimiento
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-800">
          <strong className="tabular-nums">{stockTotalDisplay}</strong> expedientes actuales
        </span>
        {loading || cohortLoading ? (
          <span className="px-2 py-1.5 text-slate-500">Actualizando…</span>
        ) : null}
      </div>

      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
        <strong className="font-semibold text-slate-800">Pasaron en el periodo</strong> = tuvieron actividad en esa etapa. {" "}
        <strong className="font-semibold text-slate-800">Siguen aquí</strong> = de los ingresos del periodo, están actualmente ahí. {" "}
        <strong className="font-semibold text-slate-800">Total actual</strong> = todos los expedientes que hoy están en esa etapa.
      </div>

      {error ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>No fue posible cargar movimientos y total actual.</span>
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Reintentar
          </Button>
        </div>
      ) : null}

      {cohortError ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>No fue posible cargar la ubicación actual de los ingresos del periodo.</span>
          <Button type="button" variant="secondary" onClick={onRetryCohort}>
            Reintentar
          </Button>
        </div>
      ) : null}

      {data && !data.historyCompleteForPeriod ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          El historial de movimientos existe desde{" "}
          <strong>{formatCoverageDate(data.historyCoverageFrom)}</strong>. Si el rango inicia antes,
          los movimientos anteriores a esa fecha no pueden reconstruirse; la ubicación actual de los
          ingresos del periodo y el total actual siguen disponibles.
        </div>
      ) : null}

      <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-[760px] w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2.5 font-semibold">Etapa</th>
              <th className="px-3 py-2.5 font-semibold">Pasaron en el periodo</th>
              <th className="px-3 py-2.5 font-semibold">
                De {cohortTotalDisplay} ingresos, siguen aquí
              </th>
              <th className="px-3 py-2.5 font-semibold">Total actual</th>
            </tr>
          </thead>
          <tbody>
            {ETAPAS_VISUALES_OPERATIVAS.map((etapa) => {
              const mov = movimientosByPaso.get(etapa.pasoVisual);
              const stock = stockByPaso.get(etapa.pasoVisual);
              const active = selectedVisualSteps.has(etapa.pasoVisual);
              const llegaron = mov?.llegaronCount ?? 0;
              const anteriores = mov?.venianDeAntesCount ?? 0;
              const delPeriodo = mov?.cohortePeriodoCount ?? 0;
              const siguenAqui = cohortByPaso.get(etapa.pasoVisual) ?? 0;
              const siguenPct = percent(siguenAqui, cohortTotal);
              const ahora = stock?.count ?? 0;
              const movimientosDisponibles = !error && (data != null || !loading);
              const ingresosDisponibles = !cohortError && !(cohortLoading && cohortBuckets.length === 0);

              return (
                <tr
                  key={etapa.pasoVisual}
                  className={`border-b border-slate-100 last:border-b-0 ${
                    active ? "bg-blue-50/60" : "bg-white hover:bg-slate-50/70"
                  }`}
                >
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-start gap-2">
                      <span
                        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${stageBadgeClass(
                          etapa.pasoVisual,
                        )}`}
                      >
                        Paso {etapa.pasoVisual}
                      </span>
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onStagePress(etapa.etapaInterna)}
                          className="text-left font-semibold text-slate-900 hover:text-blue-700 hover:underline"
                          title={`Ver expedientes de ${etapa.nombre}`}
                        >
                          {etapa.nombre}
                        </button>
                        {active ? (
                          <p className="mt-0.5 text-[11px] font-medium text-blue-700">Filtro activo</p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <p className="text-xl font-semibold leading-none tabular-nums text-slate-950">
                      {loading && !data ? "…" : movimientosDisponibles ? llegaron : "—"}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      {movimientosDisponibles
                        ? `${delPeriodo} ingresaron a Mesa en el rango · ${anteriores} ya venían de antes`
                        : "Desglose no disponible"}
                    </p>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <p className="text-xl font-semibold leading-none tabular-nums text-slate-950">
                      {cohortLoading && cohortBuckets.length === 0
                        ? "…"
                        : ingresosDisponibles
                          ? siguenAqui
                          : "—"}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {ingresosDisponibles && cohortTotal > 0
                        ? `${siguenPct}% de los ingresos del periodo`
                        : cohortTotal === 0 && ingresosDisponibles
                          ? "Sin ingresos en el periodo"
                          : "Ubicación no disponible"}
                    </p>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <p className="text-xl font-semibold leading-none tabular-nums text-slate-950">
                      {loading && !data ? "…" : movimientosDisponibles ? ahora : "—"}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">Foto vigente del CRM</p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Cada expediente cuenta una sola vez por etapa dentro del rango, aunque reingrese. Puede aparecer
        en varias filas si pasó por varias etapas. La cita biométrica legacy se agrupa con “Listo para cita
        de biométrico”.
      </p>
    </section>
  );
}
