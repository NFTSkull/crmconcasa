"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  labelEditorDecision,
  decisionBadgeClass,
  formatPrecalMontoAlAprobarDisplay,
  type AdminPeriodPreset,
  type AdminEstadoFilter,
  type AdminPrecalDecisionFilter,
  type AdminAsesorProductionRow,
  type AdminProductionSummary,
  type AdminMesaEnvioEvent,
  type AdminPrecalEvent,
} from "@/domain/admin-production";
import {
  labelAdminMesaAction,
  formatAdminMesaAsesorLabel,
  formatAdminMesaEsperaLabel,
  sanitizeAdminMotivo,
  type AdminMesaTimelineEvent,
} from "@/domain/admin-production/mesa-seguimiento";
import {
  etapaActualesFromAdminPasoFilter,
  isAdminPasoVisualFilterPressed,
  labelPasoVisualAdminFilter,
  mesaPageAfterEtapaChange,
  nextPasoVisualFilterFromInternalCard,
  opcionesFiltroPasoAdminDashboard,
  pagesAfterAsesorChange,
} from "@/domain/admin-production/admin-ui-filters";
import type { AdminEtapaBucket, AdminPrecalSummary } from "@/domain/admin-production/repo";
import {
  buildAdminProductionWorkbook,
  downloadAdminProductionWorkbook,
} from "@/lib/exportAdminProductionExcel";
import { subestadoOperativoLabel } from "@/lib/subestadoOperativoUi";
import { AdminReporteExpedientesSection } from "@/components/admin/AdminReporteExpedientesSection";

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

