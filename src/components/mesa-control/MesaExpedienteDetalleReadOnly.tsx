"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  MesaArchivoPreviewDialog,
  openBlobUrlInNewTab,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import { MesaAccordionSection } from "@/components/mesa-control/MesaAccordionSection";
import { MesaExpedienteAgendaCitasSection } from "@/components/mesa-control/MesaExpedienteAgendaCitasSection";
import { MesaNotificacionExtraordinariaSection } from "@/components/mesa-control/MesaNotificacionExtraordinariaSection";
import { MesaCancelarCitaDialog } from "@/components/mesa-control/MesaCancelarCitaDialog";
import {
  buildAgendaAccordionSummary,
  buildClienteDatosAccordionSummary,
  buildComplementariosAccordionSummary,
  buildIntegracionDocsAccordionSummary,
  buildRetencionAccordionSummary,
} from "@/components/mesa-control/MesaExpedienteDocumentosResumen";
import { MesaClienteDatosReadOnlySection } from "@/components/mesa-control/MesaClienteDatosReadOnlySection";
import { MesaMontoMejoravitActualizadoSection } from "@/components/mesa-control/MesaMontoMejoravitActualizadoSection";
import { MesaPagareSection } from "@/components/mesa-control/MesaPagareSection";
import { MesaNotificacionDocumentoSection } from "@/components/mesa-control/MesaNotificacionDocumentoSection";
import { MesaAvanceOperativoSection, MESA_AVANCE_OPERATIVO_2A3_COPY, MESA_AVANCE_OPERATIVO_3A5_COPY, MESA_AVANCE_OPERATIVO_4A5_COPY, MESA_AVANCE_OPERATIVO_5A6_COPY, MESA_AVANCE_OPERATIVO_6A7_COPY, MESA_AVANCE_OPERATIVO_7A8_COPY, MESA_AVANCE_OPERATIVO_8A9_COPY, MESA_AVANCE_OPERATIVO_9A10_COPY, MESA_FIRMA_ETAPA10_OPERATIVA_COPY, type MesaAvanceCancelCitaGate } from "@/components/mesa-control/MesaAvanceOperativoSection";
import { MesaCierreValidacionDocumentalSection } from "@/components/mesa-control/MesaCierreValidacionDocumentalSection";
import { MesaControlDocumentosComplementariosSection } from "@/components/mesa-control/MesaControlDocumentosComplementariosSection";
import { MesaDocumentosAsesorSection } from "@/components/mesa-control/MesaDocumentosAsesorSection";
import { MesaRetencionAcuseAvisoSection } from "@/components/mesa-control/MesaRetencionAcuseAvisoSection";
import { AsesorSeguimientoOperativo } from "@/components/asesor/AsesorSeguimientoOperativo";
import { Button } from "@/components/ui/Button";
import {
  formatAsesorExpedienteLabel,
  formatMontoAprobadoVigente,
} from "@/lib/asesorDisplay";
import {
  useExpedienteClienteDatosRepo,
  ClienteDatosSupabaseError,
  type ExpedienteClienteDatos,
} from "@/domain/expediente-cliente-datos";
import {
  buildMesaIntegrationDocViews,
  buildMesaComplementariosDocViews,
  ExpedienteArchivosSupabaseError,
  type EstatusRevision,
  type ExpedienteArchivoListItem,
  type ExpedienteArchivoResumen,
  type IntegrationDocAsesorUploadTipo,
  type IntegrationDocMesaUploadTipo,
  useExpedienteArchivosRepo,
} from "@/domain/expediente-archivos";
import {
  ExpedientesSupabaseError,
  esExpedienteCancelado,
  getMesaControlManualEstado,
  useExpedientesRepo,
  deriveAvanceOperativo2a3View,
  deriveAvanceOperativo3a5View,
  deriveAvanceOperativo4a5View,
  deriveAvanceOperativo5a6View,
  deriveAvanceOperativo6a7View,
  deriveAvanceOperativo7a8View,
  deriveAvanceOperativo8a9View,
  deriveAvanceOperativo9a10View,
  deriveCierreValidacionDocumentalView,
  type ExpedienteCancelacionRow,
  type ExpedienteMock,
} from "@/domain/expedientes";
import {
  mesaPuedeRevisarClienteDatos,
  mesaPuedeRevisarDocumentosIntegracion,
  mesaPuedeRevisarRetencionDocumentos,
  mostrarMesaClienteDatosConsulta,
  mostrarMesaIntegracionDocsConsulta,
  mostrarMesaRetencionConsulta,
} from "@/domain/expedientes/mesa-decision-ux";
import {
  useAgendaBiometricosBookingRepo,
  AgendaBiometricosSupabaseError,
  type AgendaBiometricosActiveBooking,
  type AgendaBiometricosConfigRecord,
  type AgendaNotificacionActiveBooking,
} from "@/domain/agenda-biometricos";
import {
  getMesaFirmasUiAccess,
  useAgendaFirmasBookingRepo,
  AgendaFirmasSupabaseError,
  type AgendaFirmasActiveBooking,
  type AgendaFirmasConfigRecord,
} from "@/domain/agenda-firmas";
import {
  buildNotificacionExtraordinariaAccordionSummary,
  MESA_NOTIFICACION_EXTRAORDINARIA_TITLE,
  resolveProfileDisplayLabel,
} from "@/lib/mesaNotificacionExtraordinariaUi";
import { parseCancelMotivoFromNote } from "@/lib/agendaCancelNote";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import { getEffectiveMockRole } from "@/lib/mockUser";
import type { MesaAgendaCancelKind } from "@/lib/mesaAgendaCancelAccess";
import {
  MESA_CANCEL_SUCCESS_MESSAGE,
} from "@/lib/mesaAgendaCancelAccess";
import {
  deriveRetencionAcuseAvisoFaltantes,
  getBloqueosRetencionAvanceEtapa8Mesa,
  type RetencionTipoDocumento,
} from "@/domain/expediente-archivos/retencion-acuse-aviso";
import {
  buildMesaRetencionDocViews,
  retencionEnvioEstadoEfectivo,
  retencionOpcionMesaEfectiva,
  useExpedienteRetencionSupabaseRepo,
  type ExpedienteRetencionEnvioMesa,
  type RetencionOpcion,
} from "@/domain/expediente-retencion";
import {
  formatPdfUploadRejectionForField,
  validatePdfFile,
} from "@/lib/fileUploadValidation";
import { useSessionRepo, type Rol } from "@/domain/session";
import { subestadoOperativoLabel } from "@/lib/subestadoOperativoUi";
import { useMesaOpsRepo, type MesaExpedienteOpsRow } from "@/domain/mesa-ops";
import { recordMesaExpedienteOpened } from "@/lib/mesaExpedienteOpenedStorage";
import { MesaExpedienteOpsSection } from "@/components/mesa-control/MesaExpedienteOpsSection";
import { MesaControlManualEtapaSection } from "@/components/mesa-control/MesaControlManualEtapaSection";
import { MesaRechazoOperativoPostBiometricosCard } from "@/components/mesa-control/MesaRechazoOperativoPostBiometricosCard";
import { MesaCancelarExpedienteCard } from "@/components/mesa-control/MesaCancelarExpedienteCard";
import { MesaExpedienteCanceladoBanner } from "@/components/mesa-control/MesaExpedienteCanceladoBanner";
import { MesaGestionFirmasSection } from "@/components/mesa-control/MesaGestionFirmasSection";
import { isProgramaMejoravit } from "@/domain/expedientes/map-programa";
import {
  formatEtapaMesaCorrespondenciaAsesor,
  formatEtapaMesaLabel,
} from "@/domain/expedientes/etapa-numeracion-ux";

type LoadState = "loading" | "ready" | "not_found" | "error";

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function editorDecisionLabel(decision?: string | null): string {
  if (decision === "aprobado") return "Aprobado";
  if (decision === "no_cumple") return "No cumple";
  return "Pendiente";
}

function origenMesaLabel(origen: string | null | undefined): string {
  if (origen === "interno") return "Interno";
  if (origen === "externo") return "Externo";
  return "—";
}

