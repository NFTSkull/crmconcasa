"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionRepo } from "@/domain/session";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";
import { Select } from "@/components/ui/Select";
import {
  mergeMesaControlInboxByLatestUpdated,
  readMesaControlInboxSafe,
} from "@/lib/mesaControlInboxMock";
import {
  getTodayYMD,
  type CasoMock,
} from "./mockData";
import {
  ExpedientesSupabaseError,
  appendMesaBandejaItemsUnique,
  mapAdminOrigenTabToRpc,
  MESA_BANDEJA_PAGE_SIZE,
  useExpedientesRepo,
  type ExpedienteMock,
  type MesaBandejaCursor,
  type MesaBandejaServerCounts,
  type PaginatedMesaBandejaResult,
} from "@/domain/expedientes";
import {
  etapasInternasParaFiltroPaso,
  formatEtapaMesaBandejaBadge,
  opcionesFiltroPasoOperativo,
} from "@/domain/expedientes/etapa-numeracion-ux";
import {
  useExpedienteArchivosRepo,
  type CategoriaResumenDocumental,
} from "@/domain/expediente-archivos";
import { useExpedienteClienteDatosRepo } from "@/domain/expediente-cliente-datos";
import type { ExpedienteClienteDatosEstado } from "@/domain/expediente-cliente-datos/types";
import { EXPEDIENTE_CLIENTE_DATOS_UPDATED_EVENT } from "@/domain/expediente-cliente-datos/emit-updated";
import { isDataModeSupabase } from "@/lib/dataMode";
import {
  subestadoOperativoBadgeClass,
  subestadoOperativoLabel,
} from "@/lib/subestadoOperativoUi";
import { filterExpedientesByRole } from "@/lib/mesaControlAccess";
import {
  getEffectiveMockRole,
  getEffectiveMockName,
} from "@/lib/mockUser";
import { AgendaBiometricosConfigPanel } from "@/components/mesa-control/AgendaBiometricosConfigPanel";
import { canManageAgendaConfig } from "@/lib/canManageAgendaConfig";
import {
  formatEnMesaHaceLabel,
  sortMesaBandejaPorAntiguedad,
} from "@/lib/mesaBandejaOrden";
import {
  mesaCorreccionLecturaBadgeClass,
  mesaCorreccionLecturaLabel,
  type MesaCorreccionLecturaEstado,
} from "@/lib/mesaCorreccionEntrada";
import {
  MESA_EXPEDIENTE_OPENED_UPDATED_EVENT,
} from "@/lib/mesaExpedienteOpenedStorage";
import { useMesaOpsRepo, type MesaExpedienteOpsRow } from "@/domain/mesa-ops";
import {
  applyMesaOpsFilterSorted,
  DEFAULT_MESA_OPS_FILTER,
  MESA_OPS_FILTER_CHIPS,
  MESA_OPS_FILTER_HELP_TEXT,
  type MesaOpsFilter,
} from "@/lib/mesaOpsUi";
import { MesaOpsBandejaBadge } from "@/components/mesa-control/MesaExpedienteOpsSection";
import { estaEnEsperaDeAsesor } from "@/lib/mesaBandejaEsperaAsesor";
import {
  aplicarFiltrosBandejaMesa,
  contarVistaRapida,
  esNuevoEtapa12,
  limpiarFiltrosBandeja,
  MESA_CITAS_HOY_CHIP_ID,
  MESA_CITAS_ROUTE,
  seleccionarAsignacion,
  seleccionarVistaRapida,
  type MesaQuickFilter,
  type MesaRechazosCancelacionesSubfiltro,
} from "@/lib/mesaBandejaFiltros";
import { enrichMesaBandejaPageItems } from "@/lib/mesaBandejaEnrichPage";
import {
  describeMesaBandejaServerWindow,
  describeMesaBandejaVisibleWindow,
  isIntersectionObserverAvailable,
  mesaBandejaInfiniteResetKey,
  MESA_BANDEJA_INITIAL_VISIBLE,
  MESA_BANDEJA_SEARCH_DEBOUNCE_MS,
  nextMesaBandejaVisibleCount,
  resetMesaBandejaVisibleCount,
  shouldShowMesaBandejaLoadMoreFallback,
  sliceMesaBandejaVisible,
} from "@/lib/mesaBandejaInfiniteScroll";
import { hasAlertMessage, MESA_OPS_UPDATED_EVENT } from "@/lib/hasAlertMessage";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { buildDashboardNotifications } from "@/lib/dashboardNotifications";
import { MesaBandejaNotificacionResumen } from "@/components/mesa-control/MesaBandejaNotificacionResumen";
import {
  useAgendaBiometricosBookingRepo,
  type AgendaNotificacionActiveBooking,
} from "@/domain/agenda-biometricos";
import { resolveProfileDisplayLabel } from "@/lib/mesaNotificacionExtraordinariaUi";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

type CasoConDocs = CasoMock & {
  resumenDocumental?: CategoriaResumenDocumental;
  clienteDatosEstado?: ExpedienteClienteDatosEstado | null;
  fechaEntradaMesaActual?: string | null;
  ultimaCorreccionEnviadaAt?: string | null;
  entradaLecturaEsCorreccion?: boolean;
  correccionLecturaEstado?: MesaCorreccionLecturaEstado;
  mesaOps?: MesaExpedienteOpsRow | null;
  notificacionBooking?: AgendaNotificacionActiveBooking | null;
  notificacionAgendadoPorLabel?: string;
};

type AdminOrigenTab = "todos" | "internos" | "externos";

function resumenDocumentalBadgeClass(c?: CategoriaResumenDocumental): string {
  if (c === "correccion_enviada") {
    return "inline-flex max-w-[11rem] rounded-md bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold text-sky-950 ring-1 ring-sky-300/80";
  }
  if (c === "correccion_requerida") {
    return "inline-flex max-w-[11rem] rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-950 ring-1 ring-amber-200";
  }
  if (c === "documentos_validados") {
    return "inline-flex rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200/80";
  }
  if (c === "pendiente_revision_documental") {
    return "inline-flex rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-900 ring-1 ring-blue-200/70";
  }
  if (c === "faltantes") {
    return "inline-flex rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700";
  }
  return "text-[11px] text-gray-400";
}

function resumenDocumentalLabel(c?: CategoriaResumenDocumental): string {
  if (!c) return "—";
  const map: Record<CategoriaResumenDocumental, string> = {
    faltantes: "Faltantes",
    pendiente_revision_documental: "Pend. revisión",
    correccion_requerida: "Corrección req.",
    correccion_enviada: "Corrección enviada",
    documentos_validados: "Docs validados",
  };
  return map[c];
}

