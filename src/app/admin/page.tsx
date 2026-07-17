"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSessionRepo } from "@/domain/session";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatMontoMX } from "@/lib/monto";
import { formatDateTimeMx } from "@/lib/filters";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";
import { getEtapaOperativaNombre } from "@/domain/expedientes/asesor-seguimiento-operativo";
import {
  useAdminProductionRepo,
  resolveAdminPeriodBounds,
  type AdminPeriodPreset,
  type AdminEstadoFilter,
  type AdminPrecalDecisionFilter,
  type AdminAsesorProductionRow,
  type AdminProductionSummary,
  type AdminMesaEnvioEvent,
  type AdminPrecalEvent,
} from "@/domain/admin-production";
import type { AdminEtapaBucket, AdminPrecalSummary } from "@/domain/admin-production/repo";
import {
  buildAdminProductionWorkbook,
  downloadAdminProductionWorkbook,
} from "@/lib/exportAdminProductionExcel";
import { subestadoOperativoLabel } from "@/lib/subestadoOperativoUi";

const PAGE_SIZE = 25;

function etapaTone(etapa: number): string {
  if (etapa <= 2) return "border-slate-200 bg-slate-50 text-slate-800";
  if (etapa <= 5) return "border-cyan-200 bg-cyan-50 text-cyan-900";
  if (etapa <= 8) return "border-amber-200 bg-amber-50 text-amber-950";
  if (etapa <= 10) return "border-violet-200 bg-violet-50 text-violet-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function compactEtapas(etapas: Readonly<Record<string, number>>): string {
  const groups: Array<{ label: string; n: number }> = [
    { label: "Integración", n: (etapas["1"] ?? 0) + (etapas["2"] ?? 0) },
    {
      label: "Biométricos",
      n: (etapas["3"] ?? 0) + (etapas["4"] ?? 0) + (etapas["5"] ?? 0),
    },
    { label: "Pendiente Acuse", n: etapas["8"] ?? 0 },
    { label: "Firma", n: (etapas["9"] ?? 0) + (etapas["10"] ?? 0) },
    { label: "Finalizados", n: (etapas["11"] ?? 0) + (etapas["12"] ?? 0) },
  ];
  return groups
    .filter((g) => g.n > 0)
    .map((g) => `${g.label} ${g.n}`)
    .join(" · ") || "—";
}

