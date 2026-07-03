"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionRepo } from "@/domain/session";
import { Button } from "@/components/ui/Button";
import { formatDateTimeMx } from "@/lib/filters";
import {
  ExpedientesSupabaseError,
  useExpedientesRepo,
  type ExpedienteMock,
} from "@/domain/expedientes";
import {
  deriveResultadoRealExpediente,
  type ResultadoRealExpediente,
} from "@/domain/expedientes/mock.repo";
import { isDataModeSupabase } from "@/lib/dataMode";
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
import {
  subestadoOperativoBadgeClass,
  subestadoOperativoLabel,
} from "@/lib/subestadoOperativoUi";
import { formatMontoMX } from "@/lib/monto";

const CORRECCION_REQUERIDA_BADGE_CLASS =
  "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-300";

function asesorResultadoFilaBadge(
  resultadoReal: ResultadoRealExpediente,
  resumenCorreccion?: CategoriaResumenDocumental,
): { label: string; className: string } {
  if (resumenCorreccion === "correccion_requerida") {
    return {
      label: "Corrección requerida",
      className: "bg-amber-100 text-amber-900 border border-amber-300",
    };
  }
  if (resumenCorreccion === "correccion_enviada") {
    return {
      label: "Corrección enviada",
      className: "bg-sky-100 text-sky-800 border border-sky-200",
    };
  }
  switch (resultadoReal) {
    case "rechazado_mesa":
      return {
        label: "Rechazado (mesa)",
        className: "bg-red-100 text-red-800 border border-red-200",
      };
    case "en_tramite":
      return {
        label: "En trámite",
        className: "bg-blue-100 text-blue-800 border border-blue-200",
      };
    case "no_cumple_editor":
      return {
        label: "No cumple (editor)",
        className: "bg-red-100 text-red-800 border border-red-200",
      };
    case "aprobado_editor":
      return {
        label: "Aprobado (editor)",
        className: "bg-green-100 text-green-800 border border-green-200",
      };
    case "pendiente_editor":
    default:
      return {
        label: "Pendiente (editor)",
        className: "bg-amber-100 text-amber-800 border border-amber-200",
      };
  }
}

function asesorDocumentacionFilaBadge(
  estadoDocumentacion: EstadoDocumentacionColumnaAsesor | undefined,
  resumenCorreccion?: CategoriaResumenDocumental,
): { label: string; className: string } {
  if (resumenCorreccion === "correccion_requerida") {
    return { label: "Corrección requerida", className: CORRECCION_REQUERIDA_BADGE_CLASS };
  }
  if (resumenCorreccion === "correccion_enviada") {
    return {
      label: "Corrección enviada",
      className:
        "inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-sky-200",
    };
  }
  return {
    label: documentacionColumnaLabel(estadoDocumentacion),
    className: documentacionColumnaBadgeClass(estadoDocumentacion),
  };
}

function asesorEstatusOperativoFilaBadge(
  subestado: string | null | undefined,
  resumenCorreccion?: CategoriaResumenDocumental,
): { label: string; className: string } {
  if (resumenCorreccion === "correccion_requerida") {
    return { label: "Corrección requerida", className: CORRECCION_REQUERIDA_BADGE_CLASS };
  }
  if (resumenCorreccion === "correccion_enviada") {
    return {
      label: "Corrección enviada",
      className:
        "inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-sky-200",
    };
  }
  return {
    label: subestadoOperativoLabel(subestado),
    className: `inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${subestadoOperativoBadgeClass(subestado)}`,
  };
}

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

