"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionRepo } from "@/domain/session";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { formatDateTimeMx } from "@/lib/filters";
import {
  ExpedientesSupabaseError,
  useExpedientesRepo,
  ASESOR_INBOX_BUSCAR_DEBOUNCE_MS,
  ASESOR_INBOX_MAX_PAGE_SIZE,
  ASESOR_INBOX_UI_PAGE_SIZE,
  ASESOR_INBOX_NOTIF_DEFAULT_LIMIT,
  asesorInboxTotalPages,
  buildAsesorInboxListInput,
  capIdsForDependentLoads,
  clampAsesorInboxPage,
  collectAsesorInboxExportRows,
  formatAsesorInboxShowingRange,
  mapAsesorInboxNotificationsToDashboard,
  mapAsesorInboxPageResultToViewModel,
  mapAsesorInboxSummaryToKpis,
  asesorInboxReprecalBadgeLabel,
  asesorInboxReprecalBadgeClass,
  formatAsesorInboxActualizacion,
  formatAsesorInboxMontoAntes,
  formatAsesorInboxResueltaHint,
  type AsesorInboxKpisFromSummary,
  type AsesorInboxReprecalMeta,
  type ExpedienteMock,
} from "@/domain/expedientes";
import {
  deriveResultadoRealExpediente,
  type ResultadoRealExpediente,
} from "@/domain/expedientes/mock.repo";
import {
  formatReingresoBadgeLabel,
  hasReingresoVisible,
} from "@/domain/expedientes/reingreso-manual";
import { asesorExpedienteDetalleHref } from "@/domain/expedientes/asesor-expediente-correccion-ui";
import {
  ASESOR_INBOX_DOCUMENTACION_COL_HEADER,
  ASESOR_INBOX_DOCUMENTACION_COL_TITLE,
  asesorDocumentacionFilaBadge,
  asesorEstadoActualFilaBadge,
  asesorEstatusOperativoFilaBadge,
} from "@/domain/expedientes/asesor-inbox-fila-badges";
import { isDataModeSupabase } from "@/lib/dataMode";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  ASESOR_INBOX_FOCUS_TTL_MS,
  asesorPerfMark,
  createAsesorSummarySingleFlight,
  shouldRefreshAsesorListOnFocus,
  shouldRefreshAsesorSummaryOnFocus,
} from "@/lib/asesorInboxPerf";
import { listAsesorAgendaHintsByExpedienteIds } from "@/lib/asesorInboxEnrichBatch";
import { listRetencionHintsByExpedienteIds } from "@/lib/mesaBandejaAccionesEnrich";
import { resolveAsesorCorreccionExplicacion } from "@/domain/expedientes/asesor-correction-explanation";
import {
  deriveEstadoDocumentacionColumnaAsesor,
  deriveResumenExpedienteCorreccion,
  useExpedienteArchivosRepo,
  type CategoriaResumenDocumental,
  type EstadoDocumentacionColumnaAsesor,
  type ExpedienteArchivoResumen,
} from "@/domain/expediente-archivos";
import {
  useExpedienteClienteDatosRepo,
  type ExpedienteClienteDatosEstado,
} from "@/domain/expediente-cliente-datos";
import { EXPEDIENTE_CLIENTE_DATOS_UPDATED_EVENT } from "@/domain/expediente-cliente-datos/emit-updated";
import { formatMontoMX } from "@/lib/monto";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { AsesorAgendaCalendarButton } from "@/components/asesor/AsesorAgendaCalendarButton";
import type { DashboardNotificationItem } from "@/lib/dashboardNotifications";
import {
  listContingenciaPendientesAsesor,
  mergeExtraordinaryBellNotifications,
} from "@/domain/agenda-contingencia";
import {
  mergeInscripcionBellNotifications,
  useAgendaInscripcionRepo,
} from "@/domain/agenda-inscripcion";
import {
  useAgendaBiometricosBookingRepo,
} from "@/domain/agenda-biometricos";
import type { AgendaBiometricosBookingRepo } from "@/domain/agenda-biometricos/repo";
import {
  useAgendaFirmasBookingRepo,
} from "@/domain/agenda-firmas";
import type { AgendaFirmasBookingRepo } from "@/domain/agenda-firmas/repo";
import {
  useExpedienteRetencionSupabaseRepo,
} from "@/domain/expediente-retencion";
import {
  ASESOR_TAREAS_ETAPA_RETENCION,
  ASESOR_TAREAS_ETAPAS_AGENDA,
  type AsesorAgendaBookingHints,
  type AsesorRetencionHints,
} from "@/lib/asesorTareasPendientes";
import {
  ASESOR_EXPORT_PROGRAMA_OPTIONS,
  downloadAsesorPrecalificacionesExcel,
  type AsesorExportProgramaFilter,
} from "@/lib/exportAsesorPrecalificacionesExcel";
import { AsesorLiderDashboard } from "@/components/asesor/AsesorLiderDashboard";
import { AsesorOperacionDelegadaBar } from "@/components/asesor/AsesorOperacionDelegadaBar";
import {
  CAP_CREATE_FOR_ANY_ADVISOR,
  CAP_INTEGRATE_FOR_ANY_ADVISOR,
  hasCapability,
  isAsesorLiderDashboardMode,
  useAsesorLiderRepo,
  type AsesorActivoOrg,
  type AsesorLiderContext,
} from "@/domain/asesor-lider";

function formatMontoAprobadoFila(
  montoAprobado: number | null | undefined,
  decision: string,
): string {
  if (typeof montoAprobado === "number" && !Number.isNaN(montoAprobado) && montoAprobado > 0) {
    return formatMontoMX(montoAprobado);
  }
  if (decision === "no_cumple") return "—";
  return "—";
}

function documentacionColumnaBadgeClass(c?: EstadoDocumentacionColumnaAsesor): string {
  if (c === "completos") {
    return "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800";
  }
  if (c === "pendiente_aprobacion") {
    return "inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800 ring-1 ring-blue-200";
  }
  if (c === "faltantes") {
    return "inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700";
  }
  return "text-xs text-gray-400";
}

function documentacionColumnaLabel(c?: EstadoDocumentacionColumnaAsesor): string {
  if (!c) return "—";
  const map: Record<EstadoDocumentacionColumnaAsesor, string> = {
    faltantes: "Faltantes",
    pendiente_aprobacion: "Pendiente de aprobación",
    completos: "Completos",
  };
  return map[c];
}
interface PrecalificacionMockLocal {
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
  submittedToMesa: boolean;
  resultadoReal: ResultadoRealExpediente;
  etapaActual?: number | null;
  /** Copia del bloque operativo del repo; el subestado de UI sale de `operativo.subestado`. */
  operativo: ExpedienteMock["operativo"];
  fechaCita?: string | null;
  updatedAtOperativo?: string | null;
  esReingreso: boolean;
  reingresoManualCount?: number;
  reingresoManualAt?: string | null;
  /** Categoría SQL B1.5 (fallback hasta enriquecer con archivos/datos). */
  categoriaCorreccionRpc?: CategoriaResumenDocumental;
  /** P197: cola/chip. No derivar de columnas. */
  estadoEfectivo?: string | null;
  /** P209: explicación causal first paint. */
  correccionExplicacion?: string | null;
  /** P210: resumen causal inbox. */
  correccionResumen?: import("@/domain/expedientes/asesor-correccion-detalle").AsesorCorreccionResumen | null;
  reprecal?: AsesorInboxReprecalMeta | null;
}

const DECISION_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "pendiente", label: "Pendiente" },
  { value: "aprobado", label: "Aprobado" },
  { value: "no_cumple", label: "No cumple" },
] as const;

const ESTATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "pendiente", label: "Pendiente" },
  { value: "en_validacion_mesa", label: "En validación por mesa" },
  { value: "en_proceso", label: "En proceso" },
  { value: "aprobado", label: "Aprobado" },
  { value: "rechazado", label: "Rechazado" },
] as const;

const RESULTADO_REAL_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "aprobado_editor", label: "Aprobado (editor)" },
  { value: "no_cumple_editor", label: "No cumple (editor)" },
  { value: "pendiente_editor", label: "Pendiente (editor)" },
  { value: "en_tramite", label: "En trámite" },
  { value: "rechazado_mesa", label: "Rechazado (mesa)" },
  { value: "cancelado", label: "Cancelado" },
] as const;

