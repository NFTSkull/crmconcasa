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

function toneForPaso(paso: number): string {
  if (paso <= 2) return "border-slate-200 bg-slate-50";
  if (paso <= 4) return "border-cyan-200 bg-cyan-50/60";
  if (paso <= 7) return "border-amber-200 bg-amber-50/60";
  if (paso <= 9) return "border-violet-200 bg-violet-50/60";
  return "border-emerald-200 bg-emerald-50/60";
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

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Flujo de expedientes
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-600">
            Una sola vista para saber qué se movió durante {periodoLabel}, dónde están
            hoy los expedientes que ingresaron en ese periodo y cuál es la carga total
            actual del CRM.
          </p>
        </div>
        {updatedAt ? (
          <p className="text-xs text-slate-500">
            Actualizado: {formatUpdatedAt(updatedAt)}
          </p>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Ingresaron a Mesa
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">
            {cohortLoading && cohortBuckets.length === 0 ? "…" : cohortTotal}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600">Dentro del periodo</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Tuvieron movimiento
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">
            {loading && !data ? "…" : (data?.totalExpedientesMovidos ?? "—")}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600">
            Aunque hayan ingresado antes
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Expedientes hoy
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">
            {loading && !data ? "…" : (data?.stockTotal ?? "—")}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-600">Foto actual del CRM</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-3">
        <p>
          <strong className="font-semibold text-slate-800">Pasaron aquí:</strong>{" "}
          actividad ocurrida dentro del periodo.
        </p>
        <p>
          <strong className="font-semibold text-slate-800">Siguen aquí:</strong>{" "}
          ubicación actual de los que ingresaron a Mesa en el periodo.
        </p>
        <p>
          <strong className="font-semibold text-slate-800">Total hoy:</strong>{" "}
          todos los expedientes que actualmente están en esa etapa.
        </p>
      </div>

      {error ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>No fue posible cargar movimientos y foto actual.</span>
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
          <strong>{formatCoverageDate(data.historyCoverageFrom)}</strong>. Si el rango
          inicia antes, la foto actual y la ubicación de la cohorte siguen disponibles,
          pero los movimientos anteriores a esa fecha no pueden reconstruirse.
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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

          return (
            <button
              key={etapa.pasoVisual}
              type="button"
              aria-pressed={active}
              onClick={() => onStagePress(etapa.etapaInterna)}
              className={`rounded-md border p-3 text-left transition hover:border-slate-400 hover:shadow-sm ${toneForPaso(
                etapa.pasoVisual,
              )} ${active ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Paso {etapa.pasoVisual}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">
                    {etapa.nombre}
                  </p>
                </div>
                {active ? (
                  <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                    Filtro
                  </span>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Pasaron aquí
                  </p>
                  <p className="mt-0.5 text-xl font-semibold leading-none tabular-nums text-slate-950">
                    {loading && !data ? "…" : error ? "—" : llegaron}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Siguen aquí
                  </p>
                  <p className="mt-0.5 text-xl font-semibold leading-none tabular-nums text-slate-950">
                    {cohortLoading && cohortBuckets.length === 0
                      ? "…"
                      : cohortError
                        ? "—"
                        : siguenAqui}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Total hoy
                  </p>
                  <p className="mt-0.5 text-xl font-semibold leading-none tabular-nums text-slate-950">
                    {loading && !data ? "…" : error ? "—" : ahora}
                  </p>
                </div>
              </div>

              <div className="mt-2 border-t border-slate-200/80 pt-2 text-[11px] leading-relaxed text-slate-600">
                <p>
                  De los que pasaron aquí: <strong className="tabular-nums text-slate-900">{delPeriodo}</strong>{" "}
                  ingresaron en el rango · <strong className="tabular-nums text-slate-900">{anteriores}</strong>{" "}
                  venían de antes.
                </p>
                <p className="mt-0.5">
                  De los {cohortTotal} ingresos del periodo, <strong className="tabular-nums text-slate-900">{siguenAqui}</strong>{" "}
                  siguen aquí{cohortTotal > 0 ? ` (${siguenPct}%)` : ""}.
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        “Pasaron aquí” cuenta cada expediente una sola vez por etapa dentro del rango,
        aunque haya reingresado. “Siguen aquí” usa la cohorte enviada a Mesa dentro del
        rango. “Total hoy” es independiente de la fecha seleccionada. La cita biométrica
        legacy se agrupa con “Listo para cita de biométrico”.
      </p>
    </section>
  );
}
