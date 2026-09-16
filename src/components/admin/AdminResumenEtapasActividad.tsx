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

type Props = Readonly<{
  bounds: AdminPeriodBounds;
  periodoLabel: string;
  asesorId: string | null;
  estado: AdminEstadoFilter;
  buscar: string | null;
  selectedInternalStages?: readonly number[] | null;
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

function toneForPaso(paso: number): string {
  if (paso <= 2) return "border-slate-200 bg-slate-50";
  if (paso <= 4) return "border-cyan-200 bg-cyan-50/60";
  if (paso <= 7) return "border-amber-200 bg-amber-50/60";
  if (paso <= 9) return "border-violet-200 bg-violet-50/60";
  return "border-emerald-200 bg-emerald-50/60";
}

export function AdminResumenEtapasActividad({
  bounds,
  periodoLabel,
  asesorId,
  estado,
  buscar,
  selectedInternalStages,
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

  const stockByPaso = useMemo(
    () => new Map((data?.stock ?? []).map((r) => [r.pasoVisual, r])),
    [data],
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Movimientos del periodo + foto actual
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-600">
            Por etapa: muestra qué expedientes pasaron por ella durante {periodoLabel},
            aunque hayan ingresado a Mesa en un periodo anterior. “Ahora” es la foto
            vigente del CRM y no depende de la fecha seleccionada.
          </p>
        </div>
        {data?.generatedAt ? (
          <p className="text-xs text-slate-500">
            Actualizado: {formatUpdatedAt(data.generatedAt)}
          </p>
        ) : null}
      </div>

      {loading && !data ? (
        <p className="mt-3 text-sm text-slate-600">
          Calculando movimientos y foto actual…
        </p>
      ) : error ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-red-700">
          <span>No fue posible cargar este resumen.</span>
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Reintentar
          </Button>
        </div>
      ) : data ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-800">
              <strong className="tabular-nums">{data.totalExpedientesMovidos}</strong>{" "}
              expediente{data.totalExpedientesMovidos === 1 ? "" : "s"} con movimiento
              en el periodo
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-800">
              Foto actual:{" "}
              <strong className="tabular-nums">{data.stockTotal}</strong> expediente
              {data.stockTotal === 1 ? "" : "s"}
            </span>
            {loading ? (
              <span className="px-2 py-1.5 text-slate-500">Actualizando…</span>
            ) : null}
          </div>

          {!data.historyCompleteForPeriod ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              El historial de movimientos existe desde{" "}
              <strong>{formatCoverageDate(data.historyCoverageFrom)}</strong>. Si el
              rango inicia antes, la foto actual sigue siendo completa, pero los
              movimientos anteriores a esa fecha no pueden reconstruirse.
            </div>
          ) : null}

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ETAPAS_VISUALES_OPERATIVAS.map((etapa) => {
              const mov = data.movimientos.find(
                (r) => r.pasoVisual === etapa.pasoVisual,
              );
              const stock = stockByPaso.get(etapa.pasoVisual);
              const active = selectedVisualSteps.has(etapa.pasoVisual);
              const llegaron = mov?.llegaronCount ?? 0;
              const anteriores = mov?.venianDeAntesCount ?? 0;
              const delPeriodo = mov?.cohortePeriodoCount ?? 0;
              const ahora = stock?.count ?? 0;

              return (
                <div
                  key={etapa.pasoVisual}
                  className={`rounded-md border p-3 ${toneForPaso(etapa.pasoVisual)} ${
                    active ? "ring-2 ring-slate-900 ring-offset-1" : ""
                  }`}
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

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[11px] text-slate-500">Llegaron en periodo</p>
                      <p className="text-2xl font-semibold leading-none tabular-nums text-slate-950">
                        {llegaron}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">Ahora</p>
                      <p className="text-2xl font-semibold leading-none tabular-nums text-slate-950">
                        {ahora}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-200/80 pt-2 text-[11px] text-slate-600">
                    <span>
                      De antes:{" "}
                      <strong className="font-semibold tabular-nums text-slate-900">
                        {anteriores}
                      </strong>
                    </span>
                    <span>
                      Ingresaron en rango:{" "}
                      <strong className="font-semibold tabular-nums text-slate-900">
                        {delPeriodo}
                      </strong>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            “Llegaron en periodo” cuenta cada expediente una sola vez por etapa si entró
            a ella durante el rango. Incluye reingresos o retrocesos para no ocultar
            actividad real de una etapa. Para el historial se usan los 11 pasos
            canónicos: la cita biométrica legacy se agrupa con “Listo para cita de
            biométrico”.
          </p>
        </>
      ) : null}
    </section>
  );
}
