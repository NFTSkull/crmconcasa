"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSessionRepo } from "@/domain/session";
import { Button } from "@/components/ui/Button";
import {
  subestadoOperativoBadgeClass,
  subestadoOperativoLabel,
} from "@/lib/subestadoOperativoUi";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatDateTimeMx } from "@/lib/filters";
import {
  ExpedientesSupabaseError,
  useExpedientesRepo,
  type ExpedienteMock,
} from "@/domain/expedientes";
import {
  computeAdminFunnelByEtapa,
  computeAdminFunnelExclusive,
  computeAdminMetricsByAsesor,
  computeAdminOperativoKpis,
  computeAdminTimeMetrics,
} from "@/lib/adminDashboardStats";
import { ETAPAS_LABELS } from "@/app/mesa-control/mockData";
import { isDataModeSupabase } from "@/lib/dataMode";

interface AdminPrecalMock {
  id: string;
  programa: string;
  nss: string;
  cliente_nombre: string;
  telefono_cliente: string;
  direccion_opcional: string;
  asesorId: string;
  createdAt: string;
  decision: string;
  monto_aprobado: number | null;
  notas_revision: string;
  etapaActual: number | null;
  subestadoOperativo: string | null;
  fechaCita: string | null;
  updatedAtOperativo: string | null;
}

function mapExpedienteToAdminPrecal(e: ExpedienteMock): AdminPrecalMock {
  return {
    id: e.id,
    programa: e.base.programa,
    nss: e.base.nss,
    cliente_nombre: e.base.cliente_nombre,
    telefono_cliente: e.base.telefono_cliente,
    direccion_opcional: e.base.direccion_opcional,
    asesorId: e.base.asesorId,
    createdAt: e.base.createdAt,
    decision: e.editorDecision.decision,
    monto_aprobado: e.editorDecision.monto_aprobado,
    notas_revision: e.editorDecision.notas_revision,
    etapaActual: e.operativo.etapaActual,
    subestadoOperativo: e.operativo.subestado,
    fechaCita: e.operativo.fechaCita,
    updatedAtOperativo: e.operativo.updatedAt,
  };
}