export default function AdminDashboardPage() {
  const { sessionRepo, currentUser } = useSessionRepo();
  const repo = useAdminProductionRepo();

  const [preset, setPreset] = useState<AdminPeriodPreset>("mes");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [asesorId, setAsesorId] = useState<string>("");
  const [etapaActual, setEtapaActual] = useState<string>("todas");
  const [estado, setEstado] = useState<AdminEstadoFilter>("todos");
  const [buscar, setBuscar] = useState("");
  const [precalDecision, setPrecalDecision] =
    useState<AdminPrecalDecisionFilter>("todas");
  const [mesaPage, setMesaPage] = useState(1);
  const [precalPage, setPrecalPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AdminProductionSummary | null>(null);
  const [byEtapa, setByEtapa] = useState<readonly AdminEtapaBucket[]>([]);
  const [asesores, setAsesores] = useState<readonly AdminAsesorProductionRow[]>([]);
  const [mesaItems, setMesaItems] = useState<readonly AdminMesaEnvioEvent[]>([]);
  const [mesaTotal, setMesaTotal] = useState(0);
  const [precalItems, setPrecalItems] = useState<readonly AdminPrecalEvent[]>([]);
  const [precalTotal, setPrecalTotal] = useState(0);
  const [precalSummary, setPrecalSummary] = useState<AdminPrecalSummary | null>(null);
  const [exporting, setExporting] = useState(false);

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

  const filtersBase = useMemo(() => {
    if (!bounds) return null;
    return {
      bounds,
      asesorId: asesorId || null,
      etapaActual: etapaActual === "todas" ? null : Number(etapaActual),
      estado,
      buscar: buscar.trim() || null,
      precalDecision,
    };
  }, [bounds, asesorId, etapaActual, estado, buscar, precalDecision]);

  const load = useCallback(async () => {
    if (!filtersBase) {
      setError("Rango de fechas inválido");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [s, cohort, as, mesa, precal] = await Promise.all([
        repo.getSummary(filtersBase),
        repo.getMesaCohortByEtapa(filtersBase),
        repo.listByAsesor(filtersBase),
        repo.listMesaEnviosPage({
          ...filtersBase,
          page: mesaPage,
          pageSize: PAGE_SIZE,
        }),
        repo.listPrecalificacionesPage({
          ...filtersBase,
          page: precalPage,
          pageSize: PAGE_SIZE,
        }),
      ]);
      setSummary(s);
      setByEtapa(cohort.byEtapa);
      setAsesores(as);
      setMesaItems(mesa.items);
      setMesaTotal(mesa.totalCount);
      setPrecalItems(precal.items);
      setPrecalTotal(precal.totalCount);
      setPrecalSummary(precal.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar producción");
    } finally {
      setLoading(false);
    }
  }, [filtersBase, mesaPage, precalPage, repo]);

  useEffect(() => {
    if (currentUser?.role === "super_admin") void load();
  }, [currentUser, load]);

  const clearFilters = () => {
    setPreset("mes");
    setCustomFrom("");
    setCustomTo("");
    setAsesorId("");
    setEtapaActual("todas");
    setEstado("todos");
    setBuscar("");
    setPrecalDecision("todas");
    setMesaPage(1);
    setPrecalPage(1);
  };

  const onPreset = (p: AdminPeriodPreset) => {
    setPreset(p);
    setMesaPage(1);
    setPrecalPage(1);
  };

  const exportExcel = async () => {
    if (!filtersBase || !bounds) return;
    setExporting(true);
    try {
      const data = await repo.exportAll(filtersBase);
      const wb = buildAdminProductionWorkbook({ bounds, ...data });
      downloadAdminProductionWorkbook(wb, bounds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al exportar Excel");
    } finally {
      setExporting(false);
    }
  };

  if (currentUser === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-500">Cargando...</p>
      </div>
    );
  }

  if (!currentUser || currentUser.role !== "super_admin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">
          <Link href="/login" className="text-blue-600 underline">
            Inicia sesión como Super Admin
          </Link>
        </p>
      </div>
    );
  }

  // Nombre completo vía helper pendiente en otra rama; temporalmente email.
  const displayName = currentUser.email?.trim() || "Administrador";

  const periodoLabel = bounds
    ? `${bounds.fromDate} — ${bounds.toDateInclusive}`
    : "—";

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              Administración · Producción
            </h1>
            <p className="text-sm text-slate-600">
              Consulta la producción por periodo y el estado actual de los
              expedientes.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-700">{displayName}</span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void sessionRepo.logout()}
            >
              Cerrar sesión
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <section className="sticky top-0 z-10 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["hoy", "Hoy"],
                ["semana", "Esta semana"],
                ["mes", "Este mes"],
                ["personalizado", "Personalizado"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => onPreset(key)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  preset === key
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {preset === "personalizado" && (
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="text-sm text-slate-600">
                Desde
                <Input
                  type="date"
                  className="mt-1"
                  value={customFrom}
                  onChange={(e) => {
                    setCustomFrom(e.target.value);
                    setMesaPage(1);
                    setPrecalPage(1);
                  }}
                />
              </label>
              <label className="text-sm text-slate-600">
                Hasta
                <Input
                  type="date"
                  className="mt-1"
                  value={customTo}
                  onChange={(e) => {
                    setCustomTo(e.target.value);
                    setMesaPage(1);
                    setPrecalPage(1);
                  }}
                />
              </label>
            </div>
          )}

          <p className="mt-3 text-sm font-medium text-slate-800">
            Periodo activo: {periodoLabel}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Las fechas determinan qué expedientes se incluyen. Las etapas muestran
            su estado actual.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Select
              label="Asesor"
              value={asesorId}
              onChange={(e) => {
                setAsesorId(e.target.value);
                setMesaPage(1);
                setPrecalPage(1);
              }}
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
            <Select
              label="Etapa actual"
              value={etapaActual}
              onChange={(e) => {
                setEtapaActual(e.target.value);
                setMesaPage(1);
              }}
              options={[
                { value: "todas", label: "Todas" },
                ...Array.from({ length: 12 }, (_, i) => i + 1).map((n) => ({
                  value: String(n),
                  label: `${n}. ${getEtapaOperativaNombre(n)}`,
                })),
              ]}
            />
            <Select
              label="Estado"
              value={estado}
              onChange={(e) => {
                setEstado(e.target.value as AdminEstadoFilter);
                setMesaPage(1);
              }}
              options={[
                { value: "todos", label: "Todos" },
                { value: "activos", label: "Activos" },
                { value: "finalizados", label: "Finalizados" },
                { value: "rechazados", label: "Rechazados/cerrados" },
              ]}
            />
            <label className="text-sm text-slate-600">
              Buscar
              <Input
                className="mt-1"
                value={buscar}
                placeholder="Cliente, asesor, programa"
                onChange={(e) => {
                  setBuscar(e.target.value);
                  setMesaPage(1);
                  setPrecalPage(1);
                }}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={clearFilters}>
              Limpiar filtros
            </Button>
            <Button type="button" onClick={() => void exportExcel()} disabled={exporting || !bounds}>
              {exporting ? "Exportando…" : "Descargar Excel"}
            </Button>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-slate-500">Cargando producción…</p>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  title: "Enviados a Mesa",
                  value: summary?.enviadosAMesa ?? 0,
                  hint: periodoLabel,
                },
                {
                  title: "Precalificaciones aprobadas",
                  value: summary?.precalificacionesAprobadas ?? 0,
                  hint: periodoLabel,
                },
                {
                  title: "Aprobadas > $20,000",
                  value: summary?.aprobadasMayorA20000 ?? 0,
                  hint: "monto al aprobar",
                },
                {
                  title: "Monto aprobado total",
                  value: formatMontoMX(summary?.montoAprobadoTotal ?? 0),
                  hint: periodoLabel,
                },
              ].map((card) => (
                <div
                  key={card.title}
                  className="rounded-lg border border-slate-200 bg-white p-4"
                >
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    {card.title}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {card.value}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{card.hint}</p>
                </div>
              ))}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-base font-semibold text-slate-900">
                Estado actual de los expedientes enviados a Mesa
              </h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {byEtapa.map((b) => (
                  <button
                    key={b.etapa}
                    type="button"
                    onClick={() => {
                      setEtapaActual(String(b.etapa));
                      setMesaPage(1);
                    }}
                    className={`rounded-md border px-3 py-2 text-left ${etapaTone(b.etapa)} ${
                      etapaActual === String(b.etapa) ? "ring-2 ring-slate-900" : ""
                    }`}
                  >
                    <p className="text-sm font-medium">
                      {getEtapaOperativaNombre(b.etapa)}
                    </p>
                    <p className="text-xs opacity-80">
                      {b.count} expedientes · {b.pct}%
                    </p>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-base font-semibold text-slate-900">
                Producción por asesor
              </h2>
              {asesores.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Sin resultados.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b text-xs uppercase text-slate-500">
                      <tr>
                        <th className="py-2 pr-3">Asesor</th>
                        <th className="py-2 pr-3">Enviados</th>
                        <th className="py-2 pr-3">Aprobadas</th>
                        <th className="py-2 pr-3">&gt;$20k</th>
                        <th className="py-2 pr-3">Monto</th>
                        <th className="py-2 pr-3">Estado actual</th>
                        <th className="py-2">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {asesores.map((a) => (
                        <tr key={a.asesorId} className="border-b border-slate-100">
                          <td className="py-2 pr-3 font-medium text-slate-800">
                            {formatAsesorExpedienteLabel({
                              fullName: a.asesorNombre,
                              email: a.asesorEmail,
                              fallbackId: a.asesorId,
                            })}
                          </td>
                          <td className="py-2 pr-3">{a.enviadosAMesa}</td>
                          <td className="py-2 pr-3">{a.precalificacionesAprobadas}</td>
                          <td className="py-2 pr-3">{a.aprobadasMayorA20000}</td>
                          <td className="py-2 pr-3">
                            {formatMontoMX(a.montoAprobadoTotal)}
                          </td>
                          <td className="py-2 pr-3 text-xs text-slate-600">
                            {compactEtapas(a.etapas)}
                          </td>
                          <td className="py-2">
                            <button
                              type="button"
                              className="text-blue-700 underline"
                              onClick={() => {
                                setAsesorId(a.asesorId);
                                setMesaPage(1);
                                setPrecalPage(1);
                              }}
                            >
                              Ver producción
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-base font-semibold text-slate-900">
                Expedientes enviados a Mesa
              </h2>
              {mesaItems.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Sin resultados.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b text-xs uppercase text-slate-500">
                      <tr>
                        <th className="py-2 pr-3">Envío</th>
                        <th className="py-2 pr-3">Cliente</th>
                        <th className="py-2 pr-3">Asesor</th>
                        <th className="py-2 pr-3">Etapa</th>
                        <th className="py-2 pr-3">Estado</th>
                        <th className="py-2 pr-3">Programa</th>
                        <th className="py-2 pr-3">Monto</th>
                        <th className="py-2">Actualizado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mesaItems.map((r) => (
                        <tr key={r.expedienteId} className="border-b border-slate-100">
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {formatDateTimeMx(r.fechaEnvioMesa)}
                          </td>
                          <td className="py-2 pr-3">{r.clienteNombre}</td>
                          <td className="py-2 pr-3">
                            {formatAsesorExpedienteLabel({
                              fullName: r.asesorNombre,
                              email: r.asesorEmail,
                              fallbackId: r.asesorId,
                            })}
                          </td>
                          <td className="py-2 pr-3">
                            {getEtapaOperativaNombre(r.etapaActual)}
                          </td>
                          <td className="py-2 pr-3">
                            {r.cicloEstado} / {subestadoOperativoLabel(r.subestado)}
                          </td>
                          <td className="py-2 pr-3">{r.programa}</td>
                          <td className="py-2 pr-3">
                            {r.montoAprobadoAlAprobar != null
                              ? formatMontoMX(r.montoAprobadoAlAprobar)
                              : "—"}
                          </td>
                          <td className="py-2 whitespace-nowrap">
                            {r.updatedAt ? formatDateTimeMx(r.updatedAt) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
                <span>
                  {mesaTotal} resultado{mesaTotal === 1 ? "" : "s"}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={mesaPage <= 1}
                    onClick={() => setMesaPage((p) => Math.max(1, p - 1))}
                  >
                    Anterior
                  </Button>
                  <span>
                    Página {mesaPage} / {Math.max(1, Math.ceil(mesaTotal / PAGE_SIZE))}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={mesaPage * PAGE_SIZE >= mesaTotal}
                    onClick={() => setMesaPage((p) => p + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-900">
                  Precalificaciones
                </h2>
                <Select
                  label="Decisión"
                  value={precalDecision}
                  onChange={(e) => {
                    setPrecalDecision(e.target.value as AdminPrecalDecisionFilter);
                    setPrecalPage(1);
                  }}
                  options={[
                    { value: "todas", label: "Todas" },
                    { value: "aprobadas", label: "Aprobadas" },
                    {
                      value: "aprobadas_mayor_20000",
                      label: "Aprobadas > $20,000",
                    },
                    { value: "no_cumple", label: "No cumple" },
                    { value: "pendientes", label: "Pendientes" },
                  ]}
                />
              </div>
              {precalSummary && (
                <p className="mt-2 text-xs text-slate-600">
                  Aprobadas {precalSummary.aprobadas} · &gt;$20k{" "}
                  {precalSummary.aprobadasMayorA20000} · Total{" "}
                  {formatMontoMX(precalSummary.montoAprobadoTotal)} · Promedio{" "}
                  {formatMontoMX(precalSummary.montoPromedioAprobado)}
                </p>
              )}
              {precalItems.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Sin resultados.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b text-xs uppercase text-slate-500">
                      <tr>
                        <th className="py-2 pr-3">Fecha</th>
                        <th className="py-2 pr-3">Cliente</th>
                        <th className="py-2 pr-3">Asesor</th>
                        <th className="py-2 pr-3">Decisión</th>
                        <th className="py-2 pr-3">Monto al aprobar</th>
                        <th className="py-2">Programa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {precalItems.map((r) => (
                        <tr key={r.expedienteId} className="border-b border-slate-100">
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {formatDateTimeMx(r.aprobadoAt)}
                          </td>
                          <td className="py-2 pr-3">{r.clienteNombre}</td>
                          <td className="py-2 pr-3">
                            {formatAsesorExpedienteLabel({
                              fullName: r.asesorNombre,
                              email: r.asesorEmail,
                              fallbackId: r.asesorId,
                            })}
                          </td>
                          <td className="py-2 pr-3">{r.decision}</td>
                          <td className="py-2 pr-3">
                            {formatMontoMX(r.montoAprobadoAlAprobar)}
                          </td>
                          <td className="py-2">{r.programa}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
                <span>
                  {precalTotal} resultado{precalTotal === 1 ? "" : "s"}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={precalPage <= 1}
                    onClick={() => setPrecalPage((p) => Math.max(1, p - 1))}
                  >
                    Anterior
                  </Button>
                  <span>
                    Página {precalPage} /{" "}
                    {Math.max(1, Math.ceil(precalTotal / PAGE_SIZE))}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={precalPage * PAGE_SIZE >= precalTotal}
                    onClick={() => setPrecalPage((p) => p + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