function DocumentacionCell({ c }: { c?: CategoriaResumenDocumental }) {
  if (c === "correccion_enviada") {
    return (
      <div className="flex max-w-[12rem] flex-col gap-0.5">
        <span className={resumenDocumentalBadgeClass(c)}>{resumenDocumentalLabel(c)}</span>
        <span className="text-[10px] leading-tight text-sky-900/80">
          Por revisar
        </span>
      </div>
    );
  }
  return <span className={resumenDocumentalBadgeClass(c)}>{resumenDocumentalLabel(c)}</span>;
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("es-MX");
  } catch {
    return "—";
  }
}

function origenMesaLabel(o: CasoMock["origenMesa"]): string {
  if (o === "interno") return "Interno";
  if (o === "externo") return "Externo";
  return "Sin origen";
}

function origenMesaBadgeClass(o: CasoMock["origenMesa"]): string {
  if (o === "interno") {
    return "inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-900 ring-1 ring-indigo-200/80";
  }
  if (o === "externo") {
    return "inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-900 ring-1 ring-violet-200/80";
  }
  return "inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200/80";
}

function MesaEnMesaHaceBadge({
  fechaEnvioMesa,
  createdAt,
  fechaEntradaMesaActual,
}: {
  fechaEnvioMesa?: string | null;
  createdAt?: string | null;
  fechaEntradaMesaActual?: string | null;
}) {
  const label = formatEnMesaHaceLabel(
    fechaEnvioMesa,
    new Date(),
    createdAt,
    fechaEntradaMesaActual,
  );
  if (!label) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-md border border-amber-400/90 bg-amber-100 px-2 py-1 text-[11px] font-semibold leading-tight text-amber-950 ring-1 ring-amber-300/70"
      data-testid="mesa-bandeja-en-mesa-hace"
    >
      {label}
    </span>
  );
}

function rowSurfaceClass(c: CasoConDocs): string {
  if (c.subestado === "rechazado") {
    return "border-l-[3px] border-l-red-400 bg-red-50/50 hover:bg-red-50/80";
  }
  if (c.correccionLecturaEstado === "nueva") {
    return "border border-teal-400 border-l-4 border-l-teal-700 bg-teal-100 ring-2 ring-teal-300 shadow-md hover:border-teal-500 hover:bg-teal-200/90";
  }
  if (c.correccionLecturaEstado === "abierta") {
    return "border-l-[3px] border-l-slate-400 bg-slate-50/50 hover:bg-slate-50/75";
  }
  if (c.resumenDocumental === "correccion_requerida") {
    return "border-l-[3px] border-l-amber-400 bg-amber-50/35 hover:bg-amber-50/55";
  }
  return "border-l-[3px] border-l-transparent hover:bg-slate-50/90";
}

function MesaCorreccionLecturaBadge({
  estado,
  esCorreccion = false,
}: {
  estado?: MesaCorreccionLecturaEstado;
  esCorreccion?: boolean;
}) {
  if (!estado || estado === "no_aplica") return null;
  const label = mesaCorreccionLecturaLabel(estado, esCorreccion);
  if (!label) return null;
  const testId =
    estado === "nueva"
      ? esCorreccion
        ? "mesa-correccion-nueva"
        : "mesa-nuevo-en-mesa"
      : esCorreccion
        ? "mesa-correccion-abierta"
        : "mesa-entrada-abierta";
  return (
    <span className={mesaCorreccionLecturaBadgeClass(estado)} data-testid={testId}>
      {label}
    </span>
  );
}