function MesaDetalleShell({
  children,
  title = "ConCasa CRM · Expediente Mesa",
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Link href="/mesa-control" className="text-sm text-gray-500 hover:text-gray-700">
            ← Volver a Mesa de control
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          <span className="w-24" aria-hidden />
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}

function formatAsesorLabelFromExpediente(expediente: ExpedienteMock): string {
  return formatAsesorExpedienteLabel({
    fullName: expediente.base.asesorNombre,
    email: expediente.base.asesorEmail ?? (expediente.base.asesorId.includes("@") ? expediente.base.asesorId : null),
    fallbackId: expediente.base.asesorId,
  });
}

function puedeRevisarDocumentos(role: Rol | undefined): boolean {
  return role === "mesa_control" || role === "super_admin";
}

export function MesaExpedienteDetalleReadOnly() {
  const { id } = useParams<{ id: string }>();
  const routeExpedienteId =
    id === undefined || id === null || id === "" ? "" : String(id);
  const { currentUser } = useSessionRepo();
  const expedientesRepo = useExpedientesRepo();
  const archivosRepo = useExpedienteArchivosRepo();
  const clienteDatosRepo = useExpedienteClienteDatosRepo();
  const agendaBookingRepo = useAgendaBiometricosBookingRepo();
  const firmasBookingRepo = useAgendaFirmasBookingRepo();
  const retencionRepo = useExpedienteRetencionSupabaseRepo();
  const mesaOpsRepo = useMesaOpsRepo();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expediente, setExpediente] = useState<ExpedienteMock | null>(null);
  const [clienteDatos, setClienteDatos] = useState<ExpedienteClienteDatos | null>(null);
  const [archivosResumen, setArchivosResumen] = useState<ExpedienteArchivoResumen[]>([]);
  const [archivosLista, setArchivosLista] = useState<ExpedienteArchivoListItem[]>([]);
  const [preview, setPreview] = useState<MesaArchivoPreviewState | null>(null);
  const [archivoLoadingTipo, setArchivoLoadingTipo] =
    useState<IntegrationDocAsesorUploadTipo | null>(null);
  const [archivoErrorByTipo, setArchivoErrorByTipo] = useState<Record<string, string>>({});
  const [revisionSavingTipo, setRevisionSavingTipo] = useState<string | null>(null);
  const [revisionErrorByTipo, setRevisionErrorByTipo] = useState<Record<string, string>>({});
  const [uploadLoadingTipo, setUploadLoadingTipo] =
    useState<IntegrationDocMesaUploadTipo | null>(null);
  const [uploadErrorByTipo, setUploadErrorByTipo] = useState<Record<string, string>>({});
  const [complementarioArchivoLoadingTipo, setComplementarioArchivoLoadingTipo] =
    useState<IntegrationDocMesaUploadTipo | null>(null);
  const [complementarioArchivoErrorByTipo, setComplementarioArchivoErrorByTipo] = useState<
    Record<string, string>
  >({});
  const [retencionOpcion, setRetencionOpcion] = useState<RetencionOpcion | null>(null);
  const [retencionEnvio, setRetencionEnvio] = useState<ExpedienteRetencionEnvioMesa | null>(
    null,
  );
  const [retencionArchivoLoadingTipo, setRetencionArchivoLoadingTipo] =
    useState<RetencionTipoDocumento | null>(null);
  const [clienteDatosSaving, setClienteDatosSaving] = useState(false);
  const [clienteDatosRevisionError, setClienteDatosRevisionError] = useState<string | null>(
    null,
  );
  const [continuarLoading, setContinuarLoading] = useState(false);
  const [continuarError, setContinuarError] = useState<string | null>(null);
  const [continuarSuccess, setContinuarSuccess] = useState<string | null>(null);
  const [avance2a3Loading, setAvance2a3Loading] = useState(false);
  const [avance2a3Error, setAvance2a3Error] = useState<string | null>(null);
  const [avance2a3Success, setAvance2a3Success] = useState<string | null>(null);
  const [avance3a5Loading, setAvance3a5Loading] = useState(false);
  const [avance3a5Error, setAvance3a5Error] = useState<string | null>(null);
  const [avance3a5Success, setAvance3a5Success] = useState<string | null>(null);
  const [activeBiometricBooking, setActiveBiometricBooking] =
    useState<AgendaBiometricosActiveBooking | null>(null);
  const [activeNotificacionBooking, setActiveNotificacionBooking] =
    useState<AgendaNotificacionActiveBooking | null>(null);
  const [biometricosConfig, setBiometricosConfig] =
    useState<AgendaBiometricosConfigRecord | null>(null);
  const [avance4a5Loading, setAvance4a5Loading] = useState(false);
  const [avance4a5Error, setAvance4a5Error] = useState<string | null>(null);
  const [avance4a5Success, setAvance4a5Success] = useState<string | null>(null);
  const [avance5a6Loading, setAvance5a6Loading] = useState(false);
  const [avance5a6Error, setAvance5a6Error] = useState<string | null>(null);
  const [avance5a6Success, setAvance5a6Success] = useState<string | null>(null);
  const [avance6a7Loading, setAvance6a7Loading] = useState(false);
  const [avance6a7Error, setAvance6a7Error] = useState<string | null>(null);
  const [avance6a7Success, setAvance6a7Success] = useState<string | null>(null);
  const [avance7a8Loading, setAvance7a8Loading] = useState(false);
  const [avance7a8Error, setAvance7a8Error] = useState<string | null>(null);
  const [avance7a8Success, setAvance7a8Success] = useState<string | null>(null);
  const [avance8a9Loading, setAvance8a9Loading] = useState(false);
  const [avance8a9Error, setAvance8a9Error] = useState<string | null>(null);
  const [avance8a9Success, setAvance8a9Success] = useState<string | null>(null);
  const [activeFirmasBooking, setActiveFirmasBooking] =
    useState<AgendaFirmasActiveBooking | null>(null);
  const [firmasConfig, setFirmasConfig] = useState<AgendaFirmasConfigRecord | null>(null);
  const [avance9a10Loading, setAvance9a10Loading] = useState(false);
  const [avance9a10Error, setAvance9a10Error] = useState<string | null>(null);
  const [avance9a10Success, setAvance9a10Success] = useState<string | null>(null);
  const [cancelCitaKind, setCancelCitaKind] = useState<MesaAgendaCancelKind | null>(null);
  const [cancelCitaSaving, setCancelCitaSaving] = useState(false);
  const [cancelCitaError, setCancelCitaError] = useState<string | null>(null);
  const [biometricosCancelSuccess, setBiometricosCancelSuccess] = useState<string | null>(null);
  const [biometricosCancelledMotivo, setBiometricosCancelledMotivo] = useState<string | null>(null);
  const [notificacionCancelSuccess, setNotificacionCancelSuccess] = useState<string | null>(null);
  const [notificacionCancelledMotivo, setNotificacionCancelledMotivo] = useState<string | null>(null);
  const [notificacionAgendadoPorLabel, setNotificacionAgendadoPorLabel] = useState("—");
  const [cancelFirmasSuccess, setCancelFirmasSuccess] = useState<string | null>(null);
  const [firmasCancelledMotivo, setFirmasCancelledMotivo] = useState<string | null>(null);
  const [mesaOps, setMesaOps] = useState<MesaExpedienteOpsRow | null>(null);
  const [mesaOpsUserId, setMesaOpsUserId] = useState<string | null>(null);
  const [mesaOpsAppRole, setMesaOpsAppRole] = useState<string | null>(null);
  const [cancelacionOperativa, setCancelacionOperativa] =
    useState<ExpedienteCancelacionRow | null>(null);

  const mesaMockRole =
    typeof window !== "undefined" ? getEffectiveMockRole() : null;
  const mesaSessionRole = currentUser?.role ?? null;

  const puedeOperarMesa = puedeRevisarDocumentos(currentUser?.role);
  const cicloOperativoActivo =
    (expediente?.operativo.cicloEstado ?? "activo") === "activo";
  const puedeOperarMesaActivo = puedeOperarMesa && cicloOperativoActivo;
  const expedienteCancelado = esExpedienteCancelado(
    expediente?.operativo.cicloEstado,
  );
  const firmasMesaUiAccess = getMesaFirmasUiAccess({
    role: mesaOpsAppRole ?? mesaSessionRole ?? mesaMockRole,
    etapaActual: expediente?.operativo.etapaActual ?? null,
    hasActiveBooking: activeFirmasBooking != null,
  });

  useEffect(() => {
    if (!mesaOpsRepo) {
      setMesaOpsUserId(null);
      setMesaOpsAppRole(null);
      return;
    }
    void mesaOpsRepo.resolveCurrentUserId().then(setMesaOpsUserId);
    void mesaOpsRepo.resolveCurrentUserAppRole().then(setMesaOpsAppRole);
  }, [mesaOpsRepo]);

  useEffect(() => {
    if (!routeExpedienteId || loadState !== "ready") return;
    recordMesaExpedienteOpened(routeExpedienteId, mesaOpsUserId);
  }, [loadState, mesaOpsUserId, routeExpedienteId]);

  const load = useCallback(() => {
    if (!routeExpedienteId || !currentUser) return;
    void (async () => {
      setLoadState("loading");
      setErrorMsg(null);
      try {
        const exp = await expedientesRepo.getById(routeExpedienteId);
        if (!exp) {
          setExpediente(null);
          setClienteDatos(null);
        setArchivosResumen([]);
        setArchivosLista([]);
        setActiveBiometricBooking(null);
        setActiveNotificacionBooking(null);
        setBiometricosConfig(null);
        setActiveFirmasBooking(null);
        setFirmasConfig(null);
        setCancelacionOperativa(null);
        setLoadState("not_found");
          return;
        }

        const [datos, archivos, lista, booking, notificacionBooking, bioConfig, firmasBooking, firmasCfg, bioCancelled, firmasCancelled, cancelacion] =
          await Promise.all([
          clienteDatosRepo.getByExpedienteId(routeExpedienteId).catch(() => null),
          archivosRepo.listResumenByExpediente(routeExpedienteId).catch(() => []),
          archivosRepo.listByExpediente(routeExpedienteId).catch(() => []),
          agendaBookingRepo
            ? agendaBookingRepo.getActiveBooking(routeExpedienteId).catch(() => null)
            : Promise.resolve(null),
          agendaBookingRepo
            ? agendaBookingRepo.getActiveNotificacionBooking(routeExpedienteId).catch(() => null)
            : Promise.resolve(null),
          agendaBookingRepo
            ? agendaBookingRepo.getBiometricosConfig().catch(() => null)
            : Promise.resolve(null),
          firmasBookingRepo
            ? firmasBookingRepo.getActiveBooking(routeExpedienteId).catch(() => null)
            : Promise.resolve(null),
          firmasBookingRepo
            ? firmasBookingRepo.getFirmasConfig().catch(() => null)
            : Promise.resolve(null),
          agendaBookingRepo
            ? agendaBookingRepo.getLastCancelledBooking(routeExpedienteId).catch(() => null)
            : Promise.resolve(null),
          firmasBookingRepo
            ? firmasBookingRepo.getLastCancelledBooking(routeExpedienteId).catch(() => null)
            : Promise.resolve(null),
          exp.operativo.cicloEstado === "cancelado"
            ? expedientesRepo
                .getUltimaCancelacionOperativa(routeExpedienteId)
                .catch(() => null)
            : Promise.resolve(null),
        ]);

        setExpediente(exp);
        setClienteDatos(datos);
        setArchivosResumen(archivos);
        setArchivosLista(lista);
        setActiveBiometricBooking(booking);
        setActiveNotificacionBooking(notificacionBooking);
        setBiometricosConfig(bioConfig);
        setActiveFirmasBooking(firmasBooking);
        setFirmasConfig(firmasCfg);
        setCancelacionOperativa(cancelacion);
        if (mesaOpsRepo) {
          try {
            const opsRow = await mesaOpsRepo.getByExpedienteId(routeExpedienteId);
            setMesaOps(opsRow);
          } catch {
            setMesaOps(null);
          }
        } else {
          setMesaOps(null);
        }
        setBiometricosCancelledMotivo(
          booking
            ? null
            : parseCancelMotivoFromNote(bioCancelled?.note ?? null),
        );
        setFirmasCancelledMotivo(
          firmasBooking
            ? null
            : parseCancelMotivoFromNote(firmasCancelled?.note ?? null),
        );
        setLoadState("ready");
      } catch (err) {
        setExpediente(null);
        setClienteDatos(null);
        setArchivosResumen([]);
        setArchivosLista([]);
        setActiveBiometricBooking(null);
        setActiveNotificacionBooking(null);
        setBiometricosConfig(null);
        setActiveFirmasBooking(null);
        setFirmasConfig(null);
        setBiometricosCancelledMotivo(null);
        setFirmasCancelledMotivo(null);
        setCancelacionOperativa(null);
        setLoadState("error");
        if (err instanceof ExpedientesSupabaseError) {
          setErrorMsg(err.message);
        } else {
          setErrorMsg("No se pudo cargar el expediente.");
        }
      }
    })();
  }, [
    archivosRepo,
    agendaBookingRepo,
    firmasBookingRepo,
    clienteDatosRepo,
    currentUser,
    expedientesRepo,
    mesaOpsRepo,
    routeExpedienteId,
  ]);

  useEffect(() => {
    if (!currentUser) return;
    load();
  }, [currentUser, load]);

  useEffect(() => {
    const createdById = activeNotificacionBooking?.createdById?.trim();
    if (!createdById || !isSupabaseConfigured() || !supabaseBrowser) {
      setNotificacionAgendadoPorLabel("—");
      return;
    }
    void (async () => {
      const { data } = await supabaseBrowser.rpc("get_asesor_display_batch", {
        p_asesor_ids: [createdById],
      });
      const row = (data ?? [])[0] as
        | { full_name?: string | null; email?: string | null; asesor_id?: string }
        | undefined;
      if (!row) {
        setNotificacionAgendadoPorLabel("—");
        return;
      }
      setNotificacionAgendadoPorLabel(
        resolveProfileDisplayLabel({
          fullName: row.full_name,
          email: row.email,
          fallbackId: row.asesor_id ?? createdById,
        }),
      );
    })();
  }, [activeNotificacionBooking?.createdById]);

  const documentosAsesor = useMemo(
    () => buildMesaIntegrationDocViews(archivosResumen, archivosLista),
    [archivosLista, archivosResumen],
  );

  const documentosComplementarios = useMemo(
    () => buildMesaComplementariosDocViews(archivosResumen, archivosLista),
    [archivosLista, archivosResumen],
  );

  const mesaUploadLabelByTipo = useMemo(() => {
    const map: Record<string, string> = {};
    for (const doc of documentosComplementarios) {
      map[doc.tipo_documento] = doc.label;
    }
    return map;
  }, [documentosComplementarios]);

  const refreshRetencionMeta = useCallback(async () => {
    if (!retencionRepo || !routeExpedienteId) return;
    try {
      const [opcion, envio] = await Promise.all([
        retencionRepo.getOpcionByExpedienteId(routeExpedienteId),
        retencionRepo.getEnvioByExpedienteId(routeExpedienteId),
      ]);
      setRetencionOpcion(opcion?.retencion_opcion ?? null);
      setRetencionEnvio(envio);
    } catch {
      setRetencionOpcion(null);
      setRetencionEnvio(null);
    }
  }, [retencionRepo, routeExpedienteId]);

  useEffect(() => {
    if (!retencionRepo || !routeExpedienteId) return;
    void refreshRetencionMeta();
  }, [retencionRepo, routeExpedienteId, refreshRetencionMeta]);

  const mostrarRetencionMesa = mostrarMesaRetencionConsulta({
    etapaActual: expediente?.operativo.etapaActual,
    tieneRetencionMeta: Boolean(retencionOpcion || retencionEnvio),
  });

  const retencionOpcionMesa = useMemo(
    () => retencionOpcionMesaEfectiva(retencionEnvio, retencionOpcion),
    [retencionEnvio, retencionOpcion],
  );

  const retencionDocumentos = useMemo(
    () => buildMesaRetencionDocViews(retencionOpcionMesa, archivosResumen, archivosLista),
    [retencionOpcionMesa, archivosResumen, archivosLista],
  );

  const retencionEnvioUiEstado = useMemo(
    () => retencionEnvioEstadoEfectivo(retencionEnvio, archivosResumen, retencionOpcion),
    [retencionEnvio, archivosResumen, retencionOpcion],
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
        retencion_enviado_a_mesa: Boolean(retencionEnvio?.enviado),
      }),
    [retencionOpcionMesa, archivosResumen, retencionEnvio],
  );

  const closePreview = useCallback(() => {
    setPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  const mapArchivoError = useCallback((err: unknown): string => {
    if (err instanceof ExpedienteArchivosSupabaseError) return err.message;
    return "No se pudo abrir el archivo. Intenta de nuevo.";
  }, []);

  const fetchArchivoBlob = useCallback(
    async (archivo: ExpedienteArchivoResumen) => {
      if (!archivo.id) {
        throw new ExpedienteArchivosSupabaseError(
          "No tienes acceso a este documento o no existe.",
        );
      }
      return archivosRepo.getArchivoBlob(archivo.id);
    },
    [archivosRepo],
  );

  const handleVerArchivo = useCallback(
    async (tipo: IntegrationDocAsesorUploadTipo, archivo: ExpedienteArchivoResumen) => {
      if (!archivo.id || !archivo.mime_type) return;
      setArchivoLoadingTipo(tipo);
      setArchivoErrorByTipo((prev) => {
        const next = { ...prev };
        delete next[tipo];
        return next;
      });
      try {
        const blob = await fetchArchivoBlob(archivo);
        const url = URL.createObjectURL(blob);
        setPreview((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return {
            url,
            mime_type: archivo.mime_type as string,
            nombre_original: archivo.nombre_original ?? "archivo",
          };
        });
      } catch (err) {
        setArchivoErrorByTipo((prev) => ({
          ...prev,
          [tipo]: mapArchivoError(err),
        }));
      } finally {
        setArchivoLoadingTipo(null);
      }
    },
    [fetchArchivoBlob, mapArchivoError],
  );

  const handleDescargarArchivo = useCallback(
    async (tipo: IntegrationDocAsesorUploadTipo, archivo: ExpedienteArchivoResumen) => {
      if (!archivo.id || !archivo.nombre_original) return;
      setArchivoLoadingTipo(tipo);
      setArchivoErrorByTipo((prev) => {
        const next = { ...prev };
        delete next[tipo];
        return next;
      });
      try {
        const blob = await fetchArchivoBlob(archivo);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = archivo.nombre_original;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (err) {
        setArchivoErrorByTipo((prev) => ({
          ...prev,
          [tipo]: mapArchivoError(err),
        }));
      } finally {
        setArchivoLoadingTipo(null);
      }
    },
    [fetchArchivoBlob, mapArchivoError],
  );

  const refreshArchivos = useCallback(async () => {
    const [archivos, lista] = await Promise.all([
      archivosRepo.listResumenByExpediente(routeExpedienteId).catch(() => []),
      archivosRepo.listByExpediente(routeExpedienteId).catch(() => []),
    ]);
    setArchivosResumen(archivos);
    setArchivosLista(lista);
  }, [archivosRepo, routeExpedienteId]);

  const persistRevision = useCallback(
    async (
      tipo: string,
      documentoId: string,
      estatus: EstatusRevision,
      comentario_mesa: string | null,
    ): Promise<boolean> => {
      setRevisionSavingTipo(tipo);
      setRevisionErrorByTipo((prev) => {
        const next = { ...prev };
        delete next[tipo];
        return next;
      });
      try {
        await archivosRepo.updateRevision(documentoId, {
          estatus_revision: estatus,
          comentario_mesa,
        });
        await refreshArchivos();
        if (tipo.startsWith("retencion_")) {
          await refreshRetencionMeta();
        }
        return true;
      } catch (err) {
        setRevisionErrorByTipo((prev) => ({
          ...prev,
          [tipo]:
            err instanceof ExpedienteArchivosSupabaseError
              ? err.message
              : "No se pudo guardar la revisión del documento.",
        }));
        return false;
      } finally {
        setRevisionSavingTipo(null);
      }
    },
    [archivosRepo, refreshArchivos, refreshRetencionMeta],
  );

  const handleValidarDocumento = useCallback(
    async (tipo: IntegrationDocAsesorUploadTipo, documentoId: string) => {
      await persistRevision(tipo, documentoId, "validado", null);
    },
    [persistRevision],
  );

  const handleGuardarRechazo = useCallback(
    async (
      tipo: IntegrationDocAsesorUploadTipo,
      documentoId: string,
      comentario: string,
    ): Promise<boolean> => {
      return persistRevision(tipo, documentoId, "rechazado", comentario);
    },
    [persistRevision],
  );

  const handleVerRetencionDoc = useCallback(
    async (tipo: RetencionTipoDocumento, archivo: ExpedienteArchivoResumen) => {
      if (!archivo.id || !archivo.mime_type) return;
      setRetencionArchivoLoadingTipo(tipo);
      setArchivoErrorByTipo((prev) => {
        const next = { ...prev };
        delete next[tipo];
        return next;
      });
      try {
        const blob = await fetchArchivoBlob(archivo);
        const url = URL.createObjectURL(blob);
        setPreview((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return {
            url,
            mime_type: archivo.mime_type as string,
            nombre_original: archivo.nombre_original ?? "archivo",
          };
        });
      } catch (err) {
        setArchivoErrorByTipo((prev) => ({
          ...prev,
          [tipo]: mapArchivoError(err),
        }));
      } finally {
        setRetencionArchivoLoadingTipo(null);
      }
    },
    [fetchArchivoBlob, mapArchivoError],
  );

  const handleDescargarRetencionDoc = useCallback(
    async (tipo: RetencionTipoDocumento, archivo: ExpedienteArchivoResumen) => {
      if (!archivo.id || !archivo.nombre_original) return;
      setRetencionArchivoLoadingTipo(tipo);
      setArchivoErrorByTipo((prev) => {
        const next = { ...prev };
        delete next[tipo];
        return next;
      });
      try {
        const blob = await fetchArchivoBlob(archivo);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = archivo.nombre_original;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (err) {
        setArchivoErrorByTipo((prev) => ({
          ...prev,
          [tipo]: mapArchivoError(err),
        }));
      } finally {
        setRetencionArchivoLoadingTipo(null);
      }
    },
    [fetchArchivoBlob, mapArchivoError],
  );

  const handleValidarRetencionDocumento = useCallback(
    async (tipo: RetencionTipoDocumento, documentoId: string) => {
      await persistRevision(tipo, documentoId, "validado", null);
    },
    [persistRevision],
  );

  const handleGuardarRechazoRetencion = useCallback(
    async (
      tipo: RetencionTipoDocumento,
      documentoId: string,
      comentario: string,
    ): Promise<boolean> => {
      return persistRevision(tipo, documentoId, "rechazado", comentario);
    },
    [persistRevision],
  );


  const handleVerComplementario = useCallback(
    async (tipo: IntegrationDocMesaUploadTipo, archivo: ExpedienteArchivoResumen) => {
      if (!archivo.id || !archivo.mime_type) return;
      setComplementarioArchivoLoadingTipo(tipo);
      setComplementarioArchivoErrorByTipo((prev) => {
        const next = { ...prev };
        delete next[tipo];
        return next;
      });
      try {
        const blob = await fetchArchivoBlob(archivo);
        const url = URL.createObjectURL(blob);
        setPreview((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return {
            url,
            mime_type: archivo.mime_type as string,
            nombre_original: archivo.nombre_original ?? "archivo",
          };
        });
      } catch (err) {
        setComplementarioArchivoErrorByTipo((prev) => ({
          ...prev,
          [tipo]: mapArchivoError(err),
        }));
      } finally {
        setComplementarioArchivoLoadingTipo(null);
      }
    },
    [fetchArchivoBlob, mapArchivoError],
  );

  const handleDescargarComplementario = useCallback(
    async (tipo: IntegrationDocMesaUploadTipo, archivo: ExpedienteArchivoResumen) => {
      if (!archivo.id || !archivo.nombre_original) return;
      setComplementarioArchivoLoadingTipo(tipo);
      setComplementarioArchivoErrorByTipo((prev) => {
        const next = { ...prev };
        delete next[tipo];
        return next;
      });
      try {
        const blob = await fetchArchivoBlob(archivo);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = archivo.nombre_original;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (err) {
        setComplementarioArchivoErrorByTipo((prev) => ({
          ...prev,
          [tipo]: mapArchivoError(err),
        }));
      } finally {
        setComplementarioArchivoLoadingTipo(null);
      }
    },
    [fetchArchivoBlob, mapArchivoError],
  );

  const persistMesaUpload = useCallback(
    async (
      tipo: IntegrationDocMesaUploadTipo,
      file: File,
      mode: "upload" | "replace",
    ): Promise<void> => {
      const pdfValidation = validatePdfFile(file);
      if (!pdfValidation.ok) {
        const label = mesaUploadLabelByTipo[tipo] ?? "Documento";
        setUploadErrorByTipo((prev) => ({
          ...prev,
          [tipo]: formatPdfUploadRejectionForField(label, file),
        }));
        return;
      }

      setUploadLoadingTipo(tipo);
      setUploadErrorByTipo((prev) => {
        const next = { ...prev };
        delete next[tipo];
        return next;
      });
      try {
        if (mode === "upload") {
          await archivosRepo.uploadMesaDocumento({
            expedienteId: routeExpedienteId,
            tipo_documento: tipo,
            file,
          });
        } else {
          await archivosRepo.replaceMesaDocumento({
            expedienteId: routeExpedienteId,
            tipo_documento: tipo,
            file,
          });
        }
        await refreshArchivos();
      } catch (err) {
        setUploadErrorByTipo((prev) => ({
          ...prev,
          [tipo]:
            err instanceof ExpedienteArchivosSupabaseError
              ? err.message
              : "No se pudo subir el documento.",
        }));
      } finally {
        setUploadLoadingTipo(null);
      }
    },
    [archivosRepo, mesaUploadLabelByTipo, refreshArchivos, routeExpedienteId],
  );

  const handleSubirComplementario = useCallback(
    async (tipo: IntegrationDocMesaUploadTipo, file: File) => {
      await persistMesaUpload(tipo, file, "upload");
    },
    [persistMesaUpload],
  );

  const handleReemplazarComplementario = useCallback(
    async (tipo: IntegrationDocMesaUploadTipo, file: File) => {
      await persistMesaUpload(tipo, file, "replace");
    },
    [persistMesaUpload],
  );

  const handleValidarClienteDatos = useCallback(async (): Promise<boolean> => {
    if (!routeExpedienteId || !currentUser?.email || !clienteDatos) return false;
    setClienteDatosSaving(true);
    setClienteDatosRevisionError(null);
    try {
      const updated = await clienteDatosRepo.updateEstado({
        expedienteId: routeExpedienteId,
        estado: "validado",
        updatedBy: currentUser.email,
      });
      if (updated) setClienteDatos(updated);
      return true;
    } catch (err) {
      setClienteDatosRevisionError(
        err instanceof ClienteDatosSupabaseError
          ? err.message
          : "No se pudo validar los datos generales.",
      );
      return false;
    } finally {
      setClienteDatosSaving(false);
    }
  }, [clienteDatos, clienteDatosRepo, currentUser?.email, routeExpedienteId]);

  const handleRechazarClienteDatos = useCallback(
    async (comentario: string): Promise<boolean> => {
      if (!routeExpedienteId || !currentUser?.email || !clienteDatos) return false;
      setClienteDatosSaving(true);
      setClienteDatosRevisionError(null);
      try {
        const updated = await clienteDatosRepo.updateEstado({
          expedienteId: routeExpedienteId,
          estado: "rechazado",
          updatedBy: currentUser.email,
          comentarioRechazo: comentario,
        });
        if (updated) setClienteDatos(updated);
        return true;
      } catch (err) {
        setClienteDatosRevisionError(
          err instanceof ClienteDatosSupabaseError
            ? err.message
            : "No se pudo rechazar los datos generales.",
        );
        return false;
      } finally {
        setClienteDatosSaving(false);
      }
    },
    [clienteDatos, clienteDatosRepo, currentUser?.email, routeExpedienteId],
  );

  const continuarContext = useMemo(
    () => ({
      submittedToMesa: expediente?.operativo.submittedToMesa ?? false,
      cicloEstado: expediente?.operativo.cicloEstado,
      etapaActual: expediente?.operativo.etapaActual ?? null,
      subestado: expediente?.operativo.subestado,
      clienteDatosEstado: clienteDatos?.estado ?? null,
      archivosResumen,
    }),
    [archivosResumen, clienteDatos?.estado, expediente],
  );

  const cierreValidacionView = useMemo(
    () => deriveCierreValidacionDocumentalView(continuarContext),
    [continuarContext],
  );

  const mostrarPanelClienteDatos = mostrarMesaClienteDatosConsulta();

  const mostrarPanelIntegracionDocs = mostrarMesaIntegracionDocsConsulta();

  const avanceOperativoContext = useMemo(
    () => ({
      submittedToMesa: expediente?.operativo.submittedToMesa ?? false,
      cicloEstado: expediente?.operativo.cicloEstado,
      etapaActual: expediente?.operativo.etapaActual ?? null,
      subestado: expediente?.operativo.subestado,
    }),
    [expediente],
  );

  const avanceOperativo2a3View = useMemo(
    () => deriveAvanceOperativo2a3View(avanceOperativoContext),
    [avanceOperativoContext],
  );

  const avanceOperativo3a5Context = useMemo(
    () => ({
      submittedToMesa: expediente?.operativo.submittedToMesa ?? false,
      cicloEstado: expediente?.operativo.cicloEstado,
      etapaActual: expediente?.operativo.etapaActual ?? null,
      subestado: expediente?.operativo.subestado,
      fechaCita: expediente?.operativo.fechaCita ?? null,
      hasActiveBiometricBooking: activeBiometricBooking != null,
      hasActiveNotificacionBooking: activeNotificacionBooking != null,
    }),
    [activeBiometricBooking, activeNotificacionBooking, expediente],
  );

  const avanceOperativo3a5View = useMemo(
    () => deriveAvanceOperativo3a5View(avanceOperativo3a5Context),
    [avanceOperativo3a5Context],
  );

  const biometricLocationLabel = useMemo(() => {
    if (!activeBiometricBooking) return null;
    const loc = biometricosConfig?.config.locations.find(
      (l) => l.id === activeBiometricBooking.locationId,
    );
    return loc?.label ?? activeBiometricBooking.locationId;
  }, [activeBiometricBooking, biometricosConfig]);

  const avanceOperativo4a5Context = useMemo(
    () => ({
      submittedToMesa: expediente?.operativo.submittedToMesa ?? false,
      cicloEstado: expediente?.operativo.cicloEstado,
      etapaActual: expediente?.operativo.etapaActual ?? null,
      subestado: expediente?.operativo.subestado,
      fechaCita: expediente?.operativo.fechaCita ?? null,
      hasActiveBiometricBooking: activeBiometricBooking != null,
    }),
    [activeBiometricBooking, expediente],
  );

  const avanceOperativo4a5View = useMemo(
    () => deriveAvanceOperativo4a5View(avanceOperativo4a5Context),
    [avanceOperativo4a5Context],
  );

  const avanceOperativo5a6Context = useMemo(
    () => ({
      submittedToMesa: expediente?.operativo.submittedToMesa ?? false,
      cicloEstado: expediente?.operativo.cicloEstado,
      etapaActual: expediente?.operativo.etapaActual ?? null,
      subestado: expediente?.operativo.subestado,
      fechaCita: expediente?.operativo.fechaCita ?? null,
      hasActiveBiometricBooking: activeBiometricBooking != null,
    }),
    [activeBiometricBooking, expediente],
  );

  const avanceOperativo5a6View = useMemo(
    () => deriveAvanceOperativo5a6View(avanceOperativo5a6Context),
    [avanceOperativo5a6Context],
  );

  const avanceOperativo6a7View = useMemo(
    () => deriveAvanceOperativo6a7View(avanceOperativoContext),
    [avanceOperativoContext],
  );

  const avanceOperativo7a8View = useMemo(
    () => deriveAvanceOperativo7a8View(avanceOperativoContext),
    [avanceOperativoContext],
  );

  const avanceOperativo8a9Context = useMemo(
    () => ({
      submittedToMesa: expediente?.operativo.submittedToMesa ?? false,
      cicloEstado: expediente?.operativo.cicloEstado,
      etapaActual: expediente?.operativo.etapaActual ?? null,
      subestado: expediente?.operativo.subestado,
      clienteDatosEstado: clienteDatos?.estado ?? null,
      archivosResumen,
      retencionOpcion: retencionOpcionMesa,
      retencionEnviadoAMesa: Boolean(retencionEnvio?.enviado),
      retencionEnvioEstado: retencionEnvio?.estado ?? null,
    }),
    [
      archivosResumen,
      clienteDatos?.estado,
      expediente,
      retencionEnvio,
      retencionOpcionMesa,
    ],
  );

  const avanceOperativo8a9View = useMemo(
    () => deriveAvanceOperativo8a9View(avanceOperativo8a9Context),
    [avanceOperativo8a9Context],
  );

  const firmasLocationLabel = useMemo(() => {
    if (!activeFirmasBooking) return null;
    const loc = firmasConfig?.config.locations.find(
      (l) => l.id === activeFirmasBooking.locationId,
    );
    return loc?.label ?? activeFirmasBooking.locationId;
  }, [activeFirmasBooking, firmasConfig]);

  const avanceOperativo9a10Context = useMemo(
    () => ({
      submittedToMesa: expediente?.operativo.submittedToMesa ?? false,
      cicloEstado: expediente?.operativo.cicloEstado,
      etapaActual: expediente?.operativo.etapaActual ?? null,
      subestado: expediente?.operativo.subestado,
      fechaCita: expediente?.operativo.fechaCita ?? null,
      hasActiveFirmasBooking: activeFirmasBooking != null,
    }),
    [activeFirmasBooking, expediente],
  );

  const avanceOperativo9a10View = useMemo(
    () => deriveAvanceOperativo9a10View(avanceOperativo9a10Context),
    [avanceOperativo9a10Context],
  );

  const bioCancelCitaGate = useMemo((): MesaAvanceCancelCitaGate | null => {
    if (!expediente) return null;
    const etapa = expediente.operativo.etapaActual ?? null;
    if (etapa !== 3 && etapa !== 4 && etapa !== 5) return null;
    return {
      kind: "biometricos",
      mockRole: mesaMockRole,
      sessionRole: mesaSessionRole,
      submittedToMesa: expediente.operativo.submittedToMesa ?? false,
      subestado: expediente.operativo.subestado ?? null,
      cicloEstado: expediente.operativo.cicloEstado ?? null,
      etapaActual: etapa,
      hasActiveBooking: activeBiometricBooking != null,
      fechaCita: expediente.operativo.fechaCita ?? null,
      success: biometricosCancelSuccess,
      cancelledMotivo: biometricosCancelledMotivo,
      onRequest: () => {
        setCancelCitaError(null);
        setCancelCitaKind("biometricos");
      },
    };
  }, [
    activeBiometricBooking,
    biometricosCancelSuccess,
    biometricosCancelledMotivo,
    expediente,
    mesaMockRole,
    mesaSessionRole,
  ]);

  const notificacionCancelCitaGate = useMemo((): MesaAvanceCancelCitaGate | null => {
    if (!expediente) return null;
    const etapa = expediente.operativo.etapaActual ?? null;
    if (etapa !== 3) return null;
    return {
      kind: "notificacion",
      mockRole: mesaMockRole,
      sessionRole: mesaSessionRole,
      submittedToMesa: expediente.operativo.submittedToMesa ?? false,
      subestado: expediente.operativo.subestado ?? null,
      cicloEstado: expediente.operativo.cicloEstado ?? null,
      etapaActual: etapa,
      hasActiveBooking: activeNotificacionBooking != null,
      fechaCita: expediente.operativo.fechaCita ?? null,
      success: notificacionCancelSuccess,
      cancelledMotivo: notificacionCancelledMotivo,
      onRequest: () => {
        setCancelCitaError(null);
        setCancelCitaKind("notificacion");
      },
    };
  }, [
    activeNotificacionBooking,
    expediente,
    mesaMockRole,
    mesaSessionRole,
    notificacionCancelSuccess,
    notificacionCancelledMotivo,
  ]);

  const firmasCancelCitaGate = useMemo((): MesaAvanceCancelCitaGate | null => {
    if (!expediente) return null;
    const etapa = expediente.operativo.etapaActual ?? null;
    if (etapa !== 9 && etapa !== 10) return null;
    return {
      kind: "firmas",
      mockRole: mesaMockRole,
      sessionRole: mesaSessionRole,
      submittedToMesa: expediente.operativo.submittedToMesa ?? false,
      subestado: expediente.operativo.subestado ?? null,
      cicloEstado: expediente.operativo.cicloEstado ?? null,
      etapaActual: etapa,
      hasActiveBooking: activeFirmasBooking != null,
      fechaCita: expediente.operativo.fechaCita ?? null,
      success: cancelFirmasSuccess,
      cancelledMotivo: firmasCancelledMotivo,
      onRequest: () => {
        setCancelCitaError(null);
        setCancelCitaKind("firmas");
      },
    };
  }, [
    activeFirmasBooking,
    cancelFirmasSuccess,
    expediente,
    firmasCancelledMotivo,
    mesaMockRole,
    mesaSessionRole,
  ]);

  const firmaEtapa10OperativaView = useMemo(
    () => ({
      mostrar: (expediente?.operativo.etapaActual ?? null) === 10,
      puedeAvanzar: false,
      bloqueos: [] as string[],
    }),
    [expediente?.operativo.etapaActual],
  );

  const handleAvanzarIntegracion = useCallback(async () => {
    if (!routeExpedienteId || !cierreValidacionView.puedeAvanzar) return;
    setContinuarLoading(true);
    setContinuarError(null);
    setContinuarSuccess(null);
    try {
      await expedientesRepo.avanzarEtapaOperativa(routeExpedienteId);
      setContinuarSuccess("Expediente avanzado a etapa 2 (Registro)");
      load();
    } catch (err) {
      setContinuarError(
        err instanceof ExpedientesSupabaseError
          ? err.message
          : "No se pudo avanzar la etapa del expediente.",
      );
    } finally {
      setContinuarLoading(false);
    }
  }, [cierreValidacionView.puedeAvanzar, expedientesRepo, load, routeExpedienteId]);

  const handleAvanzarOperativo2a3 = useCallback(async () => {
    if (!routeExpedienteId || !avanceOperativo2a3View.puedeAvanzar) return;
    setAvance2a3Loading(true);
    setAvance2a3Error(null);
    setAvance2a3Success(null);
    try {
      await expedientesRepo.avanzarEtapaOperativa(routeExpedienteId);
      setAvance2a3Success(
        "Expediente avanzado a etapa 3 (Listo para cita de biométrico)",
      );
      load();
    } catch (err) {
      setAvance2a3Error(
        err instanceof ExpedientesSupabaseError
          ? err.message
          : "No se pudo avanzar la etapa del expediente.",
      );
    } finally {
      setAvance2a3Loading(false);
    }
  }, [avanceOperativo2a3View.puedeAvanzar, expedientesRepo, load, routeExpedienteId]);

  const handleAvanzarOperativo3a5 = useCallback(async () => {
    if (!routeExpedienteId || !avanceOperativo3a5View.puedeAvanzar) return;
    setAvance3a5Loading(true);
    setAvance3a5Error(null);
    setAvance3a5Success(null);
    try {
      await expedientesRepo.avanzarEtapaOperativa(routeExpedienteId);
      setAvance3a5Success(
        "Expediente avanzado a etapa 5 (Biometría — resultado)",
      );
      load();
    } catch (err) {
      setAvance3a5Error(
        err instanceof ExpedientesSupabaseError
          ? err.message
          : "No se pudo avanzar la etapa del expediente.",
      );
    } finally {
      setAvance3a5Loading(false);
    }
  }, [avanceOperativo3a5View.puedeAvanzar, expedientesRepo, load, routeExpedienteId]);

  const handleAvanzarOperativo4a5 = useCallback(async () => {
    if (!routeExpedienteId || !avanceOperativo4a5View.puedeAvanzar) return;
    setAvance4a5Loading(true);
    setAvance4a5Error(null);
    setAvance4a5Success(null);
    try {
      await expedientesRepo.avanzarEtapaOperativa(routeExpedienteId);
      setAvance4a5Success("Expediente avanzado a etapa 5 (Biometría — resultado)");
      load();
    } catch (err) {
      setAvance4a5Error(
        err instanceof ExpedientesSupabaseError
          ? err.message
          : "No se pudo avanzar la etapa del expediente.",
      );
    } finally {
      setAvance4a5Loading(false);
    }
  }, [avanceOperativo4a5View.puedeAvanzar, expedientesRepo, load, routeExpedienteId]);

  const handleAvanzarOperativo5a6 = useCallback(async () => {
    if (!routeExpedienteId || !avanceOperativo5a6View.puedeAvanzar) return;
    setAvance5a6Loading(true);
    setAvance5a6Error(null);
    setAvance5a6Success(null);
    try {
      await expedientesRepo.avanzarEtapaOperativa(routeExpedienteId);
      setAvance5a6Success("Expediente avanzado a etapa 6 (Inscripción)");
      load();
    } catch (err) {
      setAvance5a6Error(
        err instanceof ExpedientesSupabaseError
          ? err.message
          : "No se pudo avanzar la etapa del expediente.",
      );
    } finally {
      setAvance5a6Loading(false);
    }
  }, [avanceOperativo5a6View.puedeAvanzar, expedientesRepo, load, routeExpedienteId]);

  const handleAvanzarOperativo6a7 = useCallback(async () => {
    if (!routeExpedienteId || !avanceOperativo6a7View.puedeAvanzar) return;
    setAvance6a7Loading(true);
    setAvance6a7Error(null);
    setAvance6a7Success(null);
    try {
      await expedientesRepo.avanzarEtapaOperativa(routeExpedienteId);
      setAvance6a7Success("Expediente avanzado a etapa 7 (Notificación)");
      load();
    } catch (err) {
      setAvance6a7Error(
        err instanceof ExpedientesSupabaseError
          ? err.message
          : "No se pudo avanzar la etapa del expediente.",
      );
    } finally {
      setAvance6a7Loading(false);
    }
  }, [avanceOperativo6a7View.puedeAvanzar, expedientesRepo, load, routeExpedienteId]);

  const handleAvanzarOperativo7a8 = useCallback(async () => {
    if (!routeExpedienteId || !avanceOperativo7a8View.puedeAvanzar) return;
    setAvance7a8Loading(true);
    setAvance7a8Error(null);
    setAvance7a8Success(null);
    try {
      await expedientesRepo.avanzarEtapaOperativa(routeExpedienteId);
      setAvance7a8Success("Expediente avanzado a etapa 8 (Acuse / Aviso de retención)");
      load();
    } catch (err) {
      setAvance7a8Error(
        err instanceof ExpedientesSupabaseError
          ? err.message
          : "No se pudo avanzar la etapa del expediente.",
      );
    } finally {
      setAvance7a8Loading(false);
    }
  }, [avanceOperativo7a8View.puedeAvanzar, expedientesRepo, load, routeExpedienteId]);

  const handleAvanzarOperativo8a9 = useCallback(async () => {
    if (!routeExpedienteId || !avanceOperativo8a9View.puedeAvanzar) return;
    setAvance8a9Loading(true);
    setAvance8a9Error(null);
    setAvance8a9Success(null);
    try {
      await expedientesRepo.avanzarEtapaOperativa(routeExpedienteId);
      setAvance8a9Success("Expediente avanzado a etapa 9 (Agenda de firma)");
      load();
      void refreshRetencionMeta();
    } catch (err) {
      setAvance8a9Error(
        err instanceof ExpedientesSupabaseError
          ? err.message
          : "No se pudo avanzar la etapa del expediente.",
      );
    } finally {
      setAvance8a9Loading(false);
    }
  }, [
    avanceOperativo8a9View.puedeAvanzar,
    expedientesRepo,
    load,
    refreshRetencionMeta,
    routeExpedienteId,
  ]);

  const handleAvanzarOperativo9a10 = useCallback(async () => {
    if (!routeExpedienteId || !avanceOperativo9a10View.puedeAvanzar) return;
    setAvance9a10Loading(true);
    setAvance9a10Error(null);
    setAvance9a10Success(null);
    try {
      await expedientesRepo.avanzarEtapaOperativa(routeExpedienteId);
      setAvance9a10Success("Expediente avanzado a etapa 10 (Cita para firma)");
      load();
    } catch (err) {
      setAvance9a10Error(
        err instanceof ExpedientesSupabaseError
          ? err.message
          : "No se pudo avanzar la etapa del expediente.",
      );
    } finally {
      setAvance9a10Loading(false);
    }
  }, [
    avanceOperativo9a10View.puedeAvanzar,
    expedientesRepo,
    load,
    routeExpedienteId,
  ]);

  const handleConfirmCancelCita = useCallback(
    async (motivo: string) => {
      if (!routeExpedienteId || !cancelCitaKind) return;
      setCancelCitaSaving(true);
      setCancelCitaError(null);
      const successMsg = MESA_CANCEL_SUCCESS_MESSAGE;
      try {
        if (cancelCitaKind === "firmas") {
          if (!firmasBookingRepo) return;
          await firmasBookingRepo.mesaCancelFirmas({
            expedienteId: routeExpedienteId,
            motivo,
          });
          setCancelFirmasSuccess(successMsg);
          setFirmasCancelledMotivo(motivo);
        } else if (cancelCitaKind === "notificacion") {
          if (!agendaBookingRepo) return;
          await agendaBookingRepo.cancelNotificacionEtapa3({
            expedienteId: routeExpedienteId,
            motivo,
          });
          setNotificacionCancelSuccess(successMsg);
          setNotificacionCancelledMotivo(motivo);
        } else {
          if (!agendaBookingRepo) return;
          await agendaBookingRepo.cancelBiometricos({
            expedienteId: routeExpedienteId,
            motivo,
          });
          setBiometricosCancelSuccess(successMsg);
          setBiometricosCancelledMotivo(motivo);
        }
        setCancelCitaKind(null);
        load();
      } catch (err) {
        if (cancelCitaKind === "firmas") {
          setCancelCitaError(
            err instanceof AgendaFirmasSupabaseError
              ? err.message
              : "No se pudo cancelar la cita de firma.",
          );
        } else if (cancelCitaKind === "notificacion") {
          setCancelCitaError(
            err instanceof AgendaBiometricosSupabaseError
              ? err.message
              : "No se pudo cancelar la notificación.",
          );
        } else {
          setCancelCitaError(
            err instanceof AgendaBiometricosSupabaseError
              ? err.message
              : "No se pudo cancelar la cita biométrica.",
          );
        }
      } finally {
        setCancelCitaSaving(false);
      }
    },
    [agendaBookingRepo, cancelCitaKind, firmasBookingRepo, load, routeExpedienteId],
  );

  const cancelCitaKindLabel =
    cancelCitaKind === "firmas"
      ? "Cita de firma"
      : cancelCitaKind === "notificacion"
        ? "Notificación"
        : "Cita biométrica";

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

  if (loadState === "loading") {
    return (
      <MesaDetalleShell>
        <p className="text-gray-500">Cargando expediente...</p>
      </MesaDetalleShell>
    );
  }

  if (loadState === "not_found") {
    return (
      <MesaDetalleShell>
        <p
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950"
        >
          No tienes acceso a este expediente o no existe.
        </p>
        <Link href="/mesa-control" className="mt-4 inline-block">
          <Button variant="secondary">Volver a Mesa de control</Button>
        </Link>
      </MesaDetalleShell>
    );
  }

  if (loadState === "error") {
    return (
      <MesaDetalleShell>
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {errorMsg ?? "Error al cargar el expediente."}
        </p>
        <Link href="/mesa-control" className="mt-4 inline-block">
          <Button variant="secondary">Volver a Mesa de control</Button>
        </Link>
      </MesaDetalleShell>
    );
  }

  if (!expediente) {
    return null;
  }

  const op = expediente.operativo;
  const ed = expediente.editorDecision;
  const etapaActual = op.etapaActual;

  const controlManualEstado = getMesaControlManualEstado({
    role: mesaOpsAppRole ?? mesaSessionRole ?? mesaMockRole,
    submittedToMesa: op.submittedToMesa ?? false,
    cicloEstado: op.cicloEstado ?? null,
    subestado: op.subestado ?? null,
  });
  const mostrarAtajoManual =
    controlManualEstado.visible && controlManualEstado.habilitado;

  const puedeRevisarClienteDatos =
    puedeOperarMesaActivo && mesaPuedeRevisarClienteDatos(etapaActual);
  const puedeRevisarDocsIntegracion =
    puedeOperarMesaActivo && mesaPuedeRevisarDocumentosIntegracion(etapaActual);
  const puedeRevisarRetencion =
    puedeOperarMesaActivo &&
    mesaPuedeRevisarRetencionDocumentos(etapaActual, Boolean(retencionEnvio?.enviado));

  const clienteDatosSummary = buildClienteDatosAccordionSummary({
    tieneDatos: Boolean(clienteDatos),
    estado: clienteDatos?.estado ?? null,
  });
  const documentosSummary = buildIntegracionDocsAccordionSummary(documentosAsesor);
  const complementariosSummary = buildComplementariosAccordionSummary(documentosComplementarios);
  const retencionSummary = buildRetencionAccordionSummary({
    opcion: retencionOpcionMesa,
    envioUiEstado: retencionEnvioUiEstado,
  });
  const agendaSummary = buildAgendaAccordionSummary({
    etapaActual,
    biometricBooking: activeBiometricBooking,
    hasActiveNotificacionBooking: activeNotificacionBooking != null,
    firmasBooking: activeFirmasBooking,
    fechaCita: op.fechaCita,
  });
  const notificacionSummary = buildNotificacionExtraordinariaAccordionSummary(
    activeNotificacionBooking,
  );
  const asesorDueñoLabel = expediente ? formatAsesorLabelFromExpediente(expediente) : "—";
  const editorSummary = `${editorDecisionLabel(ed.decision)}${
    typeof ed.monto_aprobado === "number" && ed.monto_aprobado > 0
      ? ` · ${formatMontoAprobadoVigente(ed.monto_aprobado)}`
      : ""
  }`;

  return (
    <MesaDetalleShell>
      {expedienteCancelado ? (
        <MesaExpedienteCanceladoBanner
          cancelacion={cancelacionOperativa}
          formatDateTime={formatDateTime}
        />
      ) : null}
      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <h2 className="text-sm font-semibold text-gray-900">Resumen del expediente</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <p>
            <span className="font-medium text-gray-900">Cliente:</span>{" "}
            {expediente.base.cliente_nombre || "—"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Programa:</span>{" "}
            {expediente.base.programa}
          </p>
          <p>
            <span className="font-medium text-gray-900">NSS:</span> {expediente.base.nss || "—"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Teléfono:</span>{" "}
            {expediente.base.telefono_cliente || "—"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Asesor:</span>{" "}
            {formatAsesorLabelFromExpediente(expediente)}
          </p>
          <p>
            <span className="font-medium text-gray-900">Monto aprobado:</span>{" "}
            {formatMontoAprobadoVigente(ed.monto_aprobado)}
          </p>
          <p>
            <span className="font-medium text-gray-900">Origen Mesa:</span>{" "}
            {origenMesaLabel(expediente.base.origenMesa)}
          </p>
          <p data-testid="mesa-etapa-actual-label">
            <span className="font-medium text-gray-900">Etapa actual:</span>{" "}
            {typeof op.etapaActual === "number"
              ? formatEtapaMesaLabel(op.etapaActual)
              : "—"}
          </p>
          {typeof op.etapaActual === "number" ? (
            (() => {
              const hint = formatEtapaMesaCorrespondenciaAsesor(op.etapaActual);
              return hint ? (
                <p
                  className="text-xs text-gray-500 sm:col-span-2"
                  data-testid="mesa-etapa-correspondencia-asesor"
                >
                  {hint}
                </p>
              ) : null;
            })()
          ) : null}
          <p>
            <span className="font-medium text-gray-900">Subestado:</span>{" "}
            {subestadoOperativoLabel(op.subestado ?? "pendiente")}
          </p>
          <p>
            <span className="font-medium text-gray-900">Enviado a Mesa:</span>{" "}
            {op.submittedToMesa ? "Sí" : "No"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Fecha envío Mesa:</span>{" "}
            {op.fechaEnvioMesa ? formatDateTime(op.fechaEnvioMesa) : "—"}
          </p>
          <p className="sm:col-span-2">
            <span className="font-medium text-gray-900">Última actualización:</span>{" "}
            {op.updatedAt ? formatDateTime(op.updatedAt) : "—"}
          </p>
        </div>
      </section>

      {mesaOpsRepo ? (
        <MesaExpedienteOpsSection
          expedienteId={routeExpedienteId}
          currentUserId={mesaOpsUserId}
          sessionRole={currentUser?.role ?? null}
          appRole={mesaOpsAppRole}
          mockRoleFallback={mesaMockRole}
          ops={mesaOps}
          onOpsChange={setMesaOps}
        />
      ) : null}

      <MesaAccordionSection
        id="mesa-editor"
        title="Decisión del editor"
        summary={editorSummary}
      >
        <div className="space-y-2 px-4 py-3 text-sm text-gray-600">
          <p>
            <span className="font-medium text-gray-900">Decisión:</span>{" "}
            {editorDecisionLabel(ed.decision)}
          </p>
          <p>
            <span className="font-medium text-gray-900">Monto aprobado:</span>{" "}
            {formatMontoAprobadoVigente(ed.monto_aprobado)}
          </p>
          <p>
            <span className="font-medium text-gray-900">Notas revisión:</span>{" "}
            {ed.notas_revision?.trim() || "—"}
          </p>
        </div>
      </MesaAccordionSection>

      {mostrarPanelClienteDatos ? (
        <MesaAccordionSection
          id="mesa-datos-generales"
          title="Datos generales del cliente"
          summary={clienteDatosSummary}
        >
          {clienteDatos ? (
            <MesaClienteDatosReadOnlySection
              embedded
              clienteDatos={clienteDatos}
              direccionOpcional={expediente.base.direccion_opcional}
              submittedToMesa={op.submittedToMesa}
              formatDateTime={formatDateTime}
              puedeRevisar={puedeRevisarClienteDatos}
              saving={clienteDatosSaving}
              revisionError={clienteDatosRevisionError}
              onValidar={handleValidarClienteDatos}
              onRechazar={handleRechazarClienteDatos}
            />
          ) : (
            <p className="px-4 py-3 text-sm text-gray-500">
              Sin datos generales registrados todavía.
            </p>
          )}
        </MesaAccordionSection>
      ) : null}

      {isProgramaMejoravit(expediente.base.programa) ? (
        <MesaAccordionSection
          id="mesa-monto-mejoravit-actualizado"
          title="Monto actualizado Mejoravit"
          summary="Operativo independiente de Datos Generales"
        >
          <div className="px-2 py-2 sm:px-3">
            <MesaMontoMejoravitActualizadoSection
              expedienteId={routeExpedienteId}
              onParentRefresh={load}
            />
          </div>
        </MesaAccordionSection>
      ) : null}

      <MesaAccordionSection
        id="mesa-pagare"
        title="Pagaré"
        summary={
          typeof etapaActual === "number" && etapaActual < 7
            ? "Disponible después de Inscripción"
            : "Carga y consulta por Mesa Control"
        }
      >
        <MesaPagareSection
          expedienteId={routeExpedienteId}
          etapaActual={etapaActual}
          puedeOperar={puedeOperarMesaActivo}
          submittedToMesa={op.submittedToMesa ?? false}
        />
      </MesaAccordionSection>

      <MesaAccordionSection
        id="mesa-notificacion-documento"
        title="Notificación"
        summary={
          typeof etapaActual === "number" && etapaActual < 7
            ? "Disponible después de Inscripción"
            : "Carga y consulta por Mesa Control"
        }
      >
        <MesaNotificacionDocumentoSection
          expedienteId={routeExpedienteId}
          etapaActual={etapaActual}
          puedeOperar={puedeOperarMesaActivo}
          submittedToMesa={op.submittedToMesa ?? false}
        />
      </MesaAccordionSection>

      {mostrarPanelIntegracionDocs ? (
        <MesaAccordionSection
          id="mesa-documentos-asesor"
          title="Documentos e imágenes del cliente"
          summary={documentosSummary}
        >
          <MesaDocumentosAsesorSection
            embedded
            documentos={documentosAsesor}
            puedeRevisar={puedeRevisarDocsIntegracion}
            archivoLoadingTipo={archivoLoadingTipo}
            revisionSavingTipo={revisionSavingTipo as IntegrationDocAsesorUploadTipo | null}
            archivoErrorByTipo={archivoErrorByTipo}
            revisionErrorByTipo={revisionErrorByTipo}
            onVer={(tipo, archivo) => void handleVerArchivo(tipo, archivo)}
            onDescargar={(tipo, archivo) => void handleDescargarArchivo(tipo, archivo)}
            onValidar={(tipo, documentoId) => void handleValidarDocumento(tipo, documentoId)}
            onGuardarRechazo={handleGuardarRechazo}
          />
        </MesaAccordionSection>
      ) : null}

      <MesaAccordionSection
        id="mesa-complementarios"
        title="Documentos complementarios / Mesa Control"
        summary={complementariosSummary}
      >
        <MesaControlDocumentosComplementariosSection
          embedded
          documentos={documentosComplementarios}
          puedeOperar={puedeOperarMesaActivo}
          archivoLoadingTipo={complementarioArchivoLoadingTipo}
          uploadLoadingTipo={uploadLoadingTipo}
          archivoErrorByTipo={complementarioArchivoErrorByTipo}
          uploadErrorByTipo={uploadErrorByTipo}
          onVer={(tipo, archivo) => void handleVerComplementario(tipo, archivo)}
          onDescargar={(tipo, archivo) => void handleDescargarComplementario(tipo, archivo)}
          onSubir={handleSubirComplementario}
          onReemplazar={handleReemplazarComplementario}
        />
      </MesaAccordionSection>

      {mostrarRetencionMesa ? (
        <MesaAccordionSection
          id="mesa-retencion"
          title="Retención / Acuse / Aviso"
          summary={retencionSummary}
        >
          <MesaRetencionAcuseAvisoSection
            embedded
            opcionMesa={retencionOpcionMesa}
            envioUiEstado={retencionEnvioUiEstado}
            fechaEnvioMesa={retencionEnvio?.fechaEnvioMesa}
            documentos={retencionDocumentos}
            faltantes={retencionFaltantes}
            bloqueosAvance={retencionBloqueosAvance}
            puedeRevisar={puedeRevisarRetencion}
            formatDateTime={formatDateTime}
            archivoLoadingTipo={retencionArchivoLoadingTipo}
            revisionSavingTipo={revisionSavingTipo as RetencionTipoDocumento | null}
            archivoErrorByTipo={archivoErrorByTipo}
            revisionErrorByTipo={revisionErrorByTipo}
            onVer={(tipo, archivo) => void handleVerRetencionDoc(tipo, archivo)}
            onDescargar={(tipo, archivo) => void handleDescargarRetencionDoc(tipo, archivo)}
            onValidar={(tipo, documentoId) => void handleValidarRetencionDocumento(tipo, documentoId)}
            onGuardarRechazo={handleGuardarRechazoRetencion}
          />
        </MesaAccordionSection>
      ) : null}

      {activeNotificacionBooking ? (
        <MesaAccordionSection
          id="mesa-notificacion-extraordinaria"
          title={MESA_NOTIFICACION_EXTRAORDINARIA_TITLE}
          summary={notificacionSummary}
        >
          <MesaNotificacionExtraordinariaSection
            embedded
            booking={activeNotificacionBooking}
            asesorDueñoLabel={asesorDueñoLabel}
            agendadoPorLabel={notificacionAgendadoPorLabel}
            etapaActual={etapaActual}
            fechaCita={op.fechaCita}
            submittedToMesa={expediente?.operativo.submittedToMesa ?? false}
            subestado={expediente?.operativo.subestado ?? null}
            cicloEstado={expediente?.operativo.cicloEstado ?? null}
            mockRole={mesaMockRole}
            sessionRole={mesaSessionRole}
            cancelSuccess={notificacionCancelSuccess}
            onRequestCancel={() => {
              setCancelCitaError(null);
              setCancelCitaKind("notificacion");
            }}
          />
        </MesaAccordionSection>
      ) : null}

      <MesaAccordionSection id="mesa-agenda" title="Agenda / Citas" summary={agendaSummary}>
        <MesaExpedienteAgendaCitasSection
          embedded
          etapaActual={etapaActual}
          fechaCita={op.fechaCita}
          submittedToMesa={expediente?.operativo.submittedToMesa ?? false}
          subestado={expediente?.operativo.subestado ?? null}
          cicloEstado={expediente?.operativo.cicloEstado ?? null}
          hasActiveNotificacionBooking={activeNotificacionBooking != null}
          biometricBooking={activeBiometricBooking}
          biometricLocationLabel={biometricLocationLabel}
          firmasBooking={activeFirmasBooking}
          firmasLocationLabel={firmasLocationLabel}
          mockRole={mesaMockRole}
          sessionRole={mesaSessionRole}
          biometricosCancelSuccess={biometricosCancelSuccess}
          biometricosCancelledMotivo={biometricosCancelledMotivo}
          firmasCancelSuccess={cancelFirmasSuccess}
          firmasCancelledMotivo={firmasCancelledMotivo}
          onRequestCancelBiometricos={() => {
            setCancelCitaError(null);
            setCancelCitaKind("biometricos");
          }}
          onRequestCancelFirmas={() => {
            setCancelCitaError(null);
            setCancelCitaKind("firmas");
          }}
        />
      </MesaAccordionSection>

      {firmasMesaUiAccess.visible ? (
        <MesaGestionFirmasSection
          expedienteId={routeExpedienteId}
          etapaActual={etapaActual ?? 1}
          activeBooking={activeFirmasBooking}
          config={firmasConfig}
          onRefresh={load}
          onRequestCancel={() => {
            setCancelCitaError(null);
            setCancelCitaKind("firmas");
          }}
        />
      ) : null}

      <MesaCancelarCitaDialog
        open={cancelCitaKind != null}
        kindLabel={cancelCitaKindLabel}
        saving={cancelCitaSaving}
        error={cancelCitaError}
        onClose={() => setCancelCitaKind(null)}
        onConfirm={handleConfirmCancelCita}
      />

      <MesaCierreValidacionDocumentalSection
        view={cierreValidacionView}
        puedeOperar={puedeOperarMesaActivo}
        loading={continuarLoading}
        error={continuarError}
        success={continuarSuccess}
        onAvanzar={handleAvanzarIntegracion}
      />

      <MesaAvanceOperativoSection
        view={avanceOperativo2a3View}
        copy={MESA_AVANCE_OPERATIVO_2A3_COPY}
        puedeOperar={puedeOperarMesaActivo}
        loading={avance2a3Loading}
        error={avance2a3Error}
        success={avance2a3Success}
        onAvanzar={handleAvanzarOperativo2a3}
      />

      <MesaAvanceOperativoSection
        view={avanceOperativo3a5View}
        copy={MESA_AVANCE_OPERATIVO_3A5_COPY}
        puedeOperar={puedeOperarMesaActivo}
        loading={avance3a5Loading}
        error={avance3a5Error}
        success={avance3a5Success}
        onAvanzar={handleAvanzarOperativo3a5}
        cancelCitaGate={notificacionCancelCitaGate}
        mostrarAtajoMovimientoManual={mostrarAtajoManual}
      />

      <MesaAvanceOperativoSection
        view={avanceOperativo4a5View}
        copy={MESA_AVANCE_OPERATIVO_4A5_COPY}
        puedeOperar={puedeOperarMesaActivo}
        loading={avance4a5Loading}
        error={avance4a5Error}
        success={avance4a5Success}
        onAvanzar={handleAvanzarOperativo4a5}
        cancelCitaGate={bioCancelCitaGate}
        mostrarAtajoMovimientoManual={mostrarAtajoManual}
      />

      <MesaAvanceOperativoSection
        view={avanceOperativo5a6View}
        copy={MESA_AVANCE_OPERATIVO_5A6_COPY}
        puedeOperar={puedeOperarMesaActivo}
        loading={avance5a6Loading}
        error={avance5a6Error}
        success={avance5a6Success}
        onAvanzar={handleAvanzarOperativo5a6}
        cancelCitaGate={bioCancelCitaGate}
        mostrarAtajoMovimientoManual={mostrarAtajoManual}
      />

      <MesaAvanceOperativoSection
        view={avanceOperativo6a7View}
        copy={MESA_AVANCE_OPERATIVO_6A7_COPY}
        puedeOperar={puedeOperarMesaActivo}
        loading={avance6a7Loading}
        error={avance6a7Error}
        success={avance6a7Success}
        onAvanzar={handleAvanzarOperativo6a7}
      />

      <MesaAvanceOperativoSection
        view={avanceOperativo7a8View}
        copy={MESA_AVANCE_OPERATIVO_7A8_COPY}
        puedeOperar={puedeOperarMesaActivo}
        loading={avance7a8Loading}
        error={avance7a8Error}
        success={avance7a8Success}
        onAvanzar={handleAvanzarOperativo7a8}
      />

      <MesaAvanceOperativoSection
        view={avanceOperativo8a9View}
        copy={MESA_AVANCE_OPERATIVO_8A9_COPY}
        puedeOperar={puedeOperarMesaActivo}
        loading={avance8a9Loading}
        error={avance8a9Error}
        success={avance8a9Success}
        onAvanzar={handleAvanzarOperativo8a9}
        mostrarAtajoMovimientoManual={mostrarAtajoManual}
      />

      <MesaAvanceOperativoSection
        view={avanceOperativo9a10View}
        copy={MESA_AVANCE_OPERATIVO_9A10_COPY}
        puedeOperar={puedeOperarMesaActivo}
        loading={avance9a10Loading}
        error={avance9a10Error}
        success={avance9a10Success}
        onAvanzar={handleAvanzarOperativo9a10}
        cancelCitaGate={firmasCancelCitaGate}
        mostrarAtajoMovimientoManual={mostrarAtajoManual}
      />

      <MesaAvanceOperativoSection
        view={firmaEtapa10OperativaView}
        copy={MESA_FIRMA_ETAPA10_OPERATIVA_COPY}
        puedeOperar={puedeOperarMesaActivo}
        loading={false}
        error={null}
        success={null}
        onAvanzar={async () => {}}
        mostrarBotonAvanzar={false}
        cancelCitaGate={firmasCancelCitaGate}
        mostrarAtajoMovimientoManual={mostrarAtajoManual}
      />

      <MesaRechazoOperativoPostBiometricosCard
        expedienteId={routeExpedienteId}
        etapaActual={etapaActual ?? null}
        subestado={op.subestado ?? null}
        cicloEstado={op.cicloEstado ?? null}
        submittedToMesa={op.submittedToMesa ?? false}
        fechaCita={op.fechaCita ?? null}
        dataModeSupabase
        onUpdated={load}
      />

      <MesaCancelarExpedienteCard
        expedienteId={routeExpedienteId}
        cicloEstado={op.cicloEstado ?? null}
        submittedToMesa={op.submittedToMesa ?? false}
        dataModeSupabase
        onUpdated={load}
      />

      {!expedienteCancelado ? (
      <MesaControlManualEtapaSection
        expedienteId={routeExpedienteId}
        etapaActual={etapaActual ?? 1}
        role={mesaOpsAppRole ?? mesaSessionRole ?? mesaMockRole}
        submittedToMesa={op.submittedToMesa ?? false}
        cicloEstado={op.cicloEstado ?? null}
        subestado={op.subestado ?? null}
        hasBiometricBooking={activeBiometricBooking != null}
        hasFirmasBooking={activeFirmasBooking != null}
        hasMonto={
          typeof expediente.editorDecision.monto_aprobado === "number" &&
          expediente.editorDecision.monto_aprobado > 0
        }
        hasMissingDocuments={archivosResumen.some(
          (archivo) => archivo.estatus_revision !== "validado",
        )}
        hasRetencion={retencionEnvio != null || retencionOpcionMesa != null}
        hasValidatedData={
          clienteDatos?.estado === "validado" ||
          archivosResumen.some((archivo) => archivo.estatus_revision === "validado")
        }
        onRefresh={load}
      />
      ) : null}

      {preview ? (
        <MesaArchivoPreviewDialog
          preview={preview}
          onClose={closePreview}
          onOpenInNewTab={openBlobUrlInNewTab}
        />
      ) : null}

      <AsesorSeguimientoOperativo
        etapaActual={op.etapaActual}
        subestado={op.subestado}
        submittedToMesa={op.submittedToMesa}
        fechaEnvioMesa={op.fechaEnvioMesa}
        updatedAt={op.updatedAt}
        cicloEstado={op.cicloEstado}
        origenMesa={expediente.base.origenMesa}
        formatDateTime={formatDateTime}
      />
    </MesaDetalleShell>
  );
}