const ETAPA_EXACTA_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "1", label: "1. Integración" },
  { value: "2", label: "2. Registro" },
  { value: "3", label: "3. Listo para cita de biométricos" },
  { value: "4", label: "4. Cita agendada (biométricos)" },
  { value: "5", label: "5. Biometría (resultado)" },
  { value: "6", label: "6. Inscripción" },
  { value: "7", label: "7. Notificación" },
  { value: "8", label: "8. Acuse / Aviso de retención" },
  { value: "9", label: "9. Listo para agendar firma" },
  { value: "10", label: "10. Cita para firma" },
  { value: "11", label: "11. Firmado" },
  { value: "12", label: "12. Pago a ConCasa" },
] as const;

function etapaActualToTexto(
  etapaActual?: number | null,
  pagoConcasaResultado?: "pagado" | "no_pagado" | null,
): string {
  if (etapaActual == null) return "—";
  const etapa = Number(etapaActual);
  if (!Number.isFinite(etapa)) return "—";

  if (etapa === 12) {
    if (pagoConcasaResultado === "pagado") return "12. Pago ConCasa · Pagó";
    if (pagoConcasaResultado === "no_pagado") return "12. Pago ConCasa · No pagó";
    return "12. Pago a ConCasa";
  }

  const found = ETAPA_EXACTA_OPTIONS.find((o) => o.value === String(etapa));
  return found?.label ?? "—";
}

interface AsesorFiltersState {
  buscar: string;
  decision: string;
  estatusOperativo: string;
  resultadoReal: string;
  programa: string;
  etapaExacta: string;
  fechaDesde: string;
  fechaHasta: string;
}

const INITIAL_FILTERS: AsesorFiltersState = {
  buscar: "",
  decision: "",
  estatusOperativo: "",
  resultadoReal: "",
  programa: "",
  etapaExacta: "",
  fechaDesde: "",
  fechaHasta: "",
};

type QuickFilterAsesor =
  | "todos"
  | "en_tramite"
  | "correccion_requerida"
  | "correccion_enviada"
  | "rechazados_mesa"
  | "cancelados"
  | "agendar_biometricos"
  | "agendar_firma"
  | "subir_acuse";

type QuickFilterChipTone = "default" | "warn" | "indigo" | "violet" | "amber" | "slate";

type QuickFilterChipConfig = {
  id: QuickFilterAsesor;
  label: string;
  count?: number;
  warnIfPositive?: boolean;
  tone?: QuickFilterChipTone;
};

type AsesorTareasHintsPorId = Record<
  string,
  | {
      agendaBiometricos?: AsesorAgendaBookingHints;
      agendaFirmas?: AsesorAgendaBookingHints;
      hasActiveNotificacionBooking?: boolean;
      retencion?: AsesorRetencionHints;
    }
  | undefined
>;

function quickFilterChipClassName(
  chip: QuickFilterChipConfig,
  isSelected: boolean,
): string {
  const base =
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors";
  const count = chip.count ?? 0;
  const warn = chip.warnIfPositive === true && count > 0;
  const tone = chip.tone ?? "default";

  if (isSelected) {
    if (warn || tone === "warn") {
      return `${base} border-amber-700 bg-amber-600 text-white shadow-sm`;
    }
    if (tone === "indigo") {
      return `${base} border-indigo-700 bg-indigo-600 text-white shadow-sm`;
    }
    if (tone === "violet") {
      return `${base} border-violet-700 bg-violet-600 text-white shadow-sm`;
    }
    if (tone === "amber") {
      return `${base} border-orange-700 bg-orange-600 text-white shadow-sm`;
    }
    if (tone === "slate") {
      return `${base} border-slate-700 bg-slate-600 text-white shadow-sm`;
    }
    return `${base} border-blue-600 bg-blue-600 text-white`;
  }

  if (warn) {
    return `${base} border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100 ring-1 ring-inset ring-amber-200`;
  }
  if (tone === "indigo" && count > 0) {
    return `${base} border-indigo-400 bg-indigo-50 text-indigo-950 hover:bg-indigo-100 ring-1 ring-inset ring-indigo-200`;
  }
  if (tone === "violet" && count > 0) {
    return `${base} border-violet-400 bg-violet-50 text-violet-950 hover:bg-violet-100 ring-1 ring-inset ring-violet-200`;
  }
  if (tone === "amber" && count > 0) {
    return `${base} border-orange-400 bg-orange-50 text-orange-950 hover:bg-orange-100 ring-1 ring-inset ring-orange-200`;
  }
  if (tone === "slate" && count > 0) {
    return `${base} border-slate-400 bg-slate-100 text-slate-900 hover:bg-slate-200 ring-1 ring-inset ring-slate-300`;
  }
  return `${base} border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100`;
}

function quickFilterChipDotClass(chip: QuickFilterChipConfig): string | null {
  const count = chip.count ?? 0;
  if (count <= 0) return null;
  const tone = chip.tone ?? "default";
  if (chip.warnIfPositive) return "bg-amber-600";
  if (tone === "indigo") return "bg-indigo-600";
  if (tone === "violet") return "bg-violet-600";
  if (tone === "amber") return "bg-orange-600";
  if (tone === "slate") return "bg-slate-600";
  return null;
}

function quickFilterChipCountBadgeClass(
  chip: QuickFilterChipConfig,
  isSelected: boolean,
): string {
  const tone = chip.tone ?? "default";
  if (chip.warnIfPositive || tone === "warn") {
    return isSelected ? "bg-amber-800/40 text-white" : "bg-amber-200 text-amber-950";
  }
  if (tone === "indigo") {
    return isSelected ? "bg-indigo-800/40 text-white" : "bg-indigo-200 text-indigo-950";
  }
  if (tone === "violet") {
    return isSelected ? "bg-violet-800/40 text-white" : "bg-violet-200 text-violet-950";
  }
  if (tone === "amber") {
    return isSelected ? "bg-orange-800/40 text-white" : "bg-orange-200 text-orange-950";
  }
  if (tone === "slate") {
    return isSelected ? "bg-slate-800/40 text-white" : "bg-slate-300 text-slate-950";
  }
  return isSelected ? "bg-blue-500/30 text-white" : "bg-gray-200 text-gray-800";
}

function quickFilterEmptyMessage(filter: QuickFilterAsesor): string | null {
  switch (filter) {
    case "agendar_biometricos":
      return "No tienes expedientes pendientes por agendar biométricos.";
    case "agendar_firma":
      return "No tienes expedientes pendientes por agendar firma.";
    case "subir_acuse":
      return "No tienes expedientes pendientes por subir acuse.";
    case "cancelados":
      return "No tienes expedientes cancelados.";
    case "rechazados_mesa":
      return "No tienes expedientes rechazados por Mesa (recuperables).";
    default:
      return null;
  }
}

async function fetchAgendaBookingHints(
  expedienteId: string,
  biometricosRepo: AgendaBiometricosBookingRepo | null,
  firmasRepo: AgendaFirmasBookingRepo | null,
): Promise<{
  agendaBiometricos?: AsesorAgendaBookingHints;
  agendaFirmas?: AsesorAgendaBookingHints;
}> {
  // Conservado para tests de equivalencia / fallback mock.
  const [bioActive, bioCancelled, firmaActive, firmaCancelled] = await Promise.all([
    biometricosRepo?.getActiveBooking(expedienteId) ?? Promise.resolve(null),
    biometricosRepo?.getLastCancelledBooking(expedienteId) ?? Promise.resolve(null),
    firmasRepo?.getActiveBooking(expedienteId) ?? Promise.resolve(null),
    firmasRepo?.getLastCancelledBooking(expedienteId) ?? Promise.resolve(null),
  ]);

  return {
    agendaBiometricos: {
      hasActiveBooking: bioActive != null,
      hasLastCancelledBooking: bioCancelled != null,
    },
    agendaFirmas: {
      hasActiveBooking: firmaActive != null,
      hasLastCancelledBooking: firmaCancelled != null,
    },
  };
}

async function fetchRetencionHints(
  expedienteId: string,
  retencionRepo: ReturnType<typeof useExpedienteRetencionSupabaseRepo>,
): Promise<AsesorRetencionHints> {
  if (!retencionRepo) {
    return { opcion: null, envio: null };
  }
  const [opcionRow, envioRow] = await Promise.all([
    retencionRepo.getOpcionByExpedienteId(expedienteId),
    retencionRepo.getEnvioByExpedienteId(expedienteId),
  ]);
  return {
    opcion: opcionRow?.retencion_opcion ?? null,
    envio: envioRow,
  };
}

function quickFilterChipLabel(chip: QuickFilterChipConfig): string {
  if (chip.count === undefined) return chip.label;
  if (chip.warnIfPositive === true && chip.count > 0) return chip.label;
  return `${chip.label} (${chip.count})`;
}