function getTodayYMD(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(t.getDate()).padStart(2, "0")}`;
}

function getYmdFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return null;
  }
}

function computeDayKpis(dayYmd: string, list: AdminPrecalMock[]) {
  const dayList = list.filter(
    (p) => getYmdFromIso(p.createdAt) === dayYmd,
  );
  const total = dayList.length;
  let pendientes = 0;
  let aprobadas = 0;
  let noCumple = 0;
  dayList.forEach((p) => {
    const d = p.decision ?? "pendiente";
    if (d === "aprobado") aprobadas += 1;
    else if (d === "no_cumple") noCumple += 1;
    else pendientes += 1;
  });
  return { total, pendientes, aprobadas, noCumple };
}

function getDecisionLabel(decision?: string): string {
  const d = decision ?? "pendiente";
  switch (d) {
    case "aprobado":
      return "Aprobado";
    case "no_cumple":
      return "No cumple";
    case "rechazado":
      return "Rechazado";
    case "pendiente":
    default:
      return "Pendiente";
  }
}

function getDecisionBadgeClass(decision?: string): string {
  const d = decision ?? "pendiente";
  if (d === "aprobado") {
    return "bg-green-100 text-green-800";
  }
  if (d === "no_cumple" || d === "rechazado") {
    return "bg-red-100 text-red-800";
  }
  if (d === "pendiente") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-gray-100 text-gray-700";
}

function filterList(
  list: AdminPrecalMock[],
  buscar: string,
  etapaFilter: string,
  subestadoFilter: string,
  soloMesa: boolean,
): AdminPrecalMock[] {
  let result = [...list];
  if (buscar.trim()) {
    const q = buscar.trim().toLowerCase();
    result = result.filter((p) => {
      return (
        p.cliente_nombre.toLowerCase().includes(q) ||
        p.telefono_cliente.includes(q) ||
        p.programa.toLowerCase().includes(q) ||
        (p.asesorId ?? "").toLowerCase().includes(q)
      );
    });
  }
  if (etapaFilter !== "todas") {
    const n = Number(etapaFilter);
    result = result.filter((p) => (p.etapaActual ?? null) === n);
  }
  if (subestadoFilter !== "todas") {
    result = result.filter(
      (p) => (p.subestadoOperativo ?? "pendiente") === subestadoFilter,
    );
  }
  if (soloMesa) {
    result = result.filter((p) => p.etapaActual != null);
  }
  return result;
}

const PAGE_SIZE = 50;
const DAY_PAGE_SIZE = 20;

export default function AdminDashboardPage() {
  const { sessionRepo, currentUser } = useSessionRepo();
  const repo = useExpedientesRepo();
  const dataSupabase = isDataModeSupabase();
  const [expedientesMock, setExpedientesMock] = useState<ExpedienteMock[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const [etapaFilter, setEtapaFilter] = useState<string>("todas");
  const [subestadoFilter, setSubestadoFilter] = useState<string>("todas");
  const [soloMesa, setSoloMesa] = useState(false);
  const [daySelected, setDaySelected] = useState<string>(getTodayYMD());
  const [page, setPage] = useState(1);
  const [dayPage, setDayPage] = useState(1);

  const mockList = useMemo(
    () => expedientesMock.map(mapExpedienteToAdminPrecal),
    [expedientesMock],
  );

  useEffect(() => {
    if (!currentUser) return;
    repo
      .listForAdmin()
      .then((list) => {
        setExpedientesMock(list);
        setListError(null);
      })
      .catch((err) => {
        setExpedientesMock([]);
        if (err instanceof ExpedientesSupabaseError) {
          setListError(err.message);
        } else {
          setListError("No se pudo cargar el listado.");
        }
      });
  }, [currentUser, repo]);

  useEffect(() => {
    const reload = () => {
      repo
        .listForAdmin()
        .then((list) => {
          setExpedientesMock(list);
          setListError(null);
        })
        .catch((err) => {
          setExpedientesMock([]);
          if (err instanceof ExpedientesSupabaseError) {
            setListError(err.message);
          }
        });
    };
    const handler = (e: StorageEvent) => {
      if (
        e.key === "precalificaciones_mock" ||
        e.key === "decisions_mock" ||
        e.key === "mesa_control_inbox"
      ) {
        reload();
      }
    };
    const customHandler = () => {
      reload();
    };
    window.addEventListener("storage", handler);
    window.addEventListener("mesa_control_inbox_updated", customHandler);
    window.addEventListener("decisions_mock_updated", customHandler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("mesa_control_inbox_updated", customHandler);
      window.removeEventListener("decisions_mock_updated", customHandler);
    };
  }, [repo]);

  const filteredList = useMemo(
    () => filterList(mockList, buscar, etapaFilter, subestadoFilter, soloMesa),
    [mockList, buscar, etapaFilter, subestadoFilter, soloMesa],
  );

  const operativoKpis = useMemo(
    () => computeAdminOperativoKpis(expedientesMock),
    [expedientesMock],
  );

  const funnelExclusive = useMemo(
    () => computeAdminFunnelExclusive(expedientesMock),
    [expedientesMock],
  );

  const funnelByEtapa = useMemo(
    () => computeAdminFunnelByEtapa(expedientesMock),
    [expedientesMock],
  );

  const metricsByAsesor = useMemo(
    () => computeAdminMetricsByAsesor(expedientesMock),
    [expedientesMock],
  );

  const timeMetrics = useMemo(
    () => computeAdminTimeMetrics(expedientesMock),
    [expedientesMock],
  );

  const totalPages = Math.max(
    1,
    Math.ceil(filteredList.length / PAGE_SIZE),
  );

  const safePage = Math.max(1, Math.min(page, totalPages));

  const pagedList = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredList.slice(start, start + PAGE_SIZE);
  }, [filteredList, safePage]);

  const dayList = useMemo(() => {
    const ymd = daySelected;
    return filteredList.filter(
      (p) => getYmdFromIso(p.createdAt) === ymd,
    );
  }, [filteredList, daySelected]);

  const dayTotalPages = Math.max(
    1,
    Math.ceil(dayList.length / DAY_PAGE_SIZE),
  );

  const safeDayPage = Math.max(1, Math.min(dayPage, dayTotalPages));

  const dayPagedList = useMemo(() => {
    const start = (safeDayPage - 1) * DAY_PAGE_SIZE;
    return dayList.slice(start, start + DAY_PAGE_SIZE);
  }, [dayList, safeDayPage]);

  const dayKpis = useMemo(
    () => computeDayKpis(daySelected, filteredList),
    [daySelected, filteredList],
  );

  if (currentUser === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }
  if (!currentUser || currentUser.role !== "super_admin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-600">
          <Link href="/login" className="text-blue-600 underline">
            Inicia sesión como Super Admin
          </Link>
        </p>
      </div>
    );
  }

  const canPrevious = safePage > 1;
  const canNext = safePage < totalPages;
  const canDayPrevious = safeDayPage > 1;
  const canDayNext = safeDayPage < dayTotalPages;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">
            ConCasa CRM · Administración{dataSupabase ? "" : " (mock)"}
          </h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{currentUser.email}</span>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await sessionRepo.logout();
                } catch (err) {
                  console.error("[logout] admin:", err);
                }
                if (typeof window !== "undefined") {
                  window.location.href = "/login";
                }
              }}
            >
              Cerrar sesión
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {/* Resumen operativo global (mockList / ExpedienteMock[]) */}
        <section className="space-y-4 rounded-lg border border-indigo-100 bg-white p-4 shadow-sm sm:p-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Resumen operativo (vista global)
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {dataSupabase
                ? "KPIs y funnel calculados sobre expedientes cargados desde Supabase; el listado inferior sigue respetando filtros."
                : "KPIs y funnel calculados sobre todos los expedientes mock cargados; el listado inferior sigue respetando filtros."}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            {(
              [
                { k: "Total", v: operativoKpis.total, c: "text-gray-900" },
                { k: "En proceso", v: operativoKpis.enProceso, c: "text-blue-800" },
                { k: "En mesa", v: operativoKpis.enMesa, c: "text-indigo-800" },
                {
                  k: "Biométricos",
                  v: operativoKpis.enBiometricos,
                  c: "text-cyan-800",
                },
                { k: "Firma", v: operativoKpis.enFirma, c: "text-violet-800" },
                { k: "Firmados (≥11)", v: operativoKpis.firmados, c: "text-emerald-800" },
                {
                  k: "Rech. operativo",
                  v: operativoKpis.rechazadosOperativo,
                  c: "text-red-800",
                },
                {
                  k: "Rech. editor",
                  v: operativoKpis.rechazadosEditor,
                  c: "text-red-700",
                },
              ] as const
            ).map(({ k, v, c }) => (
              <div
                key={k}
                className="rounded-lg border border-gray-100 bg-gray-50/80 p-3 shadow-sm"
              >
                <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                  {k}
                </p>
                <p className={`mt-1 text-xl font-semibold tabular-nums ${c}`}>{v}</p>
              </div>
            ))}
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Funnel (excluyente)
            </h3>
            <p className="mt-1 text-[11px] text-gray-500">
              Cada expediente cuenta en una sola etapa: finalizado → firma → trámite (6–8) →
              biométricos (3–5) → mesa (1–2 o validación) → precal (sin envío a mesa) → otros.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  { label: "Precal", n: funnelExclusive.precal },
                  { label: "Mesa", n: funnelExclusive.mesa },
                  { label: "Biométricos", n: funnelExclusive.biometricos },
                  { label: "Trámite", n: funnelExclusive.tramite },
                  { label: "Firma", n: funnelExclusive.firma },
                  { label: "Finalizado", n: funnelExclusive.finalizado },
                  ...(funnelExclusive.otros > 0
                    ? [{ label: "Otros", n: funnelExclusive.otros }]
                    : []),
                ] as const
              ).map(({ label, n }) => (
                <div
                  key={label}
                  className="min-w-[5.5rem] flex-1 rounded-md border border-gray-200 bg-white px-2 py-2 text-center shadow-sm"
                >
                  <p className="text-[10px] font-medium text-gray-500">{label}</p>
                  <p className="text-lg font-semibold tabular-nums text-gray-900">{n}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Conteo por etapa operativa
            </h3>
            <div className="mt-2 overflow-x-auto rounded-lg border border-gray-100">
              <table className="min-w-full divide-y divide-gray-100 text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    {Array.from({ length: 12 }, (_, i) => (
                      <th
                        key={i + 1}
                        className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-gray-600"
                      >
                        {i + 1}
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-left font-medium text-gray-600">Sin etapa</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {Array.from({ length: 12 }, (_, i) => (
                      <td key={i + 1} className="px-2 py-1.5 tabular-nums text-gray-900">
                        {funnelByEtapa.byEtapa[i + 1] ?? 0}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 tabular-nums text-gray-700">
                      {funnelByEtapa.sinEtapa}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[10px] text-gray-400">
              Referencia rápida de etiquetas:{" "}
              {[1, 2, 3, 4, 5, 9, 10, 11].map((id) => (
                <span key={id} className="mr-2 inline-block">
                  {id}: {ETAPAS_LABELS[id] ?? "—"}
                </span>
              ))}
            </p>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Métricas por asesor{dataSupabase ? "" : " (mock)"}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Agrupación por <span className="font-mono text-[11px]">base.asesorId</span> sobre los
              {dataSupabase
                ? " mismos expedientes cargados desde Supabase."
                : " mismos expedientes mock."}{" "}
              Biométricos y firma solo cuentan si hay envío a mesa y etapa
              3–5 o 9–10. Conversión = firmados (etapa ≥ 11) ÷ enviados a mesa; si no hubo envíos a
              mesa se muestra “—”.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="min-w-[56rem] w-full divide-y divide-gray-100 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="whitespace-nowrap px-2 py-2 text-left font-medium text-gray-600">
                    Asesor
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
                    Total
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
                    Enviados mesa
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
                    Biométricos (3–5)
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
                    Firma (9–10)
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
                    Firmados (≥11)
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
                    Rech. operativo
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
                    Rech. editor
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-right font-medium text-gray-600">
                    Conv. firm./mesa
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {metricsByAsesor.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-2 py-4 text-center text-gray-500">
                      {dataSupabase ? "Sin expedientes." : "Sin expedientes mock."}
                    </td>
                  </tr>
                ) : (
                  metricsByAsesor.map((r) => (
                    <tr key={r.asesorId} className="hover:bg-gray-50/80">
                      <td className="max-w-[14rem] truncate px-2 py-2 font-mono text-[11px] text-gray-900">
                        {r.asesorId}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-900">
                        {r.totalExpedientes}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-900">
                        {r.enviadosMesa}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-cyan-900">
                        {r.enBiometricos}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-violet-900">
                        {r.enFirma}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-emerald-900">
                        {r.firmados}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-red-800">
                        {r.rechazadosOperativo}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-red-700">
                        {r.rechazadosEditor}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-900">
                        {r.conversionFirmadosSobreEnviadosMesa === null
                          ? "—"
                          : `${(r.conversionFirmadosSobreEnviadosMesa * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-amber-100 bg-white p-4 shadow-sm sm:p-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Tiempos del proceso</h2>
            <p className="mt-1 text-xs text-gray-600">
              Aproximaciones basadas solo en <span className="font-mono text-[11px]">createdAt</span>,{" "}
              <span className="font-mono text-[11px]">updatedAt</span> y{" "}
              <span className="font-mono text-[11px]">etapaActual</span>: el intervalo es desde creación
              hasta la última actualización operativa, no la duración real de cada tramo. La columna
              “Enviado mesa” en el ranking solo describe el estado actual.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-100 bg-gray-50/80 p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Tiempo total promedio (etapa ≥ 11)
              </p>
              {timeMetrics.tiempoTotalPromedioFirmados ? (
                <>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900">
                    {timeMetrics.tiempoTotalPromedioFirmados.meanDays.toFixed(1)} días
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    n = {timeMetrics.tiempoTotalPromedioFirmados.sampleSize}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-gray-500">Sin expedientes firmados con fechas válidas.</p>
              )}
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50/80 p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Cuello de botella (antigüedad media, n ≥ 3)
              </p>
              {timeMetrics.cuelloDeBotella ? (
                <>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-amber-900">
                    Etapa{" "}
                    {timeMetrics.cuelloDeBotella.etapa == null
                      ? "sin etapa"
                      : timeMetrics.cuelloDeBotella.etapa}
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-600">
                    {timeMetrics.cuelloDeBotella.meanDays.toFixed(1)} días de media · n ={" "}
                    {timeMetrics.cuelloDeBotella.sampleSize}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-gray-500">
                  Ninguna etapa alcanza el mínimo de tres expedientes con fechas válidas.
                </p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Antigüedad media por etapa actual
            </h3>
            <div className="mt-2 overflow-x-auto rounded-lg border border-gray-100">
              <table className="min-w-full divide-y divide-gray-100 text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium text-gray-600">Etapa</th>
                    <th className="px-2 py-2 text-right font-medium text-gray-600">Días (media)</th>
                    <th className="px-2 py-2 text-right font-medium text-gray-600">n</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {timeMetrics.antiguedadPorEtapa.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-2 py-3 text-center text-gray-500">
                        Sin intervalos válidos (createdAt → updatedAt).
                      </td>
                    </tr>
                  ) : (
                    timeMetrics.antiguedadPorEtapa.map((r) => (
                      <tr key={r.etapa == null ? "sin" : String(r.etapa)}>
                        <td className="px-2 py-2 text-gray-900">
                          {r.etapa == null ? "Sin etapa" : r.etapa}
                          {r.etapa != null && ETAPAS_LABELS[r.etapa] ? (
                            <span className="ml-1 text-gray-500">· {ETAPAS_LABELS[r.etapa]}</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-gray-900">
                          {r.meanDays.toFixed(1)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-gray-600">
                          {r.sampleSize}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Top 10 expedientes más lentos (creación → última actualización)
            </h3>
            <div className="mt-2 overflow-x-auto rounded-lg border border-gray-100">
              <table className="min-w-full divide-y divide-gray-100 text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium text-gray-600">Expediente</th>
                    <th className="px-2 py-2 text-right font-medium text-gray-600">Días</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-600">Etapa</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-600">Mesa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {timeMetrics.top10MasLentos.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-center text-gray-500">
                        Sin expedientes con fechas válidas.
                      </td>
                    </tr>
                  ) : (
                    timeMetrics.top10MasLentos.map((r) => (
                      <tr key={r.id}>
                        <td className="px-2 py-2">
                          <Link
                            href={`/admin/${r.id}`}
                            className="font-mono text-[11px] text-blue-700 underline"
                          >
                            {r.id}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-gray-900">
                          {r.totalDays.toFixed(1)}
                        </td>
                        <td className="px-2 py-2 text-gray-800">
                          {r.etapaActual == null ? "—" : r.etapaActual}
                        </td>
                        <td className="px-2 py-2 text-gray-700">
                          {r.submittedToMesa ? "Sí" : "No"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* KPIs del día */}
        <section className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-gray-500">
              Total del día (filtros)
            </p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              {dayKpis.total}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-gray-500">
              Pendientes
            </p>
            <p className="mt-1 text-2xl font-semibold text-amber-700">
              {dayKpis.pendientes}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-gray-500">
              Aprobadas
            </p>
            <p className="mt-1 text-2xl font-semibold text-green-700">
              {dayKpis.aprobadas}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-gray-500">
              No cumple
            </p>
            <p className="mt-1 text-2xl font-semibold text-red-700">
              {dayKpis.noCumple}
            </p>
          </div>
        </section>

        {/* Vista del día */}
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="day-picker"
                className="text-sm font-medium text-gray-700"
              >
                Día
              </label>
              <input
                id="day-picker"
                type="date"
                value={daySelected}
                onChange={(e) => {
                  setDaySelected(e.target.value);
                  setDayPage(1);
                }}
                className="rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <p className="text-xs text-gray-500">
              Mostrando {dayPagedList.length} de {dayList.length} registros del
              día.
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Creada
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Programa
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    NSS
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Cliente
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Teléfono
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Asesor
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Decisión
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Monto
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Notas
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {dayPagedList.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-sm text-gray-500"
                    >
                      No hay precalificaciones en este día.
                    </td>
                  </tr>
                ) : (
                  dayPagedList.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                        {formatDateTimeMx(p.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">
                        {p.programa}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                        {p.nss}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                        {p.cliente_nombre || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                        {p.telefono_cliente || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                        {p.asesorId || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getDecisionBadgeClass(
                            p.decision,
                          )}`}
                        >
                          {getDecisionLabel(p.decision)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                        {p.monto_aprobado != null
                          ? `$${p.monto_aprobado.toLocaleString()}`
                          : "—"}
                      </td>
                      <td className="max-w-[200px] px-3 py-2 text-sm text-gray-600">
                        {p.notas_revision?.trim() || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-4 text-xs text-gray-600">
            <span>
              Página {dayPage} de {dayTotalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="text-xs"
                disabled={!canDayPrevious}
                onClick={() => setDayPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                className="text-xs"
                disabled={!canDayNext}
                onClick={() => setDayPage((p) => Math.min(dayTotalPages, p + 1))}
              >
                Siguiente
              </Button>
            </div>
          </div>
        </section>

        {/* Filtros operativos + tabla principal */}
        <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">
              Todas las precalificaciones{dataSupabase ? "" : " (mock)"}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Total: {filteredList.length} · Página {page} de {totalPages}
            </p>
            {listError ? (
              <p className="mt-2 text-xs text-red-600">{listError}</p>
            ) : null}
          </div>
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="flex flex-wrap items-end gap-4">
          <Input
            type="search"
            placeholder="Buscar (cliente, teléfono, programa, asesor)"
            value={buscar}
            onChange={(e) => {
              setBuscar(e.target.value);
              setPage(1);
              setDayPage(1);
            }}
            className="min-w-[220px]"
          />
              <Select
                label="Etapa"
                value={etapaFilter}
                onChange={(e) => {
                  setEtapaFilter(e.target.value);
                  setPage(1);
                  setDayPage(1);
                }}
                options={[
                  { value: "todas", label: "Todas" },
                  { value: "1", label: "1. Integración" },
                  { value: "2", label: "2. Registro" },
                  { value: "3", label: "3. Listo cita biométricos" },
                  { value: "4", label: "4. Cita agendada (biométricos)" },
                  { value: "5", label: "5. Biometría (resultado)" },
                  { value: "6", label: "6. Inscripción" },
                  { value: "7", label: "7. Notificación" },
                  { value: "8", label: "8. Acuse / Aviso retención" },
                  { value: "9", label: "9. Listo agendar firma" },
                  { value: "10", label: "10. Cita para firma" },
                  { value: "11", label: "11. Firmado" },
                  { value: "12", label: "12. Pago a ConCasa" },
                ]}
              />
              <Select
                label="Subestado operativo"
                value={subestadoFilter}
                onChange={(e) => {
                  setSubestadoFilter(e.target.value);
                  setPage(1);
                  setDayPage(1);
                }}
                options={[
                  { value: "todas", label: "Todos" },
                  { value: "pendiente", label: "Pendiente" },
                  { value: "en_validacion_mesa", label: "En validación por mesa" },
                  { value: "en_proceso", label: "En proceso" },
                  { value: "aprobado", label: "Aprobado" },
                  { value: "rechazado", label: "Rechazado" },
                ]}
              />
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={soloMesa}
                  onChange={(e) => {
                    setSoloMesa(e.target.checked);
                    setPage(1);
                    setDayPage(1);
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">
                  Solo enviados a mesa
                </span>
              </label>
            </div>
          </div>

          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Creada
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Cliente
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Teléfono
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Programa
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Asesor
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Decisión
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Etapa
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Subestado
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Cita
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Últ. actualización
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Acción
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {pagedList.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    className="px-4 py-8 text-center text-sm text-gray-500"
                  >
                    {listError
                      ? "No se pudo mostrar el listado."
                      : expedientesMock.length === 0
                        ? "No hay expedientes registrados."
                        : "No hay registros que coincidan con los filtros."}
                  </td>
                </tr>
              ) : (
                pagedList.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                      {formatDateTimeMx(p.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">
                      {p.cliente_nombre || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                      {p.telefono_cliente || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                      {p.programa}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                      {p.asesorId || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getDecisionBadgeClass(
                          p.decision,
                        )}`}
                      >
                        {getDecisionLabel(p.decision)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                      {p.etapaActual ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${subestadoOperativoBadgeClass(p.subestadoOperativo)}`}
                      >
                        {subestadoOperativoLabel(p.subestadoOperativo)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                      {p.fechaCita ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                      {p.updatedAtOperativo
                        ? formatDateTimeMx(p.updatedAtOperativo)
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 space-x-2">
                      <Link href={`/admin/${p.id}`}>
                        <Button variant="outline" className="text-xs">
                          {dataSupabase ? "Abrir detalle" : "Abrir admin mock"}
                        </Button>
                      </Link>
                      {p.etapaActual != null && (
                        <Link href={`/mesa-control/${p.id}`}>
                          <Button variant="outline" className="text-xs">
                            Ver en mesa
                          </Button>
                        </Link>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="border-t border-gray-100 px-4 py-3 text-xs text-gray-600">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Página {page} de {totalPages} · Total filtrado:{" "}
                {filteredList.length}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="text-xs"
                  disabled={!canPrevious}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  className="text-xs"
                  disabled={!canNext}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