export default function MesaControlPage() {
  const router = useRouter();
  const { sessionRepo, currentUser } = useSessionRepo();
  const repo = useExpedientesRepo();
  const archivosRepo = useExpedienteArchivosRepo();
  const clienteDatosRepo = useExpedienteClienteDatosRepo();
  const mesaOpsRepo = useMesaOpsRepo();
  const agendaBookingRepo = useAgendaBiometricosBookingRepo();
  const dataSupabase = isDataModeSupabase();
  const [casos, setCasos] = useState<CasoConDocs[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [mesaOpsFilter, setMesaOpsFilter] = useState<MesaOpsFilter>(DEFAULT_MESA_OPS_FILTER);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [buscar, setBuscar] = useState("");
  const [etapaFilter, setEtapaFilter] = useState<string>("todas");
  const [subestadoFilter, setSubestadoFilter] = useState<string>("todas");
  const [soloCitasHoy, setSoloCitasHoy] = useState(false);
  const [quickFilter, setQuickFilter] = useState<MesaQuickFilter>("todos");
  const [rechazosCancelacionesSubfiltro, setRechazosCancelacionesSubfiltro] =
    useState<MesaRechazosCancelacionesSubfiltro>("rechazados");
  const [adminOrigenTab, setAdminOrigenTab] = useState<AdminOrigenTab>("todos");
  const currentUserIdRef = useRef<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(MESA_BANDEJA_INITIAL_VISIBLE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [ioAvailable, setIoAvailable] = useState(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreLockRef = useRef(false);
  const [buscarDebounced, setBuscarDebounced] = useState("");
  const [serverTotalCount, setServerTotalCount] = useState(0);
  const [serverHasMore, setServerHasMore] = useState(false);
  const [serverCounts, setServerCounts] = useState<MesaBandejaServerCounts | null>(null);
  const serverCursorRef = useRef<MesaBandejaCursor | null>(null);
  const serverQueryGenRef = useRef(0);

  const todayYMD = getTodayYMD();

  const mesaMockRole =
    typeof window !== "undefined" ? getEffectiveMockRole() : null;

  useEffect(() => {
    const t = window.setTimeout(() => {
      setBuscarDebounced(buscar);
    }, MESA_BANDEJA_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [buscar]);

  const mapExpToCaso = useCallback((exp: ExpedienteMock): CasoMock => {
    const rawFe = exp.operativo.fechaEnvioMesa;
    const fechaEnvioMesa =
      typeof rawFe === "string" && rawFe.trim() !== "" ? rawFe : undefined;
    return {
      id: exp.id,
      cliente_nombre: exp.base.cliente_nombre,
      telefono_cliente: exp.base.telefono_cliente,
      programa: exp.base.programa,
      nss: exp.base.nss || undefined,
      asesorNombre: formatAsesorExpedienteLabel({
        fullName: exp.base.asesorNombre,
        email: exp.base.asesorEmail ?? (exp.base.asesorId.includes("@") ? exp.base.asesorId : null),
        fallbackId: exp.base.asesorId,
      }),
      etapaActual: exp.operativo.etapaActual ?? 1,
      subestado: exp.operativo.subestado ?? "pendiente",
      cicloEstado: exp.operativo.cicloEstado ?? "activo",
      motivoRechazo: exp.operativo.motivoRechazo ?? undefined,
      fechaCita: exp.operativo.fechaCita ?? undefined,
      createdAt: exp.base.createdAt,
      updatedAt: exp.operativo.updatedAt ?? new Date().toISOString(),
      submittedToMesa: exp.operativo.submittedToMesa,
      origenMesa: exp.base.origenMesa ?? "interno",
      fechaEnvioMesa,
    };
  }, []);

  const resolveEnrichDeps = useCallback(async () => {
    let mesaUserId = currentUserIdRef.current;
    if (mesaUserId == null && mesaOpsRepo) {
      try {
        mesaUserId = await mesaOpsRepo.resolveCurrentUserId();
        currentUserIdRef.current = mesaUserId;
        setCurrentUserId(mesaUserId);
      } catch {
        mesaUserId = null;
      }
    }
    return {
      listResumenBatchByExpedienteIds: (ids: readonly string[]) =>
        archivosRepo.listResumenBatchByExpedienteIds(ids),
      listEstadoBatchByExpedienteIds: (ids: readonly string[]) =>
        clienteDatosRepo.listEstadoBatchByExpedienteIds(ids),
      listActiveNotificacionByExpedienteIds:
        dataSupabase && agendaBookingRepo
          ? (ids: readonly string[]) =>
              agendaBookingRepo.listActiveNotificacionByExpedienteIds(ids)
          : undefined,
      listMesaOpsByExpedienteIds: mesaOpsRepo
        ? (ids: readonly string[]) => mesaOpsRepo.listByExpedienteIds(ids)
        : undefined,
      resolveAsesorDisplayBatch:
        dataSupabase && isSupabaseConfigured() && supabaseBrowser
          ? async (creatorIds: string[]) => {
              const labels = new Map<string, string>();
              if (creatorIds.length === 0) return labels;
              try {
                const { data } = await supabaseBrowser!.rpc(
                  "get_asesor_display_batch",
                  { p_asesor_ids: creatorIds },
                );
                for (const row of (data ?? []) as Array<{
                  asesor_id?: string;
                  full_name?: string | null;
                  email?: string | null;
                }>) {
                  const id = String(row.asesor_id ?? "").trim();
                  if (!id) continue;
                  labels.set(
                    id,
                    resolveProfileDisplayLabel({
                      fullName: row.full_name,
                      email: row.email,
                      fallbackId: id,
                    }),
                  );
                }
              } catch {
                // Sin labels.
              }
              return labels;
            }
          : undefined,
      mesaUserId,
    };
  }, [agendaBookingRepo, archivosRepo, clienteDatosRepo, dataSupabase, mesaOpsRepo]);

  /** P102 Supabase: filtros en RPC → página 25 → enrich P100 solo de esa página. */
  const loadServerBandeja = useCallback(
    (opciones?: { silencioso?: boolean; append?: boolean }) => {
      if (!currentUser || !dataSupabase) return;
      const append = Boolean(opciones?.append);
      void (async () => {
        const gen = append ? serverQueryGenRef.current : ++serverQueryGenRef.current;
        if (!append) {
          if (!opciones?.silencioso) setLoading(true);
          setListError(null);
          setLoadMoreError(null);
          serverCursorRef.current = null;
        } else {
          if (loadingMoreLockRef.current) return;
          loadingMoreLockRef.current = true;
          setLoadingMore(true);
          setLoadMoreError(null);
        }
        try {
          const cursor = append ? serverCursorRef.current : null;
          const etapasFiltro = etapasInternasParaFiltroPaso(etapaFilter);

          const baseQuery = {
            limit: MESA_BANDEJA_PAGE_SIZE,
            quickFilter,
            opsFilter: mesaOpsFilter,
            buscar: buscarDebounced,
            subestado: subestadoFilter === "todas" ? null : subestadoFilter,
            soloCitasHoy,
            todayYmd: todayYMD,
            rechazosSub: rechazosCancelacionesSubfiltro,
            origen: mapAdminOrigenTabToRpc(
              (typeof window !== "undefined" &&
                (getEffectiveMockRole() === "mesa_control_admin" ||
                  getEffectiveMockRole() === "mesa_control"))
                ? adminOrigenTab
                : "todos",
            ),
          } as const;

          let page: PaginatedMesaBandejaResult;

          if (etapasFiltro && etapasFiltro.length > 1) {
            // Paso visual con varias internas (p.ej. paso 3 → 3+4): unión completa
            // sin cambiar la RPC (sigue enviando un p_etapa interno por llamada).
            if (append) {
              setServerHasMore(false);
              return;
            }
            const byId = new Map<string, (typeof page.items)[number]>();
            let counts: PaginatedMesaBandejaResult["counts"] = null;
            let totalCount = 0;
            for (const etapaInterna of etapasFiltro) {
              let etapaCursor: MesaBandejaCursor | null = null;
              let includeCounts = counts === null;
              for (;;) {
                const part = await repo.listForMesaControlPaginated({
                  ...baseQuery,
                  cursor: etapaCursor,
                  etapa: etapaInterna,
                  includeCounts,
                });
                if (part.counts && !counts) counts = part.counts;
                totalCount += part.totalCount;
                for (const item of part.items) byId.set(item.id, item);
                if (!part.hasMore || !part.nextCursor) break;
                etapaCursor = part.nextCursor;
                includeCounts = false;
              }
            }
            const items = [...byId.values()].sort((a, b) => {
              const ts = String(a.sortTs).localeCompare(String(b.sortTs));
              return ts !== 0 ? ts : String(a.id).localeCompare(String(b.id));
            });
            page = {
              items,
              totalCount,
              hasMore: false,
              nextCursor: null,
              counts,
            };
          } else {
            page = await repo.listForMesaControlPaginated({
              ...baseQuery,
              cursor,
              etapa: etapasFiltro?.[0] ?? null,
              includeCounts: !append,
            });
          }
          if (gen !== serverQueryGenRef.current) return;

          const base = page.items.map((exp) => mapExpToCaso(exp));
          const enrichDeps = await resolveEnrichDeps();
          const enriched = (await enrichMesaBandejaPageItems(
            base,
            enrichDeps,
          )) as CasoConDocs[];

          // Conservar orden del servidor (sort_ts); no reordenar localmente.
          if (append) {
            setCasos((prev) => appendMesaBandejaItemsUnique(prev, enriched));
          } else {
            setCasos(enriched);
            if (page.counts) setServerCounts(page.counts);
          }
          setServerTotalCount(page.totalCount);
          setServerHasMore(page.hasMore);
          serverCursorRef.current = page.nextCursor;
        } catch (err) {
          if (gen !== serverQueryGenRef.current) return;
          const msg =
            err instanceof ExpedientesSupabaseError
              ? err.message
              : "No se pudo cargar la bandeja de Mesa de control.";
          if (append) {
            setLoadMoreError(msg);
          } else {
            setCasos([]);
            setServerTotalCount(0);
            setServerHasMore(false);
            setServerCounts(null);
            setListError(msg);
          }
        } finally {
          if (gen === serverQueryGenRef.current) {
            if (append) {
              setLoadingMore(false);
              loadingMoreLockRef.current = false;
            } else {
              setLoading(false);
            }
          } else if (append) {
            setLoadingMore(false);
            loadingMoreLockRef.current = false;
          }
        }
      })();
    },
    [
      adminOrigenTab,
      buscarDebounced,
      currentUser,
      dataSupabase,
      etapaFilter,
      mapExpToCaso,
      mesaOpsFilter,
      quickFilter,
      rechazosCancelacionesSubfiltro,
      repo,
      resolveEnrichDeps,
      soloCitasHoy,
      subestadoFilter,
      todayYMD,
    ],
  );

  /** Mock / legacy P101: descarga completa + filtros cliente + slice DOM. */
  const loadCasos = useCallback((opciones?: { silencioso?: boolean }) => {
    if (!currentUser) return;
    if (dataSupabase) {
      loadServerBandeja(opciones);
      return;
    }
    void (async () => {
      if (!opciones?.silencioso) setLoading(true);
      setListError(null);
      try {
        const exps = await repo.listForMesaControl();
        const mockRole =
          typeof window !== "undefined" ? getEffectiveMockRole() : null;
        const visibles = filterExpedientesByRole({ mockRole }, exps);
        const inboxMap =
          typeof window !== "undefined"
            ? mergeMesaControlInboxByLatestUpdated(readMesaControlInboxSafe())
            : new Map();
        const base = visibles.map((exp) => {
          const c = mapExpToCaso(exp);
          const row = inboxMap.get(exp.id);
          const rawFe = row?.fechaEnvioMesa;
          const fechaEnvioMesa =
            typeof rawFe === "string" && rawFe.trim() !== "" ? rawFe : undefined;
          return fechaEnvioMesa !== undefined ? { ...c, fechaEnvioMesa } : c;
        });
        const enrichDeps = await resolveEnrichDeps();
        const enriched = (await enrichMesaBandejaPageItems(
          base,
          enrichDeps,
        )) as CasoConDocs[];
        setCasos(sortMesaBandejaPorAntiguedad(enriched));
      } catch (err) {
        setCasos([]);
        if (err instanceof ExpedientesSupabaseError) {
          setListError(err.message);
        } else {
          setListError("No se pudo cargar la bandeja de Mesa de control.");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser, dataSupabase, loadServerBandeja, mapExpToCaso, repo, resolveEnrichDeps]);

  useEffect(() => {
    if (!mesaOpsRepo) {
      currentUserIdRef.current = null;
      setCurrentUserId(null);
      return;
    }
    void mesaOpsRepo.resolveCurrentUserId().then((id) => {
      currentUserIdRef.current = id;
      setCurrentUserId(id);
    });
  }, [mesaOpsRepo]);

  useEffect(() => {
    if (!currentUser) return;
    if (!dataSupabase) {
      loadCasos();
    }
    if (dataSupabase || typeof window === "undefined") {
      const archivosHandler = () => loadCasos();
      const clienteDatosHandler = () => loadCasos({ silencioso: true });
      const mesaOpsHandler = () => loadCasos({ silencioso: true });
      window.addEventListener(
        "expediente_archivos_updated",
        archivosHandler as EventListener,
      );
      window.addEventListener(
        EXPEDIENTE_CLIENTE_DATOS_UPDATED_EVENT,
        clienteDatosHandler as EventListener,
      );
      window.addEventListener(MESA_OPS_UPDATED_EVENT, mesaOpsHandler as EventListener);
      window.addEventListener(
        MESA_EXPEDIENTE_OPENED_UPDATED_EVENT,
        mesaOpsHandler as EventListener,
      );
      return () => {
        window.removeEventListener(
          "expediente_archivos_updated",
          archivosHandler as EventListener,
        );
        window.removeEventListener(
          EXPEDIENTE_CLIENTE_DATOS_UPDATED_EVENT,
          clienteDatosHandler as EventListener,
        );
        window.removeEventListener(MESA_OPS_UPDATED_EVENT, mesaOpsHandler as EventListener);
        window.removeEventListener(
          MESA_EXPEDIENTE_OPENED_UPDATED_EVENT,
          mesaOpsHandler as EventListener,
        );
      };
    }

    const storageHandler = (e: StorageEvent) => {
      if (e.key === "mesa_control_inbox") loadCasos();
    };
    const customHandler = () => loadCasos();

    const archivosHandler = () => loadCasos();
    const clienteDatosHandler = () => loadCasos({ silencioso: true });
    const mesaOpsHandler = () => loadCasos({ silencioso: true });

    window.addEventListener("storage", storageHandler);
    window.addEventListener("mesa_control_inbox_updated", customHandler);
    window.addEventListener("expediente_archivos_updated", archivosHandler as EventListener);
    window.addEventListener(
      EXPEDIENTE_CLIENTE_DATOS_UPDATED_EVENT,
      clienteDatosHandler as EventListener,
    );
    window.addEventListener(MESA_OPS_UPDATED_EVENT, mesaOpsHandler as EventListener);
    window.addEventListener(
      MESA_EXPEDIENTE_OPENED_UPDATED_EVENT,
      mesaOpsHandler as EventListener,
    );
    return () => {
      window.removeEventListener("storage", storageHandler);
      window.removeEventListener("mesa_control_inbox_updated", customHandler);
      window.removeEventListener(
        "expediente_archivos_updated",
        archivosHandler as EventListener,
      );
      window.removeEventListener(
        EXPEDIENTE_CLIENTE_DATOS_UPDATED_EVENT,
        clienteDatosHandler as EventListener,
      );
      window.removeEventListener(MESA_OPS_UPDATED_EVENT, mesaOpsHandler as EventListener);
      window.removeEventListener(
        MESA_EXPEDIENTE_OPENED_UPDATED_EVENT,
        mesaOpsHandler as EventListener,
      );
    };
  }, [currentUser, dataSupabase, loadCasos]);

  const kpis = useMemo(() => {
    if (dataSupabase && serverCounts) {
      return {
        correccionesEnviadas: serverCounts.correccionesEnviadas,
        nuevosPorRevisar: serverCounts.nuevos,
        citasHoy: serverCounts.citasHoy,
        bloqueadosRechazados: serverCounts.bloqueadosRechazados,
        enProceso: serverCounts.enProceso,
        rechazadosOperativo: serverCounts.rechazosCancelaciones,
        rechazadosActivos: serverCounts.rechazados,
        canceladosOperativo: serverCounts.cancelados,
        enValidacionMesa: serverCounts.enValidacionMesa,
        enEsperaAsesor: serverCounts.enEsperaAsesor,
        totalBandeja: serverCounts.totalBandeja,
      };
    }
    // Contadores mock/legacy: misma definición que la lista completa en memoria.
    const vistaRapida = contarVistaRapida(casos, todayYMD);
    const correccionesEnviadas = vistaRapida.correccionesEnviadas;
    const nuevosPorRevisar = vistaRapida.nuevos;
    const citasHoy = vistaRapida.citasHoy;
    const bloqueadosRechazados = casos.filter(
      (c) =>
        c.subestado === "rechazado" || c.resumenDocumental === "correccion_requerida",
    ).length;
    const enProceso = vistaRapida.enProceso;
    const rechazadosOperativo = vistaRapida.rechazosCancelaciones;
    const rechazadosActivos = vistaRapida.rechazados;
    const canceladosOperativo = vistaRapida.cancelados;
    const enValidacionMesa = casos.filter(
      (c) =>
        (c.cicloEstado ?? "activo") === "activo" &&
        c.subestado === "en_validacion_mesa" &&
        c.resumenDocumental !== "correccion_requerida" &&
        c.resumenDocumental !== "correccion_enviada",
    ).length;
    const enEsperaAsesor = casos.filter((c) => estaEnEsperaDeAsesor(c.resumenDocumental)).length;
    const totalBandeja = casos.filter(
      (c) => (c.cicloEstado ?? "activo") === "activo",
    ).length;
    return {
      correccionesEnviadas,
      nuevosPorRevisar,
      citasHoy,
      bloqueadosRechazados,
      enProceso,
      rechazadosOperativo,
      rechazadosActivos,
      canceladosOperativo,
      enValidacionMesa,
      enEsperaAsesor,
      totalBandeja,
    };
  }, [casos, dataSupabase, serverCounts, todayYMD]);

  const dashboardNotifications = useMemo(() => {
    return buildDashboardNotifications(
      casos.map((c) => ({
        expedienteId: c.id,
        clienteNombre: c.cliente_nombre,
        etapaActual: c.etapaActual,
        subestado: c.subestado,
        submittedToMesa: c.submittedToMesa,
        fechaCita: c.fechaCita,
        fechaEnvioMesa: c.fechaEnvioMesa,
        updatedAt: c.updatedAt,
        resumenCorreccion: c.resumenDocumental ?? null,
        clienteDatosEstado: c.clienteDatosEstado ?? null,
      })),
      "mesa",
      {
        todayYMD: todayYMD,
        isNuevoEtapa12: (source) =>
          esNuevoEtapa12({
            etapaActual: Number(source.etapaActual) || 0,
            subestado: String(source.subestado ?? "pendiente"),
          }),
        max: 50,
      },
    );
  }, [casos, todayYMD]);

  const showAdminOrigenTabs =
    mesaMockRole === "mesa_control_admin" || mesaMockRole === "mesa_control";

  const filteredCasos = useMemo(() => {
    if (dataSupabase) {
      // P102: el servidor ya aplicó filtros + orden; `casos` = páginas acumuladas.
      return casos;
    }
    // Orden mock: rol/visibilidad ya aplicados en carga → origen (solo admin) →
    // vista rápida → búsqueda → etapa → subestado → citas hoy → asignación + orden.
    let list = [...casos];
    if (showAdminOrigenTabs && adminOrigenTab === "internos") {
      list = list.filter((c) => c.origenMesa === "interno" || c.origenMesa == null);
    } else if (showAdminOrigenTabs && adminOrigenTab === "externos") {
      list = list.filter((c) => c.origenMesa === "externo");
    }
    list = aplicarFiltrosBandejaMesa(
      list,
      {
        quickFilter,
        rechazosCancelacionesSubfiltro,
        buscar,
        etapa: etapaFilter,
        subestado: subestadoFilter,
        soloCitasHoy,
      },
      todayYMD,
    );
    return applyMesaOpsFilterSorted(list, mesaOpsFilter, currentUserId);
  }, [
    adminOrigenTab,
    buscar,
    casos,
    currentUserId,
    dataSupabase,
    etapaFilter,
    mesaOpsFilter,
    quickFilter,
    rechazosCancelacionesSubfiltro,
    showAdminOrigenTabs,
    soloCitasHoy,
    subestadoFilter,
    todayYMD,
  ]);

  const infiniteResetKey = mesaBandejaInfiniteResetKey({
    quickFilter,
    mesaOpsFilter,
    buscar: dataSupabase ? buscarDebounced : buscar,
    etapaFilter,
    subestadoFilter,
    soloCitasHoy,
    rechazosCancelacionesSubfiltro,
    adminOrigenTab: showAdminOrigenTabs ? adminOrigenTab : "",
  });

  useEffect(() => {
    setVisibleCount(resetMesaBandejaVisibleCount());
    setLoadingMore(false);
    loadingMoreLockRef.current = false;
    setLoadMoreError(null);
  }, [infiniteResetKey]);

  // P102: al cambiar filtros/búsqueda debounced, refetch primera página.
  useEffect(() => {
    if (!currentUser || !dataSupabase) return;
    loadServerBandeja();
  }, [currentUser, dataSupabase, infiniteResetKey, loadServerBandeja]);

  useEffect(() => {
    setIoAvailable(isIntersectionObserverAvailable());
  }, []);

  const visibleWindow = useMemo(() => {
    if (dataSupabase) {
      return describeMesaBandejaServerWindow({
        loadedCount: filteredCasos.length,
        totalFiltered: serverTotalCount,
        hasMore: serverHasMore,
      });
    }
    return describeMesaBandejaVisibleWindow(visibleCount, filteredCasos.length);
  }, [
    dataSupabase,
    filteredCasos.length,
    serverHasMore,
    serverTotalCount,
    visibleCount,
  ]);

  const visibleCasos = useMemo(() => {
    if (dataSupabase) return filteredCasos;
    return sliceMesaBandejaVisible(filteredCasos, visibleWindow.visibleCount);
  }, [dataSupabase, filteredCasos, visibleWindow.visibleCount]);

  const loadMoreVisible = useCallback(() => {
    if (loadingMoreLockRef.current) return;
    if (!visibleWindow.hasMore) return;
    if (dataSupabase) {
      loadServerBandeja({ append: true, silencioso: true });
      return;
    }
    loadingMoreLockRef.current = true;
    setLoadingMore(true);
    window.setTimeout(() => {
      setVisibleCount((prev) =>
        nextMesaBandejaVisibleCount(prev, filteredCasos.length),
      );
      setLoadingMore(false);
      loadingMoreLockRef.current = false;
    }, 0);
  }, [
    dataSupabase,
    filteredCasos.length,
    loadServerBandeja,
    visibleWindow.hasMore,
  ]);

  useEffect(() => {
    if (!ioAvailable || !visibleWindow.hasMore || loading || loadingMore) return;
    const node = loadMoreSentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreVisible();
        }
      },
      { root: null, rootMargin: "240px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [
    ioAvailable,
    loadMoreVisible,
    loading,
    loadingMore,
    visibleWindow.hasMore,
    visibleCasos.length,
  ]);

  const showLoadMoreFallback = shouldShowMesaBandejaLoadMoreFallback({
    hasMore: visibleWindow.hasMore,
    intersectionObserverAvailable: ioAvailable,
  });

  const hayFiltrosActivos =
    quickFilter !== "todos" ||
    mesaOpsFilter !== "todo_mesa" ||
    buscar.trim() !== "" ||
    etapaFilter !== "todas" ||
    subestadoFilter !== "todas" ||
    soloCitasHoy;

  const handleQuickFilterSelect = useCallback(
    (id: MesaQuickFilter) => {
      const next = seleccionarVistaRapida(id);
      setQuickFilter(next.quickFilter);
      setMesaOpsFilter(next.opsFilter);
      setRechazosCancelacionesSubfiltro(next.rechazosCancelacionesSubfiltro);
    },
    [],
  );

  const handleOpsFilterSelect = useCallback((id: MesaOpsFilter) => {
    const next = seleccionarAsignacion(id);
    setQuickFilter(next.quickFilter);
    setMesaOpsFilter(next.opsFilter);
    setRechazosCancelacionesSubfiltro(next.rechazosCancelacionesSubfiltro);
  }, []);

  const handleLimpiarFiltros = useCallback(() => {
    const next = limpiarFiltrosBandeja();
    setQuickFilter(next.quickFilter);
    setRechazosCancelacionesSubfiltro(next.rechazosCancelacionesSubfiltro);
    setMesaOpsFilter(next.opsFilter);
    setBuscar(next.buscar);
    setEtapaFilter(next.etapa);
    setSubestadoFilter(next.subestado);
    setSoloCitasHoy(next.soloCitasHoy);
  }, []);

  const goExpediente = useCallback(
    (id: string) => {
      router.push(`/mesa-control/${id}`);
    },
    [router],
  );

  if (currentUser === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }
  if (!currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-600">
          <Link href="/login" className="text-blue-600 underline">
            Inicia sesión
          </Link>
        </p>
      </div>
    );
  }

  const chipBase =
    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1";
  const chipInactive = "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
  const chipActive = "border-blue-600 bg-blue-600 text-white";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
              Mesa de control
            </h1>
            <p className="text-xs text-slate-500">Bandeja operativa · ConCasa CRM</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="hidden max-w-[220px] flex-col truncate text-right text-xs text-slate-500 sm:flex">
              <span className="truncate font-medium text-slate-700">
                {getEffectiveMockName() || currentUser.email}
              </span>
              <span className="truncate text-[10px] text-slate-400">{currentUser.email}</span>
            </span>
            <NotificationsBell notifications={dashboardNotifications} />
            <Link
              href="/mesa-control/citas"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 sm:text-sm"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              Ver citas
            </Link>
            <Button
              variant="outline"
              className="text-xs sm:text-sm"
              onClick={async () => {
                try {
                  await sessionRepo.logout();
                } catch (err) {
                  console.error("[logout] mesa-control:", err);
                }
                if (typeof window !== "undefined") {
                  window.localStorage.removeItem("mock_role");
                  window.localStorage.removeItem("mock_email");
                  window.location.href = "/login";
                }
              }}
            >
              Cerrar sesión
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5">
        {hasAlertMessage(listError) ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {listError.trim()}
          </p>
        ) : null}
        {showAdminOrigenTabs ? (
          <section className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm sm:p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Origen comercial (solo administración)
            </p>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtro por origen">
              {(
                [
                  { id: "todos" as const, label: "Todos" },
                  { id: "internos" as const, label: "Internos" },
                  { id: "externos" as const, label: "Externos" },
                ] satisfies { id: AdminOrigenTab; label: string }[]
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={adminOrigenTab === id}
                  onClick={() => setAdminOrigenTab(id)}
                  className={`${chipBase} ${adminOrigenTab === id ? chipActive : chipInactive}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {canManageAgendaConfig(mesaMockRole) ? (
          <AgendaBiometricosConfigPanel
            canEdit={canManageAgendaConfig(mesaMockRole ?? "")}
            actorEmail={currentUser.email}
          />
        ) : null}

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl border border-sky-200/80 bg-gradient-to-br from-sky-50 to-white p-3 shadow-sm ring-1 ring-sky-100/60">
            <p className="text-[11px] font-medium uppercase tracking-wide text-sky-800/90">
              Correcciones enviadas
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-sky-950">
              {kpis.correccionesEnviadas}
            </p>
          </div>
          <div className="rounded-xl border border-amber-200/70 bg-gradient-to-br from-amber-50/80 to-white p-3 shadow-sm ring-1 ring-amber-100/50">
            <p className="text-[11px] font-medium uppercase tracking-wide text-amber-900/85">
              Nuevos por revisar
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-950">
              {kpis.nuevosPorRevisar}
            </p>
            <p className="mt-0.5 text-[10px] text-amber-800/80">Pasos 1–2 · pendiente / en proceso</p>
          </div>
          <div className="rounded-xl border border-blue-200/70 bg-gradient-to-br from-blue-50/70 to-white p-3 shadow-sm ring-1 ring-blue-100/50">
            <p className="text-[11px] font-medium uppercase tracking-wide text-blue-900/80">
              Citas hoy
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-blue-950">
              {kpis.citasHoy}
            </p>
          </div>
          <div className="rounded-xl border border-red-200/70 bg-gradient-to-br from-red-50/60 to-white p-3 shadow-sm ring-1 ring-red-100/50">
            <p className="text-[11px] font-medium uppercase tracking-wide text-red-900/85">
              Bloqueados / rechazados
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-red-950">
              {kpis.bloqueadosRechazados}
            </p>
            <p className="mt-0.5 text-[10px] text-red-800/75">
              Rechazo mesa o corrección doc./datos requerida
            </p>
          </div>
          <div className="rounded-xl border border-purple-200/70 bg-gradient-to-br from-purple-50/70 to-white p-3 shadow-sm ring-1 ring-purple-100/50">
            <p className="text-[11px] font-medium uppercase tracking-wide text-purple-900/80">
              En validación mesa
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-purple-950">
              {kpis.enValidacionMesa}
            </p>
            <p className="mt-0.5 text-[10px] text-purple-800/75">Etapa documental</p>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-gradient-to-br from-slate-50 to-white p-3 shadow-sm ring-1 ring-slate-100/60">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
              Total en bandeja
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {kpis.totalBandeja}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">Tras filtros de rol</p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm sm:p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Vista rápida
          </p>
          <div
            className="flex flex-wrap gap-1.5"
            role="tablist"
            aria-label="Filtros rápidos de bandeja"
          >
            {(
              [
                { id: "todos" as const, label: "Todos" },
                {
                  id: "correccion_enviada" as const,
                  label: `Correcciones enviadas (${kpis.correccionesEnviadas})`,
                },
                {
                  id: "nuevos" as const,
                  label: `Nuevos (${kpis.nuevosPorRevisar})`,
                },
                {
                  id: "en_proceso" as const,
                  label: `En proceso (${kpis.enProceso})`,
                },
                {
                  id: "rechazos_cancelaciones" as const,
                  label: `Rechazos y cancelaciones (${kpis.rechazadosOperativo})`,
                },
              ] satisfies { id: MesaQuickFilter; label: string }[]
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={quickFilter === id}
                onClick={() => handleQuickFilterSelect(id)}
                className={`${chipBase} ${
                  quickFilter === id ? chipActive : chipInactive
                }`}
                data-testid={`mesa-quick-filter-${id}`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => router.push(MESA_CITAS_ROUTE)}
              className={`${chipBase} ${chipInactive} inline-flex items-center gap-1`}
              data-testid={`mesa-quick-filter-${MESA_CITAS_HOY_CHIP_ID}`}
              title="Abre la pantalla de citas de Mesa"
            >
              Citas hoy ({kpis.citasHoy})
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3 w-3"
                aria-hidden
              >
                <path d="M7 17L17 7M9 7h8v8" />
              </svg>
            </button>
          </div>
          {quickFilter === "rechazos_cancelaciones" ? (
            <div
              className="mt-3 flex flex-wrap gap-1.5"
              role="tablist"
              aria-label="Subvista rechazos o cancelaciones"
              data-testid="mesa-rechazos-cancelaciones-subfiltro"
            >
              {(
                [
                  {
                    id: "rechazados" as const,
                    label: `Rechazados (${kpis.rechazadosActivos})`,
                  },
                  {
                    id: "cancelados" as const,
                    label: `Cancelados (${kpis.canceladosOperativo})`,
                  },
                ] satisfies {
                  id: MesaRechazosCancelacionesSubfiltro;
                  label: string;
                }[]
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={rechazosCancelacionesSubfiltro === id}
                  onClick={() => setRechazosCancelacionesSubfiltro(id)}
                  className={`${chipBase} ${
                    rechazosCancelacionesSubfiltro === id
                      ? chipActive
                      : chipInactive
                  }`}
                  data-testid={`mesa-rechazos-cancelaciones-${id}`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          <p className="mt-2 text-[11px] text-slate-500">
            Al elegir una vista rápida, la asignación operativa cambia a «Todo Mesa»
            para que la lista coincida con el contador. «Citas hoy» abre la pantalla
            de citas. Los cancelados solo aparecen en «Rechazos y cancelaciones».
          </p>
        </section>

        {mesaOpsRepo ? (
          <section className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm sm:p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Asignación operativa
            </p>
            <p className="mb-2 text-[11px] leading-snug text-slate-500">
              {MESA_OPS_FILTER_HELP_TEXT}
            </p>
            <div
              className="flex flex-wrap gap-1.5"
              role="tablist"
              aria-label="Filtros de asignación Mesa"
            >
              {MESA_OPS_FILTER_CHIPS.map(({ id, label }) => {
                const chipLabel =
                  id === "en_espera_asesor"
                    ? `${label} (${kpis.enEsperaAsesor})`
                    : label;
                return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mesaOpsFilter === id}
                  onClick={() => handleOpsFilterSelect(id)}
                  className={`${chipBase} ${mesaOpsFilter === id ? chipActive : chipInactive}`}
                  data-testid={`mesa-ops-filter-${id}`}
                >
                  {chipLabel}
                </button>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-3 sm:p-4">
          <p className="mb-3 text-xs font-medium text-slate-600">Filtros adicionales</p>
          <div className="flex flex-wrap items-end gap-3 sm:gap-4">
            <Input
              type="search"
              placeholder="Buscar cliente o teléfono"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              className="min-w-[min(100%,12rem)] sm:min-w-[200px]"
            />
            <Select
              label="Paso"
              value={etapaFilter}
              onChange={(e) => setEtapaFilter(e.target.value)}
              options={[
                { value: "todas", label: "Todos" },
                ...opcionesFiltroPasoOperativo().map((o) => ({
                  value: o.value,
                  label: o.label,
                })),
              ]}
            />
            <Select
              label="Subestado"
              value={subestadoFilter}
              onChange={(e) => setSubestadoFilter(e.target.value)}
              options={[
                { value: "todas", label: "Todas" },
                { value: "pendiente", label: "Pendiente" },
                { value: "en_validacion_mesa", label: "En validación por mesa" },
                { value: "en_proceso", label: "En proceso" },
                { value: "aprobado", label: "Aprobado" },
                { value: "rechazado", label: "Rechazado" },
              ]}
            />
            <label className="flex cursor-pointer items-center gap-2 pb-1">
              <input
                type="checkbox"
                checked={soloCitasHoy}
                onChange={(e) => setSoloCitasHoy(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-600">Solo citas de hoy</span>
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Expedientes</h2>
              <p
                className="text-xs text-slate-600"
                data-testid="mesa-bandeja-subtitulo-orden"
              >
                Ordenados por antigüedad en Mesa · clic o Enter para abrir
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Más antiguos primero según fecha de envío a Mesa. Urgencias en colores y
                filtros.
              </p>
            </div>
            <p className="text-right text-[11px] tabular-nums text-slate-500">
              <span className="font-semibold text-slate-700">
                {dataSupabase ? serverTotalCount : filteredCasos.length}
              </span>{" "}
              {(dataSupabase ? serverTotalCount : filteredCasos.length) === 1
                ? "caso"
                : "casos"}
              {visibleWindow.showingLabel ? (
                <span
                  className="mt-0.5 block text-[10px] font-normal text-slate-400"
                  data-testid="mesa-bandeja-mostrando"
                >
                  {visibleWindow.showingLabel}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex w-full flex-col gap-3">
            {loading ? (
              <p className="w-full py-10 text-center text-sm text-slate-500">
                Cargando expedientes…
              </p>
            ) : null}
            {!loading
              ? visibleCasos.map((c) => (
              <article
                key={c.id}
                role="button"
                tabIndex={0}
                aria-label={`Abrir expediente ${c.cliente_nombre}`}
                onClick={() => goExpediente(c.id)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  goExpediente(c.id);
                }}
                className={`w-full cursor-pointer rounded-xl border border-slate-200/90 p-4 text-left shadow-sm transition hover:border-sky-300/80 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${rowSurfaceClass(c)}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{c.cliente_nombre}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{c.telefono_cliente || "—"}</p>
                  </div>
                  <div className="flex max-w-[55%] flex-col items-end gap-1.5">
                    <MesaEnMesaHaceBadge
                      fechaEnvioMesa={c.fechaEnvioMesa}
                      createdAt={c.createdAt}
                      fechaEntradaMesaActual={c.fechaEntradaMesaActual}
                    />
                    <MesaCorreccionLecturaBadge
                      estado={c.correccionLecturaEstado}
                      esCorreccion={c.entradaLecturaEsCorreccion}
                    />
                    {showAdminOrigenTabs ? (
                      <span className={origenMesaBadgeClass(c.origenMesa ?? null)}>
                        {origenMesaLabel(c.origenMesa ?? null)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-600">
                  <span className="font-medium text-slate-700">Asesor:</span>{" "}
                  <span className="truncate">{c.asesorNombre || "—"}</span>
                </p>
                <p className="mt-1 text-[11px] text-slate-600">
                  <span className="font-medium text-slate-700">Programa:</span> {c.programa}
                </p>
                {c.nss ? (
                  <p className="mt-1 text-[11px] text-slate-600">
                    <span className="font-medium text-slate-700">NSS:</span> {c.nss}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {mesaOpsRepo ? (
                    <MesaOpsBandejaBadge
                      ops={c.mesaOps}
                      currentUserId={currentUserId}
                    />
                  ) : null}
                  {(() => {
                    const badge = formatEtapaMesaBandejaBadge(c.etapaActual);
                    return (
                      <span
                        className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-800"
                        title={
                          badge.hintAsesor
                            ? `${badge.principal} · ${badge.hintAsesor}`
                            : badge.principal
                        }
                        data-testid="mesa-bandeja-etapa-badge"
                      >
                        {badge.principal}
                        {badge.hintAsesor ? (
                          <span className="ml-1 font-normal text-slate-600">
                            · {badge.hintAsesor}
                          </span>
                        ) : null}
                      </span>
                    );
                  })()}
                  {c.subestado === "rechazado" ? (
                    <span className="inline-flex rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-900 ring-1 ring-red-200/80">
                      Rechazado
                    </span>
                  ) : (
                    <span
                      className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${subestadoOperativoBadgeClass(c.subestado)}`}
                    >
                      {subestadoOperativoLabel(c.subestado)}
                    </span>
                  )}
                </div>
                <div className="mt-2">
                  <DocumentacionCell c={c.resumenDocumental} />
                </div>
                {c.subestado === "rechazado" && c.motivoRechazo ? (
                  <p className="mt-2 line-clamp-2 text-[10px] leading-tight text-red-800/90">
                    {c.motivoRechazo}
                  </p>
                ) : null}
                {c.notificacionBooking ? (
                  <MesaBandejaNotificacionResumen
                    booking={c.notificacionBooking}
                    agendadoPorLabel={c.notificacionAgendadoPorLabel ?? "—"}
                    asesorDueñoLabel={c.asesorNombre || "—"}
                  />
                ) : null}
                <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-slate-100/80 pt-2 text-[10px] text-slate-500">
                  <span>
                    {c.notificacionBooking
                      ? "Cita biométrica/firma: —"
                      : `Cita: ${formatDate(c.fechaCita)}`}
                  </span>
                  <span>Envío Mesa: {formatDate(c.fechaEnvioMesa ?? undefined)}</span>
                  <span className="tabular-nums">Actualizado: {formatDateTime(c.updatedAt)}</span>
                </div>
              </article>
            ))
              : null}
            {!loading && visibleWindow.hasMore ? (
              <div
                ref={loadMoreSentinelRef}
                className="flex min-h-8 flex-col items-center justify-center gap-2 py-3"
                data-testid="mesa-bandeja-infinite-sentinel"
                aria-hidden={showLoadMoreFallback ? undefined : true}
              >
                {loadingMore ? (
                  <p
                    className="text-xs text-slate-500"
                    data-testid="mesa-bandeja-cargando-mas"
                  >
                    Cargando más…
                  </p>
                ) : null}
                {showLoadMoreFallback ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-xs"
                    onClick={loadMoreVisible}
                    disabled={loadingMore}
                    data-testid="mesa-bandeja-cargar-mas"
                  >
                    Cargar más
                  </Button>
                ) : null}
                {loadMoreError ? (
                  <div
                    className="flex flex-col items-center gap-2"
                    data-testid="mesa-bandeja-cargar-mas-error"
                  >
                    <p className="text-xs text-red-600">{loadMoreError}</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="text-xs"
                      onClick={loadMoreVisible}
                      disabled={loadingMore}
                      data-testid="mesa-bandeja-reintentar-mas"
                    >
                      Reintentar
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {!loading &&
          (dataSupabase ? serverTotalCount === 0 : filteredCasos.length === 0) ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-slate-500">
                {mesaOpsFilter === "en_espera_asesor"
                  ? "No hay expedientes en espera de corrección del asesor."
                  : mesaOpsFilter === "sin_asignar"
                    ? "No hay expedientes disponibles para tomar en este momento."
                    : "No hay expedientes que coincidan con los filtros seleccionados."}
              </p>
              {hayFiltrosActivos ? (
                <Button
                  variant="outline"
                  className="text-xs"
                  onClick={handleLimpiarFiltros}
                  data-testid="mesa-limpiar-filtros"
                >
                  Limpiar filtros
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
