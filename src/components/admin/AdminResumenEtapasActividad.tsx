"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  ADMIN_VISIBLE_STAGES,
  TOTAL_PASOS_ADMIN_VISIBLES,
  mapEtapaInternaAAdminPaso,
} from "@/domain/admin-production/admin-visible-stages";
import type {
  AdminEstadoFilter,
  AdminPeriodBounds,
} from "@/domain/admin-production";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

type MovimientoPasoAdmin = Readonly<{
  pasoAdmin: number;
  llegaronCount: number;
  venianDeAntesCount: number;
  cohortePeriodoCount: number;
}>;

type StockPasoAdmin = Readonly<{
  pasoAdmin: number;
  count: number;
}>;

type ResumenEtapasActividad = Readonly<{
  totalExpedientesMovidos: number;
  movimientosAdmin: readonly MovimientoPasoAdmin[];
  stockTotal: number;
  stockAdmin: readonly StockPasoAdmin[];
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

function mapPasoVisualAAdminPaso(pasoVisual: number): number | null {
  if (pasoVisual >= 1 && pasoVisual <= 7) return pasoVisual;
  if (pasoVisual === 8 || pasoVisual === 9) return 8;
  if (pasoVisual === 10) return 9;
  if (pasoVisual === 11) return 10;
  return null;
}

function parseResumen(raw: unknown): ResumenEtapasActividad {
  const root = record(raw);
  const adminRaw = Array.isArray(root.by_paso_admin) ? root.by_paso_admin : [];
  const visualRaw = Array.isArray(root.by_paso_visual) ? root.by_paso_visual : [];
  const snapshot = record(root.snapshot);
  const stockRaw = Array.isArray(snapshot.by_paso_visual)
    ? snapshot.by_paso_visual
    : [];

  const movimientosAdminByPaso = new Map<number, MovimientoPasoAdmin>();

  if (adminRaw.length > 0) {
    for (const item of adminRaw) {
      const r = record(item);
      const pasoAdmin = num(r.paso_admin);
      if (pasoAdmin < 1 || pasoAdmin > TOTAL_PASOS_ADMIN_VISIBLES) continue;
      movimientosAdminByPaso.set(pasoAdmin, {
        pasoAdmin,
        llegaronCount: num(r.llegaron_count),
        venianDeAntesCount: num(r.venian_de_antes_count),
        cohortePeriodoCount: num(r.cohorte_periodo_count),
      });
    }
  } else {
    // Compatibilidad defensiva si una preview apuntara temporalmente a una RPC vieja.
    for (const item of visualRaw) {
      const r = record(item);
      const pasoAdmin = mapPasoVisualAAdminPaso(num(r.paso_visual));
      if (!pasoAdmin) continue;
      const prev = movimientosAdminByPaso.get(pasoAdmin) ?? {
        pasoAdmin,
        llegaronCount: 0,
        venianDeAntesCount: 0,
        cohortePeriodoCount: 0,
      };
      movimientosAdminByPaso.set(pasoAdmin, {
        pasoAdmin,
        llegaronCount: prev.llegaronCount + num(r.llegaron_count),
        venianDeAntesCount: prev.venianDeAntesCount + num(r.venian_de_antes_count),
        cohortePeriodoCount: prev.cohortePeriodoCount + num(r.cohorte_periodo_count),
      });
    }
  }

  const stockAdminByPaso = new Map<number, number>();
  for (const item of stockRaw) {
    const r = record(item);
    const pasoAdmin = mapPasoVisualAAdminPaso(num(r.paso_visual));
    if (!pasoAdmin) continue;
    stockAdminByPaso.set(
      pasoAdmin,
      (stockAdminByPaso.get(pasoAdmin) ?? 0) + num(r.count),
    );
  }

  return {
    totalExpedientesMovidos: num(root.total_expedientes_movidos),
    movimientosAdmin: Array.from(
      { length: TOTAL_PASOS_ADMIN_VISIBLES },
      (_, i) => {
        const pasoAdmin = i + 1;
        return (
          movimientosAdminByPaso.get(pasoAdmin) ?? {
            pasoAdmin,
            llegaronCount: 0,
            venianDeAntesCount: 0,
            cohortePeriodoCount: 0,
          }
        );
      },
    ),
    stockTotal: num(snapshot.total_actual),
    stockAdmin: Array.from(
      { length: TOTAL_PASOS_ADMIN_VISIBLES },
      (_, i) => ({
        pasoAdmin: i + 1,
        count: stockAdminByPaso.get(i + 1) ?? 0,
      }),
    ),
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
  if (paso <= 8) return "bg-violet-50 text-violet-800";
  return "bg-emerald-50 text-emerald-800";
}

function progressClass(paso: number): string {
  if (paso <= 2) return "bg-slate-500";
  if (paso <= 4) return "bg-cyan-500";
  if (paso <= 7) return "bg-amber-500";
  if (paso <= 8) return "bg-violet-500";
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

  const selectedStage = useMemo(() => {
    const selected = new Set(selectedInternalStages ?? []);
    return (
      ADMIN_VISIBLE_STAGES.find((stage) =>
        stage.etapaInternas.some((etapa) => selected.has(etapa)),
      ) ?? null
    );
  }, [selectedInternalStages]);

  const cohortByPasoAdmin = useMemo(() => {
    const out = new Map<number, number>();
    for (const bucket of cohortBuckets) {
      const pasoAdmin = mapEtapaInternaAAdminPaso(bucket.etapa);
      out.set(pasoAdmin, (out.get(pasoAdmin) ?? 0) + bucket.count);
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
          p_buscar: null,
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
  }, [bounds.fromIso, bounds.toExclusiveIso, asesorId, estado]);

  useEffect(() => {
    void load();
    return () => {
      seqRef.current += 1;
    };
  }, [load]);

  const movimientosByPasoAdmin = useMemo(
    () => new Map((data?.movimientosAdmin ?? []).map((r) => [r.pasoAdmin, r])),
    [data],
  );
  const stockByPasoAdmin = useMemo(
    () => new Map((data?.stockAdmin ?? []).map((r) => [r.pasoAdmin, r.count])),
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
    ? movimientosByPasoAdmin.get(selectedStage.pasoAdmin)
    : null;
  const selectedCohortCount = selectedStage
    ? cohortByPasoAdmin.get(selectedStage.pasoAdmin) ?? 0
    : 0;
  const selectedStockCount = selectedStage
    ? stockByPasoAdmin.get(selectedStage.pasoAdmin) ?? 0
    : 0;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              {selectedStage ? "Detalle de etapa" : "Flujo del periodo"}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              {selectedStage
                ? `Paso ${selectedStage.pasoAdmin} de ${TOTAL_PASOS_ADMIN_VISIBLES} · ${selectedStage.nombre}`
                : `¿Dónde están hoy los ${cohortTotalDisplay} ingresos del periodo?`}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              {selectedStage
                ? `${periodoLabel} · Esta vista explica la etapa seleccionada sin cambiar los KPI generales del periodo.`
                : `${periodoLabel} · Seguimiento de los expedientes que entraron a Mesa dentro del rango seleccionado.`}
            </p>
          </div>
          {updatedAt ? (
            <p className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
              Actualizado {formatUpdatedAt(updatedAt)}
            </p>
          ) : null}
        </div>

        {buscar ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
            <strong className="font-semibold text-slate-800">Buscar es un localizador.</strong>{" "}
            Los resultados encontrados se muestran aparte; esta vista conserva las cifras generales del periodo para que todos los indicadores usen la misma base.
          </div>
        ) : null}

        {selectedStage ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                Ingresos del periodo que siguen aquí
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                {cohortLoading && cohortBuckets.length === 0
                  ? "…"
                  : cohortError
                    ? "—"
                    : selectedCohortCount}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                {cohortTotal > 0
                  ? `${selectedCohortCount} de ${cohortTotal} · ${percent(selectedCohortCount, cohortTotal)}%`
                  : "Sin ingresos en el periodo"}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Llegaron a esta etapa en el periodo
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                {loading && !data ? "…" : error ? "—" : selectedMovement?.llegaronCount ?? 0}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                {selectedMovement?.cohortePeriodoCount ?? 0} ingresaron a Mesa en el periodo · {selectedMovement?.venianDeAntesCount ?? 0} ya venían de antes
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Total actualmente en esta etapa
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                {loading && !data ? "…" : error ? "—" : selectedStockCount}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Todos los expedientes que están hoy aquí, sin importar cuándo ingresaron
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                Ingresaron a Mesa
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                {cohortTotalDisplay}
              </p>
              <p className="mt-1 text-xs text-slate-600">Base del periodo seleccionado</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Expedientes con movimiento
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                {movementsTotalDisplay}
              </p>
              <p className="mt-1 text-xs text-slate-500">Incluye expedientes de periodos anteriores</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Total actual del CRM
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                {stockTotalDisplay}
              </p>
              <p className="mt-1 text-xs text-slate-500">Foto vigente, independiente del periodo</p>
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
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Paso {selectedStage.pasoAdmin} · {selectedStage.nombre}
              </p>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
                Los tres números no se suman entre sí: el primero sigue a los ingresos del periodo, el segundo mide actividad ocurrida dentro del rango y el tercero muestra la carga total vigente.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => onStagePress(selectedStage.etapaCanonDisplay)}
            >
              Ver expedientes de esta etapa
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-950">
                  Distribución actual de los ingresos del periodo
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  La cifra grande indica cuántos de los {cohortTotalDisplay} ingresos están hoy en cada etapa. “CRM hoy” muestra la carga total vigente de esa etapa.
                </p>
              </div>
              <p className="text-xs text-slate-500">10 etapas · de Integración a Pago a ConCasa</p>
            </div>

            <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {ADMIN_VISIBLE_STAGES.map((stage) => {
                const siguenAqui = cohortByPasoAdmin.get(stage.pasoAdmin) ?? 0;
                const siguenPct = percent(siguenAqui, cohortTotal);
                const totalActual = stockByPasoAdmin.get(stage.pasoAdmin) ?? 0;
                const ubicacionDisponible =
                  !cohortError && !(cohortLoading && cohortBuckets.length === 0);
                const stockDisponible = !error && (data != null || !loading);

                return (
                  <button
                    key={stage.pasoAdmin}
                    type="button"
                    onClick={() => onStagePress(stage.etapaCanonDisplay)}
                    className="group grid w-full gap-3 px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 md:grid-cols-[15rem_minmax(0,1fr)_7rem] md:items-center"
                    title={`Ver expedientes de ${stage.nombre}`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`shrink-0 rounded px-2 py-1 text-[10px] font-semibold uppercase ${stageBadgeClass(stage.pasoAdmin)}`}
                      >
                        Paso {stage.pasoAdmin}
                      </span>
                      <span className="truncate text-sm font-semibold text-slate-900 group-hover:text-blue-700">
                        {stage.nombre}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full transition-all ${progressClass(stage.pasoAdmin)}`}
                            style={{ width: `${Math.min(100, Math.max(0, siguenPct))}%` }}
                          />
                        </div>
                        <span className="w-14 shrink-0 text-right text-xs font-medium tabular-nums text-slate-500">
                          {ubicacionDisponible ? `${siguenPct}%` : "—"}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {ubicacionDisponible
                          ? `${siguenAqui} de ${cohortTotal} ingresos están hoy aquí`
                          : "Ubicación no disponible"}
                      </p>
                    </div>

                    <div className="text-left md:text-right">
                      <p className="text-lg font-semibold leading-none tabular-nums text-slate-950">
                        {cohortLoading && cohortBuckets.length === 0
                          ? "…"
                          : ubicacionDisponible
                            ? siguenAqui
                            : "—"}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        CRM hoy: <strong className="font-semibold tabular-nums text-slate-700">{stockDisponible ? totalActual : "—"}</strong>
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <details className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-800 hover:text-slate-950">
            Ver movimientos del periodo por etapa
            <span className="ml-2 text-xs font-normal text-slate-500">
              incluye expedientes que ingresaron en meses anteriores
            </span>
          </summary>
          <div className="border-t border-slate-200 bg-white p-4">
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              Aquí se mide actividad: un expediente cuenta una sola vez por cada etapa visible que alcanzó dentro del periodo. Puede aparecer en varias etapas si avanzó durante el rango.
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-[680px] w-full border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5 font-semibold">Etapa</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Llegaron a esta etapa</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Ingresaron a Mesa en el periodo</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Ya venían de antes</th>
                  </tr>
                </thead>
                <tbody>
                  {ADMIN_VISIBLE_STAGES.map((stage) => {
                    const mov = movimientosByPasoAdmin.get(stage.pasoAdmin);
                    const llegaron = mov?.llegaronCount ?? 0;
                    const delPeriodo = mov?.cohortePeriodoCount ?? 0;
                    const anteriores = mov?.venianDeAntesCount ?? 0;
                    const disponible = !error && (data != null || !loading);
                    const active = selectedStage?.pasoAdmin === stage.pasoAdmin;

                    return (
                      <tr
                        key={stage.pasoAdmin}
                        className={`border-b border-slate-100 last:border-b-0 ${active ? "bg-blue-50/60" : ""}`}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${stageBadgeClass(stage.pasoAdmin)}`}
                            >
                              Paso {stage.pasoAdmin}
                            </span>
                            <span className="font-medium text-slate-800">{stage.nombre}</span>
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
