"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSessionRepo } from "@/domain/session";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  mergeMesaControlInboxByLatestUpdated,
  readMesaControlInboxSafe,
} from "@/lib/mesaControlInboxMock";
import {
  ETAPAS_LABELS,
  getTodayYMD,
  type CasoMock,
} from "./mockData";
import {
  ExpedientesSupabaseError,
  useExpedientesRepo,
  type ExpedienteMock,
} from "@/domain/expedientes";
import {
  deriveResumenDocumental,
  useExpedienteArchivosRepo,
  type CategoriaResumenDocumental,
} from "@/domain/expediente-archivos";
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

type CasoConDocs = CasoMock & { resumenDocumental?: CategoriaResumenDocumental };

type MesaQuickFilter =
  | "todos"
  | "correccion_enviada"
  | "nuevos"
  | "en_proceso"
  | "citas_hoy"
  | "rechazados";

type AdminOrigenTab = "todos" | "internos" | "externos";

function isNuevoEtapa12(c: CasoConDocs): boolean {
  const et = Number(c.etapaActual) || 0;
  const sub = (c.subestado ?? "pendiente") as string;
  return (
    [1, 2].includes(et) &&
    ["pendiente", "en_validacion_mesa", "en_proceso"].includes(sub)
  );
}

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

function MesaEnMesaHaceBadge({ fechaEnvioMesa }: { fechaEnvioMesa?: string | null }) {
  const label = formatEnMesaHaceLabel(fechaEnvioMesa);
  if (!label) return null;
  return (
    <span className="inline-flex rounded-md bg-slate-800/90 px-2 py-0.5 text-[10px] font-medium text-white">
      {label}
    </span>
  );
}

function rowSurfaceClass(c: CasoConDocs): string {
  if (c.subestado === "rechazado") {
    return "border-l-[3px] border-l-red-400 bg-red-50/50 hover:bg-red-50/80";
  }
  if (c.resumenDocumental === "correccion_enviada") {
    return "border-l-[3px] border-l-sky-500 bg-sky-50/40 hover:bg-sky-50/70";
  }
  if (c.resumenDocumental === "correccion_requerida") {
    return "border-l-[3px] border-l-amber-400 bg-amber-50/35 hover:bg-amber-50/55";
  }
  return "border-l-[3px] border-l-transparent hover:bg-slate-50/90";
}

