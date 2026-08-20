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
import {
  getAdminEtapaDisplayNombre,
  projectAdminVisibleStageBuckets,
} from "@/domain/admin-production/admin-visible-stages";
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
  EMPTY_ADMIN_CLIENTE_SEARCH,
  isAdminClienteSearchQueryActive,
  shouldApplyAdminSearchResponse,
  type AdminClienteSearchItem,
  type AdminClienteSearchResult,
} from "@/domain/admin-production/admin-cliente-search";
import {
  labelAdminMesaAction,
  formatAdminMesaAsesorLabel,
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
import {
  adminProductionSelectedStageCount,
  filterAdminProductionRowsByPaso,
  shortPasoVisualAdminFilterNombre,
} from "@/domain/admin-production/admin-production-stage-filter";
import type { AdminEtapaBucket, AdminPrecalSummary } from "@/domain/admin-production/repo";
import {
  buildAdminProductionWorkbook,
  downloadAdminProductionWorkbook,
} from "@/lib/exportAdminProductionExcel";
import { AdminReporteExpedientesSection } from "@/components/admin/AdminReporteExpedientesSection";
import { AdminIngresosSection } from "@/components/admin/AdminIngresosSection";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { AdminSectionHeader } from "@/components/admin/AdminSectionHeader";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminExpandableAdvisorRow } from "@/components/admin/AdminExpandableAdvisorRow";
import { AdminExpedienteDrawer } from "@/components/admin/AdminExpedienteDrawer";
import { AdminBernardoDashboard } from "@/components/admin/AdminBernardoDashboard";
import { AdminSearchResultadosSection } from "@/components/admin/AdminSearchResultadosSection";
import { AdminSearchExpedientePanel } from "@/components/admin/AdminSearchExpedientePanel";
import {
  ADMIN_REPORTES_SUBTABS,
  ADMIN_TAB_QUERY_PARAM,
  ADMIN_TABS,
  adminGlobalFiltersVisible,
  adminTabButtonId,
  adminTabPanelId,
  DEFAULT_ADMIN_REPORTES_SUBTAB,
  DEFAULT_ADMIN_TAB,
  isAdminBernardoView,
  isAdminMainTabId,
  parseAdminTabParam,
  type AdminMainTabId,
  type AdminReportesSubtabId,
  type AdminTabId,
} from "@/lib/adminUxTabs";
import { compactEtapasProduccion } from "@/lib/adminProductionCompactEtapas";

const PAGE_SIZE = 25;

