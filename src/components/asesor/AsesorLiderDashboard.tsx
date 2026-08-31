"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import {
  ASESOR_LIDER_DEFAULT_PAGE_SIZE,
  asesorLiderTotalPages,
  clampAsesorLiderPage,
  useAsesorLiderRepo,
  type AsesorLiderContext,
  type AsesorLiderDashboard,
  type AsesorLiderExpedienteRow,
  type AsesorLiderMember,
} from "@/domain/asesor-lider";
import type { SessionRepo, UserSession } from "@/domain/session";
import { formatDateTimeMx } from "@/lib/filters";
import { formatMontoMX } from "@/lib/monto";

const ETAPA_OPTIONS = [
  { value: "", label: "Todas las etapas" },
  { value: "1", label: "1 · Integración" },
  { value: "2", label: "2 · Registro" },
  { value: "3", label: "3 · Listo biométrico" },
  { value: "4", label: "4 · Cita biométricos" },
  { value: "5", label: "5 · Biometría" },
  { value: "6", label: "6 · Inscripción" },
  { value: "7", label: "7 · Notificación" },
  { value: "8", label: "8 · Acuse / retención" },
  { value: "9", label: "9 · Listo firma" },
  { value: "10", label: "10 · Cita firma" },
  { value: "11", label: "11 · Firmado" },
  { value: "12", label: "12 · Pago ConCasa" },
];

const DONUT_COLORS = [
  "#2563eb",
  "#0891b2",
  "#059669",
  "#65a30d",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#9333ea",
  "#4f46e5",
  "#0d9488",
  "#78716c",
];

function EtapaDonut({
  buckets,
}: {
  buckets: readonly { etapa: number; nombre: string; count: number }[];
}) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const gradient =
    total <= 0
      ? "conic-gradient(#e5e7eb 0deg 360deg)"
      : (() => {
          let acc = 0;
          const parts: string[] = [];
          for (let i = 0; i < buckets.length; i++) {
            const b = buckets[i]!;
            if (b.count <= 0) continue;
            const start = (acc / total) * 360;
            acc += b.count;
            const end = (acc / total) * 360;
            parts.push(
              `${DONUT_COLORS[(b.etapa - 1) % DONUT_COLORS.length]} ${start}deg ${end}deg`,
            );
          }
          return `conic-gradient(${parts.join(", ")})`;
        })();

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-6">
      <div
        className="relative h-36 w-36 shrink-0 rounded-full"
        style={{ background: gradient }}
        role="img"
        aria-label={`Distribución por etapa, total ${total}`}
      >
        <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-white">
          <span className="text-2xl font-semibold text-gray-900">{total}</span>
          <span className="text-xs text-gray-500">Total</span>
        </div>
      </div>
      <p className="max-w-xs text-center text-sm text-gray-600 sm:text-left">
        Distribución de expedientes por etapa operativa (1–12).
      </p>
    </div>
  );
}