export default function MesaControlPage() {
  const router = useRouter();
  const { sessionRepo, currentUser } = useSessionRepo();
  const repo = useExpedientesRepo();
  const archivosRepo = useExpedienteArchivosRepo();
  const dataSupabase = isDataModeSupabase();
  const [casos, setCasos] = useState<CasoConDocs[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [buscar, setBuscar] = useState("");
  const [etapaFilter, setEtapaFilter] = useState<string>("todas");
  const [subestadoFilter, setSubestadoFilter] = useState<string>("todas");
  const [soloCitasHoy, setSoloCitasHoy] = useState(false);
  const [quickFilter, setQuickFilter] = useState<MesaQuickFilter>("todos");
  const [adminOrigenTab, setAdminOrigenTab] = useState<AdminOrigenTab>("todos");

  const todayYMD = getTodayYMD();

  const mesaMockRole =
    typeof window !== "undefined" ? getEffectiveMockRole() : null;

  function toYMD(iso?: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  }

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
      asesorNombre: exp.base.asesorId,
      etapaActual: exp.operativo.etapaActual ?? 1,
      subestado: exp.operativo.subestado ?? "pendiente",
      motivoRechazo: exp.operativo.motivoRechazo ?? undefined,
      fechaCita: exp.operativo.fechaCita ?? undefined,
      createdAt: exp.base.createdAt,
      updatedAt: exp.operativo.updatedAt ?? new Date().toISOString(),
      submittedToMesa: exp.operativo.submittedToMesa,
      origenMesa: exp.base.origenMesa ?? "interno",
      fechaEnvioMesa,
    };
  }, []);

  const isCitaHoy = useCallback(
    (c: CasoMock) => toYMD(c.fechaCita) === todayYMD,
    [todayYMD],
  );

  const loadCasos = useCallback((opciones?: { silencioso?: boolean }) => {
    if (!currentUser) return;
    void (async () => {
      if (!opciones?.silencioso) setLoading(true);
      setListError(null);
      try {
        const exps = await repo.listForMesaControl();
        let visibles = exps;
        if (!dataSupabase) {
          const mockRole =
            typeof window !== "undefined" ? getEffectiveMockRole() : null;
          visibles = filterExpedientesByRole({ mockRole }, exps);
        }
        const inboxMap =
          !dataSupabase && typeof window !== "undefined"
            ? mergeMesaControlInboxByLatestUpdated(readMesaControlInboxSafe())
            : new Map();
        const base = visibles.map((exp) => {
          const c = mapExpToCaso(exp);
          if (dataSupabase) return c;
          const row = inboxMap.get(exp.id);
          const rawFe = row?.fechaEnvioMesa;
          const fechaEnvioMesa =
            typeof rawFe === "string" && rawFe.trim() !== "" ? rawFe : undefined;
          return fechaEnvioMesa !== undefined ? { ...c, fechaEnvioMesa } : c;
        });
        const enriched: CasoConDocs[] = await Promise.all(
          base.map(async (c) => {
            try {
              const r = await archivosRepo.listResumenByExpediente(c.id);
              return { ...c, resumenDocumental: deriveResumenDocumental(r) };
            } catch {
              return { ...c, resumenDocumental: "faltantes" };
            }
          }),
        );
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
  }, [archivosRepo, currentUser, dataSupabase, mapExpToCaso, repo]);

  useEffect(() => {
    if (!currentUser) return;
    loadCasos();
    if (dataSupabase || typeof window === "undefined") {
      const archivosHandler = () => loadCasos();
      window.addEventListener(
        "expediente_archivos_updated",
        archivosHandler as EventListener,
      );
      return () => {
        window.removeEventListener(
          "expediente_archivos_updated",
          archivosHandler as EventListener,
        );
      };
    }

    const storageHandler = (e: StorageEvent) => {
      if (e.key === "mesa_control_inbox") loadCasos();
    };
    const customHandler = () => loadCasos();

    const archivosHandler = () => loadCasos();

    window.addEventListener("storage", storageHandler);
    window.addEventListener("mesa_control_inbox_updated", customHandler);
    window.addEventListener("expediente_archivos_updated", archivosHandler as EventListener);
    return () => {
      window.removeEventListener("storage", storageHandler);
      window.removeEventListener("mesa_control_inbox_updated", customHandler);
      window.removeEventListener(
        "expediente_archivos_updated",
        archivosHandler as EventListener,
      );
    };
  }, [currentUser, dataSupabase, loadCasos]);

  const kpis = useMemo(() => {
    const correccionesEnviadas = casos.filter(
      (c) => c.resumenDocumental === "correccion_enviada",
    ).length;
    const nuevosPorRevisar = casos.filter((c) => isNuevoEtapa12(c)).length;
    const citasHoy = casos.filter((c) => isCitaHoy(c)).length;
    const bloqueadosRechazados = casos.filter(
      (c) =>
        c.subestado === "rechazado" || c.resumenDocumental === "correccion_requerida",
    ).length;
    const enProceso = casos.filter((c) => c.subestado === "en_proceso").length;
    const rechazadosOperativo = casos.filter((c) => c.subestado === "rechazado").length;
    const enValidacionMesa = casos.filter(
      (c) => c.subestado === "en_validacion_mesa",
    ).length;
    const totalBandeja = casos.length;
    return {
      correccionesEnviadas,
      nuevosPorRevisar,
      citasHoy,
      bloqueadosRechazados,
      enProceso,
      rechazadosOperativo,
      enValidacionMesa,
      totalBandeja,
    };
  }, [casos, isCitaHoy]);

  const showAdminOrigenTabs =
    mesaMockRole === "mesa_control_admin" || mesaMockRole === "mesa_control";

  const filteredCasos = useMemo(() => {
    let list = [...casos];
    if (showAdminOrigenTabs && adminOrigenTab === "internos") {
      list = list.filter((c) => c.origenMesa === "interno" || c.origenMesa == null);
    } else if (showAdminOrigenTabs && adminOrigenTab === "externos") {
      list = list.filter((c) => c.origenMesa === "externo");
    }
    if (buscar.trim()) {
      const q = buscar.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.cliente_nombre.toLowerCase().includes(q) ||
          c.telefono_cliente.includes(q),
      );
    }
    if (etapaFilter !== "todas") {
      const etapa = Number(etapaFilter);
      list = list.filter((c) => c.etapaActual === etapa);
    }
    if (subestadoFilter !== "todas") {
      list = list.filter((c) => c.subestado === subestadoFilter);
    }
    if (soloCitasHoy) {
      list = list.filter((c) => isCitaHoy(c));
    }

    if (quickFilter === "correccion_enviada") {
      list = list.filter((c) => c.resumenDocumental === "correccion_enviada");
    } else if (quickFilter === "nuevos") {
      list = list.filter((c) => isNuevoEtapa12(c));
    } else if (quickFilter === "en_proceso") {
      list = list.filter((c) => c.subestado === "en_proceso");
    } else if (quickFilter === "citas_hoy") {
      list = list.filter((c) => isCitaHoy(c));
    } else if (quickFilter === "rechazados") {
      list = list.filter((c) => c.subestado === "rechazado");
    }

    return list;
  }, [
    casos,
    adminOrigenTab,
    buscar,
    etapaFilter,
    quickFilter,
    isCitaHoy,
    showAdminOrigenTabs,
    soloCitasHoy,
    subestadoFilter,
  ]);

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
        {listError ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {listError}
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
            <p className="mt-0.5 text-[10px] text-amber-800/80">Etapas 1–2 · pendiente / en proceso</p>
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
              Rechazo mesa o corrección doc. requerida
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
                  id: "citas_hoy" as const,
                  label: `Citas hoy (${kpis.citasHoy})`,
                },
                {
                  id: "rechazados" as const,
                  label: `Rechazados (${kpis.rechazadosOperativo})`,
                },
              ] satisfies { id: MesaQuickFilter; label: string }[]
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={quickFilter === id}
                onClick={() => setQuickFilter(id)}
                className={`${chipBase} ${quickFilter === id ? chipActive : chipInactive}`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

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
              label="Etapa"
              value={etapaFilter}
              onChange={(e) => setEtapaFilter(e.target.value)}
              options={[
                { value: "todas", label: "Todas" },
                ...Array.from({ length: 12 }, (_, i) => ({
                  value: String(i + 1),
                  label: `${i + 1}. ${ETAPAS_LABELS[i + 1] ?? ""}`,
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
              <p className="text-xs text-slate-500">
                Ordenados por antigüedad en Mesa · clic o Enter para abrir
              </p>
            </div>
            <p className="text-[11px] tabular-nums text-slate-500">
              <span className="font-semibold text-slate-700">{filteredCasos.length}</span>{" "}
              {filteredCasos.length === 1 ? "caso" : "casos"}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {loading ? (
              <p className="col-span-full py-10 text-center text-sm text-slate-500">
                Cargando expedientes…
              </p>
            ) : null}
            {!loading
              ? filteredCasos.map((c) => (
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
                className={`cursor-pointer rounded-xl border border-slate-200/90 p-4 text-left shadow-sm transition hover:border-sky-300/80 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${rowSurfaceClass(c)}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{c.cliente_nombre}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{c.telefono_cliente || "—"}</p>
                  </div>
                  {showAdminOrigenTabs ? (
                    <span className={origenMesaBadgeClass(c.origenMesa ?? null)}>
                      {origenMesaLabel(c.origenMesa ?? null)}
                    </span>
                  ) : null}
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
                  <MesaEnMesaHaceBadge fechaEnvioMesa={c.fechaEnvioMesa} />
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-800">
                    Etapa {c.etapaActual}: {ETAPAS_LABELS[c.etapaActual] ?? "—"}
                  </span>
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
                <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-slate-100/80 pt-2 text-[10px] text-slate-500">
                  <span>Cita: {formatDate(c.fechaCita)}</span>
                  <span>Envío Mesa: {formatDate(c.fechaEnvioMesa ?? undefined)}</span>
                  <span className="tabular-nums">Actualizado: {formatDateTime(c.updatedAt)}</span>
                </div>
              </article>
            ))
              : null}
          </div>
          {!loading && filteredCasos.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              No hay casos que coincidan con los filtros.
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
