"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MesaExpedienteDetalleReadOnly } from "@/components/mesa-control/MesaExpedienteDetalleReadOnly";
import { useSessionRepo } from "@/domain/session";
import { Button } from "@/components/ui/Button";
import { isDataModeSupabase } from "@/lib/dataMode";
import { formatAsesorExpedienteLabel } from "@/lib/asesorDisplay";
import {
  SeguimientoOperativoMock,
  type SeguimientoOperativoMockSummary,
} from "@/components/seguimiento/SeguimientoOperativoMock";
import { ETAPAS_LABELS } from "../mockData";
import { MockExpedientesRepo, type ExpedienteMock } from "@/domain/expedientes/mock.repo";
import {
  DOCUMENTO_TIPOS,
  DOCUMENTO_CATALOGO_MAP,
  buildClienteItemsRevisionDocumental,
  deriveRetencionAcuseAvisoFaltantes,
  filterChecklistDocumentoItemsPorOwnerRole,
  findRowPorTipoDocumento,
  getBloqueosRetencionAvanceEtapa8Mesa,
  getChecklistDocumentosClientePermanente,
  isTipoPaqueteDocumental,
  labelRetencionOpcion,
  labelTipoDocumentoCatalogo,
  isRetencionTipoDocumento,
  listRetencionUploadsForOpcion,
  MockExpedienteArchivosIndexedDbRepo,
  RETENCION_ETAPA_OPERATIVA_ID,
  type EstatusRevision,
  type ExpedienteArchivoResumen,
  type TipoDocumento,
  type TipoDocumentoCatalogo,
} from "@/domain/expediente-archivos";
import {
  MockExpedienteClienteDatosLocalStorageRepo,
  type ExpedienteClienteDatos,
} from "@/domain/expediente-cliente-datos";
import {
  MockExpedienteRetencionEnvioMesaLocalStorageRepo,
  RETENCION_ENVIO_MESA_EVENT,
} from "@/domain/expediente-retencion/envio-mesa.mock-localstorage.repo";
import { MockExpedienteRetencionOpcionLocalStorageRepo } from "@/domain/expediente-retencion/mock-localstorage.repo";
import {
  retencionEnvioEstadoEfectivo,
  retencionOpcionMesaEfectiva,
} from "@/domain/expediente-retencion/retencion-envio-mesa";
import type {
  ExpedienteRetencionEnvioMesa,
  RetencionOpcion,
} from "@/domain/expediente-retencion/types";
import {
  backfillFechaCitaBiometricosInboxIfMissing,
  cancelBiometricosBookingsForExpediente,
} from "@/lib/agendaBiometricosMock";
import {
  readAgendaFirmasBookings,
  readAgendaFirmasConfig,
} from "@/lib/agendaFirmasMock";
import {
  canMountAgendaFirmasAgendaUI,
} from "@/lib/agendaFirmasBookingsGuard";
import {
  isArchivoPreviewImageMime,
  isArchivoPreviewPdfMime,
} from "@/lib/archivoPreviewMime";
import { AgendaFirmasCard } from "@/components/mesa-control/AgendaFirmasCard";
import {
  getEffectiveMockRole,
  getEffectiveMockName,
} from "@/lib/mockUser";
import { canUserAccessExpediente } from "@/lib/mesaControlAccess";
import { subestadoOperativoLabel as subestadoLabel } from "@/lib/subestadoOperativoUi";
import { MockAgendaBiometricosLocalStorageRepo } from "@/domain/agenda-biometricos";

type PanelSegment = "pendiente" | "validado" | "rechazado";