function etapaActualToTexto(etapaActual?: number | null): string {
  if (etapaActual == null) return "—";
  const etapa = Number(etapaActual);
  if (!Number.isFinite(etapa)) return "—";

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
  | "rechazados_mesa";

export default function AsesorDashboardPage() {
  const { sessionRepo, currentUser } = useSessionRepo();
  const router = useRouter();
  const [filters, setFilters] = useState<AsesorFiltersState>(INITIAL_FILTERS);
  const [quickFilter, setQuickFilter] = useState<QuickFilterAsesor>("todos");
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const repo = useExpedientesRepo();
  const dataSupabase = isDataModeSupabase();
  const archivosRepo = useExpedienteArchivosRepo();
  const clienteDatosRepo = useExpedienteClienteDatosRepo();
  const [mockPrecalList, setMockPrecalList] = useState<
    PrecalificacionMockLocal[]
  >([]);
  const [listError, setListError] = useState<string | null>(null);
  const [resumenArchivosPorId, setResumenArchivosPorId] = useState<
    Record<string, ExpedienteArchivoResumen[] | undefined>
  >({});
  const [clienteDatosEstadoPorId, setClienteDatosEstadoPorId] = useState<
    Record<string, ExpedienteClienteDatosEstado | undefined>
  >({});
  const expedienteIdsRef = useRef<string[]>([]);

  const resumenDocumentalPorId = useMemo(() => {
    const out: Record<string, CategoriaResumenDocumental | undefined> = {};
    for (const p of mockPrecalList) {
      out[p.id] = deriveResumenExpedienteCorreccion(
        resumenArchivosPorId[p.id] ?? [],
        clienteDatosEstadoPorId[p.id] ?? null,
      );
    }
    return out;
  }, [mockPrecalList, resumenArchivosPorId, clienteDatosEstadoPorId]);

  const mapExpedienteToLegacy = useCallback((e: ExpedienteMock): PrecalificacionMockLocal => {
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
      resultadoReal: deriveResultadoRealExpediente(e),
      etapaActual: e.operativo.etapaActual,
      operativo: e.operativo,
      fechaCita: e.operativo.fechaCita,
      updatedAtOperativo: e.operativo.updatedAt,
    };
  }, []);

  const fetchResumenArchivosPorIds = useCallback(
    async (ids: string[]) => {
      if (typeof window === "undefined" || ids.length === 0) return;
      const entries = await Promise.all(
        ids.map(async (expId) => {
          try {
            const r = await archivosRepo.listResumenByExpediente(expId);
            return [expId, r] as const;
          } catch {
            return [expId, [] as ExpedienteArchivoResumen[]] as const;
          }
        }),
      );
      setResumenArchivosPorId((prev) => {
        const next = { ...prev };
        for (const [id, rows] of entries) {
          next[id] = rows;
        }
        return next;
      });
    },
    [archivosRepo],
  );

  const fetchClienteDatosEstadoPorIds = useCallback(
    async (ids: string[]) => {
      if (typeof window === "undefined" || ids.length === 0) return;
      try {
        const estados = await clienteDatosRepo.listEstadoByExpedienteIds(ids);
        setClienteDatosEstadoPorId((prev) => {
          const next = { ...prev };
          for (const id of ids) {
            next[id] = estados[id];
          }
          return next;
        });
      } catch {
        // Sin estados: la bandeja sigue con resumen solo documental.
      }
    },
    [clienteDatosRepo],
  );

  const reloadPrecalificaciones = useCallback(() => {
    if (!currentUser) return;
    void repo
      .listForAsesor(currentUser.email)
      .then((list) => {
        const mapped = list.map(mapExpedienteToLegacy);
        setMockPrecalList(mapped);
        setListError(null);
        expedienteIdsRef.current = mapped.map((p) => p.id);
        const ids = mapped.map((p) => p.id);
        void fetchResumenArchivosPorIds(ids);
        void fetchClienteDatosEstadoPorIds(ids);
      })
      .catch((err) => {
        setMockPrecalList([]);
        expedienteIdsRef.current = [];
        if (err instanceof ExpedientesSupabaseError) {
          setListError(err.message);
        } else {
          setListError("No se pudo cargar el listado de expedientes.");
        }
      });
  }, [currentUser, repo, mapExpedienteToLegacy, fetchResumenArchivosPorIds, fetchClienteDatosEstadoPorIds]);

  const programasUnicos = useMemo(() => {
    const set = new Set(mockPrecalList.map((p) => (p.programa ?? "").trim()).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [mockPrecalList]);

  const filteredMockList = useMemo(() => {
    let list = mockPrecalList;

    const term = (filters.buscar ?? "").trim().toLowerCase();
    if (term) {
      list = list.filter(
        (p) =>
          (p.cliente_nombre ?? "").toLowerCase().includes(term) ||
          (p.nss ?? "").replace(/\D/g, "").includes(term.replace(/\D/g, "")) ||
          (p.nss ?? "").toLowerCase().includes(term) ||
          (p.telefono_cliente ?? "")
            .replace(/\D/g, "")
            .includes(term.replace(/\D/g, "")) ||
          (p.programa ?? "").toLowerCase().includes(term)
      );
    }

    if (filters.decision) {
      list = list.filter((p) => (p.decision ?? "pendiente") === filters.decision);
    }
    if (filters.estatusOperativo) {
      list = list.filter(
        (p) =>
          (p.operativo?.subestado ?? "pendiente") === filters.estatusOperativo
      );
    }
    if (filters.resultadoReal) {
      list = list.filter((p) => p.resultadoReal === filters.resultadoReal);
    }
    if (filters.etapaExacta) {
      const etapa = Number(filters.etapaExacta);
      list = list.filter((p) => p.etapaActual === etapa);
    }
    if (filters.programa) {
      list = list.filter((p) => (p.programa ?? "").trim() === filters.programa);
    }

    if (filters.fechaDesde) {
      const desde = new Date(filters.fechaDesde);
      desde.setHours(0, 0, 0, 0);
      list = list.filter((p) => new Date(p.createdAt) >= desde);
    }
    if (filters.fechaHasta) {
      const hasta = new Date(filters.fechaHasta);
      hasta.setHours(23, 59, 59, 999);
      list = list.filter((p) => new Date(p.createdAt) <= hasta);
    }

    if (quickFilter === "en_tramite") {
      list = list.filter(
        (p) =>
          p.resultadoReal === "en_tramite" &&
          resumenDocumentalPorId[p.id] !== "correccion_requerida" &&
          resumenDocumentalPorId[p.id] !== "correccion_enviada",
      );
    } else if (quickFilter === "correccion_requerida") {
      list = list.filter(
        (p) => resumenDocumentalPorId[p.id] === "correccion_requerida",
      );
    } else if (quickFilter === "correccion_enviada") {
      list = list.filter(
        (p) => resumenDocumentalPorId[p.id] === "correccion_enviada",
      );
    } else if (quickFilter === "rechazados_mesa") {
      list = list.filter((p) => p.resultadoReal === "rechazado_mesa");
    }

    return list;
  }, [mockPrecalList, filters, quickFilter, resumenDocumentalPorId]);

  const kpis = useMemo(() => {
    const total = mockPrecalList.length;
    const aprobadosEditor = mockPrecalList.filter((p) => p.resultadoReal === "aprobado_editor").length;
    const noCumple = mockPrecalList.filter((p) => p.resultadoReal === "no_cumple_editor").length;
    const enTramite = mockPrecalList.filter(
      (p) =>
        p.resultadoReal === "en_tramite" &&
        resumenDocumentalPorId[p.id] !== "correccion_requerida" &&
        resumenDocumentalPorId[p.id] !== "correccion_enviada",
    ).length;
    const rechazadosMesa = mockPrecalList.filter((p) => p.resultadoReal === "rechazado_mesa").length;
    let correccionRequerida = 0;
    let correccionEnviada = 0;
    for (const p of mockPrecalList) {
      const doc = resumenDocumentalPorId[p.id];
      if (doc === "correccion_requerida") correccionRequerida += 1;
      if (doc === "correccion_enviada") correccionEnviada += 1;
    }
    return {
      total,
      aprobadosEditor,
      noCumple,
      enTramite,
      rechazadosMesa,
      correccionRequerida,
      correccionEnviada,
    };
  }, [mockPrecalList, resumenDocumentalPorId]);

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
    setQuickFilter("todos");
  };

  useEffect(() => {
    reloadPrecalificaciones();
  }, [reloadPrecalificaciones]);

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
        <div className="flex items-baseline justify-between gap-2 border-b border-gray-200/80 pb-2">
          <h2 className="text-sm font-semibold text-gray-900 sm:text-base">
            Mis expedientes
          </h2>
        </div>
        {listError ? (
          <p role="alert" className="text-sm text-red-600">
            {listError}
          </p>
        ) : null}

        {/* KPIs principales (4); aprobadosEditor, noCumple, correccionEnviada siguen en objeto `kpis` */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-md border border-gray-200 bg-white px-3 py-2 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Total
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">
              {kpis.total}
            </p>
          </div>
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
              Corrección requerida
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-amber-950">
              {kpis.correccionRequerida}
            </p>
            <p className="mt-0.5 text-[9px] leading-tight text-amber-800/90">
              Doc. o datos rechazados por mesa
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
              Operativo del trámite
            </p>
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
                  setFilters((prev) => ({ ...prev, buscar: e.target.value }))
                }
                placeholder="Buscar cliente, NSS, teléfono o programa..."
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <div
              className="flex flex-wrap gap-1.5"
              role="tablist"
              aria-label="Filtros rápidos"
            >
              {(
                [
                  { id: "todos" as const, label: "Todos" },
                  { id: "en_tramite" as const, label: "En trámite" },
                  {
                    id: "correccion_requerida" as const,
                    label: "Corrección requerida",
                  },
                  {
                    id: "correccion_enviada" as const,
                    label: `Corrección enviada (${kpis.correccionEnviada})`,
                  },
                  { id: "rechazados_mesa" as const, label: "Rechazados por mesa" },
                ] satisfies { id: QuickFilterAsesor; label: string }[]
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={quickFilter === id}
                  onClick={() => setQuickFilter(id)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    quickFilter === id
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {label}
                </button>
              ))}
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
            className="mt-2 flex w-full items-center justify-between rounded-md border border-dashed border-gray-200 bg-gray-50/50 px-2 py-1.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-100"
            aria-expanded={advancedFiltersOpen}
          >
            <span>Filtros avanzados</span>
            <span className="text-gray-400" aria-hidden>
              {advancedFiltersOpen ? "▲" : "▼"}
            </span>
          </button>
          {advancedFiltersOpen && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <div className="min-w-0">
                  <label
                    htmlFor="asesor-decision"
                    className="mb-0.5 block text-[11px] font-medium text-gray-600"
                  >
                    Decisión
                  </label>
                  <select
                    id="asesor-decision"
                    value={filters.decision}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, decision: e.target.value }))
                    }
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                    className="mb-0.5 block text-[11px] font-medium text-gray-600"
                  >
                    Resultado real
                  </label>
                  <select
                    id="asesor-resultado-real"
                    value={filters.resultadoReal}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        resultadoReal: e.target.value,
                      }))
                    }
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                    className="mb-0.5 block text-[11px] font-medium text-gray-600"
                  >
                    Programa
                  </label>
                  <select
                    id="asesor-programa"
                    value={filters.programa}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, programa: e.target.value }))
                    }
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                    className="mb-0.5 block text-[11px] font-medium text-gray-600"
                  >
                    Etapa exacta
                  </label>
                  <select
                    id="asesor-etapa-exacta"
                    value={filters.etapaExacta}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, etapaExacta: e.target.value }))
                    }
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                    className="mb-0.5 block text-[11px] font-medium text-gray-600"
                  >
                    Estatus operativo
                  </label>
                  <select
                    id="asesor-estatus"
                    value={filters.estatusOperativo}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        estatusOperativo: e.target.value,
                      }))
                    }
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                    className="mb-0.5 block text-[11px] font-medium text-gray-600"
                  >
                    Fecha desde
                  </label>
                  <input
                    id="asesor-fecha-desde"
                    type="date"
                    value={filters.fechaDesde}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, fechaDesde: e.target.value }))
                    }
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="asesor-fecha-hasta"
                    className="mb-0.5 block text-[11px] font-medium text-gray-600"
                  >
                    Fecha hasta
                  </label>
                  <input
                    id="asesor-fecha-hasta"
                    type="date"
                    value={filters.fechaHasta}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, fechaHasta: e.target.value }))
                    }
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto px-2 py-1.5 sm:px-3 sm:py-2">
            {filteredMockList.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-gray-500 sm:text-sm">
                  {mockPrecalList.length === 0
                    ? dataSupabase
                      ? "Aún no tienes expedientes."
                      : "Aún no hay precalificaciones guardadas para este asesor."
                    : "No hay resultados con los filtros aplicados. Pruebe otros criterios o limpie los filtros."}
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
                      Resultado real
                    </th>
                    <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-gray-500">
                      Documentación
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
                  {filteredMockList
                    .slice()
                    .sort(
                      (a, b) =>
                        new Date(b.createdAt).getTime() -
                        new Date(a.createdAt).getTime()
                    )
                    .map((p) => {
                      const decision = p.decision ?? "pendiente";
                      const resultadoReal = p.resultadoReal;
                      const resumenCorreccion = resumenDocumentalPorId[p.id];
                      const montoDisplay = formatMontoAprobadoFila(p.monto_aprobado, decision);
                      const etapaDisplay = etapaActualToTexto(p.etapaActual);
                      const resultadoBadge = asesorResultadoFilaBadge(
                        resultadoReal,
                        resumenCorreccion,
                      );
                      const estatusOperativoBadge = asesorEstatusOperativoFilaBadge(
                        p.operativo?.subestado,
                        resumenCorreccion,
                      );
                      const updatedDisplay = p.updatedAtOperativo
                        ? formatDateTimeMx(p.updatedAtOperativo)
                        : "—";

                      const rowsDoc = resumenArchivosPorId[p.id];
                      const estadoDocumentacion =
                        rowsDoc === undefined
                          ? undefined
                          : deriveEstadoDocumentacionColumnaAsesor(rowsDoc, p.etapaActual);
                      const documentacionBadge = asesorDocumentacionFilaBadge(
                        estadoDocumentacion,
                        resumenCorreccion,
                      );
                      const rowSurfaceClass =
                        resumenCorreccion === "correccion_requerida"
                          ? "cursor-pointer bg-amber-50/40 hover:bg-amber-50/70"
                          : resumenCorreccion === "correccion_enviada"
                            ? "cursor-pointer bg-sky-50/30 hover:bg-sky-50/50"
                            : "cursor-pointer hover:bg-slate-50/80";

                      const handleRowOpen = (e: React.MouseEvent<HTMLTableRowElement>) => {
                        const targetEl = e.target as HTMLElement | null;
                        if (targetEl?.closest("a,button")) return;
                        router.push(`/asesor/expediente/${p.id}`);
                      };

                      const handleRowKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        const targetEl = e.target as HTMLElement | null;
                        if (targetEl?.closest("a,button")) return;
                        e.preventDefault();
                        router.push(`/asesor/expediente/${p.id}`);
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
                          <td className="max-w-[140px] truncate px-2 py-1.5 font-medium text-gray-900">
                            {p.cliente_nombre || "—"}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] tabular-nums text-gray-600 sm:text-xs">
                            {p.nss?.trim() || "—"}
                          </td>
                          <td className="max-w-[100px] truncate px-2 py-1.5 text-gray-600">
                            {p.programa}
                          </td>
                          <td className="max-w-[7.5rem] px-2 py-1.5 sm:max-w-none sm:whitespace-nowrap">
                            <span
                              className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium sm:text-xs ${resultadoBadge.className}`}
                            >
                              <span className="truncate sm:whitespace-normal">
                                {resultadoBadge.label}
                              </span>
                            </span>
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
                            <span className={estatusOperativoBadge.className}>
                              {estatusOperativoBadge.label}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-gray-600">
                            {montoDisplay}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-[10px] text-gray-600 sm:text-xs">
                            {updatedDisplay}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