function quickFilterChipEmphasize(chip: QuickFilterChipConfig): boolean {
  const count = chip.count ?? 0;
  if (count <= 0) return false;
  if (chip.warnIfPositive === true) return true;
  const tone = chip.tone ?? "default";
  return tone === "indigo" || tone === "violet" || tone === "amber" || tone === "slate";
}

const PAGE_SIZE = ASESOR_INBOX_UI_PAGE_SIZE;

const EMPTY_KPIS: AsesorInboxKpisFromSummary = {
  total: 0,
  aprobadosEditor: 0,
  noCumple: 0,
  enTramite: 0,
  rechazadosMesa: 0,
  cancelados: 0,
  correccionRequerida: 0,
  correccionEnviada: 0,
  agendarBiometricos: 0,
  agendarFirma: 0,
  subirAcuse: 0,
};

function AsesorDashboardNormalPage({
  liderCtx,
}: {
  liderCtx: AsesorLiderContext | null;
}) {
  const { sessionRepo, currentUser } = useSessionRepo();
  const liderRepo = useAsesorLiderRepo();
  const router = useRouter();
  const [filters, setFilters] = useState<AsesorFiltersState>(INITIAL_FILTERS);
  const [buscarDebounced, setBuscarDebounced] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilterAsesor>("todos");
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const repo = useExpedientesRepo();
  const dataSupabase = isDataModeSupabase();
  const archivosRepo = useExpedienteArchivosRepo();
  const clienteDatosRepo = useExpedienteClienteDatosRepo();
  const biometricosBookingRepo = useAgendaBiometricosBookingRepo();
  const firmasBookingRepo = useAgendaFirmasBookingRepo();
  const inscripcionRepo = useAgendaInscripcionRepo();
  const retencionRepo = useExpedienteRetencionSupabaseRepo();
  const [mockPrecalList, setMockPrecalList] = useState<
    PrecalificacionMockLocal[]
  >([]);
  /** Total global del asesor (summary.counts.total). */
  const [globalTotalCount, setGlobalTotalCount] = useState(0);
  /** Total del filtro actual (RPC list total_count). */
  const [filteredTotalCount, setFilteredTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<AsesorInboxKpisFromSummary>(EMPTY_KPIS);
  const [programasUnicos, setProgramasUnicos] = useState<string[]>([]);
  const [dashboardNotifications, setDashboardNotifications] = useState<
    DashboardNotificationItem[]
  >([]);
  const [resumenArchivosPorId, setResumenArchivosPorId] = useState<
    Record<string, ExpedienteArchivoResumen[] | undefined>
  >({});
  const [clienteDatosEstadoPorId, setClienteDatosEstadoPorId] = useState<
    Record<string, ExpedienteClienteDatosEstado | undefined>
  >({});
  const [tareasHintsPorId, setTareasHintsPorId] = useState<AsesorTareasHintsPorId>({});
  void tareasHintsPorId; // hints de página (máx 25); chips usan summary global
  const [exportProgramaFilter, setExportProgramaFilter] =
    useState<AsesorExportProgramaFilter>("ambos");
  const [exportExcelLoading, setExportExcelLoading] = useState(false);
  const [exportExcelMessage, setExportExcelMessage] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const expedienteIdsRef = useRef<string[]>([]);
  const queryGenRef = useRef(0);
  const exportBusyRef = useRef(false);
  const categoriaRpcPorIdRef = useRef<Record<string, string>>({});
  const lastListAtRef = useRef(0);
  const lastSummaryAtRef = useRef(0);
  const summaryGenRef = useRef(0);
  const summarySingleFlightRef = useRef(createAsesorSummarySingleFlight<void>());
  const dashboardNotifsBaseRef = useRef<DashboardNotificationItem[]>([]);
  const canIntegrateForAny =
    liderCtx != null && hasCapability(liderCtx, CAP_INTEGRATE_FOR_ANY_ADVISOR);
  const canCreateForAny =
    liderCtx != null && hasCapability(liderCtx, CAP_CREATE_FOR_ANY_ADVISOR);
  const [asesoresOrg, setAsesoresOrg] = useState<readonly AsesorActivoOrg[]>([]);
  const [ownerAsesorId, setOwnerAsesorId] = useState("");

  const resumenDocumentalPorId = useMemo(() => {
    const out: Record<string, CategoriaResumenDocumental | undefined> = {};
    for (const p of mockPrecalList) {
      const fromEnrich = deriveResumenExpedienteCorreccion(
        resumenArchivosPorId[p.id] ?? [],
        clienteDatosEstadoPorId[p.id] ?? null,
      );
      const fromRpc = p.categoriaCorreccionRpc;
      // RPC es autoridad (incluye P130). No pisar correccion_enviada con heurística documental.
      const hasEnrich =
        resumenArchivosPorId[p.id] !== undefined ||
        clienteDatosEstadoPorId[p.id] !== undefined;
      out[p.id] =
        fromRpc === "correccion_enviada"
          ? fromRpc
          : hasEnrich
            ? fromEnrich
            : fromRpc;
    }
    return out;
  }, [mockPrecalList, resumenArchivosPorId, clienteDatosEstadoPorId]);

  const mapExpedienteToLegacy = useCallback(
    (
      e: ExpedienteMock,
      opts?: {
        resultadoReal?: ResultadoRealExpediente;
        categoriaCorreccion?: CategoriaResumenDocumental;
        estadoEfectivo?: string | null;
        correccionExplicacion?: string | null;
        correccionResumen?: import("@/domain/expedientes/asesor-correccion-detalle").AsesorCorreccionResumen | null;
        reprecal?: AsesorInboxReprecalMeta | null;
      },
    ): PrecalificacionMockLocal => {
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
        submittedToMesa: e.operativo.submittedToMesa,
        resultadoReal: opts?.resultadoReal ?? deriveResultadoRealExpediente(e),
        etapaActual: e.operativo.etapaActual,
        operativo: e.operativo,
        fechaCita: e.operativo.fechaCita,
        updatedAtOperativo: e.operativo.updatedAt,
        esReingreso: hasReingresoVisible(e),
        reingresoManualCount: e.reingresoManual?.count ?? 0,
        reingresoManualAt: e.reingresoManual?.at ?? null,
        categoriaCorreccionRpc: opts?.categoriaCorreccion,
        estadoEfectivo: opts?.estadoEfectivo ?? null,
        correccionExplicacion: opts?.correccionExplicacion ?? null,
        correccionResumen: opts?.correccionResumen ?? null,
        reprecal: opts?.reprecal ?? null,
      };
    },
    [],
  );

  const fetchResumenArchivosPorIds = useCallback(
    async (ids: string[]) => {
      const capped = capIdsForDependentLoads(ids);
      if (typeof window === "undefined" || capped.length === 0) return;
      asesorPerfMark("docsBatch-start");
      try {
        const byId = await archivosRepo.listResumenBatchByExpedienteIds(capped);
        setResumenArchivosPorId((prev) => {
          const next = { ...prev };
          for (const id of capped) {
            next[id] = byId[id] ?? [];
          }
          return next;
        });
      } catch {
        // Fail-soft AE8: filas siguen visibles sin docs.
      } finally {
        asesorPerfMark("docsBatch-end");
      }
    },
    [archivosRepo],
  );

  const fetchClienteDatosEstadoPorIds = useCallback(
    async (ids: string[]) => {
      const capped = capIdsForDependentLoads(ids);
      if (typeof window === "undefined" || capped.length === 0) return;
      try {
        const estados = await clienteDatosRepo.listEstadoByExpedienteIds(capped);
        setClienteDatosEstadoPorId((prev) => {
          const next = { ...prev };
          for (const id of capped) {
            next[id] = estados[id];
          }
          return next;
        });
      } catch {
        // Sin estados: la bandeja sigue con categoría RPC / documental.
      }
    },
    [clienteDatosRepo],
  );

  const fetchTareasHintsPorIds = useCallback(
    async (rows: readonly PrecalificacionMockLocal[]) => {
      const cappedRows = rows.slice(0, ASESOR_INBOX_UI_PAGE_SIZE);
      if (typeof window === "undefined" || cappedRows.length === 0) {
        setTareasHintsPorId({});
        return;
      }

      const agendaCandidates = cappedRows.filter(
        (p) =>
          p.submittedToMesa &&
          ASESOR_TAREAS_ETAPAS_AGENDA.includes(
            (p.etapaActual ?? 0) as (typeof ASESOR_TAREAS_ETAPAS_AGENDA)[number],
          ),
      );
      const notificacionCandidates = cappedRows.filter(
        (p) => p.submittedToMesa && p.etapaActual === 3,
      );
      const retencionCandidates = cappedRows.filter(
        (p) => p.submittedToMesa && p.etapaActual === ASESOR_TAREAS_ETAPA_RETENCION,
      );

      asesorPerfMark("enrichTotal-start");

      const agendaIds = agendaCandidates.map((p) => p.id);
      const retencionIds = retencionCandidates.map((p) => p.id);
      const notifIds = notificacionCandidates.map((p) => p.id);

      const canBatch =
        dataSupabase && isSupabaseConfigured() && Boolean(supabaseBrowser);

      const [notifSettled, agendaSettled, retencionSettled] = await Promise.allSettled([
        biometricosBookingRepo && notifIds.length > 0
          ? biometricosBookingRepo.listActiveNotificacionByExpedienteIds(notifIds)
          : Promise.resolve(new Map()),
        canBatch && agendaIds.length > 0
          ? (async () => {
              asesorPerfMark("agendaBatch-start");
              try {
                return await listAsesorAgendaHintsByExpedienteIds(
                  supabaseBrowser!,
                  agendaIds,
                );
              } finally {
                asesorPerfMark("agendaBatch-end");
              }
            })()
          : Promise.resolve(null),
        canBatch && retencionIds.length > 0
          ? (async () => {
              asesorPerfMark("retencionBatch-start");
              try {
                return await listRetencionHintsByExpedienteIds(
                  supabaseBrowser!,
                  retencionIds,
                );
              } finally {
                asesorPerfMark("retencionBatch-end");
              }
            })()
          : Promise.resolve(null),
      ]);

      const activeNotificacionIds = new Set<string>();
      if (notifSettled.status === "fulfilled") {
        for (const id of (notifSettled.value as Map<string, unknown>).keys()) {
          activeNotificacionIds.add(id);
        }
      }

      const agendaHintsById = new Map<
        string,
        {
          agendaBiometricos?: AsesorAgendaBookingHints;
          agendaFirmas?: AsesorAgendaBookingHints;
          hasActiveNotificacionBooking: boolean;
        }
      >();

      if (agendaSettled.status === "fulfilled" && agendaSettled.value) {
        for (const [id, hints] of agendaSettled.value) {
          agendaHintsById.set(id, {
            agendaBiometricos: hints.agendaBiometricos,
            agendaFirmas: hints.agendaFirmas,
            hasActiveNotificacionBooking: activeNotificacionIds.has(id),
          });
        }
      } else if (
        !canBatch &&
        (biometricosBookingRepo || firmasBookingRepo) &&
        agendaCandidates.length > 0
      ) {
        // Fallback mock / sin supabase browser
        const agendaEntries = await Promise.all(
          agendaCandidates.map(async (p) => {
            try {
              const agenda = await fetchAgendaBookingHints(
                p.id,
                biometricosBookingRepo,
                firmasBookingRepo,
              );
              return [
                p.id,
                {
                  agendaBiometricos: agenda.agendaBiometricos ?? {
                    hasActiveBooking: false,
                    hasLastCancelledBooking: false,
                  },
                  agendaFirmas: agenda.agendaFirmas ?? {
                    hasActiveBooking: false,
                    hasLastCancelledBooking: false,
                  },
                  hasActiveNotificacionBooking: activeNotificacionIds.has(p.id),
                },
              ] as const;
            } catch {
              return null;
            }
          }),
        );
        for (const entry of agendaEntries) {
          if (entry) agendaHintsById.set(entry[0], entry[1]);
        }
      }

      for (const p of notificacionCandidates) {
        const agenda = agendaHintsById.get(p.id);
        agendaHintsById.set(p.id, {
          ...(agenda ?? {}),
          hasActiveNotificacionBooking: activeNotificacionIds.has(p.id),
        });
      }

      const retencionHintsById = new Map<string, AsesorRetencionHints>();
      if (retencionSettled.status === "fulfilled" && retencionSettled.value) {
        for (const [id, hint] of retencionSettled.value) {
          const opcion = hint.opcion;
          const estado = hint.envioEstado;
          retencionHintsById.set(id, {
            opcion,
            envio:
              opcion && estado && hint.fechaEnvioMesa
                ? {
                    expedienteId: id,
                    enviado: hint.enviadoAMesa,
                    fechaEnvioMesa: hint.fechaEnvioMesa,
                    opcion,
                    estado,
                  }
                : null,
          });
        }
      } else if (retencionRepo && retencionCandidates.length > 0) {
        const retencionEntries = await Promise.all(
          retencionCandidates.map(async (p) => {
            try {
              const hints = await fetchRetencionHints(p.id, retencionRepo);
              return [p.id, hints] as const;
            } catch {
              return [p.id, { opcion: null, envio: null }] as const;
            }
          }),
        );
        for (const [id, hints] of retencionEntries) {
          retencionHintsById.set(id, hints);
        }
      }

      setTareasHintsPorId(() => {
        const next: AsesorTareasHintsPorId = {};
        for (const p of cappedRows) {
          const agenda = agendaHintsById.get(p.id);
          const retencion = retencionHintsById.get(p.id);
          if (!agenda && !retencion) continue;
          next[p.id] = {
            ...(agenda ?? {}),
            ...(retencion ? { retencion } : {}),
          };
        }
        return next;
      });
      asesorPerfMark("enrichTotal-end");
    },
    [
      biometricosBookingRepo,
      dataSupabase,
      firmasBookingRepo,
      retencionRepo,
    ],
  );

  const applySummarySideEffects = useCallback(
    async (summary: Awaited<ReturnType<typeof repo.getAsesorInboxSummary>>, gen: number) => {
      setGlobalTotalCount(summary.counts.total);
      setKpis(mapAsesorInboxSummaryToKpis(summary));
      setProgramasUnicos(summary.programas_unicos);
      const inboxNotifs = mapAsesorInboxNotificationsToDashboard(summary);
      dashboardNotifsBaseRef.current = inboxNotifs;
      let mergedNotifs = inboxNotifs;
      try {
        const pendingContingencia = await listContingenciaPendientesAsesor();
        if (gen !== summaryGenRef.current) return;
        mergedNotifs = mergeExtraordinaryBellNotifications(
          inboxNotifs,
          pendingContingencia,
        );
      } catch {
        /* Contingencia opcional */
      }
      try {
        if (inscripcionRepo?.listOpenRequirementsForAsesor) {
          const openReqs = await inscripcionRepo.listOpenRequirementsForAsesor();
          if (gen !== summaryGenRef.current) return;
          const nameById = new Map<string, string>();
          for (const n of inboxNotifs) {
            const id = String(n.expedienteId ?? "").trim();
            const nombre = String(n.clienteNombre ?? "").trim();
            if (id) nameById.set(id, nombre);
          }
          mergedNotifs = mergeInscripcionBellNotifications(
            mergedNotifs,
            openReqs,
            nameById,
          );
        }
      } catch {
        /* Inscripción opcional */
      }
      if (gen !== summaryGenRef.current) return;
      setDashboardNotifications(mergedNotifs);
      lastSummaryAtRef.current = Date.now();
    },
    [inscripcionRepo, repo],
  );

  const refreshSummary = useCallback(
    async (_reason: "initial" | "mutation" | "explicit" | "focus" | "realtime") => {
      if (!currentUser) return;
      const key = String(currentUser.email ?? "asesor");
      asesorPerfMark("summary-start");
      // Gen dentro del factory: single-flight no invalida el apply del vuelo compartido.
      await summarySingleFlightRef.current.run(key, async () => {
        const gen = ++summaryGenRef.current;
        try {
          const summary = await repo.getAsesorInboxSummary(
            ASESOR_INBOX_NOTIF_DEFAULT_LIMIT,
          );
          if (gen !== summaryGenRef.current) return;
          await applySummarySideEffects(summary, gen);
        } finally {
          asesorPerfMark("summary-end");
        }
      });
    },
    [applySummarySideEffects, currentUser, repo],
  );

  const loadInbox = useCallback(
    async (opts?: { pageOverride?: number }) => {
      if (!currentUser) return;
      const gen = ++queryGenRef.current;
      const pageToLoad = opts?.pageOverride ?? page;
      setListLoading(true);
      setListError(null);
      // Evitar mezclar registros de la página anterior mientras llega la nueva.
      setMockPrecalList([]);
      setResumenArchivosPorId({});
      setClienteDatosEstadoPorId({});
      setTareasHintsPorId({});

      const listInput = buildAsesorInboxListInput({
        page: pageToLoad,
        pageSize: PAGE_SIZE,
        ownerAsesorId:
          canIntegrateForAny && ownerAsesorId ? ownerAsesorId : null,
        filters: {
          buscar: buscarDebounced,
          decision: filters.decision,
          estatusOperativo: filters.estatusOperativo,
          resultadoReal: filters.resultadoReal,
          programa: filters.programa,
          etapaExacta: filters.etapaExacta,
          fechaDesde: filters.fechaDesde,
          fechaHasta: filters.fechaHasta,
        },
        quickFilter,
      });

      try {
        // P203: solo list — summary va por refreshSummary (no page/chip).
        asesorPerfMark("list-start");
        const pageResult = await repo.listAsesorInboxPage(listInput);
        asesorPerfMark("list-end");
        if (gen !== queryGenRef.current) return;

        let effectiveResult = pageResult;
        const totalPages = asesorInboxTotalPages(
          pageResult.total_count,
          pageResult.page_size,
        );
        if (
          pageResult.total_count > 0 &&
          pageToLoad > totalPages &&
          pageResult.items.length === 0
        ) {
          const clamped = clampAsesorInboxPage(
            pageToLoad,
            pageResult.total_count,
            pageResult.page_size,
          );
          if (clamped !== pageToLoad) {
            effectiveResult = await repo.listAsesorInboxPage({
              ...listInput,
              page: clamped,
            });
            if (gen !== queryGenRef.current) return;
            setPage(clamped);
          }
        }

        const view = mapAsesorInboxPageResultToViewModel(effectiveResult, {
          asesorEmail: currentUser.email,
        });
        categoriaRpcPorIdRef.current = { ...view.categoriaPorId };
        const mapped = view.items.map((exp) => {
          const cat = view.categoriaPorId[exp.id];
          const catTyped =
            cat === "faltantes" ||
            cat === "correccion_requerida" ||
            cat === "correccion_enviada" ||
            cat === "pendiente_revision_documental" ||
            cat === "documentos_validados"
              ? cat
              : undefined;
          return mapExpedienteToLegacy(exp, {
            resultadoReal: deriveResultadoRealExpediente(exp),
            categoriaCorreccion: catTyped,
            estadoEfectivo: view.estadoEfectivoPorId[exp.id] ?? null,
            correccionExplicacion: view.correccionExplicacionPorId[exp.id] ?? null,
            correccionResumen: view.correccionResumenPorId[exp.id] ?? null,
            reprecal: view.reprecalPorId[exp.id] ?? null,
          });
        });
        const mappedWithRpcResult = effectiveResult.items.map((row, idx) => {
          const base = mapped[idx]!;
          return {
            ...base,
            resultadoReal: row.resultado_real,
            categoriaCorreccionRpc:
              row.categoria_correccion as CategoriaResumenDocumental,
            estadoEfectivo: row.estado_efectivo ?? null,
            correccionExplicacion: row.correccion_explicacion ?? null,
            correccionResumen: view.correccionResumenPorId[row.id] ?? null,
          };
        });

        // First paint: filas RPC sin esperar enrich.
        setMockPrecalList(mappedWithRpcResult);
        setFilteredTotalCount(view.totalCount);
        setListError(null);
        lastListAtRef.current = Date.now();
        setListLoading(false);

        const ids = capIdsForDependentLoads(mappedWithRpcResult.map((p) => p.id));
        expedienteIdsRef.current = ids;
        // B9: enrich en paralelo, fail-soft
        void Promise.allSettled([
          fetchResumenArchivosPorIds(ids),
          fetchClienteDatosEstadoPorIds(ids),
          fetchTareasHintsPorIds(mappedWithRpcResult),
        ]);
      } catch (err) {
        if (gen !== queryGenRef.current) return;
        setMockPrecalList([]);
        setFilteredTotalCount(0);
        expedienteIdsRef.current = [];
        if (err instanceof ExpedientesSupabaseError) {
          setListError(err.message);
        } else {
          setListError("No se pudo cargar el listado de expedientes.");
        }
        if (gen === queryGenRef.current) {
          setListLoading(false);
        }
      }
    },
    [
      currentUser,
      page,
      buscarDebounced,
      filters.decision,
      filters.estatusOperativo,
      filters.resultadoReal,
      filters.programa,
      filters.etapaExacta,
      filters.fechaDesde,
      filters.fechaHasta,
      quickFilter,
      canIntegrateForAny,
      ownerAsesorId,
      repo,
      mapExpedienteToLegacy,
      fetchResumenArchivosPorIds,
      fetchClienteDatosEstadoPorIds,
      fetchTareasHintsPorIds,
    ],
  );

  const reloadPrecalificaciones = useCallback(() => {
    void loadInbox();
    void refreshSummary("mutation");
  }, [loadInbox, refreshSummary]);

  const handleDescargarExcel = useCallback(async () => {
    if (!currentUser?.email) {
      setExportExcelMessage("No se pudo identificar al asesor autenticado.");
      return;
    }
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    setExportExcelLoading(true);
    setExportExcelMessage(null);
    setExportProgress("Preparando exportación…");
    try {
      const rows = await collectAsesorInboxExportRows({
        listPage: (input) => repo.listAsesorInboxPage(input),
        baseInput: {
          quick_filter: "todos",
          buscar: null,
          decision: null,
          estatus_operativo: null,
          resultado_real: null,
          programa: null,
          etapa_exacta: null,
          fecha_desde: null,
          fecha_hasta: null,
        },
        pageSize: ASESOR_INBOX_MAX_PAGE_SIZE,
        asesorEmail: currentUser.email,
        onProgress: (loaded, total) => {
          setExportProgress(`Exportando ${loaded} de ${total}…`);
        },
      });
      const result = downloadAsesorPrecalificacionesExcel(
        rows,
        exportProgramaFilter,
        currentUser.email,
      );
      if (!result.ok) {
        setExportExcelMessage("No hay precalificaciones para el programa seleccionado.");
      } else {
        setExportExcelMessage(`Se descargó ${result.filename} (${result.rowCount} filas).`);
      }
    } catch {
      setExportExcelMessage("No se pudo generar el archivo Excel. Intenta de nuevo.");
    } finally {
      exportBusyRef.current = false;
      setExportExcelLoading(false);
      setExportProgress(null);
    }
  }, [currentUser?.email, exportProgramaFilter, repo]);

  const totalPages = asesorInboxTotalPages(filteredTotalCount, PAGE_SIZE);
  const safePage = clampAsesorInboxPage(page, filteredTotalCount, PAGE_SIZE);
  const canPrevious = safePage > 1 && !listLoading;
  const canNext = safePage < totalPages && !listLoading;
  const showingRange = formatAsesorInboxShowingRange(
    safePage,
    PAGE_SIZE,
    filteredTotalCount,
  );
  const expedientesPagina = mockPrecalList;

  const hasActiveFilters =
    quickFilter !== "todos" ||
    filters.buscar !== "" ||
    filters.decision !== "" ||
    filters.estatusOperativo !== "" ||
    filters.resultadoReal !== "" ||
    filters.etapaExacta !== "" ||
    filters.programa !== "" ||
    filters.fechaDesde !== "" ||
    filters.fechaHasta !== "";

  const handleClearFilters = () => {
    setFilters(INITIAL_FILTERS);
    setBuscarDebounced("");
    setQuickFilter("todos");
    setPage(1);
  };

  const updateFilters = (
    updater: (prev: AsesorFiltersState) => AsesorFiltersState,
  ) => {
    setFilters(updater);
    setPage(1);
  };

  const handleQuickFilterChange = (id: QuickFilterAsesor) => {
    setQuickFilter(id);
    setPage(1);
  };

  const quickFilterChips = useMemo((): QuickFilterChipConfig[] => {
    return [
      { id: "todos", label: "Todos" },
      { id: "en_tramite", label: "En trámite", count: kpis.enTramite },
      {
        id: "correccion_requerida",
        label: "Necesita corrección",
        count: kpis.correccionRequerida,
        warnIfPositive: true,
      },
      {
        id: "correccion_enviada",
        label: "Corrección enviada",
        count: kpis.correccionEnviada,
      },
      {
        id: "rechazados_mesa",
        label: "Rechazados por mesa",
        count: kpis.rechazadosMesa,
      },
      {
        id: "cancelados",
        label: "Cancelados",
        count: kpis.cancelados,
        tone: "slate",
      },
      {
        id: "agendar_biometricos",
        label: "Agendar biométricos",
        count: kpis.agendarBiometricos,
        tone: "indigo",
      },
      {
        id: "agendar_firma",
        label: "Agendar firma",
        count: kpis.agendarFirma,
        tone: "violet",
      },
      {
        id: "subir_acuse",
        label: "Subir acuse",
        count: kpis.subirAcuse,
        tone: "amber",
      },
    ];
  }, [kpis]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setBuscarDebounced(filters.buscar);
    }, ASESOR_INBOX_BUSCAR_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [filters.buscar]);

  useEffect(() => {
    if (!dataSupabase || (!canCreateForAny && !canIntegrateForAny)) {
      setAsesoresOrg([]);
      setOwnerAsesorId("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await liderRepo.listAsesoresActivosOrg();
        if (cancelled) return;
        setAsesoresOrg(list);
        const self = list.find((a) => a.email === currentUser?.email);
        const nextOwner = self?.id ?? list[0]?.id ?? "";
        setOwnerAsesorId((prev) =>
          prev && list.some((a) => a.id === prev) ? prev : nextOwner,
        );
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[asesor] listAsesoresActivosOrg:", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    canCreateForAny,
    canIntegrateForAny,
    currentUser?.email,
    dataSupabase,
    liderRepo,
  ]);

  useEffect(() => {
    setPage(1);
  }, [buscarDebounced, ownerAsesorId]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  /** P203: summary inicial / cambio de usuario — no en cada page/chip. */
  useEffect(() => {
    if (!currentUser) return;
    void refreshSummary("initial");
  }, [currentUser?.email, refreshSummary]);

  /** Refetch al volver a la pestaña con TTL 45s (list y summary por separado). */
  useEffect(() => {
    const refreshIfVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      const now = Date.now();
      if (
        shouldRefreshAsesorListOnFocus({
          lastListAtMs: lastListAtRef.current,
          nowMs: now,
          ttlMs: ASESOR_INBOX_FOCUS_TTL_MS,
        })
      ) {
        void loadInbox();
      }
      if (
        shouldRefreshAsesorSummaryOnFocus({
          lastSummaryAtMs: lastSummaryAtRef.current,
          nowMs: now,
          ttlMs: ASESOR_INBOX_FOCUS_TTL_MS,
        })
      ) {
        void refreshSummary("focus");
      }
    };
    const onFocus = () => refreshIfVisible();
    const onVis = () => {
      if (document.visibilityState === "visible") refreshIfVisible();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [loadInbox, refreshSummary]);

  useEffect(() => {
    const storageHandler = (e: StorageEvent) => {
      if (
        e.key === "precalificaciones_mock" ||
        e.key === "decisions_mock" ||
        e.key === "mesa_control_inbox"
      ) {
        reloadPrecalificaciones();
      }
    };
    const customHandler = () => {
      reloadPrecalificaciones();
    };
    const archivosHandler = (e: Event) => {
      const ce = e as CustomEvent<{ expedienteId?: string | null }>;
      const expId = ce.detail?.expedienteId;
      if (expId) {
        void fetchResumenArchivosPorIds([expId]);
      } else {
        void fetchResumenArchivosPorIds(expedienteIdsRef.current);
      }
    };
    const clienteDatosHandler = (e: Event) => {
      const ce = e as CustomEvent<{ expedienteId?: string | null }>;
      const expId = ce.detail?.expedienteId;
      if (expId) {
        void fetchClienteDatosEstadoPorIds([expId]);
      } else {
        void fetchClienteDatosEstadoPorIds(expedienteIdsRef.current);
      }
    };
    window.addEventListener("storage", storageHandler);
    window.addEventListener("decisions_mock_updated", customHandler);
    window.addEventListener("mesa_control_inbox_updated", customHandler);
    window.addEventListener("expediente_archivos_updated", archivosHandler as EventListener);
    window.addEventListener(
      EXPEDIENTE_CLIENTE_DATOS_UPDATED_EVENT,
      clienteDatosHandler as EventListener,
    );
    return () => {
      window.removeEventListener("storage", storageHandler);
      window.removeEventListener("decisions_mock_updated", customHandler);
      window.removeEventListener("mesa_control_inbox_updated", customHandler);
      window.removeEventListener(
        "expediente_archivos_updated",
        archivosHandler as EventListener,
      );
      window.removeEventListener(
        EXPEDIENTE_CLIENTE_DATOS_UPDATED_EVENT,
        clienteDatosHandler as EventListener,
      );
    };
  }, [reloadPrecalificaciones, fetchResumenArchivosPorIds, fetchClienteDatosEstadoPorIds]);

  if (currentUser === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }
  if (!currentUser || currentUser.role !== "asesor") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-600">
          No has iniciado sesión como asesor.{" "}
          <Link href="/login" className="text-blue-600 underline">
            Ir a login
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-3 py-3 sm:px-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-base font-semibold text-gray-900 sm:text-lg">
            ConCasa CRM · Asesor
          </h1>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="min-w-0 truncate text-sm text-gray-500">
              {currentUser.email}
            </span>
            <NotificationsBell
              notifications={dashboardNotifications}
              userKey={currentUser.email}
            />
            <AsesorAgendaCalendarButton />
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await sessionRepo.logout();
                } catch (err) {
                  console.error("[logout] error en logout asesor:", err);
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
      <main className="mx-auto w-full max-w-5xl space-y-3 px-3 py-3 sm:px-4 sm:py-4 lg:max-w-7xl lg:px-6 xl:max-w-[1400px]">
        {canIntegrateForAny && asesoresOrg.length > 0 && ownerAsesorId ? (
          <AsesorOperacionDelegadaBar
            asesores={asesoresOrg}
            currentUserId={
              asesoresOrg.find((a) => a.email === currentUser.email)?.id ??
              ownerAsesorId
            }
            ownerAsesorId={ownerAsesorId}
            onOwnerChange={setOwnerAsesorId}
          />
        ) : null}
        <div className="flex items-baseline justify-between gap-2 border-b border-gray-200/80 pb-2">
          <h2 className="text-sm font-semibold text-gray-900 sm:text-base">
            {canIntegrateForAny && ownerAsesorId !==
            (asesoresOrg.find((a) => a.email === currentUser.email)?.id ?? "")
              ? "Expedientes del asesor titular"
              : "Mis expedientes"}
          </h2>
        </div>
        {listError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            <p>{listError}</p>
            <Button
              type="button"
              variant="outline"
              className="text-xs"
              onClick={() => void loadInbox()}
            >
              Reintentar
            </Button>
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="max-w-[10rem] rounded-md border border-gray-200 bg-white px-3 py-2 shadow-sm sm:max-w-xs">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Total
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">
              {kpis.total}
            </p>
          </div>
          <p className="text-[10px] font-medium text-gray-500">
            Resumen de tus expedientes
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-md border border-blue-200/80 bg-blue-50/40 px-3 py-2 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-800">
                En trámite
              </p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-blue-900">
                {kpis.enTramite}
              </p>
            </div>
            <div className="rounded-md border border-amber-200/80 bg-amber-50/50 px-3 py-2 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                Necesita corrección
              </p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-amber-950">
                {kpis.correccionRequerida}
              </p>
              <p className="mt-0.5 text-[9px] leading-tight text-amber-800/90">
                Correcciones abiertas pedidas por Mesa
              </p>
            </div>
            <div className="rounded-md border border-red-200/80 bg-red-50/40 px-3 py-2 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-red-800">
                Rechazados por mesa
              </p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-red-900">
                {kpis.rechazadosMesa}
              </p>
              <p className="mt-0.5 text-[9px] leading-tight text-red-800/85">
                Recuperables (reingreso)
              </p>
            </div>
            <div className="rounded-md border border-slate-300 bg-slate-100/70 px-3 py-2 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-800">
                Cancelados
              </p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">
                {kpis.cancelados}
              </p>
              <p className="mt-0.5 text-[9px] leading-tight text-slate-700/90">
                Terminales (solo lectura)
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="asesor-buscar" className="sr-only">
                Buscar
              </label>
              <input
                id="asesor-buscar"
                type="search"
                value={filters.buscar}
                onChange={(e) =>
                  updateFilters((prev) => ({ ...prev, buscar: e.target.value }))
                }
                placeholder="Buscar cliente, NSS, teléfono o programa..."
                className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 shadow-sm placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <Link href="/asesor/nueva" className="shrink-0">
              <Button
                variant="primary"
                className="h-9 w-full whitespace-nowrap px-3 text-sm lg:w-auto"
              >
                Nueva precalificación
              </Button>
            </Link>
          </div>
          <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            <Select
              id="asesor-export-programa"
              label="Programa para exportar"
              value={exportProgramaFilter}
              onChange={(e) => {
                setExportProgramaFilter(e.target.value as AsesorExportProgramaFilter);
                setExportExcelMessage(null);
              }}
              options={[...ASESOR_EXPORT_PROGRAMA_OPTIONS]}
              className="min-w-[12rem] py-1.5 text-sm"
              disabled={exportExcelLoading}
            />
            <Button
              type="button"
              variant="outline"
              className="h-[42px] whitespace-nowrap px-3 text-sm sm:self-end"
              disabled={exportExcelLoading || globalTotalCount === 0}
              onClick={() => void handleDescargarExcel()}
            >
              {exportExcelLoading
                ? (exportProgress ?? "Generando Excel...")
                : "Descargar Excel"}
            </Button>
          </div>
          {exportExcelMessage ? (
            <p role="status" className="mt-2 text-xs text-amber-800">
              {exportExcelMessage}
            </p>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <div
              className="flex flex-wrap gap-1.5"
              role="tablist"
              aria-label="Filtros rápidos"
            >
              {quickFilterChips.map((chip) => {
                const isSelected = quickFilter === chip.id;
                const emphasize = quickFilterChipEmphasize(chip);
                const dotClass = quickFilterChipDotClass(chip);
                const displayLabel = quickFilterChipLabel(chip);
                return (
                  <button
                    key={chip.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    aria-label={
                      chip.count !== undefined
                        ? `${chip.label}, ${chip.count} expedientes`
                        : chip.label
                    }
                    onClick={() => handleQuickFilterChange(chip.id)}
                    className={quickFilterChipClassName(chip, isSelected)}
                  >
                    {emphasize && !isSelected && dotClass ? (
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
                        aria-hidden
                      />
                    ) : null}
                    <span>{displayLabel}</span>
                    {emphasize && chip.warnIfPositive ? (
                      <span
                        className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 tabular-nums text-[10px] font-bold leading-none ${quickFilterChipCountBadgeClass(chip, isSelected)}`}
                        aria-hidden
                      >
                        {chip.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Limpiar filtros
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setAdvancedFiltersOpen((o) => !o)}
            className="mt-2 flex w-full items-center justify-between rounded-md border border-dashed border-gray-300 bg-gray-50 px-2 py-1.5 text-left text-xs font-medium text-gray-900 hover:bg-gray-100"
            aria-expanded={advancedFiltersOpen}
          >
            <span>Filtros avanzados</span>
            <span className="text-gray-600" aria-hidden>
              {advancedFiltersOpen ? "▲" : "▼"}
            </span>
          </button>
          {advancedFiltersOpen && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <div className="min-w-0">
                  <label
                    htmlFor="asesor-decision"
                    className="mb-0.5 block text-[11px] font-medium text-gray-700"
                  >
                    Decisión
                  </label>
                  <select
                    id="asesor-decision"
                    value={filters.decision}
                    onChange={(e) =>
                      updateFilters((prev) => ({ ...prev, decision: e.target.value }))
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {DECISION_OPTIONS.map((o) => (
                      <option key={o.value || "all"} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="asesor-resultado-real"
                    className="mb-0.5 block text-[11px] font-medium text-gray-700"
                  >
                    Resultado real
                  </label>
                  <select
                    id="asesor-resultado-real"
                    value={filters.resultadoReal}
                    onChange={(e) =>
                      updateFilters((prev) => ({
                        ...prev,
                        resultadoReal: e.target.value,
                      }))
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {RESULTADO_REAL_OPTIONS.map((o) => (
                      <option key={o.value || "all"} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="asesor-programa"
                    className="mb-0.5 block text-[11px] font-medium text-gray-700"
                  >
                    Programa
                  </label>
                  <select
                    id="asesor-programa"
                    value={filters.programa}
                    onChange={(e) =>
                      updateFilters((prev) => ({ ...prev, programa: e.target.value }))
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Todos</option>
                    {programasUnicos.map((prog) => (
                      <option key={prog} value={prog}>
                        {prog}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="asesor-etapa-exacta"
                    className="mb-0.5 block text-[11px] font-medium text-gray-700"
                  >
                    Etapa exacta
                  </label>
                  <select
                    id="asesor-etapa-exacta"
                    value={filters.etapaExacta}
                    onChange={(e) =>
                      updateFilters((prev) => ({ ...prev, etapaExacta: e.target.value }))
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {ETAPA_EXACTA_OPTIONS.map((o) => (
                      <option key={o.value || "all"} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="asesor-estatus"
                    className="mb-0.5 block text-[11px] font-medium text-gray-700"
                  >
                    Estatus operativo
                  </label>
                  <select
                    id="asesor-estatus"
                    value={filters.estatusOperativo}
                    onChange={(e) =>
                      updateFilters((prev) => ({
                        ...prev,
                        estatusOperativo: e.target.value,
                      }))
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {ESTATUS_OPTIONS.map((o) => (
                      <option key={o.value || "all"} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="asesor-fecha-desde"
                    className="mb-0.5 block text-[11px] font-medium text-gray-700"
                  >
                    Fecha desde
                  </label>
                  <input
                    id="asesor-fecha-desde"
                    type="date"
                    value={filters.fechaDesde}
                    onChange={(e) =>
                      updateFilters((prev) => ({ ...prev, fechaDesde: e.target.value }))
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="asesor-fecha-hasta"
                    className="mb-0.5 block text-[11px] font-medium text-gray-700"
                  >
                    Fecha hasta
                  </label>
                  <input
                    id="asesor-fecha-hasta"
                    type="date"
                    value={filters.fechaHasta}
                    onChange={(e) =>
                      updateFilters((prev) => ({ ...prev, fechaHasta: e.target.value }))
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto px-2 py-1.5 sm:px-3 sm:py-2">
            {listLoading ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                Cargando expedientes…
              </div>
            ) : expedientesPagina.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-gray-600 sm:text-sm">
                  {globalTotalCount === 0
                    ? dataSupabase
                      ? "Aún no tienes expedientes."
                      : "Aún no hay precalificaciones guardadas para este asesor."
                    : (quickFilterEmptyMessage(quickFilter) ??
                      (filters.buscar.trim()
                        ? "No hay coincidencias con la búsqueda. Pruebe otro término o limpie los filtros."
                        : "No hay resultados con los filtros aplicados. Pruebe otros criterios o limpie los filtros."))}
                </p>
              </div>
            ) : (
              <table className="min-w-[820px] w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500">
                      Cliente
                    </th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500">
                      NSS
                    </th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500">
                      Programa
                    </th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500">
                      Estado actual
                    </th>
                    <th
                      className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500"
                      title={ASESOR_INBOX_DOCUMENTACION_COL_TITLE}
                    >
                      {ASESOR_INBOX_DOCUMENTACION_COL_HEADER}
                    </th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500">
                      Etapa
                    </th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500">
                      Estatus op.
                    </th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500">
                      Monto
                    </th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500">
                      Actualización
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {expedientesPagina.map((p) => {
                      const decision = p.decision ?? "pendiente";
                      const estadoEfectivo = p.estadoEfectivo ?? null;
                      const resumenCorreccion = resumenDocumentalPorId[p.id];
                      const montoDisplay = formatMontoAprobadoFila(p.monto_aprobado, decision);
                      const etapaDisplay = etapaActualToTexto(
                        p.etapaActual,
                        p.operativo?.pagoConcasaResultado,
                      );
                      const resultadoBadge = asesorEstadoActualFilaBadge(
                        estadoEfectivo,
                        p.etapaActual,
                        p.operativo?.pagoConcasaResultado,
                      );
                      const estatusOperativoBadge = asesorEstatusOperativoFilaBadge(
                        p.operativo?.subestado,
                        estadoEfectivo,
                        p.operativo?.cicloEstado,
                        p.etapaActual,
                        p.operativo?.pagoConcasaResultado,
                      );
                      const updatedDisplay = formatAsesorInboxActualizacion(
                        p.reprecal,
                        p.updatedAtOperativo,
                        formatDateTimeMx,
                      );
                      const reprecal = p.reprecal ?? null;
                      const montoAntes =
                        reprecal?.estado === "approved"
                          ? formatAsesorInboxMontoAntes(
                              reprecal.montoPrevio,
                              p.monto_aprobado,
                            )
                          : null;

                      const rowsDoc = resumenArchivosPorId[p.id];
                      const estadoDocumentacion =
                        rowsDoc === undefined
                          ? undefined
                          : deriveEstadoDocumentacionColumnaAsesor(rowsDoc, p.etapaActual);
                      const documentacionBadge = asesorDocumentacionFilaBadge(
                        documentacionColumnaLabel(estadoDocumentacion),
                        documentacionColumnaBadgeClass(estadoDocumentacion),
                        resumenCorreccion,
                        estadoEfectivo,
                        p.correccionExplicacion,
                      );
                      const rowSurfaceClass =
                        estadoEfectivo === "correccion_requerida"
                          ? "cursor-pointer bg-amber-50/40 hover:bg-amber-50/70"
                          : estadoEfectivo === "correccion_enviada"
                            ? "cursor-pointer bg-sky-50/30 hover:bg-sky-50/50"
                            : "cursor-pointer hover:bg-slate-50/80";

                      const handleRowOpen = (e: React.MouseEvent<HTMLTableRowElement>) => {
                        const targetEl = e.target as HTMLElement | null;
                        if (targetEl?.closest("a,button")) return;
                        router.push(asesorExpedienteDetalleHref(p.id, estadoEfectivo));
                      };

                      const handleRowKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        const targetEl = e.target as HTMLElement | null;
                        if (targetEl?.closest("a,button")) return;
                        e.preventDefault();
                        router.push(asesorExpedienteDetalleHref(p.id, estadoEfectivo));
                      };

                      return (
                        <tr
                          key={p.id}
                          className={rowSurfaceClass}
                          tabIndex={0}
                          role="link"
                          onClick={handleRowOpen}
                          onKeyDown={handleRowKeyDown}
                          aria-label={`Abrir expediente ${p.id}`}
                        >
                          <td className="max-w-[140px] px-2 py-1.5 font-medium text-gray-900">
                            <span className="block truncate">
                              {p.cliente_nombre || "—"}
                            </span>
                            {(() => {
                              const explicacion = resolveAsesorCorreccionExplicacion({
                                estadoEfectivo,
                                correccionExplicacion: p.correccionExplicacion,
                                correccionResumen: p.correccionResumen,
                              });
                              if (!explicacion) return null;
                              return (
                                <span className="mt-0.5 block text-[10px] font-normal leading-tight text-amber-800">
                                  {explicacion}
                                </span>
                              );
                            })()}
                            {p.esReingreso ? (
                              <span className="mt-0.5 inline-flex flex-col gap-0.5">
                                <span className="inline-flex w-fit rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-900">
                                  {formatReingresoBadgeLabel(p.reingresoManualCount ?? 0)}
                                </span>
                                {p.reingresoManualAt ? (
                                  <span className="text-[9px] text-violet-800/80">
                                    Último envío: {formatDateTimeMx(p.reingresoManualAt)}
                                  </span>
                                ) : null}
                              </span>
                            ) : estadoEfectivo === "cancelado" || p.operativo.cicloEstado === "cancelado" ? (
                              <span className="mt-0.5 inline-flex rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold text-slate-900">
                                Cancelado
                              </span>
                            ) : estadoEfectivo === "rechazado_mesa" ? (
                              <span
                                className="mt-0.5 inline-flex max-w-full flex-col gap-0.5"
                                data-testid="asesor-fila-rechazado-mesa"
                              >
                                <span className="inline-flex w-fit rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-900">
                                  Rechazado por Mesa
                                </span>
                                {p.operativo.motivoRechazo?.trim() ? (
                                  <span
                                    className="line-clamp-2 text-[9px] font-normal leading-snug text-red-900/90"
                                    title={p.operativo.motivoRechazo}
                                  >
                                    {p.operativo.motivoRechazo}
                                  </span>
                                ) : null}
                              </span>
                            ) : p.operativo.cicloEstado === "cerrado" ? (
                              <span className="mt-0.5 inline-flex rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-600">
                                Ciclo histórico
                              </span>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] tabular-nums text-gray-600 sm:text-xs">
                            {p.nss?.trim() || "—"}
                          </td>
                          <td className="max-w-[100px] truncate px-2 py-1.5 text-gray-600">
                            {p.programa}
                          </td>
                          <td className="max-w-[7.5rem] px-2 py-1.5 sm:max-w-none">
                            <div className="flex flex-col items-start gap-0.5">
                            <span
                              className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium sm:text-xs ${resultadoBadge.className}`}
                            >
                              <span className="truncate sm:whitespace-normal">
                                {resultadoBadge.label}
                              </span>
                            </span>
                            {reprecal && reprecal.estado !== "approved" ? (
                              <span
                                className={`mt-0.5 ${asesorInboxReprecalBadgeClass(reprecal.estado)}`}
                                data-testid={`asesor-reprecal-badge-${reprecal.estado}`}
                              >
                                {asesorInboxReprecalBadgeLabel(reprecal.estado)}
                              </span>
                            ) : null}
                            </div>
                          </td>
                          <td className="max-w-[140px] px-2 py-1.5 align-top">
                            <span
                              className={`${documentacionBadge.className} text-[10px] sm:text-xs`}
                            >
                              {documentacionBadge.label}
                            </span>
                          </td>
                          <td className="max-w-[min(200px,28vw)] px-2 py-1.5 align-top text-[10px] leading-snug text-gray-600 sm:text-xs">
                            <span className="line-clamp-2" title={etapaDisplay}>
                              {etapaDisplay}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {estatusOperativoBadge ? (
                              <span className={estatusOperativoBadge.className}>
                                {estatusOperativoBadge.label}
                              </span>
                            ) : (
                              <span className="text-[10px] text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums text-gray-600">
                            <span className="whitespace-nowrap">{montoDisplay}</span>
                            {reprecal?.estado === "approved" ? (
                              <span
                                className="mt-0.5 block text-[9px] font-medium leading-tight text-emerald-800"
                                data-testid="asesor-reprecal-badge-approved"
                              >
                                Monto actualizado
                              </span>
                            ) : null}
                            {montoAntes ? (
                              <span className="mt-0.5 block text-[9px] leading-tight text-gray-500">
                                {montoAntes}
                              </span>
                            ) : null}
                            {reprecal?.estado === "approved" && reprecal.resueltaAt ? (
                              <span className="mt-0.5 block text-[9px] leading-tight text-gray-400">
                                Actualizado {formatAsesorInboxResueltaHint(reprecal.resueltaAt)}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5 text-[10px] text-gray-600 sm:text-xs">
                            {updatedDisplay}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
          {globalTotalCount > 0 || filteredTotalCount > 0 ? (
            <div className="border-t border-gray-100 px-3 py-2.5 text-xs text-gray-600 sm:px-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {showingRange}
                  {" · "}
                  Página {safePage} de {totalPages}
                  {hasActiveFilters
                    ? ` · ${filteredTotalCount} con filtros (total ${globalTotalCount})`
                    : null}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="text-xs"
                    disabled={!canPrevious}
                    onClick={() => setPage(Math.max(1, safePage - 1))}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    className="text-xs"
                    disabled={!canNext}
                    onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

/**
 * Entrada `/asesor`: si el asesor tiene team_dashboard_read + equipo activo,
 * muestra dashboard líder; si no, el inbox habitual sin cambios.
 */
export default function AsesorDashboardPage() {
  const { sessionRepo, currentUser } = useSessionRepo();
  const dataSupabase = isDataModeSupabase();
  const liderRepo = useAsesorLiderRepo();
  const [liderCtx, setLiderCtx] = useState<AsesorLiderContext | null>(null);
  const [liderResolved, setLiderResolved] = useState(!dataSupabase);

  useEffect(() => {
    if (!dataSupabase) {
      setLiderResolved(true);
      setLiderCtx(null);
      return;
    }
    if (currentUser === undefined) return;
    if (!currentUser || currentUser.role !== "asesor") {
      setLiderResolved(true);
      setLiderCtx(null);
      return;
    }
    let cancelled = false;
    setLiderResolved(false);
    (async () => {
      try {
        const ctx = await liderRepo.getContext();
        if (cancelled) return;
        setLiderCtx(ctx);
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[asesor] lider context:", err);
        }
        if (!cancelled) setLiderCtx(null);
      } finally {
        if (!cancelled) setLiderResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataSupabase, currentUser, liderRepo]);

  if (currentUser === undefined || (dataSupabase && !liderResolved)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }

  if (
    dataSupabase &&
    currentUser?.role === "asesor" &&
    liderCtx &&
    isAsesorLiderDashboardMode(liderCtx)
  ) {
    return (
      <AsesorLiderDashboard
        context={liderCtx}
        currentUser={currentUser}
        sessionRepo={sessionRepo}
      />
    );
  }

  return <AsesorDashboardNormalPage liderCtx={liderCtx} />;
}