function estatusRevisionLabel(e: ExpedienteArchivoResumen["estatus_revision"]): string {
  if (e === "faltante") return "Faltante";
  if (e === "subido") return "Pendiente revisión";
  if (e === "resubido") return "Corrección enviada";
  if (e === "validado") return "Validado";
  return "Rechazado";
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

function StatusBadge({
  estatus,
}: {
  estatus: ExpedienteArchivoResumen["estatus_revision"];
}) {
  const styles =
    estatus === "validado"
      ? "bg-green-100 text-green-900 border-2 border-green-400"
      : estatus === "rechazado"
        ? "bg-red-100 text-red-900 border-2 border-red-400"
        : estatus === "resubido"
          ? "bg-orange-100 text-orange-950 border-2 border-orange-500 ring-2 ring-orange-400/70 shadow-sm"
          : estatus === "subido"
            ? "bg-blue-50 text-blue-900 border border-blue-300"
            : "bg-amber-100 text-amber-900 border border-amber-300";

  const label =
    estatus === "faltante"
      ? "Faltante"
      : estatus === "subido"
        ? "Pendiente revisión"
        : estatus === "validado"
          ? "Validado"
          : estatus === "resubido"
            ? "Corrección enviada"
            : "Rechazado";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles}`}
    >
      {label}
    </span>
  );
}

function docRowAccentClass(estatus: ExpedienteArchivoResumen["estatus_revision"]): string {
  switch (estatus) {
    case "resubido":
      return "border-l-4 border-l-orange-500 bg-orange-50/35";
    case "subido":
      return "border-l-4 border-l-blue-400 bg-blue-50/25";
    case "validado":
      return "border-l-4 border-l-green-500 bg-green-50/25";
    case "rechazado":
      return "border-l-4 border-l-red-500 bg-red-50/30";
    default:
      return "border-l-4 border-l-amber-300 bg-amber-50/20";
  }
}

/** Siguiente tipo con archivo pendiente de revisión (subido/resubido), en orden después de `afterTipo`. */
function findNextPendingTipo(
  list: ExpedienteArchivoResumen[],
  afterTipo: TipoDocumento,
): TipoDocumento | null {
  const order = DOCUMENTO_TIPOS;
  const start = order.indexOf(afterTipo) + 1;
  for (let i = start; i < order.length; i++) {
    const tipo = order[i];
    const it = findRowPorTipoDocumento(list, tipo);
    if (
      it?.id &&
      (it.estatus_revision === "subido" || it.estatus_revision === "resubido")
    ) {
      return tipo;
    }
  }
  for (let i = 0; i < order.indexOf(afterTipo); i++) {
    const tipo = order[i];
    const it = findRowPorTipoDocumento(list, tipo);
    if (
      it?.id &&
      (it.estatus_revision === "subido" || it.estatus_revision === "resubido")
    ) {
      return tipo;
    }
  }
  return null;
}

function MesaControlExpedienteMockPage() {
  const { id } = useParams<{ id: string }>();
  /** Misma clave que localStorage / eventos (evita desajuste string vs otro tipo). */
  const routeExpedienteId =
    id === undefined || id === null || id === "" ? "" : String(id);
  const { sessionRepo, currentUser } = useSessionRepo();

  const repo = useMemo(() => new MockExpedientesRepo(), []);
  const archivosRepo = useMemo(() => new MockExpedienteArchivosIndexedDbRepo(), []);
  const clienteDatosRepo = useMemo(
    () => new MockExpedienteClienteDatosLocalStorageRepo(),
    [],
  );
  const retencionOpcionRepo = useMemo(
    () => new MockExpedienteRetencionOpcionLocalStorageRepo(),
    [],
  );
  const retencionEnvioMesaRepo = useMemo(
    () => new MockExpedienteRetencionEnvioMesaLocalStorageRepo(),
    [],
  );
  const [expediente, setExpediente] = useState<ExpedienteMock | null | undefined>(undefined);
  const [mesaAccessDenied, setMesaAccessDenied] = useState(false);
  const [summary, setSummary] = useState<SeguimientoOperativoMockSummary | null>(null);
  const [checklist, setChecklist] = useState<
    Awaited<ReturnType<typeof getChecklistDocumentosClientePermanente>> | null
  >(null);
  const [archivosResumen, setArchivosResumen] = useState<ExpedienteArchivoResumen[]>([]);
  const [preview, setPreview] = useState<{
    tipo: TipoDocumentoCatalogo;
    id: string;
    url: string;
    mime_type: string;
    nombre_original: string;
  } | null>(null);
  /** Vista previa modal: documentos cliente en panel “Documentos requeridos” (blob URL). */
  const [clienteReqDocPreview, setClienteReqDocPreview] = useState<{
    url: string;
    mime_type: string;
    nombre_original: string;
  } | null>(null);
  const [selectedTipo, setSelectedTipo] = useState<TipoDocumentoCatalogo | null>(null);
  /** Para “Pendiente revisión”: persistir `subido` o `resubido` según el último estado pendiente conocido. */
  const [pendienteKindById, setPendienteKindById] = useState<
    Record<string, "subido" | "resubido">
  >({});
  const [rejectEditing, setRejectEditing] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  /** Miniatura / iframe compacta visible en el panel (no la vista enorme). */
  const [docPreviewUiVisible, setDocPreviewUiVisible] = useState(false);
  /** Panel lateral de detalle + decisión colapsado (solo lista). */
  const [docPanelCollapsed, setDocPanelCollapsed] = useState(true);
  const [savingById, setSavingById] = useState<Record<string, boolean>>({});
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);
  const [clienteDatos, setClienteDatos] = useState<ExpedienteClienteDatos | null>(null);
  const [retencionOpcion, setRetencionOpcion] = useState<RetencionOpcion | null>(null);
  const [retencionEnvioMesa, setRetencionEnvioMesa] =
    useState<ExpedienteRetencionEnvioMesa | null>(null);
  const [clienteDatosSaving, setClienteDatosSaving] = useState(false);
  const [showRejectDatosModal, setShowRejectDatosModal] = useState(false);
  const [rejectDatosComment, setRejectDatosComment] = useState("");
  const [rejectDatosError, setRejectDatosError] = useState<string | null>(null);
  const [agendaTick, setAgendaTick] = useState(0);
  const [retencionRejectTipo, setRetencionRejectTipo] =
    useState<TipoDocumentoCatalogo | null>(null);
  const [retencionRejectComment, setRetencionRejectComment] = useState("");
  const [retencionDocPreview, setRetencionDocPreview] = useState<{
    url: string;
    mime_type: string;
    nombre_original: string;
    label: string;
  } | null>(null);
  const [retencionPreviewLoading, setRetencionPreviewLoading] = useState(false);

  const load = useCallback(() => {
    if (!routeExpedienteId) return;
    setMesaAccessDenied(false);
    void (async () => {
      try {
        let exp = await repo.getById(routeExpedienteId);
        if (!exp) {
          setExpediente(null);
          return;
        }
        if (exp.operativo.etapaActual === 4) {
          const synced = await backfillFechaCitaBiometricosInboxIfMissing(
            repo,
            routeExpedienteId,
          );
          if (synced) exp = synced;
        }
        const mockRole =
          typeof window !== "undefined" ? getEffectiveMockRole() : null;
        if (!canUserAccessExpediente({ mockRole }, exp)) {
          setMesaAccessDenied(true);
          setExpediente(null);
          return;
        }
        setExpediente(exp);
      } catch {
        setMesaAccessDenied(false);
        setExpediente(null);
      }
    })();
  }, [routeExpedienteId, repo]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onAgendaUpdated = () => {
      setAgendaTick((t) => t + 1);
      load();
    };
    window.addEventListener("agenda_bookings_updated", onAgendaUpdated);
    window.addEventListener("agenda_config_updated", onAgendaUpdated);
    window.addEventListener("agenda_firmas_bookings_v1_updated", onAgendaUpdated);
    window.addEventListener("agenda_firmas_config_updated", onAgendaUpdated);
    return () => {
      window.removeEventListener("agenda_bookings_updated", onAgendaUpdated);
      window.removeEventListener("agenda_config_updated", onAgendaUpdated);
      window.removeEventListener("agenda_firmas_bookings_v1_updated", onAgendaUpdated);
      window.removeEventListener("agenda_firmas_config_updated", onAgendaUpdated);
    };
  }, [load]);

  const etapaActualDisplay = summary?.etapaActualId ?? expediente?.operativo.etapaActual ?? 1;

  const citasAgenda = useMemo(() => {
    void agendaTick;
    const expedienteId = expediente ? String(expediente.id) : "";
    if (!expedienteId || typeof window === "undefined") {
      return {
        biometrico: null as null | {
          ubicacion: string;
          fecha: string;
          asesor: string;
          estado: string;
        },
        firma: null as null | {
          ubicacion: string;
          fecha: string;
          asesor: string;
          estado: string;
        },
      };
    }

    const bioRepo = new MockAgendaBiometricosLocalStorageRepo();
    const bioConfig = bioRepo.readConfig();
    const bioBookings = bioRepo.readBookings();
    const bio = [...bioBookings.bookings]
      .reverse()
      .find((b) => b.status === "booked" && String(b.expedienteId).trim() === expedienteId);
    const bioLocLabel =
      bio && bioConfig
        ? bioConfig.locations.find((l) => l.id === bio.locationId)?.label ?? bio.locationId
        : "";

    const firmasConfig = readAgendaFirmasConfig();
    const firmasBookings = readAgendaFirmasBookings();
    const firma = [...firmasBookings.bookings]
      .reverse()
      .find((b) => b.status === "booked" && String(b.expedienteId ?? "").trim() === expedienteId);
    const firmaLocLabel =
      firma && firmasConfig
        ? firmasConfig.locations.find((l) => l.id === String(firma.locationId ?? ""))?.label ??
          String(firma.locationId ?? "")
        : "";

    return {
      biometrico: bio
        ? {
            ubicacion: bioLocLabel || "—",
            fecha: `${bio.date} ${bio.time}`,
            asesor: bio.createdBy.email,
            estado: bio.status,
          }
        : null,
      firma: firma
        ? {
            ubicacion: firmaLocLabel || "—",
            fecha: `${firma.date ?? "—"} ${firma.time ?? "—"}`,
            asesor: String(firma.createdBy?.email ?? "—"),
            estado: String(firma.status ?? "—"),
          }
        : null,
    };
  }, [agendaTick, expediente]);

  const loadClienteDatos = useCallback(() => {
    if (!routeExpedienteId) return;
    void clienteDatosRepo
      .getByExpedienteId(routeExpedienteId)
      .then((next) => {
        setClienteDatos(next);
      })
      .catch(() => setClienteDatos(null));
  }, [clienteDatosRepo, routeExpedienteId]);

  useEffect(() => {
    if (!routeExpedienteId) return;
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ expedienteId?: string | null }>;
      const changedId = ce.detail?.expedienteId;
      if (
        changedId != null &&
        changedId !== "" &&
        String(changedId) !== routeExpedienteId
      ) {
        return;
      }
      loadClienteDatos();
    };
    window.addEventListener("expediente_cliente_datos_updated", handler as EventListener);
    return () => {
      window.removeEventListener(
        "expediente_cliente_datos_updated",
        handler as EventListener,
      );
    };
  }, [routeExpedienteId, loadClienteDatos]);

  const loadRetencionOpcion = useCallback(() => {
    if (!routeExpedienteId) return;
    void retencionOpcionRepo
      .getByExpedienteId(routeExpedienteId)
      .then((row) => setRetencionOpcion(row?.retencion_opcion ?? null))
      .catch(() => setRetencionOpcion(null));
  }, [retencionOpcionRepo, routeExpedienteId]);

  const loadRetencionEnvioMesa = useCallback(() => {
    if (!routeExpedienteId) return;
    void retencionEnvioMesaRepo
      .getByExpedienteId(routeExpedienteId)
      .then((row) => setRetencionEnvioMesa(row))
      .catch(() => setRetencionEnvioMesa(null));
  }, [retencionEnvioMesaRepo, routeExpedienteId]);

  useEffect(() => {
    loadRetencionOpcion();
    loadRetencionEnvioMesa();
  }, [loadRetencionOpcion, loadRetencionEnvioMesa]);

  useEffect(() => {
    if (!routeExpedienteId) return;
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ expedienteId?: string }>;
      if (ce.detail?.expedienteId && ce.detail.expedienteId !== routeExpedienteId) return;
      loadRetencionOpcion();
    };
    window.addEventListener(
      "expediente_retencion_opcion_updated",
      handler as EventListener,
    );
    return () => {
      window.removeEventListener(
        "expediente_retencion_opcion_updated",
        handler as EventListener,
      );
    };
  }, [routeExpedienteId, loadRetencionOpcion]);

  useEffect(() => {
    if (!routeExpedienteId) return;
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ expedienteId?: string }>;
      if (ce.detail?.expedienteId && ce.detail.expedienteId !== routeExpedienteId) return;
      loadRetencionEnvioMesa();
    };
    window.addEventListener(RETENCION_ENVIO_MESA_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(RETENCION_ENVIO_MESA_EVENT, handler as EventListener);
    };
  }, [routeExpedienteId, loadRetencionEnvioMesa]);

  const retencionOpcionMesa = useMemo(
    () => retencionOpcionMesaEfectiva(retencionEnvioMesa, retencionOpcion),
    [retencionEnvioMesa, retencionOpcion],
  );

  const retencionFaltantes = useMemo(
    () =>
      deriveRetencionAcuseAvisoFaltantes({
        retencion_opcion: retencionOpcionMesa,
        archivos: archivosResumen,
      }),
    [retencionOpcionMesa, archivosResumen],
  );

  const retencionBloqueosAvance = useMemo(
    () =>
      getBloqueosRetencionAvanceEtapa8Mesa({
        retencion_opcion: retencionOpcionMesa,
        archivos: archivosResumen,
        retencion_enviado_a_mesa: Boolean(retencionEnvioMesa?.enviado),
      }),
    [retencionOpcionMesa, archivosResumen, retencionEnvioMesa],
  );

  const retencionUploadsMesa = useMemo(
    () => listRetencionUploadsForOpcion(retencionOpcionMesa),
    [retencionOpcionMesa],
  );

  const retencionEnvioUiEstado = useMemo(
    () =>
      retencionEnvioEstadoEfectivo(
        retencionEnvioMesa,
        archivosResumen,
        retencionOpcion,
      ),
    [retencionEnvioMesa, archivosResumen, retencionOpcion],
  );

  const mostrarSeccionRetencion =
    etapaActualDisplay === RETENCION_ETAPA_OPERATIVA_ID;

  const selectRetencionDoc = useCallback((tipo: TipoDocumentoCatalogo) => {
    setSelectedTipo(tipo);
    setDocPanelCollapsed(false);
    setDocPreviewUiVisible(true);
    setRetencionRejectTipo(null);
    setRetencionRejectComment("");
  }, []);

  useEffect(() => {
    if (!expediente?.id) return;
    let cancelled = false;
    const refresh = () => {
      void getChecklistDocumentosClientePermanente(String(expediente.id), {
        pendienteRevisionCuentaComoCompleto: true,
      })
        .then((next) => {
          if (cancelled) return;
          setChecklist(next);
        })
        .catch(() => {
          if (cancelled) return;
          setChecklist(null);
        });
    };

    refresh();

    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ expedienteId?: string | null }>;
      const changedId = ce.detail?.expedienteId;
      if (
        changedId != null &&
        changedId !== "" &&
        String(changedId) !== String(expediente.id)
      ) {
        return;
      }
      refresh();
    };

    window.addEventListener("expediente_archivos_updated", handler as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(
        "expediente_archivos_updated",
        handler as EventListener,
      );
    };
  }, [expediente?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storageHandler = (e: StorageEvent) => {
      if (e.key === "mesa_control_inbox") load();
    };
    const customHandler = () => load();
    window.addEventListener("storage", storageHandler);
    window.addEventListener("mesa_control_inbox_updated", customHandler);
    return () => {
      window.removeEventListener("storage", storageHandler);
      window.removeEventListener("mesa_control_inbox_updated", customHandler);
    };
  }, [load]);

  const loadArchivos = useCallback(() => {
    if (!routeExpedienteId) return;
    void archivosRepo
      .listResumenByExpediente(routeExpedienteId)
      .then((next) => {
        setArchivosResumen(next);
        setPendienteKindById((prev) => {
          const merged = { ...prev };
          for (const item of next) {
            if (
              item.id &&
              (item.estatus_revision === "subido" || item.estatus_revision === "resubido")
            ) {
              merged[item.id] = item.estatus_revision;
            }
          }
          return merged;
        });
      })
      .catch(() => {
        setArchivosResumen([]);
      });
  }, [archivosRepo, routeExpedienteId]);

  const syncTrasRevisionRetencion = useCallback(
    async (tipo: TipoDocumentoCatalogo, estatus: EstatusRevision, ok: boolean) => {
      if (!ok || !routeExpedienteId) return;
      loadArchivos();
      if (isRetencionTipoDocumento(tipo) && estatus === "rechazado") {
        const row = await retencionEnvioMesaRepo.markCorreccionRequerida(routeExpedienteId);
        setRetencionEnvioMesa(row);
      } else {
        loadRetencionEnvioMesa();
      }
    },
    [loadArchivos, loadRetencionEnvioMesa, retencionEnvioMesaRepo, routeExpedienteId],
  );

  useEffect(() => {
    if (!routeExpedienteId) return;
    loadClienteDatos();
    loadArchivos();
  }, [routeExpedienteId, loadClienteDatos, loadArchivos]);

  useEffect(() => {
    if (typeof window === "undefined" || !routeExpedienteId) return;
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ expedienteId?: string | null }>;
      const changedId = ce.detail?.expedienteId;
      if (
        changedId != null &&
        changedId !== "" &&
        String(changedId) !== routeExpedienteId
      ) {
        return;
      }
      loadArchivos();
    };
    window.addEventListener("expediente_archivos_updated", handler as EventListener);
    return () => {
      window.removeEventListener(
        "expediente_archivos_updated",
        handler as EventListener,
      );
    };
  }, [routeExpedienteId, loadArchivos]);

  useEffect(() => {
    if (typeof window === "undefined" || !routeExpedienteId) return;
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ expedienteId?: string | null }>;
      const eid = ce.detail?.expedienteId;
      if (!eid || String(eid) !== routeExpedienteId) return;
      loadClienteDatos();
      loadArchivos();
    };
    window.addEventListener("expediente_enviado_a_mesa", handler as EventListener);
    return () => {
      window.removeEventListener(
        "expediente_enviado_a_mesa",
        handler as EventListener,
      );
    };
  }, [routeExpedienteId, loadClienteDatos, loadArchivos]);

  const openPreview = useCallback(
    async (item: ExpedienteArchivoResumen) => {
      if (!item.id || !item.mime_type) return;
      const blob = await archivosRepo.getArchivoBlob(item.id);
      const url = URL.createObjectURL(blob);

      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return {
          tipo: item.tipo_documento,
          id: item.id as string,
          url,
          mime_type: item.mime_type as string,
          nombre_original: item.nombre_original ?? "archivo",
        };
      });
    },
    [archivosRepo],
  );

  const closePreview = useCallback(() => {
    setPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  const parseTs = (iso: string | null) => {
    if (!iso) return 0;
    const n = Date.parse(iso);
    return Number.isNaN(n) ? 0 : n;
  };

  const latestByTipo = useMemo(() => {
    const map = new Map<TipoDocumentoCatalogo, ExpedienteArchivoResumen>();
    for (const row of archivosResumen) {
      const rowMs = parseTs(row.created_at);
      const current = map.get(row.tipo_documento);
      if (!current) {
        map.set(row.tipo_documento, row);
        continue;
      }
      const currentMs = parseTs(current.created_at);
      if (rowMs > currentMs) {
        map.set(row.tipo_documento, row);
      }
    }
    return map;
  }, [archivosResumen]);

  const openClienteRequeridoPreview = useCallback(
    async (tipo: TipoDocumentoCatalogo) => {
      const doc = latestByTipo.get(tipo);
      if (!doc?.id || !doc.mime_type) return;
      const mime = doc.mime_type;
      try {
        const blob = await archivosRepo.getArchivoBlob(doc.id);
        const url = URL.createObjectURL(blob);
        setClienteReqDocPreview((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return {
            url,
            mime_type: mime,
            nombre_original: doc.nombre_original ?? "archivo",
          };
        });
      } catch {
        /* preview opcional */
      }
    },
    [latestByTipo, archivosRepo],
  );

  const closeClienteRequeridoPreview = useCallback(() => {
    setClienteReqDocPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  const openRetencionDocPreview = useCallback(
    async (item: ExpedienteArchivoResumen, docLabel: string) => {
      if (!item.id || !item.mime_type) return;
      setRetencionPreviewLoading(true);
      try {
        const blob = await archivosRepo.getArchivoBlob(item.id);
        const url = URL.createObjectURL(blob);
        setRetencionDocPreview((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return {
            url,
            mime_type: item.mime_type as string,
            nombre_original: item.nombre_original ?? "archivo",
            label: docLabel,
          };
        });
      } catch {
        window.alert("No se pudo cargar la vista previa del documento.");
      } finally {
        setRetencionPreviewLoading(false);
      }
    },
    [archivosRepo],
  );

  const closeRetencionDocPreview = useCallback(() => {
    setRetencionDocPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  const activateRetencionDocRow = useCallback(
    (tipo: TipoDocumentoCatalogo, item: ExpedienteArchivoResumen, docLabel: string) => {
      selectRetencionDoc(tipo);
      if (item.id && item.mime_type) {
        void openRetencionDocPreview(item, docLabel);
      }
    },
    [openRetencionDocPreview, selectRetencionDoc],
  );

  const downloadArchivo = useCallback(
    async (item: ExpedienteArchivoResumen) => {
      if (!item.id || !item.nombre_original) return;
      const blob = await archivosRepo.getArchivoBlob(item.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.nombre_original;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
    [archivosRepo],
  );

  /**
   * Abre el mismo `preview.url` (blob) en nueva pestaña sin revocar aquí.
   * Fallback con <a target="_blank"> si el bloqueador impide window.open.
   */
  const openPreviewBlobInNewTab = useCallback((blobUrl: string) => {
    if (typeof window === "undefined" || !blobUrl) return;
    const opened = window.open(blobUrl, "_blank", "noopener,noreferrer");
    if (opened != null) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const handleChangeSummary = useCallback(
    (next: SeguimientoOperativoMockSummary) => {
      setSummary(next);

      // Evita persistir si el expediente real aún NO está en mesa.
      if (!expediente?.operativo.submittedToMesa) return;
      if (!routeExpedienteId) return;

      const motivoRechazoNext =
        next.subestado === "rechazado" &&
        next.motivo !== undefined &&
        next.motivo !== ""
          ? next.motivo
          : null;
      const comentarioRechazoNext =
        next.subestado === "rechazado"
          ? next.comentarioRechazo?.trim()
            ? next.comentarioRechazo
            : null
          : null;
      const fechaCitaNext =
        next.fechaCita !== undefined
          ? next.fechaCita
          : (expediente.operativo.fechaCita ?? null);

      // Guard no-op: abrir/montar la vista no debe tocar `updatedAt` si no hay cambio real.
      const isNoop =
        (expediente.operativo.etapaActual ?? null) === (next.etapaActualId ?? null) &&
        (expediente.operativo.subestado ?? null) === (next.subestado ?? null) &&
        Boolean(expediente.operativo.submittedToMesa) === true &&
        (expediente.operativo.motivoRechazo ?? null) === (motivoRechazoNext ?? null) &&
        (expediente.operativo.comentarioRechazo ?? null) ===
          (comentarioRechazoNext ?? null) &&
        (expediente.operativo.fechaCita ?? null) === (fechaCitaNext ?? null);
      if (isNoop) return;

      const patch: Parameters<MockExpedientesRepo["updateOperativo"]>[1] = {
        etapaActual: next.etapaActualId,
        subestado: next.subestado,
        submittedToMesa: true,
        motivoRechazo: motivoRechazoNext,
        comentarioRechazo: comentarioRechazoNext,
        ...(next.fechaCita !== undefined ? { fechaCita: next.fechaCita } : {}),
      };

      void (async () => {
        try {
          await repo.updateOperativo(routeExpedienteId, patch);
          if (next.subestado === "rechazado") {
            cancelBiometricosBookingsForExpediente(routeExpedienteId);
          }
        } catch (err) {
          console.error("[mesa-control] error updateOperativo:", err);
          const msg =
            err instanceof Error
              ? err.message
              : "No se pudo persistir el avance de etapa.";
          if (typeof window !== "undefined") {
            window.alert(msg);
          }
        }
      })();
    },
    [
      expediente?.operativo.comentarioRechazo,
      expediente?.operativo.etapaActual,
      expediente?.operativo.fechaCita,
      expediente?.operativo.motivoRechazo,
      expediente?.operativo.subestado,
      expediente?.operativo.submittedToMesa,
      routeExpedienteId,
      repo,
    ],
  );

  const docStats = useMemo(() => {
    const empty = {
      pendientesMesa: 0,
      correccionesEnviadas: 0,
      validados: 0,
      rechazados: 0,
      faltantes: 0,
    };
    if (!checklist) return empty;

    const clienteItemsRevision = buildClienteItemsRevisionDocumental({
      checklist,
      resumen: archivosResumen,
      etapaId: 2,
    });

    let subido = 0;
    let resubido = 0;
    let validado = 0;
    let rechazado = 0;
    let faltante = 0;
    for (const it of clienteItemsRevision) {
      const r = findRowPorTipoDocumento(archivosResumen, it.tipo_documento);
      const s = r?.estatus_revision ?? "faltante";
      if (s === "faltante") faltante += 1;
      else if (s === "subido") subido += 1;
      else if (s === "resubido") resubido += 1;
      else if (s === "validado") validado += 1;
      else if (s === "rechazado") rechazado += 1;
    }
    return {
      pendientesMesa: subido + resubido,
      correccionesEnviadas: resubido,
      validados: validado,
      rechazados: rechazado,
      faltantes: faltante,
    };
  }, [checklist, archivosResumen]);

  const persistRevision = useCallback(
    async (
      itemId: string,
      estatus: EstatusRevision,
      comentario_mesa: string | null,
    ): Promise<boolean> => {
      setSavingById((prev) => ({ ...prev, [itemId]: true }));
      try {
        await archivosRepo.updateRevision(itemId, {
          estatus_revision: estatus,
          comentario_mesa,
        });
        return true;
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : "No se pudo guardar la revisión del documento.",
        );
        return false;
      } finally {
        setSavingById((prev) => ({ ...prev, [itemId]: false }));
      }
    },
    [archivosRepo],
  );

  const mergePendienteKinds = useCallback(
    (list: ExpedienteArchivoResumen[]) => {
      setPendienteKindById((prev) => {
        const merged = { ...prev };
        for (const item of list) {
          if (
            item.id &&
            (item.estatus_revision === "subido" || item.estatus_revision === "resubido")
          ) {
            merged[item.id] = item.estatus_revision;
          }
        }
        return merged;
      });
    },
    [],
  );

  /** Tras validar/rechazar: refresca lista, salta al siguiente pendiente o compacta la vista. */
  const afterRevisionPersist = useCallback(
    async (currentTipo: TipoDocumentoCatalogo, ok: boolean) => {
      if (!ok) return;
      try {
        const list = await archivosRepo.listResumenByExpediente(routeExpedienteId);
        setArchivosResumen(list);
        mergePendienteKinds(list);
        if (!isTipoPaqueteDocumental(currentTipo)) return;
        const next = findNextPendingTipo(list, currentTipo);
        if (next) {
          setSelectedTipo(next);
          setDocPreviewUiVisible(true);
          setDocPanelCollapsed(false);
        } else {
          setDocPreviewUiVisible(false);
          setDocPanelCollapsed(true);
        }
      } catch {
        void loadArchivos();
      }
    },
    [archivosRepo, routeExpedienteId, loadArchivos, mergePendienteKinds],
  );

  const allFourValidated = useMemo(
    () =>
      DOCUMENTO_TIPOS.every((t) => {
        const it = findRowPorTipoDocumento(archivosResumen, t);
        return it?.estatus_revision === "validado";
      }),
    [archivosResumen],
  );

  useEffect(() => {
    if (!allFourValidated) return;
    setDocPreviewUiVisible(false);
    setDocPanelCollapsed(true);
  }, [allFourValidated]);

  const handleValidarTodosPendientes = useCallback(async () => {
    if (!checklist) {
      setBulkFeedback("Cargando documentos…");
      return;
    }

    const clienteItemsRevision = buildClienteItemsRevisionDocumental({
      checklist,
      resumen: archivosResumen,
      etapaId: 2,
    });

    const pendingItems: ExpedienteArchivoResumen[] = [];
    for (const it of clienteItemsRevision) {
      const row = findRowPorTipoDocumento(archivosResumen, it.tipo_documento);
      if (
        row?.id &&
        (row.estatus_revision === "subido" || row.estatus_revision === "resubido")
      ) {
        pendingItems.push(row);
      }
    }

    if (pendingItems.length === 0) {
      setBulkFeedback("No hay documentos pendientes por validar.");
      return;
    }

    setBulkSaving(true);
    setBulkFeedback(null);
    setSavingById((prev) => {
      const next = { ...prev };
      for (const item of pendingItems) {
        if (item.id) next[item.id] = true;
      }
      return next;
    });

    const results = await Promise.allSettled(
      pendingItems.map((item) =>
        archivosRepo.updateRevision(item.id as string, {
          estatus_revision: "validado",
          comentario_mesa: null,
        }),
      ),
    );

    let okCount = 0;
    let failCount = 0;
    setSavingById((prev) => {
      const next = { ...prev };
      results.forEach((r, idx) => {
        const itemId = pendingItems[idx].id as string;
        next[itemId] = false;
        if (r.status === "fulfilled") okCount += 1;
        else failCount += 1;
      });
      return next;
    });

    setBulkSaving(false);
    if (failCount > 0) {
      setBulkFeedback(`Se validaron ${okCount}; fallaron ${failCount}.`);
    } else {
      setBulkFeedback(`Se validaron ${okCount} documentos pendientes.`);
    }
    setDocPreviewUiVisible(false);
    void loadArchivos();
  }, [archivosRepo, archivosResumen, checklist, loadArchivos]);

  const selectedDoc = useMemo((): ExpedienteArchivoResumen | null => {
    if (!selectedTipo) return null;
    return (
      findRowPorTipoDocumento(archivosResumen, selectedTipo) ??
      ({
        expediente_id: routeExpedienteId,
        tipo_documento: selectedTipo,
        id: null,
        nombre_original: null,
        mime_type: null,
        size_bytes: null,
        created_at: null,
        uploaded_by_role: null,
        uploaded_by_email: null,
        estatus_revision: "faltante",
        comentario_mesa: null,
      } satisfies ExpedienteArchivoResumen)
    );
  }, [archivosResumen, routeExpedienteId, selectedTipo]);

  useEffect(() => {
    if (selectedTipo !== null || !checklist) return;
    const ordered = buildClienteItemsRevisionDocumental({
      checklist,
      resumen: archivosResumen,
      etapaId: 2,
    });
    const first = ordered.find((it) => {
      const row = findRowPorTipoDocumento(archivosResumen, it.tipo_documento);
      return !!row?.id && row.estatus_revision !== "faltante";
    });
    if (first) setSelectedTipo(first.tipo_documento);
  }, [archivosResumen, checklist, selectedTipo]);

  useEffect(() => {
    if (!selectedTipo) {
      closePreview();
      return;
    }
    const item = findRowPorTipoDocumento(archivosResumen, selectedTipo);
    if (item?.id && item.mime_type) {
      void openPreview(item);
    } else {
      closePreview();
    }
  }, [archivosResumen, closePreview, openPreview, selectedTipo]);

  const prevSelectedTipoRef = useRef<TipoDocumentoCatalogo | null>(null);
  useEffect(() => {
    if (prevSelectedTipoRef.current !== selectedTipo) {
      prevSelectedTipoRef.current = selectedTipo;
      setRejectEditing(false);
    }
  }, [selectedTipo]);

  useEffect(() => {
    if (!selectedTipo) {
      setRejectComment("");
      return;
    }
    const item = findRowPorTipoDocumento(archivosResumen, selectedTipo);
    if (rejectEditing) return;
    setRejectComment(
      item?.estatus_revision === "rechazado" ? (item.comentario_mesa ?? "") : "",
    );
  }, [archivosResumen, rejectEditing, selectedTipo]);

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

  if (expediente === undefined) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="border-b border-gray-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <Link href="/mesa-control" className="text-sm text-gray-500 hover:text-gray-700">
              ← Volver a Mesa de control
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <p className="text-gray-500">Cargando expediente...</p>
        </main>
      </div>
    );
  }

  if (mesaAccessDenied) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="border-b border-gray-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <Link href="/mesa-control" className="text-sm text-gray-500 hover:text-gray-700">
              ← Volver a Mesa de control
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950">
            No tienes permiso para ver este expediente con tu rol actual de mesa de control.
          </p>
          <Link href="/mesa-control" className="mt-4 inline-block">
            <Button variant="secondary">Volver al tablero</Button>
          </Link>
        </main>
      </div>
    );
  }

  if (expediente === null) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="border-b border-gray-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <Link href="/mesa-control" className="text-sm text-gray-500 hover:text-gray-700">
              ← Volver a Mesa de control
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            Caso no encontrado.
          </p>
          <Link href="/mesa-control" className="mt-4 inline-block">
            <Button variant="secondary">Volver al tablero</Button>
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/mesa-control" className="text-sm text-gray-500 hover:text-gray-700">
            ← Volver a Mesa de control
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">
            ConCasa CRM · Expediente
          </h1>
          <div className="flex max-w-[min(100%,14rem)] flex-col items-end gap-0.5 sm:max-w-xs">
            <span className="truncate text-sm font-medium text-gray-800">
              {getEffectiveMockName() || currentUser.email}
            </span>
            <span className="truncate text-xs text-gray-500">{currentUser.email}</span>
            <Button
              variant="outline"
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

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <section className="overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-white via-indigo-50/30 to-white p-5 shadow-md sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700/90">
                Cliente
              </p>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
                {expediente.base.cliente_nombre}
              </h2>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                <span>
                  <span className="font-medium text-gray-700">Tel.</span>{" "}
                  {expediente.base.telefono_cliente}
                </span>
                <span>
                  <span className="font-medium text-gray-700">Programa</span>{" "}
                  {expediente.base.programa}
                </span>
              </div>
            </div>
            <div className="flex w-full flex-shrink-0 flex-wrap gap-3 sm:w-auto">
              <div className="min-w-[10rem] flex-1 rounded-xl border border-gray-100 bg-white/95 p-3 shadow-sm sm:flex-initial">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Asesor
                </p>
                <p className="mt-1 break-all text-sm font-semibold text-gray-900">
                  {formatAsesorExpedienteLabel({
                    fullName: expediente.base.asesorNombre,
                    email:
                      expediente.base.asesorEmail ??
                      (expediente.base.asesorId.includes("@")
                        ? expediente.base.asesorId
                        : null),
                    fallbackId: expediente.base.asesorId,
                  })}
                </p>
              </div>
              <div className="min-w-[10rem] flex-1 rounded-xl border border-gray-100 bg-white/95 p-3 shadow-sm sm:flex-initial">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Origen comercial
                </p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {expediente.base.origenMesa === "interno"
                    ? "Interno"
                    : expediente.base.origenMesa === "externo"
                      ? "Externo"
                      : "Sin definir"}
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Resumen operativo</h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase text-gray-500">Etapa actual</dt>
              <dd className="mt-0.5 text-sm text-gray-700">
                {etapaActualDisplay}. {ETAPAS_LABELS[etapaActualDisplay]}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-gray-500">Subestado</dt>
              <dd className="mt-0.5">
                {(summary?.subestado ?? expediente.operativo.subestado ?? "pendiente") === "rechazado" ? (
                  <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                    Rechazado
                  </span>
                ) : (
                  <span className="text-sm text-gray-700">
                    {subestadoLabel(summary?.subestado ?? expediente.operativo.subestado ?? "pendiente")}
                  </span>
                )}
              </dd>
            </div>
            {(summary?.motivo ?? expediente.operativo.motivoRechazo) && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase text-gray-500">Motivo rechazo</dt>
                <dd className="mt-0.5 text-sm text-gray-700">
                  {summary?.motivo ?? expediente.operativo.motivoRechazo}
                </dd>
              </div>
            )}
            {(summary?.comentarioRechazo ?? expediente.operativo.comentarioRechazo)
              ?.trim() && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase text-gray-500">
                  Comentario rechazo
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-700">
                  {summary?.comentarioRechazo ?? expediente.operativo.comentarioRechazo}
                </dd>
              </div>
            )}
            {(summary?.fechaCita ?? expediente.operativo.fechaCita) && (
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Fecha cita</dt>
                <dd className="mt-0.5 text-sm text-gray-700">
                  {formatDateTime(
                    summary?.fechaCita ?? expediente.operativo.fechaCita ?? "",
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium uppercase text-gray-500">Última actualización</dt>
              <dd className="mt-0.5 text-sm text-gray-600">
                {formatDateTime(expediente.operativo.updatedAt ?? new Date().toISOString())}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Datos Generales del Cliente
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Estado: {clienteDatos?.estado ?? "pendiente"}
                {clienteDatos?.updatedAt ? ` · Actualizado: ${formatDateTime(clienteDatos.updatedAt)}` : ""}
                {clienteDatos?.updatedBy ? ` · Por: ${clienteDatos.updatedBy}` : ""}
              </p>
              {clienteDatos?.estado === "validado" ? (
                <p className="mt-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-800">
                  Datos validados
                  {clienteDatos.validatedAt
                    ? ` · ${formatDateTime(clienteDatos.validatedAt)}`
                    : ""}
                  {clienteDatos.validatedBy ? ` · ${clienteDatos.validatedBy}` : ""}
                </p>
              ) : null}
              {clienteDatos?.estado === "rechazado" ? (
                <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
                  Datos rechazados
                  {clienteDatos.rejectedAt
                    ? ` · ${formatDateTime(clienteDatos.rejectedAt)}`
                    : ""}
                  {clienteDatos.rejectedBy ? ` · ${clienteDatos.rejectedBy}` : ""}
                  {clienteDatos.comentarioRechazo?.trim()
                    ? ` · Motivo: ${clienteDatos.comentarioRechazo}`
                    : ""}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="px-2 py-1 text-xs"
                disabled={
                  !clienteDatos ||
                  clienteDatosSaving ||
                  clienteDatos.estado === "validado"
                }
                onClick={async () => {
                  if (!expediente?.id) return;
                  if (!clienteDatos) return;
                  setClienteDatosSaving(true);
                  try {
                    const updated = await clienteDatosRepo.updateEstado({
                      expedienteId: String(expediente.id),
                      estado: "validado",
                      updatedBy: currentUser.email,
                    });
                    if (updated) setClienteDatos(updated);
                    loadClienteDatos();
                  } finally {
                    setClienteDatosSaving(false);
                  }
                }}
              >
                {clienteDatos?.estado === "validado"
                  ? "Datos validados"
                  : clienteDatosSaving
                    ? "Guardando..."
                    : "Validar datos"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="px-2 py-1 text-xs"
                disabled={!clienteDatos || clienteDatosSaving}
                onClick={() => {
                  setRejectDatosError(null);
                  setRejectDatosComment(clienteDatos?.comentarioRechazo ?? "");
                  setShowRejectDatosModal(true);
                }}
              >
                Rechazar datos
              </Button>
            </div>
          </div>
          {!clienteDatos ? (
            <p className="mt-2 text-xs text-gray-500">
              Sin captura (asesor aún no ha guardado datos generales).
            </p>
          ) : (
            <>
              <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase text-gray-500">Nombre</dt>
                  <dd className="mt-0.5 text-gray-800">{clienteDatos.datos.nombreCliente || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-gray-500">NSS</dt>
                  <dd className="mt-0.5 text-gray-800">{clienteDatos.datos.nss || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-gray-500">CURP</dt>
                  <dd className="mt-0.5 text-gray-800">{clienteDatos.datos.curp || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-gray-500">RFC (opcional)</dt>
                  <dd className="mt-0.5 text-gray-800">{clienteDatos.datos.rfc || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-gray-500">Celular</dt>
                  <dd className="mt-0.5 text-gray-800">{clienteDatos.datos.celular || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-gray-500">Correo</dt>
                  <dd className="mt-0.5 text-gray-800">{clienteDatos.datos.correo || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-gray-500">Empresa</dt>
                  <dd className="mt-0.5 text-gray-800">{clienteDatos.datos.empresa || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-gray-500">Registro patronal</dt>
                  <dd className="mt-0.5 text-gray-800">
                    {clienteDatos.datos.registroPatronal || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-gray-500">Teléfono empresa</dt>
                  <dd className="mt-0.5 text-gray-800">
                    {clienteDatos.datos.telefonoEmpresa || "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase text-gray-500">Dirección empresa</dt>
                  <dd className="mt-0.5 text-gray-800">
                    {[
                      clienteDatos.datos.direccionEmpresa.calle,
                      clienteDatos.datos.direccionEmpresa.colonia,
                      clienteDatos.datos.direccionEmpresa.municipio,
                      clienteDatos.datos.direccionEmpresa.cp ? `CP ${clienteDatos.datos.direccionEmpresa.cp}` : "",
                    ]
                      .filter((x) => !!x && String(x).trim() !== "")
                      .join(", ") || "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase text-gray-500">Beneficiario</dt>
                  <dd className="mt-0.5 text-gray-800">
                    {clienteDatos.datos.beneficiario.nombre
                      ? `${clienteDatos.datos.beneficiario.nombre} (${clienteDatos.datos.beneficiario.parentesco || "—"})`
                      : "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase text-gray-500">Referencias</dt>
                  <dd className="mt-1 grid gap-1 text-gray-800">
                    {clienteDatos.datos.referencias
                      .slice(0, 2)
                      .map((r, idx) => {
                        const txt = [r.nombre, r.celular].filter(Boolean).join(" · ");
                        return (
                          <div key={idx} className="text-sm">
                            {txt || "—"}
                          </div>
                        );
                      })}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase text-gray-500">Notas del asesor</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-gray-800">
                    {clienteDatos.datos.notaMesa?.trim() || "Sin notas"}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-900">
            Documentos requeridos
          </p>
          {!checklist ? (
            <p className="mt-2 text-xs text-gray-500">Cargando…</p>
          ) : (
            <>
              {(() => {
                const faltantesCliente = filterChecklistDocumentoItemsPorOwnerRole(
                  checklist.faltantes,
                  "cliente",
                );
                const completosCliente = filterChecklistDocumentoItemsPorOwnerRole(
                  checklist.completosLista,
                  "cliente",
                );
                const total = faltantesCliente.length + completosCliente.length;
                const completos = completosCliente.length;
                return (
                  <>
                    <p className="mt-2 text-xs text-gray-600">
                      Progreso: {completos} / {total} documentos completos (
                      {Math.round((completos / Math.max(1, total)) * 100)}%)
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-gray-800">
                      {completosCliente.map((it) => {
                        const docRow = latestByTipo.get(it.tipo_documento);
                        const canOpen = Boolean(docRow?.id && docRow.mime_type);
                        return (
                          <li key={`ok-${it.tipo_documento}`} className="flex gap-2">
                            <span aria-hidden>🟢</span>
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                disabled={!canOpen}
                                className="cursor-pointer text-left text-gray-800 underline decoration-gray-400 decoration-dotted underline-offset-2 hover:text-blue-800 hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
                                onClick={() => void openClienteRequeridoPreview(it.tipo_documento)}
                              >
                                {it.label}
                              </button>
                              {canOpen ? (
                                <p className="mt-0.5 text-[10px] leading-tight text-gray-500">
                                  Click para ver documento
                                </p>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                      {faltantesCliente.map((it) => {
                        const obligatorio =
                          DOCUMENTO_CATALOGO_MAP[it.tipo_documento].obligatorio ??
                          "obligatorio";
                        return (
                          <li key={`miss-${it.tipo_documento}`} className="flex gap-2">
                            <span aria-hidden>{obligatorio === "opcional" ? "🟡" : "🔴"}</span>
                            <span>{it.label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                );
              })()}
            </>
          )}
        </div>

        {mostrarSeccionRetencion ? (
          <div className="rounded-xl border border-violet-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">
              Acuse / Aviso de retención
            </h2>
            <p className="mt-1 text-xs text-gray-600">
              Etapa {RETENCION_ETAPA_OPERATIVA_ID}: revisa los documentos según la opción
              elegida por el asesor. Valida o rechaza cada documento; puedes rechazar aunque
              ya esté validado si hubo un error.
            </p>

            <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Opción elegida
              </p>
              <p className="mt-1 font-medium text-gray-900">
                {retencionOpcionMesa
                  ? labelRetencionOpcion(retencionOpcionMesa)
                  : "Sin opción — el asesor debe elegir Opción A o B"}
              </p>
            </div>

            <div
              role="status"
              className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                retencionEnvioUiEstado === "enviado"
                  ? "border-violet-300 bg-violet-50 text-violet-950"
                  : retencionEnvioUiEstado === "correccion_requerida"
                    ? "border-amber-300 bg-amber-50 text-amber-950"
                    : "border-gray-200 bg-gray-50 text-gray-800"
              }`}
            >
              <p className="font-semibold">Envío Acuse/Aviso desde asesor</p>
              {retencionEnvioUiEstado === "no_enviado" ? (
                <p className="mt-1">
                  Pendiente: el asesor aún no envía este bloque a Mesa Control para
                  revisión.
                </p>
              ) : null}
              {retencionEnvioUiEstado === "enviado" ? (
                <p className="mt-1">
                  Enviado a Mesa Control para revisión
                  {retencionEnvioMesa?.fechaEnvioMesa
                    ? ` (${formatDateTime(retencionEnvioMesa.fechaEnvioMesa)})`
                    : ""}
                  .
                </p>
              ) : null}
              {retencionEnvioUiEstado === "correccion_requerida" ? (
                <p className="mt-1">
                  Corrección solicitada: hay documentos rechazados. El asesor debe
                  corregir y reenviar el bloque.
                </p>
              ) : null}
            </div>

            {retencionFaltantes.length > 0 ? (
              <div
                role="status"
                className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950"
              >
                <p className="font-semibold">Pendientes (bloquean avance a etapa 9)</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {retencionFaltantes.map((f) => (
                    <li key={f.kind === "opcion" ? "opcion" : f.tipo_documento}>{f.label}</li>
                  ))}
                </ul>
              </div>
            ) : retencionOpcionMesa ? (
              <p
                role="status"
                className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900"
              >
                Archivos subidos para la opción elegida. Valida cada documento en la lista.
              </p>
            ) : null}

            {retencionOpcionMesa && retencionBloqueosAvance.length > 0 ? (
              <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                <p className="font-semibold">Bloqueos para avanzar a etapa 9</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {retencionBloqueosAvance.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {retencionOpcionMesa ? (
              <div className="mt-3 space-y-1.5" role="list" aria-label="Documentos retención">
                {retencionUploadsMesa.map(({ tipo, label }) => {
                  const item =
                    findRowPorTipoDocumento(archivosResumen, tipo) ??
                    ({
                      expediente_id: routeExpedienteId,
                      tipo_documento: tipo,
                      id: null,
                      nombre_original: null,
                      mime_type: null,
                      size_bytes: null,
                      created_at: null,
                      uploaded_by_role: null,
                      uploaded_by_email: null,
                      estatus_revision: "faltante",
                      comentario_mesa: null,
                    } satisfies ExpedienteArchivoResumen);
                  const isSelected = selectedTipo === tipo;
                  const isSavingRow = item.id ? !!savingById[item.id] : false;
                  const puedeAbrirPreview = Boolean(item.id && item.mime_type);
                  return (
                    <div
                      key={tipo}
                      role="listitem"
                      tabIndex={0}
                      className={`rounded-lg border p-2 text-left transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${docRowAccentClass(item.estatus_revision)} ${
                        puedeAbrirPreview ? "cursor-pointer" : "cursor-default"
                      } ${
                        isSelected
                          ? "border-violet-500 ring-2 ring-violet-400/60 shadow-sm"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                      onClick={() => activateRetencionDocRow(tipo, item, label)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          activateRetencionDocRow(tipo, item, label);
                        }
                      }}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        {label}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge estatus={item.estatus_revision} />
                        {isSavingRow ? (
                          <span className="text-[10px] text-blue-700">Guardando…</span>
                        ) : null}
                      </div>
                      <p
                        className={`mt-0.5 truncate text-xs font-medium text-gray-900 ${
                          puedeAbrirPreview ? "underline decoration-gray-300 underline-offset-2" : ""
                        }`}
                      >
                        {!item.id ? "Sin archivo" : (item.nombre_original ?? "—")}
                      </p>
                      {item.estatus_revision === "rechazado" && item.comentario_mesa ? (
                        <p className="mt-1 text-[11px] text-red-800">
                          Nota Mesa: {item.comentario_mesa}
                        </p>
                      ) : null}
                      {item.estatus_revision === "validado" ? (
                        <p className="mt-1 text-[11px] text-green-800">
                          Validado por Mesa. Si hubo un error, usa «Rechazar (corregir)».
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          className="px-2 py-0.5 text-[11px]"
                          disabled={
                            !item.id ||
                            !item.mime_type ||
                            retencionPreviewLoading ||
                            isSavingRow
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            void openRetencionDocPreview(item, label);
                          }}
                        >
                          {retencionPreviewLoading &&
                          retencionDocPreview?.nombre_original === item.nombre_original
                            ? "Cargando…"
                            : "Ver documento"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="px-2 py-0.5 text-[11px]"
                          disabled={!item.id || item.estatus_revision === "validado" || isSavingRow}
                          onClick={(e) => {
                            e.stopPropagation();
                            void persistRevision(item.id!, "validado", null).then((ok) =>
                              syncTrasRevisionRetencion(tipo, "validado", ok),
                            );
                          }}
                        >
                          Validar
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="px-2 py-0.5 text-[11px] text-red-800 border-red-200"
                          disabled={!item.id || isSavingRow}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTipo(tipo);
                            setRetencionRejectTipo(tipo);
                            setRetencionRejectComment(
                              item.estatus_revision === "rechazado"
                                ? (item.comentario_mesa ?? "")
                                : "",
                            );
                          }}
                        >
                          {item.estatus_revision === "validado"
                            ? "Rechazar (corregir)"
                            : "Rechazar"}
                        </Button>
                      </div>
                      {retencionRejectTipo === tipo ? (
                        <div
                          className="mt-2 space-y-1.5 rounded border border-red-100 bg-red-50/80 p-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <label className="block text-[11px] font-medium text-red-900">
                            Nota de rechazo (obligatoria)
                          </label>
                          <textarea
                            className="w-full rounded border border-red-200 px-2 py-1 text-xs"
                            rows={2}
                            value={retencionRejectComment}
                            onChange={(e) => setRetencionRejectComment(e.target.value)}
                          />
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              type="button"
                              variant="primary"
                              className="px-2 py-0.5 text-[11px]"
                              disabled={
                                retencionRejectComment.trim().length === 0 || isSavingRow
                              }
                              onClick={() => {
                                const c = retencionRejectComment.trim();
                                if (!item.id || c.length === 0) return;
                                void persistRevision(item.id, "rechazado", c).then((ok) => {
                                  if (ok) {
                                    setRetencionRejectTipo(null);
                                    setRetencionRejectComment("");
                                  }
                                  void syncTrasRevisionRetencion(tipo, "rechazado", ok);
                                });
                              }}
                            >
                              Guardar rechazo
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="px-2 py-0.5 text-[11px]"
                              onClick={() => {
                                setRetencionRejectTipo(null);
                                setRetencionRejectComment("");
                              }}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-xs text-gray-500">
                Cuando el asesor elija la opción, aquí aparecerán los documentos a revisar.
              </p>
            )}
          </div>
        ) : null}

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">Revisión de documentos</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="px-2 py-1 text-xs"
                onClick={() => setDocPanelCollapsed((v) => !v)}
              >
                {docPanelCollapsed ? "Mostrar panel lateral" : "Colapsar panel lateral"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="px-2 py-1 text-xs"
                disabled={bulkSaving || docStats.pendientesMesa === 0}
                onClick={() => void handleValidarTodosPendientes()}
              >
                {bulkSaving ? "Guardando..." : "Validar todos los pendientes"}
              </Button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] sm:text-xs">
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold text-gray-600">Pendientes de revisar</span>
              <span className="tabular-nums text-sm font-bold text-blue-800">
                {docStats.pendientesMesa}
              </span>
              <span className="text-gray-400">(subido + resubido)</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold text-orange-800">Correcciones enviadas</span>
              <span className="tabular-nums text-sm font-bold text-orange-900">
                {docStats.correccionesEnviadas}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold text-green-800">Validados</span>
              <span className="tabular-nums text-sm font-bold text-green-900">
                {docStats.validados}
              </span>
            </div>
            {bulkFeedback && (
              <div className="w-full text-[11px] text-gray-700 sm:w-auto">{bulkFeedback}</div>
            )}
          </div>

          {(() => {
            const sid = selectedDoc?.id;
            const savingSelected = sid ? !!savingById[sid] : false;
            const activeSegment: PanelSegment = rejectEditing
              ? "rechazado"
              : selectedDoc?.estatus_revision === "validado"
                ? "validado"
                : selectedDoc?.estatus_revision === "rechazado"
                  ? "rechazado"
                  : "pendiente";
            const segBase =
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";
            const segOn = "border-blue-600 bg-blue-600 text-white";
            const segOff = "border-gray-200 bg-white text-gray-700 hover:bg-gray-50";

            const onPendiente = () => {
              if (!sid) return;
              if (
                selectedDoc?.estatus_revision === "subido" ||
                selectedDoc?.estatus_revision === "resubido"
              ) {
                return;
              }
              setRejectEditing(false);
              const kind = pendienteKindById[sid] ?? "subido";
              void persistRevision(sid, kind, null);
            };
            const onValidado = () => {
              if (!sid) return;
              if (selectedDoc?.estatus_revision === "validado") return;
              setRejectEditing(false);
              const tipo = selectedDoc.tipo_documento;
              void persistRevision(sid, "validado", null).then((ok) => {
                if (isRetencionTipoDocumento(tipo)) {
                  void syncTrasRevisionRetencion(tipo, "validado", ok);
                } else {
                  void afterRevisionPersist(tipo, ok);
                }
              });
            };
            const onRechazado = () => {
              setRejectEditing(true);
              if (selectedDoc?.estatus_revision === "rechazado") {
                setRejectComment(selectedDoc.comentario_mesa ?? "");
              } else {
                setRejectComment("");
              }
            };

            const selectDocFromList = (tipo: TipoDocumentoCatalogo) => {
              setSelectedTipo(tipo);
              setDocPanelCollapsed(false);
              setDocPreviewUiVisible(true);
            };

            const clienteItemsRevision = checklist
              ? buildClienteItemsRevisionDocumental({
                  checklist,
                  resumen: archivosResumen,
                  etapaId: 2,
                })
              : [];

            return (
              <div
                className={`mt-3 grid gap-4 items-start ${
                  docPanelCollapsed
                    ? "grid-cols-1"
                    : "lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]"
                }`}
              >
                <div className="space-y-1.5" role="listbox" aria-label="Documentos del expediente">
                  {!checklist ? (
                    <p className="text-xs text-gray-500">Cargando…</p>
                  ) : clienteItemsRevision.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      No hay documentos de cliente en el checklist para esta etapa.
                    </p>
                  ) : (
                    clienteItemsRevision.map((it) => {
                      const tipo = it.tipo_documento;
                      const item =
                        findRowPorTipoDocumento(archivosResumen, tipo) ??
                        ({
                          expediente_id: routeExpedienteId,
                          tipo_documento: tipo,
                          id: null,
                          nombre_original: null,
                          mime_type: null,
                          size_bytes: null,
                          created_at: null,
                          uploaded_by_role: null,
                          uploaded_by_email: null,
                          estatus_revision: "faltante",
                          comentario_mesa: null,
                        } satisfies ExpedienteArchivoResumen);

                      const isMissing = item.estatus_revision === "faltante" || !item.id;
                      const isSelected = selectedTipo === tipo;
                      const isSavingRow = item.id ? !!savingById[item.id] : false;

                      return (
                        <div
                          key={tipo}
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={0}
                          className={`cursor-pointer rounded-lg border p-2 text-left transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${docRowAccentClass(item.estatus_revision)} ${
                            isSelected
                              ? "border-blue-500 ring-2 ring-blue-400/60 shadow-sm"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                          onClick={() => selectDocFromList(tipo)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectDocFromList(tipo);
                            }
                          }}
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            {it.label}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <StatusBadge estatus={item.estatus_revision} />
                            {isSavingRow && (
                              <span className="text-[10px] text-blue-700">Guardando…</span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs font-medium text-gray-900">
                            {isMissing ? "Sin archivo" : (item.nombre_original ?? "—")}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>

                {docPanelCollapsed ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-3 lg:col-span-2">
                    <p className="text-xs text-gray-700">
                      {selectedTipo
                        ? `Seleccionado: ${labelTipoDocumentoCatalogo(selectedTipo)}. El panel lateral está colapsado — ábrelo para ver metadatos, decidir y vista previa compacta.`
                        : "Selecciona un documento en la lista o abre el panel lateral para revisar."}
                    </p>
                    <div>
                      <Button
                        type="button"
                        variant="primary"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => setDocPanelCollapsed(false)}
                      >
                        Mostrar panel de revisión
                      </Button>
                    </div>
                  </div>
                ) : null}

                {!docPanelCollapsed ? (
                <aside className="flex min-h-0 flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50/80 p-3 lg:sticky lg:top-4">
                  {!selectedDoc ? (
                    <p className="text-sm text-gray-600">Selecciona un documento en la lista.</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-200/80 pb-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          Documento seleccionado
                        </p>
                        <button
                          type="button"
                          className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-200/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          onClick={() => setDocPanelCollapsed(true)}
                          aria-label="Colapsar panel lateral"
                        >
                          ✕ Cerrar panel
                        </button>
                      </div>
                      <div className="space-y-1 pb-2">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {selectedDoc.nombre_original ?? "—"}
                        </p>
                        <p className="text-xs text-gray-600">
                          Tipo:{" "}
                          <span className="font-medium text-gray-800">
                            {labelTipoDocumentoCatalogo(selectedDoc.tipo_documento)}
                          </span>
                        </p>
                        <p className="text-xs text-gray-600">
                          Estado:{" "}
                          <span className="font-medium text-gray-800">
                            {estatusRevisionLabel(selectedDoc.estatus_revision)}
                          </span>
                        </p>
                        <p className="text-xs text-gray-600">
                          Carga:{" "}
                          {selectedDoc.created_at
                            ? formatDateTime(selectedDoc.created_at)
                            : "—"}
                        </p>
                        <p className="text-xs text-gray-600">
                          Decisión:{" "}
                          <span className="font-medium text-gray-800">
                            {activeSegment === "pendiente"
                              ? "Pendiente revisión"
                              : activeSegment === "validado"
                                ? "Validado"
                                : "Rechazado"}
                          </span>
                        </p>
                        {selectedDoc.estatus_revision === "rechazado" &&
                          selectedDoc.comentario_mesa && (
                            <p className="rounded-md border border-red-200 bg-red-50/90 px-2 py-1 text-[11px] text-red-900">
                              <span className="font-semibold">Comentario mesa:</span>{" "}
                              {selectedDoc.comentario_mesa}
                            </p>
                          )}
                      </div>

                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          Decisión
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className={`${segBase} ${activeSegment === "pendiente" ? segOn : segOff}`}
                            disabled={!sid || savingSelected}
                            onClick={onPendiente}
                          >
                            Pendiente revisión
                          </button>
                          <button
                            type="button"
                            className={`${segBase} ${activeSegment === "validado" ? segOn : segOff}`}
                            disabled={!sid || savingSelected}
                            onClick={onValidado}
                          >
                            Validado
                          </button>
                          <button
                            type="button"
                            className={`${segBase} ${activeSegment === "rechazado" ? segOn : segOff}`}
                            disabled={!sid || savingSelected}
                            onClick={onRechazado}
                          >
                            Rechazado
                          </button>
                        </div>
                        {rejectEditing && (
                          <div className="mt-2 rounded-md border border-gray-200 bg-white p-2">
                            <label className="text-[11px] font-medium text-gray-600">
                              Comentario (obligatorio para rechazar)
                            </label>
                            <textarea
                              className="mt-1 min-h-[72px] w-full resize-none rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              value={rejectComment}
                              onChange={(e) => setRejectComment(e.target.value)}
                              placeholder="Motivo del rechazo documental…"
                            />
                            <div className="mt-2 flex flex-wrap justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="px-2 py-1 text-xs"
                                onClick={() => {
                                  setRejectEditing(false);
                                  setRejectComment(
                                    selectedDoc.estatus_revision === "rechazado"
                                      ? (selectedDoc.comentario_mesa ?? "")
                                      : "",
                                  );
                                }}
                              >
                                Cancelar
                              </Button>
                              <Button
                                type="button"
                                variant="primary"
                                className="px-2 py-1 text-xs"
                                disabled={
                                  rejectComment.trim().length === 0 || savingSelected || !sid
                                }
                                onClick={() => {
                                  const c = rejectComment.trim();
                                  if (!sid || c.length === 0) return;
                                  const tipo = selectedDoc.tipo_documento;
                                  void persistRevision(sid, "rechazado", c).then((ok) => {
                                    if (ok) setRejectEditing(false);
                                    if (isRetencionTipoDocumento(tipo)) {
                                      void syncTrasRevisionRetencion(tipo, "rechazado", ok);
                                    } else {
                                      void afterRevisionPersist(tipo, ok);
                                    }
                                  });
                                }}
                              >
                                Guardar rechazo
                              </Button>
                            </div>
                          </div>
                        )}
                        {savingSelected && (
                          <p className="mt-2 text-xs text-blue-700">Guardando…</p>
                        )}
                      </div>

                      <div className="min-h-0 flex-1 border-t border-gray-200/80 pt-2">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            Vista previa
                          </p>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {docPreviewUiVisible ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="px-2 py-0.5 text-[11px]"
                                onClick={() => setDocPreviewUiVisible(false)}
                              >
                                Ocultar vista previa
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                className="px-2 py-0.5 text-[11px]"
                                disabled={!selectedDoc.id}
                                onClick={() => setDocPreviewUiVisible(true)}
                              >
                                Mostrar vista previa
                              </Button>
                            )}
                            {selectedDoc.id && selectedDoc.nombre_original ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="px-2 py-0.5 text-[11px]"
                                onClick={() => void downloadArchivo(selectedDoc)}
                              >
                                Descargar
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {!docPreviewUiVisible ? (
                          <p className="rounded-md border border-dashed border-gray-300 bg-white px-2 py-3 text-center text-[11px] leading-snug text-gray-600">
                            Vista previa oculta. Usa &quot;Mostrar vista previa&quot; para ver el
                            documento en el panel; podrás abrirlo completo en una nueva pestaña.
                          </p>
                        ) : preview && preview.id === selectedDoc.id ? (
                          <div className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                            {preview.mime_type.startsWith("image/") ? (
                              <button
                                type="button"
                                className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
                                onClick={() => openPreviewBlobInNewTab(preview.url)}
                                aria-label="Abrir imagen en una nueva pestaña"
                              >
                                <div className="flex h-[min(420px,55vh)] min-h-[320px] w-full items-center justify-center bg-gray-50 p-3">
                                  {/* eslint-disable-next-line @next/next/no-img-element -- blob URL preview */}
                                  <img
                                    src={preview.url}
                                    alt={preview.nombre_original}
                                    className="max-h-full max-w-full cursor-pointer object-contain"
                                  />
                                </div>
                                <p className="border-t border-gray-200 bg-white px-2 py-1.5 text-center text-[10px] font-medium text-gray-600">
                                  Clic para abrir en nueva pestaña
                                </p>
                              </button>
                            ) : preview.mime_type === "application/pdf" ? (
                              <div>
                                <iframe
                                  title={preview.nombre_original}
                                  src={preview.url}
                                  className="h-[420px] w-full border-0 bg-white"
                                />
                                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 bg-gray-50 px-2 py-2">
                                  <p className="text-[10px] text-gray-600">
                                    Vista embebida; para ver el PDF completo usa el botón.
                                  </p>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="px-2 py-1 text-xs"
                                    onClick={() => openPreviewBlobInNewTab(preview.url)}
                                  >
                                    Abrir PDF en nueva pestaña
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 bg-gray-50 px-4 py-8 text-center">
                                <p className="text-xs font-medium text-gray-700">
                                  Vista previa no disponible en el panel
                                </p>
                                <p className="text-[11px] text-gray-500">
                                  Descarga el archivo para revisarlo con la aplicación adecuada.
                                </p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex min-h-[160px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-4 py-6 text-center">
                            <p className="text-xs font-medium text-gray-600">
                              {selectedDoc.id
                                ? "Cargando vista previa…"
                                : "Sin archivo para previsualizar"}
                            </p>
                            {!selectedDoc.id ? (
                              <p className="text-[11px] text-gray-500">
                                Sube o solicita el documento desde el flujo del asesor.
                              </p>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </aside>
                ) : null}
              </div>
            );
          })()}
        </div>

        {citasAgenda.biometrico || citasAgenda.firma ? (
          <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {citasAgenda.biometrico ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 shadow-sm">
                <p className="text-sm font-semibold text-emerald-950">Cita de biométricos agendada</p>
                <p className="mt-1 text-xs text-emerald-900">
                  <span className="font-medium">Ubicación:</span> {citasAgenda.biometrico.ubicacion}
                </p>
                <p className="text-xs text-emerald-900">
                  <span className="font-medium">Fecha/hora:</span> {citasAgenda.biometrico.fecha}
                </p>
                <p className="text-xs text-emerald-900">
                  <span className="font-medium">Agendó:</span> {citasAgenda.biometrico.asesor}
                </p>
                <p className="text-xs text-emerald-900">
                  <span className="font-medium">Estado:</span> {citasAgenda.biometrico.estado}
                </p>
              </div>
            ) : null}
            {citasAgenda.firma ? (
              <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 shadow-sm">
                <p className="text-sm font-semibold text-violet-950">Cita de firma agendada</p>
                <p className="mt-1 text-xs text-violet-900">
                  <span className="font-medium">Ubicación:</span> {citasAgenda.firma.ubicacion}
                </p>
                <p className="text-xs text-violet-900">
                  <span className="font-medium">Fecha/hora:</span> {citasAgenda.firma.fecha}
                </p>
                <p className="text-xs text-violet-900">
                  <span className="font-medium">Agendó:</span> {citasAgenda.firma.asesor}
                </p>
                <p className="text-xs text-violet-900">
                  <span className="font-medium">Estado:</span> {citasAgenda.firma.estado}
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {canMountAgendaFirmasAgendaUI() && expediente.operativo.etapaActual === 9 ? (
          <AgendaFirmasCard expedienteId={String(expediente.id)} />
        ) : null}

        <SeguimientoOperativoMock
          contextPrecalId={String(expediente.id)}
          contextClienteNombre={expediente.base.cliente_nombre}
          contextTelefono={expediente.base.telefono_cliente}
          contextPrograma={expediente.base.programa}
          contextAsesorId={expediente.base.asesorId}
          onEnviarAMesa={async (payload) => {
            await repo.enviarAMesaWithPayload(payload.id, {
              cliente_nombre: payload.cliente_nombre,
              telefono_cliente: payload.telefono_cliente,
              programa: payload.programa,
              asesorNombre: payload.asesorNombre,
              fechaCita: payload.fechaCita ?? null,
              etapaActual: payload.etapaActual,
              subestado: payload.subestado,
              docs: payload.docs,
            });
            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("expediente_enviado_a_mesa", {
                  detail: { expedienteId: String(payload.id) },
                }),
              );
            }
          }}
          initialSubmittedToMesa={expediente.operativo.submittedToMesa}
          initialEtapaActualId={expediente.operativo.etapaActual ?? undefined}
          initialSubestado={expediente.operativo.subestado ?? undefined}
          initialMotivo={expediente.operativo.motivoRechazo ?? undefined}
          initialComentarioRechazo={expediente.operativo.comentarioRechazo ?? undefined}
          initialFechaCita={expediente.operativo.fechaCita ?? undefined}
          initialUpdatedAt={expediente.operativo.updatedAt ?? undefined}
          onChangeSummary={handleChangeSummary}
        />
      </main>

      {retencionDocPreview ? (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={closeRetencionDocPreview}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Vista previa: ${retencionDocPreview.label}`}
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">
                  {retencionDocPreview.label}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {retencionDocPreview.nombre_original}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="shrink-0 px-2 py-1 text-xs"
                onClick={closeRetencionDocPreview}
              >
                Cerrar
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-3">
              {isArchivoPreviewImageMime(retencionDocPreview.mime_type) ? (
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element -- blob URL modal retención */}
                  <img
                    src={retencionDocPreview.url}
                    alt={retencionDocPreview.nombre_original}
                    className="max-h-[min(70vh,720px)] max-w-full object-contain"
                  />
                </div>
              ) : isArchivoPreviewPdfMime(retencionDocPreview.mime_type) ? (
                <iframe
                  title={retencionDocPreview.nombre_original}
                  src={retencionDocPreview.url}
                  className="h-[min(70vh,720px)] w-full border-0 bg-white"
                />
              ) : (
                <div className="py-8 text-center">
                  <p className="text-sm text-gray-600">
                    Vista previa no disponible para este tipo de archivo.
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    className="mt-3 px-3 py-1.5 text-xs"
                    onClick={() => openPreviewBlobInNewTab(retencionDocPreview.url)}
                  >
                    Abrir archivo
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {clienteReqDocPreview ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={closeClienteRequeridoPreview}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Vista previa: ${clienteReqDocPreview.nombre_original}`}
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
              <p className="min-w-0 truncate text-sm font-medium text-gray-900">
                {clienteReqDocPreview.nombre_original}
              </p>
              <Button
                type="button"
                variant="outline"
                className="shrink-0 px-2 py-1 text-xs"
                onClick={closeClienteRequeridoPreview}
              >
                Cerrar
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-3">
              {isArchivoPreviewImageMime(clienteReqDocPreview.mime_type) ? (
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element -- blob URL modal */}
                  <img
                    src={clienteReqDocPreview.url}
                    alt={clienteReqDocPreview.nombre_original}
                    className="max-h-[min(70vh,720px)] max-w-full object-contain"
                  />
                </div>
              ) : isArchivoPreviewPdfMime(clienteReqDocPreview.mime_type) ? (
                <iframe
                  title={clienteReqDocPreview.nombre_original}
                  src={clienteReqDocPreview.url}
                  className="h-[min(70vh,720px)] w-full border-0 bg-white"
                />
              ) : (
                <div className="py-8 text-center">
                  <p className="text-sm text-gray-600">
                    Vista previa no disponible para este tipo de archivo.
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    className="mt-3 px-3 py-1.5 text-xs"
                    onClick={() => openPreviewBlobInNewTab(clienteReqDocPreview.url)}
                  >
                    Abrir archivo
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {showRejectDatosModal ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={() => setShowRejectDatosModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Rechazar datos generales"
            className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-900">
              Rechazar datos generales
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Escribe el motivo del rechazo para que el asesor pueda corregirlo.
            </p>
            <label className="mt-3 block text-xs font-medium text-gray-700">
              Motivo de rechazo
            </label>
            <textarea
              value={rejectDatosComment}
              onChange={(e) => {
                setRejectDatosComment(e.target.value);
                if (rejectDatosError) setRejectDatosError(null);
              }}
              placeholder="Ej. Falta corregir CURP"
              className="mt-1 min-h-[110px] w-full resize-none rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {rejectDatosError ? (
              <p className="mt-2 text-xs text-red-700">{rejectDatosError}</p>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="px-2 py-1 text-xs"
                onClick={() => setShowRejectDatosModal(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                className="px-2 py-1 text-xs"
                disabled={clienteDatosSaving}
                onClick={async () => {
                  if (!expediente?.id || !clienteDatos) return;
                  const comentario = rejectDatosComment.trim();
                  if (!comentario) {
                    setRejectDatosError("Escribe un comentario para rechazar.");
                    return;
                  }
                  setClienteDatosSaving(true);
                  try {
                    const updated = await clienteDatosRepo.updateEstado({
                      expedienteId: String(expediente.id),
                      estado: "rechazado",
                      updatedBy: currentUser.email,
                      comentarioRechazo: comentario,
                    });
                    if (updated) setClienteDatos(updated);
                    setShowRejectDatosModal(false);
                    setRejectDatosComment("");
                    setRejectDatosError(null);
                    loadClienteDatos();
                  } catch (err) {
                    setRejectDatosError(
                      err instanceof Error
                        ? err.message
                        : "No se pudo guardar el rechazo.",
                    );
                  } finally {
                    setClienteDatosSaving(false);
                  }
                }}
              >
                {clienteDatosSaving ? "Guardando..." : "Confirmar rechazo"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function MesaControlExpedientePage() {
  if (isDataModeSupabase()) {
    return <MesaExpedienteDetalleReadOnly />;
  }
  return <MesaControlExpedienteMockPage />;
}