function downloadCsv(
  rows: readonly AsesorLiderExpedienteRow[],
  filename: string,
) {
  const headers = [
    "cliente",
    "nss",
    "asesor",
    "etapa",
    "ciclo",
    "decision",
    "monto",
    "creado",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const cells = [
      r.cliente_nombre,
      r.nss,
      r.asesor_nombre ?? "",
      String(r.etapa_actual ?? ""),
      r.ciclo_estado ?? "",
      r.decision ?? "",
      String(r.monto_aprobado_al_aprobar ?? r.monto_aprobado ?? ""),
      r.created_at,
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
    lines.push(cells.join(","));
  }
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type Props = Readonly<{
  context: AsesorLiderContext;
  currentUser: UserSession;
  sessionRepo: SessionRepo;
}>;

export function AsesorLiderDashboard({
  context,
  currentUser,
  sessionRepo,
}: Props) {
  const repo = useAsesorLiderRepo();
  const [members, setMembers] = useState<readonly AsesorLiderMember[]>([]);
  const [dashboard, setDashboard] = useState<AsesorLiderDashboard | null>(null);
  const [rows, setRows] = useState<readonly AsesorLiderExpedienteRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [asesorId, setAsesorId] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [buscar, setBuscar] = useState("");
  const [buscarDebounced, setBuscarDebounced] = useState("");
  const [etapaExacta, setEtapaExacta] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setBuscarDebounced(buscar.trim()), 350);
    return () => window.clearTimeout(t);
  }, [buscar]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await repo.listMembers();
        if (!cancelled) setMembers(m);
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error ? err.message : "No se pudieron cargar miembros.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const reload = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const etapaNum = etapaExacta ? Number(etapaExacta) : null;
      const [dash, pageResult] = await Promise.all([
        repo.getDashboard({
          asesorId: asesorId || null,
          fechaDesde: fechaDesde || null,
          fechaHasta: fechaHasta || null,
        }),
        repo.listExpedientesPage({
          page,
          page_size: ASESOR_LIDER_DEFAULT_PAGE_SIZE,
          buscar: buscarDebounced || null,
          asesor_id: asesorId || null,
          etapa_exacta: etapaNum,
          fecha_desde: fechaDesde || null,
          fecha_hasta: fechaHasta || null,
          ciclo: null,
        }),
      ]);
      setDashboard(dash);
      setRows(pageResult.items);
      setTotalCount(pageResult.total_count);
      const clamped = clampAsesorLiderPage(
        page,
        pageResult.total_count,
        pageResult.page_size,
      );
      if (clamped !== page) setPage(clamped);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Error al cargar el dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, [
    repo,
    page,
    asesorId,
    fechaDesde,
    fechaHasta,
    buscarDebounced,
    etapaExacta,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const totalPages = useMemo(
    () => asesorLiderTotalPages(totalCount, ASESOR_LIDER_DEFAULT_PAGE_SIZE),
    [totalCount],
  );

  const asesorOptions = useMemo(
    () => [
      { value: "", label: "Todos los asesores" },
      ...members.map((m) => ({
        value: m.id,
        label: m.is_leader ? `${m.full_name} (líder)` : m.full_name,
      })),
    ],
    [members],
  );

  const teamName = context.team?.nombre ?? "Equipo";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-3 py-3 sm:px-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:max-w-7xl">
          <div>
            <h1 className="text-base font-semibold text-gray-900 sm:text-lg">
              ConCasa CRM · Dashboard equipo
            </h1>
            <p className="text-sm text-gray-500">{teamName}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="min-w-0 truncate text-sm text-gray-500">
              {currentUser.email}
            </span>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await sessionRepo.logout();
                } catch (err) {
                  console.error("[logout] error líder:", err);
                }
                if (typeof window !== "undefined") {
                  window.location.href = "/login";
                }
              }}
              className="min-h-[44px] touch-manipulation sm:min-h-0"
            >
              Cerrar sesión
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-4 px-3 py-3 sm:px-4 sm:py-4 lg:max-w-7xl lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900 sm:text-base">
            Resumen del equipo
          </h2>
          <div className="flex flex-wrap gap-2">
            <Link href="/asesor/nueva">
              <Button
                variant="primary"
                className="min-h-[44px] touch-manipulation sm:min-h-0"
              >
                Agregar Cliente
              </Button>
            </Link>
            <Button
              variant="secondary"
              className="min-h-[44px] touch-manipulation sm:min-h-0"
              disabled={rows.length === 0}
              onClick={() =>
                downloadCsv(
                  rows,
                  `equipo-expedientes-p${page}-${new Date().toISOString().slice(0, 10)}.csv`,
                )
              }
            >
              Exportar Excel
            </Button>
          </div>
        </div>

        {errorMsg ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {errorMsg}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Activos
            </p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              {dashboard?.activos ?? "—"}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Cerrados
            </p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              {dashboard?.cerrados ?? "—"}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Total
            </p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              {dashboard?.total ?? "—"}
            </p>
            {dashboard ? (
              <p className="mt-1 text-xs text-gray-500">
                Monto aprobado: {formatMontoMX(dashboard.monto_total_aprobado)}
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Select
              label="Asesor"
              name="filtro_asesor"
              options={asesorOptions}
              value={asesorId}
              onChange={(e) => {
                setAsesorId(e.target.value);
                setPage(1);
              }}
              className="min-h-[44px] sm:min-h-0"
            />
            <Input
              label="Desde"
              name="fecha_desde"
              type="date"
              value={fechaDesde}
              onChange={(e) => {
                setFechaDesde(e.target.value);
                setPage(1);
              }}
              className="min-h-[44px] sm:min-h-0"
            />
            <Input
              label="Hasta"
              name="fecha_hasta"
              type="date"
              value={fechaHasta}
              onChange={(e) => {
                setFechaHasta(e.target.value);
                setPage(1);
              }}
              className="min-h-[44px] sm:min-h-0"
            />
            <Input
              label="Buscar"
              name="buscar"
              placeholder="Nombre, NSS, teléfono…"
              value={buscar}
              onChange={(e) => {
                setBuscar(e.target.value);
                setPage(1);
              }}
              className="min-h-[44px] sm:min-h-0"
            />
            <Select
              label="Etapa"
              name="etapa"
              options={ETAPA_OPTIONS}
              value={etapaExacta}
              onChange={(e) => {
                setEtapaExacta(e.target.value);
                setPage(1);
              }}
              className="min-h-[44px] sm:min-h-0"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              Por etapa
            </h3>
            <EtapaDonut buckets={dashboard?.by_etapa ?? []} />
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              Detalle por etapa
            </h3>
            <div className="flex flex-wrap gap-2">
              {(dashboard?.by_etapa ?? [])
                .filter((b) => b.count > 0)
                .map((b) => (
                  <button
                    key={b.etapa}
                    type="button"
                    onClick={() => {
                      setEtapaExacta(String(b.etapa));
                      setPage(1);
                    }}
                    className="inline-flex flex-col rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs hover:border-blue-300 hover:bg-blue-50"
                  >
                    <span className="font-medium text-gray-900">
                      {b.etapa}. {b.nombre}
                    </span>
                    <span className="text-gray-600">
                      {b.count} · {formatMontoMX(b.monto)}
                    </span>
                  </button>
                ))}
              {(dashboard?.by_etapa ?? []).every((b) => b.count === 0) ? (
                <p className="text-sm text-gray-500">Sin expedientes en el filtro.</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
            <h3 className="text-sm font-semibold text-gray-900">Expedientes</h3>
            <span className="text-xs text-gray-500">
              {loading
                ? "Cargando…"
                : `${totalCount} resultado${totalCount === 1 ? "" : "s"}`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">
                    Cliente
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">
                    Asesor
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">
                    Etapa
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">
                    Monto
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">
                    Creado
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 && !loading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-gray-500"
                    >
                      No hay expedientes con estos filtros.
                    </td>
                  </tr>
                ) : null}
                {rows.map((r) => {
                  const monto =
                    typeof r.monto_aprobado_al_aprobar === "number" &&
                    r.monto_aprobado_al_aprobar > 0
                      ? formatMontoMX(r.monto_aprobado_al_aprobar)
                      : typeof r.monto_aprobado === "number" &&
                          r.monto_aprobado > 0
                        ? formatMontoMX(r.monto_aprobado)
                        : "—";
                  return (
                    <tr key={r.id} className="hover:bg-gray-50/80">
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">
                          {r.cliente_nombre}
                        </div>
                        <div className="text-xs text-gray-500">NSS {r.nss}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {r.asesor_nombre ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {r.etapa_actual ?? "—"}
                        {r.ciclo_estado ? (
                          <span className="ml-1 text-xs text-gray-400">
                            ({r.ciclo_estado})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{monto}</td>
                      <td className="px-3 py-2 text-gray-600">
                        {formatDateTimeMx(r.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/asesor/expediente/${r.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3">
            <Button
              variant="outline"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="min-h-[44px] touch-manipulation sm:min-h-0"
            >
              Anterior
            </Button>
            <span className="text-sm text-gray-600">
              Página {page} de {totalPages}
            </span>
            <Button
              variant="outline"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="min-h-[44px] touch-manipulation sm:min-h-0"
            >
              Siguiente
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