function formatCorreccionCell(r: AdminMesaEnvioEvent): string {
  const parts: string[] = [];
  if (r.correccionesAbiertasCount > 0) {
    const desde = r.correccionAbiertaDesde
      ? ` desde ${formatDateTimeMx(r.correccionAbiertaDesde)}`
      : "";
    parts.push(`${r.correccionesAbiertasCount} pendiente(s)${desde}`);
  }
  if (r.correccionesReenviadasCount > 0) {
    const desde = r.correccionReenviadaDesde
      ? ` desde ${formatDateTimeMx(r.correccionReenviadaDesde)}`
      : "";
    parts.push(`${r.correccionesReenviadasCount} reenviada(s)${desde}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No";
}

function formatRechazoCell(r: AdminMesaEnvioEvent): string {
  if (!r.rechazoOperativo) return "No";
  const when = r.rechazoAt ? formatDateTimeMx(r.rechazoAt) : "—";
  const motivo = sanitizeAdminMotivo(r.rechazoMotivo);
  const clasif = r.rechazoClasificacion ? ` · ${r.rechazoClasificacion}` : "";
  return `${when}${clasif} · ${motivo}`;
}

export default function AdminDashboardPage() {
  const { sessionRepo, currentUser } = useSessionRepo();
  const repo = useAdminProductionRepo();
  const mesaExpedientesRef = useRef<HTMLElement | null>(null);

  const [preset, setPreset] = useState<AdminPeriodPreset>("hoy");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [asesorId, setAsesorId] = useState<string>("");
  const [etapaActual, setEtapaActual] = useState<string>("todas");
  const [estado, setEstado] = useState<AdminEstadoFilter>("todos");
  const [buscar, setBuscar] = useState("");
  const [precalDecision, setPrecalDecision] =
    useState<AdminPrecalDecisionFilter>("resueltas");
  const [mesaPage, setMesaPage] = useState(1);
  const [precalPage, setPrecalPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AdminProductionSummary | null>(null);
  const [byEtapa, setByEtapa] = useState<readonly AdminEtapaBucket[]>([]);
  const [asesores, setAsesores] = useState<readonly AdminAsesorProductionRow[]>([]);
  const [asesorOptions, setAsesorOptions] = useState<
    readonly AdminAsesorProductionRow[]
  >([]);
  const [mesaItems, setMesaItems] = useState<readonly AdminMesaEnvioEvent[]>([]);
  const [mesaTotal, setMesaTotal] = useState(0);
  const [precalItems, setPrecalItems] = useState<readonly AdminPrecalEvent[]>([]);
  const [precalTotal, setPrecalTotal] = useState(0);
  const [precalSummary, setPrecalSummary] = useState<AdminPrecalSummary | null>(null);
  const [exporting, setExporting] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineTarget, setTimelineTarget] = useState<AdminMesaEnvioEvent | null>(null);
  const [timelineItems, setTimelineItems] = useState<readonly AdminMesaTimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineHasMore, setTimelineHasMore] = useState(false);
  const [timelineOffset, setTimelineOffset] = useState(0);
  const [timelineTotal, setTimelineTotal] = useState(0);
  const [timelineLoadingMore, setTimelineLoadingMore] = useState(false);
  const timelineTriggerRef = useRef<HTMLButtonElement | null>(null);
  const timelineDialogRef = useRef<HTMLDivElement | null>(null);

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
    const etapaActuales = etapaActualesFromAdminPasoFilter(etapaActual);
    return {
      bounds,
      asesorId: asesorId || null,
      etapaActual: etapaActuales?.length === 1 ? etapaActuales[0]! : null,
      etapaActuales,
      estado,
      buscar: buscar.trim() || null,
      precalDecision,
    };
  }, [bounds, asesorId, etapaActual, estado, buscar, precalDecision]);

  const selectedAsesorLabel = useMemo(() => {
    if (!asesorId) return null;
    const row =
      asesorOptions.find((a) => a.asesorId === asesorId) ??
      asesores.find((a) => a.asesorId === asesorId);
    if (!row) return null;
    return formatAsesorExpedienteLabel({
      fullName: row.asesorNombre,
      email: row.asesorEmail,
      fallbackId: row.asesorId,
    });
  }, [asesorId, asesorOptions, asesores]);

  const etapaFiltroActiva = etapaActual !== "todas";
  const showProduccionPorAsesor = !etapaFiltroActiva;

  const focusMesaExpedientes = useCallback(() => {
    const el = mesaExpedientesRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
    });
  }, []);

  const closeTimeline = useCallback(() => {
    setTimelineOpen(false);
    setTimelineTarget(null);
    setTimelineItems([]);
    setTimelineError(null);
    setTimelineLoading(false);
    setTimelineHasMore(false);
    setTimelineOffset(0);
    setTimelineTotal(0);
    setTimelineLoadingMore(false);
    const trigger = timelineTriggerRef.current;
    timelineTriggerRef.current = null;
    requestAnimationFrame(() => {
      trigger?.focus();
    });
  }, []);

  const openTimeline = useCallback(
    async (row: AdminMesaEnvioEvent, trigger: HTMLButtonElement | null) => {
      timelineTriggerRef.current = trigger;
      setTimelineTarget(row);
      setTimelineOpen(true);
      setTimelineLoading(true);
      setTimelineError(null);
      setTimelineItems([]);
      setTimelineHasMore(false);
      setTimelineOffset(0);
      setTimelineTotal(0);
      try {
        const page = await repo.getExpedienteMesaTimeline({
          expedienteId: row.expedienteId,
          limit: 10,
          offset: 0,
        });
        setTimelineItems(page.items);
        setTimelineHasMore(page.hasMore);
        setTimelineOffset(page.items.length);
        setTimelineTotal(page.totalCount);
      } catch (e) {
        setTimelineError(
          e instanceof Error ? e.message : "No se pudo cargar el seguimiento",
        );
      } finally {
        setTimelineLoading(false);
        requestAnimationFrame(() => {
          timelineDialogRef.current?.focus();
        });
      }
    },
    [repo],
  );

  const loadMoreTimeline = useCallback(async () => {
    if (!timelineTarget || timelineLoadingMore || !timelineHasMore) return;
    setTimelineLoadingMore(true);
    setTimelineError(null);
    try {
      const page = await repo.getExpedienteMesaTimeline({
        expedienteId: timelineTarget.expedienteId,
        limit: 10,
        offset: timelineOffset,
      });
      setTimelineItems((prev) => [...prev, ...page.items]);
      setTimelineHasMore(page.hasMore);
      setTimelineOffset((prev) => prev + page.items.length);
      setTimelineTotal(page.totalCount);
    } catch (e) {
      setTimelineError(
        e instanceof Error ? e.message : "No se pudo cargar más eventos",
      );
    } finally {
      setTimelineLoadingMore(false);
    }
  }, [repo, timelineTarget, timelineLoadingMore, timelineHasMore, timelineOffset]);

  useEffect(() => {
    if (!timelineOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeTimeline();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timelineOpen, closeTimeline]);

  const load = useCallback(async () => {
    if (!filtersBase) {
      setError("Rango de fechas inválido");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const filtersSinAsesor = { ...filtersBase, asesorId: null };
      const [s, cohort, as, asOpts, mesa, precal] = await Promise.all([
        repo.getSummary(filtersBase),
        repo.getMesaCohortByEtapa(filtersBase),
        repo.listByAsesor(filtersBase),
        repo.listByAsesor(filtersSinAsesor),
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
      setAsesorOptions(asOpts);
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
    setPreset("hoy");
    setCustomFrom("");
    setCustomTo("");
    setAsesorId("");
    setEtapaActual("todas");
    setEstado("todos");
    setBuscar("");
    setPrecalDecision("resueltas");
    setMesaPage(1);
    setPrecalPage(1);
  };

  const onPreset = (p: AdminPeriodPreset) => {
    setPreset(p);
    setMesaPage(1);
    setPrecalPage(1);
  };

  const clearEtapaFilter = () => {
    setEtapaActual("todas");
    setMesaPage(1);
  };

  const onEtapaCardPress = (etapa: number) => {
    const next = nextPasoVisualFilterFromInternalCard(etapaActual, etapa);
    setEtapaActual(next);
    setMesaPage(mesaPageAfterEtapaChange());
    if (next !== "todas") {
      requestAnimationFrame(() => focusMesaExpedientes());
    }
  };

  const applyAsesorFilter = (id: string) => {
    setAsesorId(id);
    const pages = pagesAfterAsesorChange();
    setMesaPage(pages.mesaPage);
    setPrecalPage(pages.precalPage);
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
        <p className="text-gray-700">Cargando...</p>
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

  const produccionTitle = selectedAsesorLabel
    ? `Producción de ${selectedAsesorLabel}`
    : "Producción por asesor";

  const etapaFiltroNombre = labelPasoVisualAdminFilter(etapaActual);

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
        <AdminReporteExpedientesSection />

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
          <p className="mt-1 text-xs text-gray-700">
            Las fechas determinan qué expedientes se incluyen. Las etapas muestran
            su estado actual.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Select
              label="Asesor"
              value={asesorId}
              onChange={(e) => applyAsesorFilter(e.target.value)}
              options={[
                { value: "", label: "Todos los asesores" },
                ...asesorOptions.map((a) => ({
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
                ...opcionesFiltroPasoAdminDashboard(),
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
                { value: "rechazados", label: "Rechazados" },
                { value: "cancelados", label: "Cancelados" },
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
          <p className="text-gray-700">Cargando producción…</p>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              {[
                {
                  title: "Expedientes enviados a Mesa",
                  value: summary?.enviadosAMesa ?? 0,
                  hint: periodoLabel,
                },
                {
                  title: "Precalificaciones aprobadas",
                  value: summary?.precalificacionesAprobadas ?? 0,
                  hint: "por aprobado_at",
                },
                {
                  title: "Rechazadas (No cumple)",
                  value: summary?.precalificacionesNoCumple ?? 0,
                  hint: "por no_cumple_at",
                },
                {
                  title: "Aprobadas > $20,000",
                  value: summary?.aprobadasMayorA20000 ?? 0,
                  hint: "monto al aprobar",
                },
                {
                  title: "Monto aprobado Mejoravit",
                  value: formatMontoMX(summary?.montoAprobadoTotal ?? 0),
                  hint: "aprobado · Mejoravit",
                },
              ].map((card) => {
                const isMontoKpi = card.title === "Monto aprobado Mejoravit";
                return (
                <div
                  key={card.title}
                  className={
                    isMontoKpi
                      ? "min-w-0 rounded-lg border border-slate-200 bg-white p-4 sm:col-span-2"
                      : "min-w-0 rounded-lg border border-slate-200 bg-white p-4"
                  }
                >
                  <p className="text-xs uppercase tracking-wide text-gray-700">
                    {card.title}
                  </p>
                  <p
                    className={
                      isMontoKpi
                        ? "mt-2 whitespace-nowrap font-semibold leading-none tabular-nums text-gray-900 text-[clamp(0.95rem,2.5vw,1.5rem)]"
                        : "mt-2 text-2xl font-semibold text-gray-900"
                    }
                    title={isMontoKpi && typeof card.value === "string" ? card.value : undefined}
                  >
                    {card.value}
                  </p>
                  <p className="mt-1 text-xs text-gray-700">{card.hint}</p>
                </div>
                );
              })}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-base font-semibold text-slate-900">
                Estado actual de los expedientes enviados a Mesa
              </h2>
              <p className="mt-1 text-sm text-gray-700">
                Pulsa una etapa para filtrar el listado de expedientes.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {byEtapa.map((b) => {
                  const pressed = isAdminPasoVisualFilterPressed(etapaActual, b.etapa);
                  const empty = b.count === 0;
                  return (
                    <button
                      key={b.etapa}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => onEtapaCardPress(b.etapa)}
                      className={`rounded-md border px-3 py-2 text-left transition ${etapaTone(b.etapa)} ${
                        pressed
                          ? "border-slate-900 bg-white shadow-sm ring-2 ring-slate-900 ring-offset-1"
                          : "hover:border-slate-400"
                      } ${empty && !pressed ? "opacity-70" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">
                          {getEtapaOperativaNombre(b.etapa)}
                        </p>
                        {pressed ? (
                          <span
                            aria-hidden="true"
                            className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-slate-900 px-1 text-[10px] font-semibold uppercase tracking-wide text-white"
                          >
                            Activa
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-gray-700">
                        {b.count === 0
                          ? "0 expedientes"
                          : `${b.count} expediente${b.count === 1 ? "" : "s"} · ${b.pct}%`}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section
              id="admin-mesa-expedientes"
              ref={mesaExpedientesRef}
              tabIndex={-1}
              aria-labelledby="admin-mesa-expedientes-title"
              className="rounded-lg border border-slate-200 bg-white p-4 outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            >
              <h2
                id="admin-mesa-expedientes-title"
                className="text-base font-semibold text-slate-900"
              >
                Expedientes enviados a Mesa
              </h2>
              {etapaFiltroNombre ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                  <span>
                    Mostrando expedientes en:{" "}
                    <strong className="font-semibold">{etapaFiltroNombre}</strong>
                  </span>
                  <Button type="button" variant="secondary" onClick={clearEtapaFilter}>
                    Quitar filtro de etapa
                  </Button>
                </div>
              ) : null}
              {mesaItems.length === 0 ? (
                <p className="mt-3 text-sm text-gray-700">
                  {etapaFiltroNombre
                    ? `No hay expedientes en ${etapaFiltroNombre} con los filtros actuales.`
                    : "Sin resultados."}
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-gray-900">
                    <thead className="border-b text-xs uppercase text-gray-700">
                      <tr>
                        <th className="py-2 pr-3">Enviado a Mesa</th>
                        <th className="py-2 pr-3">Cliente</th>
                        <th className="py-2 pr-3">Asesor</th>
                        <th className="py-2 pr-3">Etapa actual</th>
                        <th className="py-2 pr-3">Situación actual</th>
                        <th className="py-2 pr-3">Desde envío</th>
                        <th className="py-2 pr-3">Última actividad Mesa</th>
                        <th className="py-2 pr-3">Espera actual</th>
                        <th className="py-2">Seguimiento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mesaItems.map((r) => (
                        <tr key={r.expedienteId} className="border-b border-slate-100 align-top">
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {formatDateTimeMx(r.fechaEnvioMesa)}
                          </td>
                          <td className="py-2 pr-3">{r.clienteNombre}</td>
                          <td className="py-2 pr-3">
                            {formatAdminMesaAsesorLabel(r.asesorNombre)}
                          </td>
                          <td className="py-2 pr-3">
                            {r.etapaLabel || getEtapaOperativaNombre(r.etapaActual)}
                          </td>
                          <td className="py-2 pr-3">
                            <p className="font-medium text-gray-900">{r.situacionLabel}</p>
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap text-xs">
                            {formatDateTimeMx(r.fechaEnvioMesa)}
                          </td>
                          <td className="py-2 pr-3">
                            {r.ultimaActividadMesaAt ? (
                              <>
                                <span className="whitespace-nowrap">
                                  {formatDateTimeMx(r.ultimaActividadMesaAt)}
                                </span>
                                <p className="mt-0.5 text-xs text-gray-700">
                                  {r.ultimaActividadMesaLabel ||
                                    labelAdminMesaAction(r.ultimaActividadMesaCode)}
                                </p>
                              </>
                            ) : (
                              "Sin actividad de Mesa registrada"
                            )}
                          </td>
                          <td className="py-2 pr-3 text-xs">
                            {formatAdminMesaEsperaLabel({
                              esperaLabel: r.esperaLabel,
                              esperaDesde: r.esperaDesde,
                            })}
                            {r.esperaDesde ? (
                              <p className="mt-0.5 text-gray-700">
                                {formatDateTimeMx(r.esperaDesde)}
                              </p>
                            ) : null}
                          </td>
                          <td className="py-2">
                            <button
                              type="button"
                              className="text-blue-700 underline"
                              onClick={(e) => void openTimeline(r, e.currentTarget)}
                            >
                              Ver seguimiento
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-3 flex items-center justify-between text-sm text-gray-700">
                <span className="text-gray-900">
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

            {showProduccionPorAsesor ? (
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">
                  {produccionTitle}
                </h2>
                {asesores.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-700">
                    {asesorId
                      ? "No hay producción para este asesor en el periodo seleccionado."
                      : "Sin resultados."}
                  </p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-sm text-gray-900">
                      <thead className="border-b text-xs uppercase text-gray-700">
                        <tr>
                          <th className="py-2 pr-3">Asesor</th>
                          <th className="py-2 pr-3">Enviados</th>
                          <th className="py-2 pr-3">Aprobadas</th>
                          <th className="py-2 pr-3">No cumple</th>
                          <th className="py-2 pr-3">&gt;$20k</th>
                          <th className="py-2 pr-3">Monto Mejoravit</th>
                          <th className="py-2 pr-3">Estado actual</th>
                          <th className="py-2">Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {asesores.map((a) => (
                          <tr key={a.asesorId} className="border-b border-slate-100">
                            <td className="py-2 pr-3 font-medium text-gray-900">
                              {formatAsesorExpedienteLabel({
                                fullName: a.asesorNombre,
                                email: a.asesorEmail,
                                fallbackId: a.asesorId,
                              })}
                            </td>
                            <td className="py-2 pr-3 text-gray-900">{a.enviadosAMesa}</td>
                            <td className="py-2 pr-3 text-gray-900">{a.precalificacionesAprobadas}</td>
                            <td className="py-2 pr-3 text-gray-900">{a.precalificacionesNoCumple}</td>
                            <td className="py-2 pr-3 text-gray-900">{a.aprobadasMayorA20000}</td>
                            <td className="max-w-[10rem] break-words py-2 pr-3 text-gray-900 tabular-nums">
                              {formatMontoMX(a.montoAprobadoTotal)}
                            </td>
                            <td className="py-2 pr-3 text-xs text-gray-700">
                              {compactEtapas(a.etapas)}
                            </td>
                            <td className="py-2">
                              <button
                                type="button"
                                className="text-blue-700 underline"
                                onClick={() => applyAsesorFilter(a.asesorId)}
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
            ) : null}

            <section className="rounded-lg border border-gray-200 bg-white p-4 text-gray-900">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Precalificaciones
                  </h2>
                  <p className="mt-1 text-sm text-gray-700">
                    El periodo aplica a aprobadas y rechazadas; pendientes muestra
                    el estado actual.
                  </p>
                </div>
                <Select
                  label="Decisión"
                  className="text-gray-900"
                  value={precalDecision}
                  onChange={(e) => {
                    setPrecalDecision(e.target.value as AdminPrecalDecisionFilter);
                    setPrecalPage(1);
                  }}
                  options={[
                    { value: "resueltas", label: "Resueltas" },
                    { value: "aprobadas", label: "Aprobadas" },
                    { value: "no_cumple", label: "Rechazadas (No cumple)" },
                    { value: "pendientes", label: "Pendientes actuales" },
                    { value: "todas", label: "Todas" },
                  ]}
                />
              </div>
              {precalSummary && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  {[
                    {
                      label: "Resueltas",
                      value: String(precalSummary.resueltasCount),
                    },
                    {
                      label: "Aprobadas",
                      value: String(precalSummary.aprobadasCount),
                    },
                    {
                      label: "Rechazadas (No cumple)",
                      value: String(precalSummary.noCumpleCount),
                    },
                    {
                      label: "Pendientes actuales",
                      value: String(precalSummary.pendientesActualesCount),
                    },
                    {
                      label: "Monto aprobado Mejoravit",
                      value: formatMontoMX(precalSummary.montoMejoravitTotal),
                    },
                    {
                      label: "Promedio aprobado Mejoravit",
                      value: formatMontoMX(precalSummary.montoMejoravitPromedio),
                    },
                  ].map((card) => (
                    <div
                      key={card.label}
                      className="min-w-0 rounded-md border border-gray-200 bg-white px-3 py-2"
                    >
                      <p className="text-xs font-medium text-gray-700">{card.label}</p>
                      <p
                        className="mt-1 break-words text-base font-semibold leading-tight tabular-nums text-gray-900"
                        title={card.value}
                      >
                        {card.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {precalItems.length === 0 ? (
                <p className="mt-3 text-sm text-gray-700">Sin resultados.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-gray-900">
                    <thead className="border-b border-gray-200 text-xs uppercase text-gray-700">
                      <tr>
                        <th className="py-2 pr-3 font-semibold">Fecha</th>
                        <th className="py-2 pr-3 font-semibold">Cliente</th>
                        <th className="py-2 pr-3 font-semibold">Asesor</th>
                        <th className="py-2 pr-3 font-semibold">Decisión</th>
                        <th className="py-2 pr-3 font-semibold">Monto al aprobar</th>
                        <th className="py-2 font-semibold">Programa</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-900">
                      {precalItems.map((r) => (
                        <tr key={r.expedienteId} className="border-b border-gray-100">
                          <td className="py-2 pr-3 whitespace-nowrap text-gray-900">
                            {r.decision === "pendiente"
                              ? "—"
                              : r.fecha
                                ? formatDateTimeMx(r.fecha)
                                : "—"}
                          </td>
                          <td className="py-2 pr-3 text-gray-900">{r.clienteNombre}</td>
                          <td className="py-2 pr-3 text-gray-900">
                            {formatAsesorExpedienteLabel({
                              fullName: r.asesorNombre,
                              email: r.asesorEmail,
                              fallbackId: r.asesorId,
                            })}
                          </td>
                          <td className="py-2 pr-3 text-gray-900">
                            <span className={decisionBadgeClass(r.decision)}>
                              {labelEditorDecision(r.decision)}
                            </span>
                          </td>
                          <td className="max-w-[14rem] break-words py-2 pr-3 text-gray-900">
                            {formatPrecalMontoAlAprobarDisplay(
                              {
                                montoAprobadoAlAprobar: r.montoAprobadoAlAprobar,
                                montoSnapshotNoRecuperable:
                                  r.montoSnapshotNoRecuperable,
                              },
                              formatMontoMX,
                            )}
                          </td>
                          <td className="py-2 text-gray-900">{r.programa}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-3 flex items-center justify-between text-sm text-gray-700">
                <span className="text-gray-900">
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
                  <span className="text-gray-900">
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

      {timelineOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="presentation"
          onClick={closeTimeline}
        >
          <div
            ref={timelineDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-mesa-timeline-title"
            tabIndex={-1}
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-lg outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="admin-mesa-timeline-title"
                  className="text-base font-semibold text-slate-900"
                >
                  Seguimiento de Mesa
                </h2>
                <p className="mt-1 text-xs text-gray-600">Más reciente primero · solo lectura</p>
              </div>
              <Button type="button" variant="secondary" onClick={closeTimeline}>
                Cerrar
              </Button>
            </div>
            {timelineTarget ? (
              <dl className="mt-3 grid grid-cols-1 gap-2 text-sm text-gray-800 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-gray-600">Cliente</dt>
                  <dd className="font-medium">{timelineTarget.clienteNombre}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-600">Asesor</dt>
                  <dd>{formatAdminMesaAsesorLabel(timelineTarget.asesorNombre)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-600">Etapa</dt>
                  <dd>
                    {timelineTarget.etapaLabel ||
                      getEtapaOperativaNombre(timelineTarget.etapaActual)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-600">Situación</dt>
                  <dd>{timelineTarget.situacionLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-600">Enviado a Mesa</dt>
                  <dd>{formatDateTimeMx(timelineTarget.fechaEnvioMesa)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-600">Espera</dt>
                  <dd>
                    {formatAdminMesaEsperaLabel({
                      esperaLabel: timelineTarget.esperaLabel,
                      esperaDesde: timelineTarget.esperaDesde,
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-600">Siguiente acción</dt>
                  <dd>{timelineTarget.siguienteAccionLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-600">Actor esperado</dt>
                  <dd>{timelineTarget.siguienteAccionActor}</dd>
                </div>
              </dl>
            ) : null}
            {timelineLoading ? (
              <p className="mt-4 text-sm text-gray-700">Cargando seguimiento…</p>
            ) : timelineError ? (
              <p className="mt-4 text-sm text-red-700">{timelineError}</p>
            ) : timelineItems.length === 0 ? (
              <p className="mt-4 text-sm text-gray-700">
                No hay eventos de seguimiento para este expediente.
              </p>
            ) : (
              <>
                <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-gray-800">
                  {timelineItems.map((ev, idx) => {
                    const doc = ev.summary.tipo_documento?.trim();
                    const motivo = sanitizeAdminMotivo(ev.summary.motivo);
                    const showMotivo = Boolean(ev.summary.motivo?.trim());
                    return (
                      <li key={`${ev.at}-${ev.action}-${idx}`}>
                        <span className="whitespace-nowrap font-medium text-gray-900">
                          {formatDateTimeMx(ev.at)}
                        </span>
                        {" · "}
                        <span>{labelAdminMesaAction(ev.action)}</span>
                        {ev.actorGeneral ? (
                          <span className="text-xs text-gray-600"> ({ev.actorGeneral})</span>
                        ) : null}
                        {doc ? (
                          <p className="mt-0.5 text-xs text-gray-700">Documento: {doc}</p>
                        ) : null}
                        {showMotivo ? (
                          <p className="mt-0.5 text-xs text-gray-700">Motivo: {motivo}</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
                {timelineHasMore ? (
                  <div className="mt-4">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={timelineLoadingMore}
                      onClick={() => void loadMoreTimeline()}
                    >
                      {timelineLoadingMore
                        ? "Cargando…"
                        : `Cargar más (${timelineOffset}/${timelineTotal})`}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