function etapaTone(etapa: number): string {
  if (etapa <= 2) return "border-slate-200 bg-slate-50 text-slate-800";
  if (etapa <= 5) return "border-cyan-200 bg-cyan-50 text-cyan-900";
  if (etapa <= 8) return "border-amber-200 bg-amber-50 text-amber-950";
  if (etapa <= 10) return "border-violet-200 bg-violet-50 text-violet-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function compactEtapas(etapas: Readonly<Record<string, number>>): string {
  return compactEtapasProduccion(etapas);
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

  // B1 (solo UX): pestaña activa del panel. No afecta filtros ni consultas;
  // los paneles inactivos permanecen montados (hidden) para conservar datos.
  // B3: `bernardo` es vista aparte (no está en el tablist); se guarda la pestaña previa.
  const [activeTab, setActiveTab] = useState<AdminTabId>(DEFAULT_ADMIN_TAB);
  const bernardoReturnTabRef = useRef<AdminMainTabId>(DEFAULT_ADMIN_TAB);
  const [reportesSubtab, setReportesSubtab] = useState<AdminReportesSubtabId>(
    DEFAULT_ADMIN_REPORTES_SUBTAB,
  );
  /** B2: una sola fila de producción expandida a la vez (estado predecible). */
  const [expandedAsesorId, setExpandedAsesorId] = useState<string | null>(null);

  const [preset, setPreset] = useState<AdminPeriodPreset>("hoy");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [asesorId, setAsesorId] = useState<string>("");
  const [etapaActual, setEtapaActual] = useState<string>("todas");
  const [estado, setEstado] = useState<AdminEstadoFilter>("todos");
  const [buscar, setBuscar] = useState("");
  const [buscarDebounced, setBuscarDebounced] = useState("");
  const [precalDecision, setPrecalDecision] =
    useState<AdminPrecalDecisionFilter>("resueltas");
  const [mesaPage, setMesaPage] = useState(1);
  const [precalPage, setPrecalPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [mesaLoading, setMesaLoading] = useState(true);
  const [mesaError, setMesaError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AdminProductionSummary | null>(null);
  const [byEtapa, setByEtapa] = useState<readonly AdminEtapaBucket[]>([]);
  const [snapshotTotal, setSnapshotTotal] = useState(0);
  const [snapshotGeneratedAt, setSnapshotGeneratedAt] = useState<string | null>(null);
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
  const searchSeqRef = useRef(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<AdminClienteSearchResult>(
    EMPTY_ADMIN_CLIENTE_SEARCH,
  );
  const [searchOpenItem, setSearchOpenItem] = useState<AdminClienteSearchItem | null>(
    null,
  );

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
      etapaActual: null as number | null,
      etapaActuales: null as number[] | null,
      estado,
      buscar: buscarDebounced || null,
      precalDecision,
    };
  }, [bounds, asesorId, estado, buscarDebounced, precalDecision]);

  const snapshotFiltersBase = useMemo(
    () => ({
      asesorId: asesorId || null,
      estado,
      buscar: buscarDebounced || null,
    }),
    [asesorId, estado, buscarDebounced],
  );

  /** Expedientes del periodo (fecha_envio_mesa) — no usar snapshot sin bounds. */
  const mesaListFilters = useMemo(() => {
    if (!filtersBase) return null;
    const etapaActuales = etapaActualesFromAdminPasoFilter(etapaActual);
    return {
      ...filtersBase,
      etapaActual: etapaActuales?.length === 1 ? etapaActuales[0]! : null,
      etapaActuales,
      page: mesaPage,
      pageSize: PAGE_SIZE,
    };
  }, [filtersBase, etapaActual, mesaPage]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setBuscarDebounced(buscar.trim());
    }, 300);
    return () => window.clearTimeout(t);
  }, [buscar]);

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
  const etapaFiltroNombreCorto = shortPasoVisualAdminFilterNombre(etapaActual);
  const etapaActualesSeleccionadas = useMemo(
    () => etapaActualesFromAdminPasoFilter(etapaActual),
    [etapaActual],
  );
  const produccionRows = useMemo(
    () => filterAdminProductionRowsByPaso(asesores, etapaActual),
    [asesores, etapaActual],
  );
  const visibleByEtapa = useMemo(
    () => projectAdminVisibleStageBuckets(byEtapa, snapshotTotal),
    [byEtapa, snapshotTotal],
  );

  // Query param visual (?adminTab=) para conservar la pestaña al refrescar.
  // Se lee una sola vez al montar; no interviene el router ni las consultas.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get(
      ADMIN_TAB_QUERY_PARAM,
    );
    if (param) setActiveTab(parseAdminTabParam(param));
  }, []);

  const handleTabChange = useCallback((tab: AdminTabId) => {
    setActiveTab((prev) => {
      if (tab === "bernardo" && isAdminMainTabId(prev)) {
        bernardoReturnTabRef.current = prev;
      }
      return tab;
    });
    const url = new URL(window.location.href);
    url.searchParams.set(ADMIN_TAB_QUERY_PARAM, tab);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const openBernardo = useCallback(() => {
    handleTabChange("bernardo");
  }, [handleTabChange]);

  const closeBernardo = useCallback(() => {
    handleTabChange(bernardoReturnTabRef.current);
  }, [handleTabChange]);

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
      const [s, as, asOpts, precal] = await Promise.all([
        repo.getSummary(filtersBase),
        repo.listByAsesor(filtersBase),
        repo.listByAsesor(filtersSinAsesor),
        repo.listPrecalificacionesPage({
          ...filtersBase,
          page: precalPage,
          pageSize: PAGE_SIZE,
        }),
      ]);
      setSummary(s);
      setAsesores(as);
      setAsesorOptions(asOpts);
      setPrecalItems(precal.items);
      setPrecalTotal(precal.totalCount);
      setPrecalSummary(precal.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar producción");
    } finally {
      setLoading(false);
    }
  }, [filtersBase, precalPage, repo]);

  const loadSnapshot = useCallback(async () => {
    setSnapshotLoading(true);
    setSnapshotError(null);
    try {
      // Resumen: stock vigente por etapas — independiente del periodo.
      const snap = await repo.getExpedientesSnapshotEtapas(snapshotFiltersBase);
      setByEtapa(snap.byEtapa);
      setSnapshotTotal(snap.totalActual);
      setSnapshotGeneratedAt(snap.generatedAt);
    } catch (e) {
      setSnapshotError(
        e instanceof Error ? e.message : "No fue posible cargar el estado actual",
      );
    } finally {
      setSnapshotLoading(false);
    }
  }, [repo, snapshotFiltersBase]);

  const loadExpedientesPeriodo = useCallback(async () => {
    if (!mesaListFilters) {
      setMesaError("Rango de fechas inválido");
      setMesaLoading(false);
      setMesaItems([]);
      setMesaTotal(0);
      return;
    }
    setMesaLoading(true);
    setMesaError(null);
    try {
      const list = await repo.listMesaEnviosPage(mesaListFilters);
      setMesaItems(list.items);
      setMesaTotal(list.totalCount);
    } catch (e) {
      setMesaError(
        e instanceof Error
          ? e.message
          : "No fue posible cargar los expedientes del periodo",
      );
      setMesaItems([]);
      setMesaTotal(0);
    } finally {
      setMesaLoading(false);
    }
  }, [repo, mesaListFilters]);

  const loadSearch = useCallback(async () => {
    const q = buscarDebounced.trim();
    const seq = ++searchSeqRef.current;
    if (!isAdminClienteSearchQueryActive(q)) {
      setSearchLoading(false);
      setSearchError(null);
      setSearchResult(EMPTY_ADMIN_CLIENTE_SEARCH);
      setSearchOpenItem(null);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    try {
      const r = await repo.searchClienteExpedientes({
        buscar: q,
        asesorId: asesorId || null,
        limit: 20,
      });
      if (!shouldApplyAdminSearchResponse(seq, searchSeqRef.current)) return;
      setSearchResult(r);
    } catch (e) {
      if (!shouldApplyAdminSearchResponse(seq, searchSeqRef.current)) return;
      setSearchError(e instanceof Error ? e.message : "No se pudo buscar");
      setSearchResult(EMPTY_ADMIN_CLIENTE_SEARCH);
    } finally {
      if (seq === searchSeqRef.current) setSearchLoading(false);
    }
  }, [repo, buscarDebounced, asesorId]);

  useEffect(() => {
    if (currentUser?.role === "super_admin") void load();
  }, [currentUser, load]);

  useEffect(() => {
    if (currentUser?.role === "super_admin") void loadSnapshot();
  }, [currentUser, loadSnapshot]);

  useEffect(() => {
    if (currentUser?.role === "super_admin") void loadExpedientesPeriodo();
  }, [currentUser, loadExpedientesPeriodo]);

  useEffect(() => {
    if (currentUser?.role === "super_admin") void loadSearch();
  }, [currentUser, loadSearch]);

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
    setPrecalPage(1);
    setMesaPage(1);
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
      // La tabla del flujo de Mesa vive en la pestaña Expedientes (B1).
      handleTabChange("expedientes");
      requestAnimationFrame(() => focusMesaExpedientes());
    }
  };

  const applyAsesorFilter = (id: string) => {
    setAsesorId(id);
    const pages = pagesAfterAsesorChange();
    setMesaPage(pages.mesaPage);
    setPrecalPage(pages.precalPage);
  };

  /** B2: desde Producción → Expedientes con el filtro de asesor vigente. */
  const goExpedientesAsesor = (id: string) => {
    applyAsesorFilter(id);
    handleTabChange("expedientes");
  };

  /** Precal ya cargada para el drawer (sin consultas nuevas). */
  const drawerPrecal = useMemo(() => {
    if (!timelineTarget) return null;
    return (
      precalItems.find((p) => p.expedienteId === timelineTarget.expedienteId) ??
      null
    );
  }, [timelineTarget, precalItems]);

  const exportExcel = async () => {
    if (!filtersBase || !bounds) return;
    setExporting(true);
    try {
      const etapaActuales = etapaActualesFromAdminPasoFilter(etapaActual);
      const data = await repo.exportAll({
        ...filtersBase,
        etapaActual: etapaActuales?.length === 1 ? etapaActuales[0]! : null,
        etapaActuales,
      });
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
              Administración
            </h1>
            <p className="text-sm text-slate-600">
              Producción, expedientes, reportes y desempeño por asesor.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-700">{displayName}</span>
            <Button type="button" variant="secondary" onClick={openBernardo}>
              Reporte del día
            </Button>
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

      {!isAdminBernardoView(activeTab) ? (
        <AdminTabs active={activeTab} onChange={handleTabChange} />
      ) : null}

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {isAdminBernardoView(activeTab) ? (
          <AdminBernardoDashboard
            repo={repo}
            onBack={closeBernardo}
            onOpenExpediente={(row, trigger) => void openTimeline(row, trigger)}
          />
        ) : null}

        <section
          hidden={!adminGlobalFiltersVisible(activeTab)}
          className="sticky top-0 z-10 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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
                    setPrecalPage(1);
                    setMesaPage(1);
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
                    setPrecalPage(1);
                    setMesaPage(1);
                  }}
                />
              </label>
            </div>
          )}

          <p className="mt-3 text-sm font-medium text-slate-800">
            Periodo activo: {periodoLabel}
          </p>
          <p className="mt-1 text-xs text-gray-700">
            El periodo aplica a los KPI, Expedientes, Producción,
            precalificaciones y Excel.
          </p>
          <p className="mt-1 text-xs text-gray-700">
            El estado actual por etapas del Resumen es un corte de todos los
            expedientes vigentes y no depende del periodo.
          </p>
          <p className="mt-1 text-xs text-gray-600">
            Estos filtros aplican a Resumen, Expedientes y Producción. Los
            reportes históricos e ingresos tienen filtros propios dentro de su
            pestaña.
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
                placeholder="Cliente, NSS, asesor, programa"
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

        {/* ── Pestaña: Resumen ─────────────────────────────────────────── */}
        <div
          role="tabpanel"
          id={adminTabPanelId("resumen")}
          aria-labelledby={adminTabButtonId("resumen")}
          hidden={activeTab !== "resumen"}
          className="space-y-6"
        >
        {isAdminClienteSearchQueryActive(buscarDebounced) ? (
          <AdminSearchResultadosSection
            query={buscarDebounced}
            loading={searchLoading}
            error={searchError}
            items={searchResult.items}
            truncated={searchResult.truncated}
            limit={searchResult.limit}
            onRetry={() => void loadSearch()}
            onOpen={setSearchOpenItem}
            onClear={() => setBuscar("")}
          />
        ) : null}

        <AdminSectionHeader
          title="Resumen del periodo"
          description="KPIs del rango seleccionado. No se mezclan con el localizador de búsqueda."
        />
        {loading ? (
          <p className="text-gray-700">Cargando producción…</p>
        ) : (
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[
                {
                  title: "Ingresos",
                  value: summary?.enviadosAMesa ?? 0,
                  hint: `Expedientes enviados a Mesa · ${periodoLabel}`,
                },
                {
                  title: "Precal. aprobadas",
                  value: summary?.precalificacionesAprobadas ?? 0,
                  hint: "Según fecha de aprobación",
                },
                {
                  title: "No cumple",
                  value: summary?.precalificacionesNoCumple ?? 0,
                  hint: "Según fecha de rechazo",
                },
                {
                  title: "Aprobadas > $20k",
                  value: summary?.aprobadasMayorA20000 ?? 0,
                  hint: "Monto al aprobar",
                },
                {
                  title: "Monto Mejoravit",
                  value: formatMontoMX(summary?.montoAprobadoTotal ?? 0),
                  hint: "Total aprobado · Mejoravit",
                },
              ].map((card) => {
                const isMontoKpi = card.title === "Monto Mejoravit";
                return (
                <div
                  key={card.title}
                  className="flex min-h-[7.5rem] min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-4"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
                    {card.title}
                  </p>
                  <p
                    className={
                      isMontoKpi
                        ? "mt-2 whitespace-nowrap font-semibold leading-none tabular-nums text-slate-900 text-[clamp(1.1rem,2.8vw,1.75rem)]"
                        : "mt-2 text-3xl font-semibold tabular-nums text-slate-900"
                    }
                    title={isMontoKpi && typeof card.value === "string" ? card.value : undefined}
                  >
                    {card.value}
                  </p>
                  <p className="mt-auto pt-2 text-xs text-slate-500">{card.hint}</p>
                </div>
                );
              })}
            </section>
        )}

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <AdminSectionHeader
                title="Estado actual de los expedientes enviados a Mesa"
                description="Corte actual de los expedientes vigentes que ya ingresaron al flujo de Mesa. No depende del periodo seleccionado. Pulsa una etapa para abrir sus expedientes en la pestaña Expedientes."
              />
              {snapshotLoading && byEtapa.length === 0 ? (
                <p className="mt-3 text-sm text-gray-700">
                  Calculando estado actual de los expedientes…
                </p>
              ) : snapshotError ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-red-700">
                  <span>No fue posible cargar el estado actual. Reintentar.</span>
                  <Button type="button" variant="secondary" onClick={() => void loadSnapshot()}>
                    Reintentar
                  </Button>
                </div>
              ) : snapshotTotal === 0 ? (
                <AdminEmptyState
                  title="No hay expedientes con estos filtros."
                  description="Prueba limpiar o cambiar los filtros."
                  onClearFilters={clearFilters}
                />
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-slate-800">
                    <p>
                      Total actual:{" "}
                      <strong className="font-semibold tabular-nums">
                        {snapshotTotal} expediente{snapshotTotal === 1 ? "" : "s"}
                      </strong>
                    </p>
                    {snapshotGeneratedAt ? (
                      <p className="text-xs text-gray-700">
                        Actualizado:{" "}
                        {new Date(snapshotGeneratedAt).toLocaleTimeString("es-MX", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </p>
                    ) : null}
                    {snapshotLoading ? (
                      <p className="text-xs text-gray-600">Actualizando…</p>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {visibleByEtapa.map((b) => {
                      const pressed = isAdminPasoVisualFilterPressed(etapaActual, b.etapa);
                      const empty = b.count === 0;
                      return (
                        <button
                          key={b.etapa}
                          type="button"
                          aria-pressed={pressed}
                          onClick={() => onEtapaCardPress(b.etapa)}
                          className={`rounded-md border px-3 py-2 text-left transition cursor-pointer ${etapaTone(b.etapa)} ${
                            pressed
                              ? "border-slate-900 bg-white shadow-sm ring-2 ring-slate-900 ring-offset-1"
                              : "hover:border-slate-400 hover:shadow-sm"
                          } ${empty && !pressed ? "opacity-70" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium">
                              {getAdminEtapaDisplayNombre(b.etapa)}
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
                </>
              )}
            </section>

            {/* Accesos rápidos a las demás pestañas (solo navegación visual). */}
            <section aria-label="Accesos rápidos" className="grid gap-3 sm:grid-cols-3">
              {ADMIN_TABS.filter((t) => t.id !== "resumen").map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleTabChange(t.id)}
                  className="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-slate-400"
                >
                  <p className="text-sm font-semibold text-slate-900">{t.label}</p>
                  <p className="mt-1 text-xs text-slate-600">{t.description}</p>
                  <p className="mt-2 text-xs font-medium text-blue-700">
                    Abrir {t.label} →
                  </p>
                </button>
              ))}
            </section>
        </div>

        {/* ── Pestaña: Expedientes ─────────────────────────────────────── */}
        <div
          role="tabpanel"
          id={adminTabPanelId("expedientes")}
          aria-labelledby={adminTabButtonId("expedientes")}
          hidden={activeTab !== "expedientes"}
          className="space-y-6"
        >
            <section
              id="admin-mesa-expedientes"
              ref={mesaExpedientesRef}
              tabIndex={-1}
              aria-labelledby="admin-mesa-expedientes-title"
              className="rounded-lg border border-slate-200 bg-white p-4 outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            >
              <AdminSectionHeader
                titleId="admin-mesa-expedientes-title"
                title="Expedientes del flujo operativo de Mesa"
                description="Expedientes enviados a Mesa durante el periodo seleccionado, mostrando su etapa y situación actuales."
              />
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
              {mesaLoading && mesaItems.length === 0 && !mesaError ? (
                <p className="mt-3 text-sm text-gray-700">
                  Cargando expedientes del periodo…
                </p>
              ) : mesaError ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-red-700">
                  <span>No fue posible cargar los expedientes del periodo. Reintentar.</span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void loadExpedientesPeriodo()}
                  >
                    Reintentar
                  </Button>
                </div>
              ) : mesaItems.length === 0 ? (
                <AdminEmptyState
                  title={
                    etapaFiltroNombre
                      ? `No hay expedientes enviados a Mesa en ${etapaFiltroNombre} para el periodo seleccionado.`
                      : "No hay expedientes enviados a Mesa en el periodo seleccionado."
                  }
                  description="Prueba limpiar o cambiar el periodo u otros filtros."
                  onClearFilters={clearFilters}
                />
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-gray-900">
                    <thead className="border-b text-xs uppercase text-gray-700">
                      <tr>
                        <th className="py-2 pr-3">Cliente</th>
                        <th className="py-2 pr-3">Asesor</th>
                        <th className="py-2 pr-3">Etapa</th>
                        <th className="py-2 pr-3">Situación</th>
                        <th className="py-2 pr-3">Última actividad</th>
                        <th className="py-2">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mesaItems.map((r) => (
                        <tr
                          key={r.expedienteId}
                          className="border-b border-slate-100 align-top hover:bg-slate-50"
                        >
                          <td className="py-2.5 pr-3 font-medium text-slate-900">
                            {r.clienteNombre}
                          </td>
                          <td className="py-2.5 pr-3">
                            {formatAdminMesaAsesorLabel(r.asesorNombre)}
                          </td>
                          <td className="py-2.5 pr-3">
                            {r.etapaActual === 10 ||
                            /cita para firma/i.test(String(r.etapaLabel ?? ""))
                              ? getAdminEtapaDisplayNombre(r.etapaActual)
                              : r.etapaLabel ||
                                getAdminEtapaDisplayNombre(r.etapaActual)}
                          </td>
                          <td className="py-2.5 pr-3">
                            <AdminStatusBadge
                              situacionLabel={r.situacionLabel}
                              situacionCode={r.situacionCode}
                              cicloEstado={r.cicloEstado}
                              rechazoOperativo={r.rechazoOperativo}
                              correccionesAbiertasCount={r.correccionesAbiertasCount}
                            />
                          </td>
                          <td className="py-2.5 pr-3">
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
                              <span className="text-xs text-slate-500">
                                Sin actividad registrada
                              </span>
                            )}
                          </td>
                          <td className="py-2.5">
                            <button
                              type="button"
                              className="text-blue-700 underline"
                              onClick={(e) => void openTimeline(r, e.currentTarget)}
                            >
                              Ver detalle
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
                    disabled={mesaPage <= 1 || mesaLoading}
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
                    disabled={
                      mesaLoading || mesaPage * PAGE_SIZE >= mesaTotal
                    }
                    onClick={() => setMesaPage((p) => p + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            </section>

            {!loading && (
            <section className="rounded-lg border border-gray-200 bg-white p-4 text-gray-900">
              <AdminSectionHeader
                title="Precalificaciones"
                description="El periodo aplica a aprobadas y rechazadas; pendientes muestra el estado actual."
                trailing={
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
                }
              />
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
                <AdminEmptyState
                  title="No hay resultados para este periodo."
                  description="Prueba limpiar o cambiar los filtros."
                  onClearFilters={clearFilters}
                />
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
            )}
        </div>

        {/* ── Pestaña: Reportes ────────────────────────────────────────── */}
        <div
          role="tabpanel"
          id={adminTabPanelId("reportes")}
          aria-labelledby={adminTabButtonId("reportes")}
          hidden={activeTab !== "reportes"}
          className="space-y-6"
        >
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <AdminSectionHeader
              title="Reportes"
              description="Cada reporte conserva sus propios filtros, cálculos y exportaciones, independientes de la barra de filtros de las otras pestañas."
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {ADMIN_REPORTES_SUBTABS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={reportesSubtab === s.id}
                  onClick={() => setReportesSubtab(s.id)}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    reportesSubtab === s.id
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              El reporte muestra entradas, avances y permanencia por etapa.
            </p>
          </div>

          <div hidden={reportesSubtab !== "historico"}>
            <AdminReporteExpedientesSection />
          </div>

          <div hidden={reportesSubtab !== "ingresos"}>
            <AdminIngresosSection
              asesorOptions={asesorOptions.map((a) => ({
                id: a.asesorId,
                nombre: a.asesorNombre?.trim() || a.asesorId,
              }))}
            />
          </div>
        </div>

        {/* ── Pestaña: Producción ──────────────────────────────────────── */}
        <div
          role="tabpanel"
          id={adminTabPanelId("produccion")}
          aria-labelledby={adminTabButtonId("produccion")}
          hidden={activeTab !== "produccion"}
          className="space-y-6"
        >
          {loading ? (
            <p className="text-gray-700">Cargando producción…</p>
          ) : (
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <AdminSectionHeader
                  title={produccionTitle}
                  description="Producción por asesor durante el periodo seleccionado en la barra de filtros. Expande una fila para ver el desglose por etapas."
                />
                {etapaFiltroActiva && etapaFiltroNombreCorto ? (
                  <p className="mt-2 text-xs text-slate-600">
                    Filtro activo:{" "}
                    <strong className="font-semibold text-slate-800">
                      {etapaFiltroNombreCorto}
                    </strong>
                  </p>
                ) : null}
                {produccionRows.length === 0 ? (
                  <AdminEmptyState
                    title={
                      etapaFiltroActiva && etapaFiltroNombreCorto
                        ? `No hay producción en ${etapaFiltroNombreCorto} para el periodo seleccionado.`
                        : asesorId
                          ? "No hay producción para este asesor en el periodo seleccionado."
                          : "No hay resultados para este periodo."
                    }
                    description="Prueba limpiar o cambiar los filtros."
                    onClearFilters={clearFilters}
                  />
                ) : (
                  <div className="mt-3 space-y-2">
                    {produccionRows.map((a) => {
                      const label = formatAsesorExpedienteLabel({
                        fullName: a.asesorNombre,
                        email: a.asesorEmail,
                        fallbackId: a.asesorId,
                      });
                      const expanded = expandedAsesorId === a.asesorId;
                      const stageCount = etapaFiltroActiva
                        ? adminProductionSelectedStageCount(
                            a,
                            etapaActualesSeleccionadas,
                          )
                        : null;
                      return (
                        <AdminExpandableAdvisorRow
                          key={a.asesorId}
                          advisorLabel={label}
                          expanded={expanded}
                          onToggle={() =>
                            setExpandedAsesorId((cur) =>
                              cur === a.asesorId ? null : a.asesorId,
                            )
                          }
                          summary={
                            <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-6">
                              <div className="min-w-0 sm:col-span-3 lg:col-span-1">
                                <p className="truncate font-medium text-slate-900">{label}</p>
                                {stageCount != null && etapaFiltroNombreCorto ? (
                                  <p className="mt-0.5 text-xs text-slate-600">
                                    {etapaFiltroNombreCorto}: {stageCount}
                                  </p>
                                ) : null}
                              </div>
                              <div>
                                <p className="text-[11px] uppercase text-slate-500">Enviados</p>
                                <p className="tabular-nums text-slate-900">{a.enviadosAMesa}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase text-slate-500">Aprobadas</p>
                                <p className="tabular-nums text-slate-900">
                                  {a.precalificacionesAprobadas}
                                </p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase text-slate-500">No cumple</p>
                                <p className="tabular-nums text-slate-900">
                                  {a.precalificacionesNoCumple}
                                </p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase text-slate-500">&gt;$20k</p>
                                <p className="tabular-nums text-slate-900">
                                  {a.aprobadasMayorA20000}
                                </p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase text-slate-500">Monto</p>
                                <p className="break-words tabular-nums text-slate-900">
                                  {formatMontoMX(a.montoAprobadoTotal)}
                                </p>
                              </div>
                            </div>
                          }
                        >
                          <div className="space-y-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                                Estado actual por etapas
                              </p>
                              <p className="mt-1 text-sm text-slate-800">
                                {compactEtapas(a.etapas) || "Sin desglose"}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                Aprobadas / No cumple / monto son totales del periodo
                                (no se recalculan por etapa).
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                                onClick={() => goExpedientesAsesor(a.asesorId)}
                              >
                                Ver expedientes de este asesor
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50"
                                onClick={() => applyAsesorFilter(a.asesorId)}
                              >
                                Filtrar producción
                              </button>
                            </div>
                          </div>
                        </AdminExpandableAdvisorRow>
                      );
                    })}
                  </div>
                )}
              </section>
          )}
        </div>
      </main>

      <AdminSearchExpedientePanel
        item={searchOpenItem}
        onClose={() => setSearchOpenItem(null)}
      />
      <AdminExpedienteDrawer
        open={timelineOpen}
        row={timelineTarget}
        onClose={closeTimeline}
        precal={drawerPrecal}
        timelineItems={timelineItems}
        timelineLoading={timelineLoading}
        timelineError={timelineError}
        timelineHasMore={timelineHasMore}
        timelineLoadingMore={timelineLoadingMore}
        timelineOffset={timelineOffset}
        timelineTotal={timelineTotal}
        onLoadMoreTimeline={() => void loadMoreTimeline()}
        correccionText={
          timelineTarget ? formatCorreccionCell(timelineTarget) : "No"
        }
        rechazoText={
          timelineTarget ? formatRechazoCell(timelineTarget) : "No"
        }
      />
    </div>
  );
}
