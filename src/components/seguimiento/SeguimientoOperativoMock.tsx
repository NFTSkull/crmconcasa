"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DocumentDropzone } from "@/components/documents/DocumentDropzone";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  deriveRetencionAcuseAvisoFaltantes,
  filterChecklistDocumentoItemsPorOwnerRole,
  getChecklistDocumentos,
  getBloqueosRetencionAvanceEtapa8Mesa,
  isRetencionTipoDocumento,
  labelRetencionOpcion,
  listRetencionUploadsForOpcion,
  RETENCION_ETAPA_OPERATIVA_ID,
} from "@/domain/expediente-archivos";
import {
  DOCUMENTO_TIPOS,
  findRowPorTipoDocumento,
  MockExpedienteArchivosIndexedDbRepo,
  type ExpedienteArchivoResumen,
} from "@/domain/expediente-archivos";
import { MockExpedienteClienteDatosLocalStorageRepo } from "@/domain/expediente-cliente-datos";
import {
  MockExpedienteRetencionEnvioMesaLocalStorageRepo,
  RETENCION_ENVIO_MESA_EVENT,
} from "@/domain/expediente-retencion/envio-mesa.mock-localstorage.repo";
import { MockExpedienteRetencionOpcionLocalStorageRepo } from "@/domain/expediente-retencion/mock-localstorage.repo";
import {
  retencionEnvioEstadoEfectivo,
  retencionOpcionAsesorEditable,
  retencionOpcionMesaEfectiva,
  retencionOpcionParaPanelAsesor,
  retencionDocPuedeReemplazarAsesor,
  retencionPuedeReenviarAMesa,
} from "@/domain/expediente-retencion/retencion-envio-mesa";
import type {
  ExpedienteRetencionEnvioMesa,
  RetencionOpcion,
} from "@/domain/expediente-retencion/types";
import {
  etapaActualParaOperativo,
  etapaAlEnviarAMesaDesdeAsesor,
} from "@/domain/expedientes/mock.repo";
import { getEffectiveMockRole, isMesaControlMockRole } from "@/lib/mockUser";
import { EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR } from "@/domain/expediente-archivos/upload-constraints";
import { validatePdfFile } from "@/lib/fileUploadValidation";
import { resolveFechaCitaBiometricosOperativa } from "@/lib/agendaBiometricosMock";

type EstadoEtapa =
  | "pendiente"
  | "en_validacion_mesa"
  | "en_proceso"
  | "aprobado"
  | "rechazado";
type RolMock = "asesor" | "mesa_control";

const MSJ_ESPERA_MONTO_REVISOR =
  "Debes esperar a que el editor apruebe un monto antes de capturar datos, subir documentos o enviar a mesa.";

function retencionDocEstatusLabel(
  e: ExpedienteArchivoResumen["estatus_revision"] | undefined,
): string {
  if (!e || e === "faltante") return "Faltante";
  if (e === "subido") return "Pendiente revisión Mesa";
  if (e === "resubido") return "Resubido — pendiente revisión";
  if (e === "validado") return "Validado por Mesa";
  return "Rechazado por Mesa";
}

interface Etapa {
  id: number;
  nombre: string;
  sla?: string;
}

const ETAPAS: Etapa[] = [
  { id: 1, nombre: "Integración", sla: "SLA 2 días" },
  { id: 2, nombre: "Registro", sla: "SLA 2 días" },
  { id: 3, nombre: "Listo para cita de biométrico" },
  { id: 4, nombre: "Cita agendada (biométricos)" },
  { id: 5, nombre: "Biometría (resultado)" },
  { id: 6, nombre: "Inscripción" },
  { id: 7, nombre: "Notificación" },
  { id: 8, nombre: "Acuse / Aviso de retención" },
  { id: 9, nombre: "Listo para agendar firma" },
  { id: 10, nombre: "Cita para firma" },
  { id: 11, nombre: "Firmado" },
  { id: 12, nombre: "Pago a ConCasa" },
];

function getEtapaNombre(id: number | null | undefined): string {
  if (id == null) return "Etapa desconocida";
  const etapa = ETAPAS.find((e) => e.id === id);
  return etapa?.nombre ?? `Etapa ${id}`;
}

type MotivoOption = {
  value: string;
  label: string;
};

const CLIENTE_DOC_TIPOS_OBLIGATORIOS = [
  { tipo: "nss" as const, label: "NSS" },
  { tipo: "cliente_ine_frente" as const, label: "INE frente" },
  { tipo: "cliente_ine_reverso" as const, label: "INE reverso" },
  { tipo: "cliente_comprobante_domicilio" as const, label: "Comprobante de domicilio" },
  { tipo: "cliente_estado_cuenta" as const, label: "Estado de cuenta" },
] as const;

const CLIENTE_DOC_TIPOS_OPCIONALES = [
  { tipo: "cliente_semanas_cotizadas" as const, label: "Semanas Cotizadas (opcional)" },
] as const;

const CLIENTE_DOC_TIPOS = [...CLIENTE_DOC_TIPOS_OBLIGATORIOS, ...CLIENTE_DOC_TIPOS_OPCIONALES];

const MOTIVOS_POR_ETAPA: Record<number, MotivoOption[]> = {
  1: [
    { value: "direccion_repetida", label: "Dirección repetida" },
    { value: "ine_ilegible", label: "INE ilegible" },
    { value: "edo_cuenta_no_actualizado", label: "Estado de cuenta no actualizado" },
    { value: "nss_equivocado", label: "NSS equivocado" },
    { value: "ine_vencida", label: "INE vencida" },
  ],
  2: [
    {
      value: "registrado_otro_proveedor",
      label: "Registrado con otro proveedor",
    },
  ],
  3: [
    { value: "huellas_ilegibles", label: "Huellas ilegibles" },
    { value: "no_actualizada_afore", label: "No actualizada en AFORE" },
    { value: "no_acudio", label: "No acudió" },
    { value: "rfc_error", label: "RFC con error" },
    { value: "curp_equivocada", label: "CURP equivocada" },
    { value: "cp_diferente", label: "Código postal diferente" },
    { value: "credito_vigente", label: "Crédito vigente" },
    { value: "mal_buro", label: "Mal buró" },
    { value: "problemas_legales", label: "Problemas legales" },
    { value: "usurpacion_identidad", label: "Usurpación de identidad" },
  ],
  4: [
    { value: "huellas_ilegibles", label: "Huellas ilegibles" },
    { value: "no_actualizada_afore", label: "No actualizada en AFORE" },
    { value: "no_acudio", label: "No acudió" },
    { value: "rfc_error", label: "RFC con error" },
    { value: "curp_equivocada", label: "CURP equivocada" },
    { value: "cp_diferente", label: "Código postal diferente" },
    { value: "credito_vigente", label: "Crédito vigente" },
    { value: "mal_buro", label: "Mal buró" },
    { value: "problemas_legales", label: "Problemas legales" },
    { value: "usurpacion_identidad", label: "Usurpación de identidad" },
  ],
  5: [
    { value: "huellas_ilegibles", label: "Huellas ilegibles" },
    { value: "no_actualizada_afore", label: "No actualizada en AFORE" },
    { value: "no_acudio", label: "No acudió" },
    { value: "rfc_error", label: "RFC con error" },
    { value: "curp_equivocada", label: "CURP equivocada" },
    { value: "cp_diferente", label: "Código postal diferente" },
    { value: "credito_vigente", label: "Crédito vigente" },
    { value: "mal_buro", label: "Mal buró" },
    { value: "problemas_legales", label: "Problemas legales" },
    { value: "usurpacion_identidad", label: "Usurpación de identidad" },
  ],
  7: [{ value: "notificacion_vencida", label: "Notificación vencida" }],
  9: [
    { value: "no_agendo_segunda_cita", label: "No agendó la segunda cita" },
    { value: "no_vino", label: "No vino" },
  ],
  10: [
    { value: "no_asistio", label: "No asistió" },
    { value: "no_habia_sistema", label: "No había sistema" },
    { value: "vino_sin_ine", label: "Vino sin INE" },
  ],
  12: [
    {
      value: "cliente_no_quiere_pagar",
      label: "Cliente no quiere pagar",
    },
  ],
};

type Abogado = "elis" | "roberto";
type DocKey = "ine" | "estado_cuenta" | "nss" | "direccion";

interface DocState {
  checked: boolean;
  notes: string;
}

interface EstadoEtapaDetallado {
  estado: EstadoEtapa;
  motivo?: string;
  /** Comentario libre de rechazo (persistido aparte de `motivo`). */
  comentarioRechazo?: string;
  notasInternas: string;
  fechaCita?: string;
  fechaLiberacion?: string;
  abogadoAsignado?: Abogado;
  ultimaActualizacion: string;
}

type TimelineState = Record<number, EstadoEtapaDetallado>;

const ESTADO_INICIAL: TimelineState = {};

/** Alineado con `etapaActualParaOperativo`: validación mesa mantiene etapa 1 hasta aprobación. */
function initialOperativoEtapaIdFromProps(
  etapa: number | undefined | null,
  subestado: EstadoEtapa | undefined,
): number | null {
  if (subestado === "en_validacion_mesa") {
    return etapaActualParaOperativo(etapa ?? null, "en_validacion_mesa");
  }
  if (etapa != null) return etapa;
  return 1;
}

function FileUploadButton({
  accept,
  label,
  onFile,
  disabled,
}: {
  accept: string;
  label: string;
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  return (
    <div className="max-w-xs">
      <DocumentDropzone
        compact
        accept={accept}
        disabled={disabled}
        aria-label={label}
        hint={label}
        onFiles={(files) => {
          const file = files[0];
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

function getEstadoLabel(estado: EstadoEtapa): string {
  switch (estado) {
    case "pendiente":
      return "Pendiente";
    case "en_validacion_mesa":
      return "En validación por mesa";
    case "en_proceso":
      return "En proceso";
    case "aprobado":
      return "Aprobado";
    case "rechazado":
      return "Rechazado";
    default:
      return estado;
  }
}

type StageVisualStatus = "completed" | "current" | "pending" | "rejected";

function getStageVisualStatus(
  stageId: number,
  etapaActualId: number | null,
  subestado: EstadoEtapa,
): StageVisualStatus {
  if (etapaActualId == null) {
    return "pending";
  }
  if (stageId < etapaActualId) {
    return "completed";
  }
  if (stageId > etapaActualId) {
    return "pending";
  }
  // stageId === etapaActualId
  if (subestado === "rechazado") return "rejected";
  if (subestado === "aprobado") return "completed";
  if (subestado === "en_proceso") return "current";
  if (subestado === "en_validacion_mesa") return "current";
  return "pending";
}

function formatFecha(fechaIso?: string): string {
  if (!fechaIso) return "—";
  try {
    const d = new Date(fechaIso);
    if (Number.isNaN(d.getTime())) return "—";
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return "—";
  }
}

/** Valor para `input[type=datetime-local]` en hora local (firma alineada con booking). */
function fechaCitaToDatetimeLocalInput(val?: string): string {
  if (!val) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return `${val}T12:00`;
  }
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day}T${h}:${min}`;
}

function datetimeLocalInputToIso(localVal: string): string {
  const d = new Date(localVal);
  if (Number.isNaN(d.getTime())) return localVal;
  return d.toISOString();
}

export interface SeguimientoOperativoMockSummary {
  /** Etapa real del expediente (no la selección visual del timeline). `null` = aún sin etapa operativa (p. ej. validación documental). */
  etapaActualId: number | null;
  subestado: EstadoEtapa;
  motivo?: string;
  comentarioRechazo?: string | null;
  /** `null` limpia cita en persistencia (cualquier rechazo operativo). */
  fechaCita?: string | null;
}

export interface SeguimientoOperativoMockProps {
  initialSubmittedToMesa?: boolean;
  initialEtapaActualId?: number | null;
  initialSubestado?: EstadoEtapa;
  initialMotivo?: string;
  initialComentarioRechazo?: string | null;
  initialFechaCita?: string;
  initialUpdatedAt?: string;
  onChangeSummary?: (summary: SeguimientoOperativoMockSummary) => void;
  /**
   * Persistencia real del "Enviar a mesa de control".
   * El componente no debe escribir en localStorage para mesa; lo hace el repo vía callback.
   */
  onEnviarAMesa?: (payload: {
    id: string;
    cliente_nombre: string;
    telefono_cliente: string;
    programa: string;
    asesorNombre: string;
    // Al enviar desde asesor, NO se debe requerir cita.
    // Biométricos: cita en etapa 4 (asesor). Firma: etapa 9 (mesa admin).
    fechaCita?: string | null;
    etapaActual?: number;
    subestado?: EstadoEtapa;
    docs?: unknown;
  }) => Promise<boolean | void> | boolean | void;
  contextPrecalId?: string;
  contextClienteNombre?: string;
  contextTelefono?: string;
  contextPrograma?: string;
  contextAsesorId?: string;
  /**
   * Si el padre conoce `exp.editorDecision` (p. ej. página asesor tras `getById`), debe pasar el flag aquí.
   * Si no viene, en rol asesor se usa fallback temporal leyendo `decisions_mock`.
   */
  asesorIntegracionHabilitada?: boolean;
}

export function SeguimientoOperativoMock(props: SeguimientoOperativoMockProps = {}) {
  const {
    initialSubmittedToMesa,
    initialEtapaActualId,
    initialSubestado,
    initialMotivo,
    initialComentarioRechazo,
    initialFechaCita,
    initialUpdatedAt,
    onChangeSummary,
    onEnviarAMesa,
    contextPrecalId,
    contextClienteNombre,
    contextTelefono,
    contextPrograma,
    contextAsesorId,
    asesorIntegracionHabilitada,
  } = props;

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

  const [timeline, setTimeline] = useState<TimelineState>(() => {
    if (initialEtapaActualId != null && initialSubestado != null) {
      return {
        [initialEtapaActualId]: {
          estado: initialSubestado,
          motivo: initialMotivo,
          comentarioRechazo: initialComentarioRechazo ?? undefined,
          fechaCita: initialFechaCita,
          ultimaActualizacion: initialUpdatedAt ?? new Date().toISOString(),
          notasInternas: "",
        },
      };
    }
    if (
      initialEtapaActualId == null &&
      initialSubestado === "en_validacion_mesa"
    ) {
      const now = initialUpdatedAt ?? new Date().toISOString();
      return {
        1: {
          estado: "en_validacion_mesa",
          motivo: initialMotivo,
          comentarioRechazo: initialComentarioRechazo ?? undefined,
          fechaCita: initialFechaCita,
          ultimaActualizacion: now,
          notasInternas: "",
        },
      };
    }
    return ESTADO_INICIAL;
  });
  /** Etapa real del expediente (fuente de verdad operativa + persistencia). `null` = sin etapa hasta acción mesa. */
  const [operativoEtapaId, setOperativoEtapaId] = useState<number | null>(() =>
    initialOperativoEtapaIdFromProps(initialEtapaActualId, initialSubestado),
  );
  /** Etapa cuyo detalle se muestra al hacer click en el timeline (solo visual). */
  const [selectedStageId, setSelectedStageId] = useState<number>(() => {
    const op = initialOperativoEtapaIdFromProps(
      initialEtapaActualId,
      initialSubestado,
    );
    return op ?? 1;
  });
  const [currentRole, setCurrentRole] = useState<RolMock>("asesor");
  const [submittedToMesa, setSubmittedToMesa] = useState(initialSubmittedToMesa ?? false);

  // Alinear con el padre cuando `mesa_control_inbox` (u otra fuente) actualiza la prop tras refetch.
  // No pisa el optimistic `setSubmittedToMesa(true)` mientras la prop sigue en false: el efecto solo
  // depende de cambios de `initialSubmittedToMesa`, no del estado local.
  useEffect(() => {
    // Sincronía intencional prop → estado; el linter advierte setState en efecto.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync defensiva initialSubmittedToMesa
    setSubmittedToMesa(initialSubmittedToMesa ?? false);
  }, [initialSubmittedToMesa]);

  const [docs, setDocs] = useState<Record<DocKey, DocState>>({
    ine: { checked: false, notes: "" },
    estado_cuenta: { checked: false, notes: "" },
    nss: { checked: false, notes: "" },
    direccion: { checked: false, notes: "" },
  });
  const [archivosResumen, setArchivosResumen] = useState<ExpedienteArchivoResumen[]>([]);
  /** Incrementa tras cada sync exitoso desde IndexedDB (montaje + `expediente_archivos_updated`). */
  const [archivosChecklistNonce, setArchivosChecklistNonce] = useState(0);
  /** Checklist etapa 1 (integración): para bloquear envío a mesa si faltan docs cliente. */
  const [checklistIntegracionAsesor, setChecklistIntegracionAsesor] = useState<
    Awaited<ReturnType<typeof getChecklistDocumentos>> | null
  >(null);
  const [archivosAll, setArchivosAll] = useState<
    Awaited<ReturnType<MockExpedienteArchivosIndexedDbRepo["listByExpediente"]>>
  >([]);
  const [operativoWarning, setOperativoWarning] = useState<string | null>(null);
  const [showRechazoModal, setShowRechazoModal] = useState(false);
  const [motivoRechazo, setMotivoRechazo] = useState<string>("");
  const [notaRechazo, setNotaRechazo] = useState<string>("");
  const [fechaCita, setFechaCita] = useState<string>("");
  const [fechaLiberacion, setFechaLiberacion] = useState<string>("");
  const [abogadoAsignado, setAbogadoAsignado] = useState<Abogado | "">("");
  const [aprobadoConMonto, setAprobadoConMonto] = useState<boolean>(false);
  const [retencionOpcion, setRetencionOpcion] = useState<RetencionOpcion | null>(null);
  const [retencionEnvioMesa, setRetencionEnvioMesa] =
    useState<ExpedienteRetencionEnvioMesa | null>(null);
  const [retencionEnvioSaving, setRetencionEnvioSaving] = useState(false);

  /** Rol UI según `mock_user` / `mock_role` (mesa: admin, interno, externo o legacy). */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mockRole = getEffectiveMockRole();
    if (isMesaControlMockRole(mockRole)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentRole("mesa_control");
    } else if (mockRole === "asesor") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentRole("asesor");
    }
  }, []);

  // Sincroniza el paquete de documentos (INE, etc.) contra la existencia
  // real de archivos en IndexedDB.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!contextPrecalId) return;

    const syncDocsFromIndexedDb = async () => {
      try {
        const resumen: ExpedienteArchivoResumen[] =
          await archivosRepo.listResumenByExpediente(contextPrecalId);
        const all = await archivosRepo.listByExpediente(contextPrecalId);

        setArchivosResumen(resumen);
        setArchivosAll(all);
        setDocs((prev) => {
          const next = { ...prev };
          (DOCUMENTO_TIPOS as readonly DocKey[]).forEach((tipo) => {
            const found = findRowPorTipoDocumento(resumen, tipo);
            next[tipo] = {
              ...next[tipo],
              checked: Boolean(found && found.estatus_revision !== "faltante"),
            };
          });
          return next;
        });
        setArchivosChecklistNonce((n) => n + 1);
      } catch (err) {
        console.error("[seguimiento] error sync docs indexeddb:", err);
      }
    };

    void syncDocsFromIndexedDb();

    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ expedienteId?: string | null }>;
      const changedId = ce.detail?.expedienteId;
      if (changedId && changedId !== contextPrecalId) return;
      void syncDocsFromIndexedDb();
    };

    window.addEventListener(
      "expediente_archivos_updated",
      handler as EventListener,
    );

    return () => {
      window.removeEventListener(
        "expediente_archivos_updated",
        handler as EventListener,
      );
    };
  }, [archivosRepo, contextPrecalId]);

  useEffect(() => {
    if (typeof window === "undefined" || !contextPrecalId) return;
    let cancelled = false;
    void retencionOpcionRepo.getByExpedienteId(contextPrecalId).then((row) => {
      if (!cancelled) setRetencionOpcion(row?.retencion_opcion ?? null);
    });
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ expedienteId?: string }>;
      if (ce.detail?.expedienteId && ce.detail.expedienteId !== contextPrecalId) return;
      void retencionOpcionRepo.getByExpedienteId(contextPrecalId).then((row) => {
        if (!cancelled) setRetencionOpcion(row?.retencion_opcion ?? null);
      });
    };
    window.addEventListener(
      "expediente_retencion_opcion_updated",
      handler as EventListener,
    );
    return () => {
      cancelled = true;
      window.removeEventListener(
        "expediente_retencion_opcion_updated",
        handler as EventListener,
      );
    };
  }, [contextPrecalId, retencionOpcionRepo]);

  useEffect(() => {
    if (!contextPrecalId) {
      setRetencionEnvioMesa(null);
      return;
    }
    let cancelled = false;
    const loadEnvio = () => {
      void retencionEnvioMesaRepo.getByExpedienteId(contextPrecalId).then((row) => {
        if (!cancelled) setRetencionEnvioMesa(row);
      });
    };
    loadEnvio();
    if (typeof window === "undefined") return () => {
      cancelled = true;
    };
    const onEnvio = (ev: Event) => {
      const detail = (ev as CustomEvent<{ expedienteId?: string }>).detail;
      if (detail?.expedienteId && detail.expedienteId !== contextPrecalId) return;
      loadEnvio();
    };
    window.addEventListener(RETENCION_ENVIO_MESA_EVENT, onEnvio);
    return () => {
      cancelled = true;
      window.removeEventListener(RETENCION_ENVIO_MESA_EVENT, onEnvio);
    };
  }, [contextPrecalId, retencionEnvioMesaRepo]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!contextPrecalId || currentRole !== "asesor" || submittedToMesa) return;
    let cancelled = false;
    void getChecklistDocumentos(String(contextPrecalId), 1, {
      pendienteRevisionCuentaComoCompleto: true,
    })
      .then((checklist) => {
        if (cancelled) return;
        setChecklistIntegracionAsesor(checklist);
      })
      .catch(() => {
        if (!cancelled) setChecklistIntegracionAsesor(null);
      });
    return () => {
      cancelled = true;
    };
  }, [contextPrecalId, currentRole, submittedToMesa, archivosChecklistNonce, archivosResumen]);

  // Sincroniza etapa real + timeline cuando el padre refetch (inbox / expediente).
  useEffect(() => {
    const sub = initialSubestado ?? "pendiente";
    const now = initialUpdatedAt ?? new Date().toISOString();
    const fechaCitaOperativa =
      resolveFechaCitaBiometricosOperativa(
        contextPrecalId ?? "",
        initialFechaCita,
      ) ?? initialFechaCita;

    if (initialEtapaActualId != null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOperativoEtapaId(initialEtapaActualId);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedStageId(initialEtapaActualId);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTimeline(() => {
        const base: TimelineState = {};
        ETAPAS.forEach((etapa) => {
          if (etapa.id < initialEtapaActualId!) {
            base[etapa.id] = {
              estado: "aprobado",
              motivo: undefined,
              comentarioRechazo: undefined,
              notasInternas: "",
              fechaCita:
                etapa.id === 3 || etapa.id === 4 || etapa.id === 9
                  ? fechaCitaOperativa
                  : undefined,
              fechaLiberacion: undefined,
              abogadoAsignado: undefined,
              ultimaActualizacion: now,
            };
          } else if (etapa.id === initialEtapaActualId) {
            base[etapa.id] = {
              estado: sub,
              motivo: initialMotivo,
              comentarioRechazo: initialComentarioRechazo ?? undefined,
              notasInternas: "",
              fechaCita: sub === "rechazado" ? undefined : fechaCitaOperativa,
              fechaLiberacion: undefined,
              abogadoAsignado: undefined,
              ultimaActualizacion: now,
            };
          }
        });
        return base;
      });
      return;
    }

    if (sub === "en_validacion_mesa" && (initialSubmittedToMesa ?? false)) {
      const id = etapaActualParaOperativo(null, "en_validacion_mesa") ?? 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOperativoEtapaId(id);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedStageId(id);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTimeline(() => {
        const base: TimelineState = {};
        ETAPAS.forEach((etapa) => {
          if (etapa.id < id) {
            base[etapa.id] = {
              estado: "aprobado",
              motivo: undefined,
              comentarioRechazo: undefined,
              notasInternas: "",
              fechaCita:
                etapa.id === 3 || etapa.id === 4 || etapa.id === 9
                  ? fechaCitaOperativa
                  : undefined,
              fechaLiberacion: undefined,
              abogadoAsignado: undefined,
              ultimaActualizacion: now,
            };
          } else if (etapa.id === id) {
            base[etapa.id] = {
              estado: sub,
              motivo: initialMotivo,
              comentarioRechazo: initialComentarioRechazo ?? undefined,
              notasInternas: "",
              fechaCita: fechaCitaOperativa,
              fechaLiberacion: undefined,
              abogadoAsignado: undefined,
              ultimaActualizacion: now,
            };
          }
        });
        return base;
      });
    }
    // `initialUpdatedAt` a propósito fuera de deps: solo refetch “lógico” (etapa/subestado/cita/motivo),
    // no cada tick de `updatedAt` al persistir notas u otros, para no resetear `selectedStageId`.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initialUpdatedAt` solo fallback de timestamp; no re-sincronizar por cada persistencia.
  }, [
    contextPrecalId,
    initialEtapaActualId,
    initialSubestado,
    initialMotivo,
    initialComentarioRechazo,
    initialFechaCita,
    initialSubmittedToMesa,
  ]);

  const loadDecisionFromMock = () => {
    if (typeof window === "undefined") return;
    if (!contextPrecalId) {
      setAprobadoConMonto(false);
      return;
    }
    try {
      const raw = window.localStorage.getItem("decisions_mock");
      if (!raw) {
        setAprobadoConMonto(false);
        return;
      }
      const parsed = JSON.parse(raw) as unknown[];
      const found = parsed.find((d) => {
        if (!d || typeof d !== "object") return false;
        const obj = d as Record<string, unknown>;
        return obj.idPrecal === contextPrecalId;
      });
      if (!found) {
        setAprobadoConMonto(false);
        return;
      }
      const obj = found as Record<string, unknown>;
      const decision = obj.decision;
      const monto = obj.monto_aprobado;
      const ok =
        decision === "aprobado" &&
        typeof monto === "number" &&
        !Number.isNaN(monto) &&
        monto > 0;
      setAprobadoConMonto(ok);
    } catch (err) {
      console.error(
        "[seguimiento] error leyendo decisions_mock:",
        err instanceof Error ? err.message : String(err),
      );
      setAprobadoConMonto(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDecisionFromMock();
  }, [contextPrecalId]);

  useEffect(() => {
    if (typeof window === "undefined" || !contextPrecalId) return;
    const handler = (e: StorageEvent) => {
      if (e.key === "decisions_mock") {
        loadDecisionFromMock();
      }
    };
    const customHandler = () => {
      loadDecisionFromMock();
    };
    window.addEventListener("storage", handler);
    window.addEventListener("decisions_mock_updated", customHandler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("decisions_mock_updated", customHandler);
    };
  }, [contextPrecalId]);

  const asesorIntegracionActiva = useMemo(() => {
    if (currentRole !== "asesor") return true;
    if (typeof asesorIntegracionHabilitada === "boolean") {
      return asesorIntegracionHabilitada;
    }
    return aprobadoConMonto;
  }, [currentRole, asesorIntegracionHabilitada, aprobadoConMonto]);

  /** `null` = checklist aún no cargado; no confundir con "cero faltantes". */
  const faltantesCliente = useMemo(() => {
    if (!checklistIntegracionAsesor) return null;
    return filterChecklistDocumentoItemsPorOwnerRole(
      checklistIntegracionAsesor.faltantes,
      "cliente",
    );
  }, [checklistIntegracionAsesor]);

  const puedeEnviar = faltantesCliente !== null && faltantesCliente.length === 0;

  const mostrarPanelRetencionAsesor =
    currentRole === "asesor" &&
    submittedToMesa &&
    (operativoEtapaId === RETENCION_ETAPA_OPERATIVA_ID ||
      selectedStageId === RETENCION_ETAPA_OPERATIVA_ID);

  const retencionEnvioUiEstado = useMemo(
    () =>
      retencionEnvioEstadoEfectivo(
        retencionEnvioMesa,
        archivosResumen,
        retencionOpcion,
      ),
    [retencionEnvioMesa, archivosResumen, retencionOpcion],
  );

  const retencionOpcionEditable = retencionOpcionAsesorEditable(retencionEnvioUiEstado);

  const retencionOpcionPanel = useMemo(
    () =>
      retencionOpcionParaPanelAsesor(
        retencionEnvioMesa,
        retencionOpcion,
        retencionEnvioUiEstado,
      ),
    [retencionEnvioMesa, retencionOpcion, retencionEnvioUiEstado],
  );

  const retencionFaltantes = useMemo(
    () =>
      deriveRetencionAcuseAvisoFaltantes({
        retencion_opcion: retencionOpcionPanel,
        archivos: archivosResumen,
      }),
    [retencionOpcionPanel, archivosResumen],
  );

  const retencionUploads = useMemo(
    () => listRetencionUploadsForOpcion(retencionOpcionPanel),
    [retencionOpcionPanel],
  );

  const mostrarBotonEnvioRetencionMesa =
    mostrarPanelRetencionAsesor &&
    operativoEtapaId === RETENCION_ETAPA_OPERATIVA_ID &&
    Boolean(retencionOpcion);

  const puedeClickEnviarRetencionMesa =
    mostrarBotonEnvioRetencionMesa &&
    retencionPuedeReenviarAMesa(retencionEnvioUiEstado, retencionFaltantes) &&
    !retencionEnvioSaving;

  const etapaOperativa = useMemo(
    () =>
      operativoEtapaId != null
        ? (ETAPAS.find((e) => e.id === operativoEtapaId) ?? ETAPAS[0])
        : ETAPAS[0],
    [operativoEtapaId],
  );

  const etapaSeleccionada = useMemo(
    () => ETAPAS.find((e) => e.id === selectedStageId) ?? etapaOperativa,
    [selectedStageId, etapaOperativa],
  );

  const estadoReal =
    operativoEtapaId != null
      ? (timeline[operativoEtapaId] ?? {
          estado: "pendiente" as EstadoEtapa,
          notasInternas: "",
          ultimaActualizacion: "",
        })
      : (timeline[2] ??
        timeline[1] ?? {
          estado: "pendiente" as EstadoEtapa,
          notasInternas: "",
          ultimaActualizacion: "",
        });

  /** Detalle mostrado en el panel (etapa seleccionada en el timeline). */
  const estadoPanel = timeline[etapaSeleccionada.id] ?? {
    estado: "pendiente" as EstadoEtapa,
    notasInternas: "",
    ultimaActualizacion: "",
  };

  const panelOperativoEditable =
    currentRole === "mesa_control" &&
    submittedToMesa &&
    (selectedStageId === operativoEtapaId ||
      (operativoEtapaId == null && selectedStageId === 2));

  const isMesaControlAdminMock =
    typeof window !== "undefined" &&
    getEffectiveMockRole() === "mesa_control_admin";

  /** Biométricos (3–4): cita desde asesor. Firma (9): cita editable solo con `mock_role` admin; etapa 10 solo lectura (firma vía agenda). */
  const citaEditable =
    panelOperativoEditable &&
    operativoEtapaId === 9 &&
    isMesaControlAdminMock;

  const readonlyHistoricalMesa =
    currentRole === "mesa_control" &&
    submittedToMesa &&
    operativoEtapaId != null &&
    selectedStageId !== operativoEtapaId;

  const motivosOperativa = MOTIVOS_POR_ETAPA[etapaOperativa.id] ?? [];
  const motivosEtapaSeleccionada =
    MOTIVOS_POR_ETAPA[etapaSeleccionada.id] ?? [];

  const ultimaActualizacionGlobal = useMemo(() => {
    const fechas = Object.values(timeline)
      .map((e) => e.ultimaActualizacion)
      .filter(Boolean);
    if (fechas.length === 0) return undefined;
    return fechas.sort().slice(-1)[0];
  }, [timeline]);

  /** Valor a mostrar en "Última actualización": prioriza el dato real del expediente (mesa_control_inbox) sobre el estado interno del timeline. */
  const ultimaActualizacionDisplay = initialUpdatedAt ?? ultimaActualizacionGlobal;

  /** Mesa puede navegar el timeline (solo selección visual); el asesor no. */
  const canInteractTimeline = currentRole === "mesa_control";

  const subestado = useMemo(() => {
    return getEstadoLabel(estadoReal.estado);
  }, [estadoReal.estado]);

  const getBloqueosAvanceMesa = useCallback(async (): Promise<string[]> => {
    const bloqueos: string[] = [];
    if (!contextPrecalId || operativoEtapaId == null) return bloqueos;

    const checklist = await getChecklistDocumentos(contextPrecalId, operativoEtapaId);
    let faltantesCliente = filterChecklistDocumentoItemsPorOwnerRole(
      checklist.faltantes,
      "cliente",
    );
    if (operativoEtapaId === RETENCION_ETAPA_OPERATIVA_ID) {
      faltantesCliente = faltantesCliente.filter(
        (x) => !isRetencionTipoDocumento(x.tipo_documento),
      );
    }
    if (faltantesCliente.length > 0) {
      const labels = faltantesCliente.map((x) => x.label);
      if (labels.length > 0) {
        bloqueos.push(`Documentos pendientes/rechazados: ${labels.join(", ")}`);
      } else {
        bloqueos.push("Documentos pendientes/rechazados.");
      }
    }

    const datosCliente = await clienteDatosRepo.getByExpedienteId(contextPrecalId);
    if (!datosCliente) {
      bloqueos.push("Datos generales no capturados.");
    } else if (datosCliente.estado !== "validado") {
      bloqueos.push(
        "Datos generales pendientes de validar por mesa-control.",
      );
    }

    if (operativoEtapaId === RETENCION_ETAPA_OPERATIVA_ID) {
      const opcionRow = await retencionOpcionRepo.getByExpedienteId(contextPrecalId);
      const envioRow = await retencionEnvioMesaRepo.getByExpedienteId(contextPrecalId);
      const resumenArchivos = await archivosRepo.listResumenByExpediente(contextPrecalId);
      const opcionMesa = retencionOpcionMesaEfectiva(
        envioRow,
        opcionRow?.retencion_opcion ?? null,
      );
      bloqueos.push(
        ...getBloqueosRetencionAvanceEtapa8Mesa({
          retencion_opcion: opcionMesa,
          archivos: resumenArchivos,
          retencion_enviado_a_mesa: Boolean(envioRow?.enviado),
        }),
      );
    }

    return bloqueos;
  }, [
    archivosRepo,
    clienteDatosRepo,
    contextPrecalId,
    operativoEtapaId,
    retencionEnvioMesaRepo,
    retencionOpcionRepo,
  ]);

  useEffect(() => {
    if (!onChangeSummary) return;
    if (operativoEtapaId == null) return;
    const estado = timeline[operativoEtapaId] ?? {
      estado: "pendiente" as EstadoEtapa,
      motivo: undefined,
      fechaCita: undefined,
    };
    /** Cualquier rechazo: `null` en summary para que el patch incluya `fechaCita: null` y limpie inbox. */
    const fechaCitaPersist =
      estado.estado === "rechazado" ? null : estado.fechaCita;
    onChangeSummary({
      etapaActualId: operativoEtapaId,
      subestado: estado.estado,
      motivo: estado.motivo,
      comentarioRechazo:
        estado.estado === "rechazado"
          ? (estado.comentarioRechazo ?? null)
          : null,
      fechaCita: fechaCitaPersist,
    });
  }, [onChangeSummary, timeline, operativoEtapaId]);

  const handleAprobarYSiguiente = async () => {
    if (currentRole !== "mesa_control" || !submittedToMesa) return;
    if (!panelOperativoEditable) return;
    if (operativoEtapaId == null) return;

    if (contextPrecalId) {
      const bloqueos = await getBloqueosAvanceMesa();
      if (bloqueos.length > 0) {
        const msg = `No puedes avanzar todavía.\n\n- ${bloqueos.join("\n- ")}`;
        setOperativoWarning(msg.replace(/\n+/g, " "));
        alert(msg);
        return;
      }
    }

    // Etapa 4 → 5: la cita de biométricos la agenda el asesor en etapa 4.
    if (operativoEtapaId === 4) {
      const fc = resolveFechaCitaBiometricosOperativa(
        contextPrecalId ?? "",
        timeline[4]?.fechaCita ?? initialFechaCita,
      );
      if (!fc) {
        setOperativoWarning(
          "No hay fecha de cita registrada en etapa 4. El asesor debe agendar biométricos desde su expediente.",
        );
        return;
      }
    }
    if (operativoEtapaId === 9) {
      const fechaFirma = timeline[9]?.fechaCita;
      if (!fechaFirma) {
        setOperativoWarning(
          "Para pasar a la etapa 10 (Cita para firma), captura primero la cita de firma en la etapa 9.",
        );
        return;
      }
    }

    setOperativoWarning(null);
    const now = new Date().toISOString();
    const siguiente = ETAPAS.find((e) => e.id === operativoEtapaId + 1);
    setTimeline((prev) => {
      const next: TimelineState = {
        ...prev,
        [operativoEtapaId]: {
          ...prev[operativoEtapaId],
          estado: "aprobado",
          motivo: undefined,
          comentarioRechazo: undefined,
          ultimaActualizacion: now,
          notasInternas: prev[operativoEtapaId]?.notasInternas ?? "",
        },
      };
      if (siguiente) {
        next[siguiente.id] = {
          ...prev[siguiente.id],
          estado: "en_proceso",
          motivo: undefined,
          comentarioRechazo: undefined,
          notasInternas: prev[siguiente.id]?.notasInternas ?? "",
          ultimaActualizacion: now,
        };
      }
      return next;
    });
    if (siguiente) {
      setOperativoEtapaId(siguiente.id);
      setSelectedStageId(siguiente.id);
    }
  };

  /**
   * Regresa la etapa real en 1 (mesa). No persiste el timeline desde el click del timeline;
   * `onChangeSummary` refleja la nueva etapa vía efecto existente.
   */
  const handleRegresarEtapaAnterior = () => {
    if (currentRole !== "mesa_control" || !submittedToMesa) return;
    if (!panelOperativoEditable) return;
    if (operativoEtapaId == null) return;
    if (operativoEtapaId <= 1) return;

    setOperativoWarning(null);
    const now = new Date().toISOString();
    const etapaQueDejamos = operativoEtapaId;
    const etapaDestino = operativoEtapaId - 1;

    setTimeline((prev) => {
      const next: TimelineState = { ...prev };
      const salida = prev[etapaQueDejamos] ?? {
        estado: "pendiente" as EstadoEtapa,
        notasInternas: "",
        ultimaActualizacion: now,
      };

      // Etapa adelantada: deja de ser la operativa; no se borran notas/citas útiles.
      if (salida.estado === "rechazado") {
        next[etapaQueDejamos] = {
          ...salida,
          ultimaActualizacion: now,
        };
      } else {
        next[etapaQueDejamos] = {
          ...salida,
          estado: "pendiente",
          motivo: undefined,
          comentarioRechazo: undefined,
          ultimaActualizacion: now,
        };
      }

      const destinoPrev = prev[etapaDestino] ?? {
        estado: "pendiente" as EstadoEtapa,
        notasInternas: "",
        ultimaActualizacion: now,
      };
      next[etapaDestino] = {
        ...destinoPrev,
        estado: "en_proceso",
        ultimaActualizacion: now,
      };

      return next;
    });

    setOperativoEtapaId(etapaDestino);
    setSelectedStageId(etapaDestino);
  };

  const handleGuardarNotas = (value: string) => {
    if (!panelOperativoEditable) return;
    const key = operativoEtapaId ?? 1;
    setTimeline((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        notasInternas: value,
        ultimaActualizacion:
          prev[key]?.ultimaActualizacion ?? new Date().toISOString(),
      },
    }));
  };

  const abrirModalRechazo = () => {
    if (currentRole !== "mesa_control" || !submittedToMesa) return;
    if (!panelOperativoEditable) return;
    setMotivoRechazo("");
    setNotaRechazo("");
    setShowRechazoModal(true);
  };

  const cerrarModalRechazo = () => {
    setShowRechazoModal(false);
  };

  const handleConfirmarRechazo = () => {
    if (!panelOperativoEditable) return;
    if (!motivoRechazo) return;

    /** Rechazo de cita biométricos ya agendada: vuelve a etapa 3, libera slot en persistencia. */
    if (operativoEtapaId === 4) {
      const now = new Date().toISOString();
      setTimeline((prev) => {
        const next: TimelineState = { ...prev };
        next[4] = {
          ...prev[4],
          estado: "pendiente",
          motivo: undefined,
          comentarioRechazo: undefined,
          fechaCita: undefined,
          notasInternas: prev[4]?.notasInternas ?? "",
          ultimaActualizacion: now,
        };
        next[3] = {
          ...(prev[3] ?? {
            estado: "pendiente" as EstadoEtapa,
            notasInternas: "",
            ultimaActualizacion: now,
          }),
          estado: "rechazado",
          motivo: motivoRechazo,
          comentarioRechazo: notaRechazo.trim() || undefined,
          fechaCita: undefined,
          notasInternas: prev[3]?.notasInternas ?? "",
          ultimaActualizacion: now,
        };
        return next;
      });
      setOperativoEtapaId(3);
      setSelectedStageId(3);
      setShowRechazoModal(false);
      return;
    }

    const etapaIdx = operativoEtapaId ?? 1;
    setTimeline((prev) => ({
      ...prev,
      [etapaIdx]: {
        ...prev[etapaIdx],
        estado: "rechazado",
        motivo: motivoRechazo,
        comentarioRechazo: notaRechazo.trim() || undefined,
        notasInternas: prev[etapaIdx]?.notasInternas ?? "",
        fechaCita: undefined,
        fechaLiberacion:
          etapaIdx === 2 && motivoRechazo === "registrado_otro_proveedor"
            ? fechaLiberacion || prev[etapaIdx]?.fechaLiberacion
            : prev[etapaIdx]?.fechaLiberacion,
        abogadoAsignado:
          etapaIdx === 12 && motivoRechazo === "cliente_no_quiere_pagar"
            ? (abogadoAsignado || prev[etapaIdx]?.abogadoAsignado)
            : prev[etapaIdx]?.abogadoAsignado,
        ultimaActualizacion: new Date().toISOString(),
      },
    }));
    if (operativoEtapaId == null) {
      setOperativoEtapaId(2);
    }
    setShowRechazoModal(false);
  };

  const handleFechaCitaChange = (value: string) => {
    if (!citaEditable) return;
    if (operativoEtapaId == null) return;
    setOperativoWarning(null);
    setFechaCita(value);
    setTimeline((prev) => ({
      ...prev,
      [operativoEtapaId]: {
        ...prev[operativoEtapaId],
        fechaCita: value,
        ultimaActualizacion: new Date().toISOString(),
      },
    }));
  };

  const handleFechaLiberacionChange = (value: string) => {
    if (!panelOperativoEditable) return;
    if (operativoEtapaId == null) return;
    setFechaLiberacion(value);
    setTimeline((prev) => ({
      ...prev,
      [operativoEtapaId]: {
        ...prev[operativoEtapaId],
        fechaLiberacion: value,
        ultimaActualizacion: new Date().toISOString(),
      },
    }));
  };

  const handleAbogadoChange = (value: Abogado | "") => {
    setAbogadoAsignado(value);
    if (!value) return;
    if (!panelOperativoEditable) return;
    if (operativoEtapaId == null) return;
    setTimeline((prev) => ({
      ...prev,
      [operativoEtapaId]: {
        ...prev[operativoEtapaId],
        abogadoAsignado: value,
        ultimaActualizacion: new Date().toISOString(),
      },
    }));
  };

  // Bloque cita en panel: biométricos 3–4; firma 9 (editable si admin) y 10 solo lectura.
  const mostrarBloqueCita =
    etapaSeleccionada.id === 3 ||
    etapaSeleccionada.id === 4 ||
    etapaSeleccionada.id === 9 ||
    etapaSeleccionada.id === 10;
  const mostrarBloqueFechaLiberacion =
    etapaSeleccionada.id === 2 &&
    estadoPanel.estado === "rechazado" &&
    estadoPanel.motivo === "registrado_otro_proveedor";
  const mostrarBloqueAbogado =
    etapaSeleccionada.id === 12 &&
    estadoPanel.estado === "rechazado" &&
    estadoPanel.motivo === "cliente_no_quiere_pagar";

  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-gray-900">
          Seguimiento Operativo (mock)
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Información en memoria solo para pruebas de flujo. No se guarda en BD.
        </p>
      </header>

      {/* Resumen superior compacto */}
      <div className="rounded-xl border border-gray-100 bg-white p-2.5 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Etapa actual
            </p>
            <p className="mt-1 text-sm font-semibold text-gray-900">
              {operativoEtapaId == null
                ? "—"
                : `${etapaOperativa.id}. ${etapaOperativa.nombre}`}
            </p>
            {operativoEtapaId != null && etapaOperativa.sla && (
              <p className="mt-0.5 text-[11px] text-yellow-700">{etapaOperativa.sla}</p>
            )}
            {(operativoEtapaId === 3 ||
              operativoEtapaId === 4 ||
              operativoEtapaId === 9) &&
              (estadoReal.fechaCita ?? fechaCita) && (
              <p className="mt-1 text-[11px] text-gray-700">
                <span className="font-semibold">Cita:</span>{" "}
                {formatFecha(estadoReal.fechaCita ?? fechaCita)}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-gray-100 bg-white p-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Subestado / Estatus
            </p>
            <div className="mt-1">
              {estadoReal.estado === "rechazado" ? (
                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800 border border-red-200">
                  {subestado}
                </span>
              ) : estadoReal.estado === "aprobado" ? (
                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800 border border-green-200">
                  {subestado}
                </span>
              ) : estadoReal.estado === "en_validacion_mesa" ? (
                <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-900 border border-violet-200">
                  {subestado}
                </span>
              ) : estadoReal.estado === "en_proceso" ? (
                <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800 border border-blue-200">
                  {subestado}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-200">
                  {subestado}
                </span>
              )}
            </div>

            {estadoReal.estado === "rechazado" && estadoReal.motivo && (
              <p className="mt-1 text-[11px] text-red-700">
                <span className="font-semibold">Motivo:</span>{" "}
                {motivosOperativa.find((m) => m.value === estadoReal.motivo)?.label ??
                  estadoReal.motivo}
              </p>
            )}
            {estadoReal.estado === "rechazado" &&
              estadoReal.comentarioRechazo?.trim() && (
                <p className="mt-1 text-[11px] text-red-800">
                  <span className="font-semibold">Comentario:</span>{" "}
                  {estadoReal.comentarioRechazo}
                </p>
              )}
          </div>

          <div className="rounded-lg border border-gray-100 bg-white p-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Estado de envío
            </p>
            <div className="mt-1">
              {submittedToMesa ? (
                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800 border border-green-200">
                  En mesa de control
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-semibold text-yellow-800 border border-yellow-200">
                  Pendiente
                </span>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-100 bg-white p-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Última actualización
            </p>
            <p className="mt-0.5 text-xs font-semibold text-gray-900">
              {formatFecha(ultimaActualizacionDisplay)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.65fr)_320px] lg:items-start">
        {/* Timeline */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-800">
              Timeline / Etapas
            </p>
          </div>
          <ol className="max-h-[300px] space-y-1 overflow-y-auto overflow-x-visible pr-2 text-sm">
            {ETAPAS.map((etapa) => {
              const visualEstado =
                operativoEtapaId != null
                  ? (timeline[operativoEtapaId]?.estado ?? "pendiente")
                  : (timeline[1]?.estado ?? "pendiente");
              const visual = getStageVisualStatus(
                etapa.id,
                operativoEtapaId,
                visualEstado,
              );

              const isCompleted = visual === "completed";

              const circleClasses =
                visual === "completed"
                  ? "bg-green-500 text-white"
                  : visual === "current"
                    ? "bg-blue-600 text-white"
                    : visual === "rejected"
                      ? "bg-red-600 text-white"
                      : "bg-gray-200 text-gray-800";

              const cardClasses =
                `${visual === "current" || visual === "rejected"
                  ? "border-blue-500 bg-blue-50"
                  : isCompleted
                    ? "border-green-400 bg-green-50"
                    : canInteractTimeline
                      ? "border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-50"
                      : "border-gray-200 bg-gray-50"}${
                  etapa.id === selectedStageId ? " ring-2 ring-blue-500 ring-offset-1" : ""
                }`;

              let estadoLabel: string;
              if (visual === "completed") {
                estadoLabel = "Completada";
              } else if (visual === "current") {
                estadoLabel = "En proceso";
              } else if (visual === "rejected") {
                estadoLabel = "Rechazada";
              } else {
                estadoLabel = "Pendiente";
              }

              const badgeClass =
                visual === "completed"
                  ? "bg-green-50 text-green-800 border border-green-200"
                  : visual === "current"
                    ? "bg-blue-50 text-blue-800 border border-blue-200"
                    : visual === "rejected"
                      ? "bg-red-50 text-red-800 border border-red-200"
                      : "bg-gray-50 text-gray-700 border border-gray-200";

              return (
                <li
                  key={etapa.id}
                  className={`flex items-start justify-between rounded-lg border px-2 py-1 transition-colors ${canInteractTimeline ? "cursor-pointer" : "cursor-default"} ${cardClasses}`}
                  onClick={
                    canInteractTimeline ? () => setSelectedStageId(etapa.id) : undefined
                  }
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${circleClasses}`}
                    >
                      {etapa.id}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-[12px] font-semibold leading-tight text-gray-900">
                        {etapa.nombre}
                      </p>
                      {etapa.sla && (
                        <p className="truncate text-[10px] text-gray-500">
                          {etapa.sla}
                        </p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`inline-flex flex-shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeClass} whitespace-nowrap mt-0.5`}
                  >
                    {estadoLabel}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Panel derecho contextual */}
        <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4">
          {currentRole === "asesor" ? (
            submittedToMesa ? (
              <div className="rounded-xl border border-gray-100 bg-white p-2.5">
                <p className="text-sm font-semibold text-gray-900">
                  Enviado a mesa de control
                </p>
                <p className="mt-0.5 text-xs text-gray-600">
                  El seguimiento ya lo actualiza mesa-control.
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-gray-600">
                  <div>
                    <p className="font-semibold text-gray-800">Etapa</p>
                    <p className="mt-0.5">
                      {etapaOperativa.id}. {etapaOperativa.nombre}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800">Actualización</p>
                    <p className="mt-0.5">{formatFecha(ultimaActualizacionDisplay)}</p>
                  </div>
                </div>

                {mostrarPanelRetencionAsesor ? (
                  <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/40 p-2">
                    <p className="text-sm font-semibold text-gray-900">
                      Acuse / Aviso de retención
                    </p>
                    <p className="mt-0.5 text-xs text-gray-600">
                      Etapa {RETENCION_ETAPA_OPERATIVA_ID}: elige una opción y sube los
                      documentos requeridos antes de que el expediente pueda avanzar a la
                      etapa 9.
                    </p>

                    <fieldset className="mt-2 space-y-1.5" disabled={!retencionOpcionEditable}>
                      <legend className="sr-only">Opción de retención</legend>
                      <label
                        className={`flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs ${
                          retencionOpcionEditable ? "cursor-pointer" : "cursor-not-allowed opacity-80"
                        }`}
                      >
                        <input
                          type="radio"
                          name="retencion_opcion"
                          className="mt-0.5"
                          checked={retencionOpcionPanel === "con_sello"}
                          disabled={!retencionOpcionEditable}
                          onChange={() => {
                            if (!contextPrecalId || !retencionOpcionEditable) return;
                            void retencionOpcionRepo
                              .save({
                                expedienteId: contextPrecalId,
                                retencion_opcion: "con_sello",
                              })
                              .then((saved) =>
                                setRetencionOpcion(saved.retencion_opcion),
                              );
                          }}
                        />
                        <span>
                          <span className="font-semibold text-gray-900">
                            Opción A — Tiene sello
                          </span>
                          <span className="mt-0.5 block text-gray-600">
                            Acuse con sello, aviso de retención e INE frente/reverso
                            específicos.
                          </span>
                        </span>
                      </label>
                      <label
                        className={`flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs ${
                          retencionOpcionEditable ? "cursor-pointer" : "cursor-not-allowed opacity-80"
                        }`}
                      >
                        <input
                          type="radio"
                          name="retencion_opcion"
                          className="mt-0.5"
                          checked={retencionOpcionPanel === "sin_sello"}
                          disabled={!retencionOpcionEditable}
                          onChange={() => {
                            if (!contextPrecalId || !retencionOpcionEditable) return;
                            void retencionOpcionRepo
                              .save({
                                expedienteId: contextPrecalId,
                                retencion_opcion: "sin_sello",
                              })
                              .then((saved) =>
                                setRetencionOpcion(saved.retencion_opcion),
                              );
                          }}
                        />
                        <span>
                          <span className="font-semibold text-gray-900">
                            Opción B — No tiene sello
                          </span>
                          <span className="mt-0.5 block text-gray-600">
                            Carta de motivo, aviso de retención e INE frente/reverso
                            específicos.
                          </span>
                        </span>
                      </label>
                    </fieldset>

                    {!retencionOpcionEditable && retencionEnvioMesa?.opcion ? (
                      <p
                        role="status"
                        className="mt-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800"
                      >
                        Opción enviada a Mesa:{" "}
                        <span className="font-semibold">
                          {labelRetencionOpcion(retencionEnvioMesa.opcion)}
                        </span>
                        . Para cambiar la opción, primero requiere que Mesa solicite
                        corrección o reenvíes el bloque tras una corrección.
                      </p>
                    ) : null}

                    {retencionOpcionPanel ? (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {retencionUploads.map(({ tipo, label }) => {
                          const item =
                            findRowPorTipoDocumento(archivosAll, tipo) ?? null;
                          const hasFile = Boolean(item?.id);
                          const estatus = item?.estatus_revision ?? "faltante";
                          const rechazado = estatus === "rechazado";
                          const puedeReemplazar = retencionDocPuedeReemplazarAsesor(
                            estatus,
                            hasFile,
                          );
                          return (
                            <div
                              key={tipo}
                              className={`rounded-lg border p-1.5 ${
                                rechazado
                                  ? "border-red-200 bg-red-50/50"
                                  : "border-gray-100 bg-white"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                    {label}
                                  </p>
                                  <p className="mt-1 text-xs text-gray-800">
                                    <span className="font-medium">
                                      {retencionDocEstatusLabel(estatus)}
                                    </span>
                                  </p>
                                  {item?.nombre_original ? (
                                    <p className="mt-0.5 truncate text-sm font-medium text-gray-900">
                                      {item.nombre_original}
                                    </p>
                                  ) : null}
                                  {rechazado && item?.comentario_mesa ? (
                                    <p className="mt-1 text-[11px] text-red-900">
                                      Nota de Mesa: {item.comentario_mesa}
                                    </p>
                                  ) : null}
                                  {estatus === "validado" ? (
                                    <p className="mt-1 text-[11px] text-green-800">
                                      Validado por Mesa — no requiere cambios.
                                    </p>
                                  ) : null}
                                  {!puedeReemplazar && hasFile && estatus !== "validado" ? (
                                    <p className="mt-1 text-[10px] text-gray-500">
                                      En revisión por Mesa; espera validación o rechazo.
                                    </p>
                                  ) : null}
                                </div>
                                <FileUploadButton
                                  accept={EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR}
                                  label={hasFile ? "Reemplazar" : "Subir"}
                                  disabled={!contextPrecalId || !puedeReemplazar}
                                  onFile={async (file) => {
                                    if (!contextPrecalId) return;
                                    const pdfValidation = validatePdfFile(file);
                                    if (!pdfValidation.ok) {
                                      alert(pdfValidation.message);
                                      return;
                                    }
                                    await archivosRepo.replaceArchivo({
                                      expedienteId: contextPrecalId,
                                      tipo_documento: tipo,
                                      file,
                                      uploaded_by_role: "asesor",
                                      uploaded_by_email: contextAsesorId ?? "asesor",
                                    });
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-gray-600">
                        Selecciona Opción A o B para ver los documentos a subir.
                      </p>
                    )}

                    {retencionFaltantes.length > 0 ? (
                      <div
                        role="status"
                        className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-950"
                      >
                        <p className="font-semibold">Pendiente para avanzar a etapa 9</p>
                        <ul className="mt-1 list-inside list-disc space-y-0.5">
                          {retencionFaltantes.map((f) => (
                            <li key={f.kind === "opcion" ? "opcion" : f.tipo_documento}>
                              {f.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : retencionOpcionPanel ? (
                      <p
                        role="status"
                        className="mt-2 rounded-lg border border-green-200 bg-green-50 px-2 py-1.5 text-xs text-green-900"
                      >
                        Documentación de Acuse / Aviso completa para la opción elegida.
                      </p>
                    ) : null}

                    {retencionEnvioUiEstado === "enviado" ? (
                      <p
                        role="status"
                        className="mt-2 rounded-lg border border-violet-300 bg-violet-100 px-2 py-1.5 text-xs font-medium text-violet-950"
                      >
                        Acuse/Aviso enviado a Mesa Control para revisión
                        {retencionEnvioMesa?.fechaEnvioMesa
                          ? ` (${formatFecha(retencionEnvioMesa.fechaEnvioMesa)})`
                          : ""}
                        .
                      </p>
                    ) : null}

                    {retencionEnvioUiEstado === "correccion_requerida" ? (
                      <p
                        role="status"
                        className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-950"
                      >
                        Mesa rechazó uno o más documentos. Sustituye los archivos
                        marcados y vuelve a enviar el bloque a Mesa Control.
                      </p>
                    ) : null}

                    {mostrarBotonEnvioRetencionMesa ? (
                      <div className="mt-3 space-y-1.5">
                        {retencionFaltantes.length > 0 ? (
                          <p className="text-xs text-amber-900">
                            Completa los documentos pendientes antes de enviar a Mesa
                            Control.
                          </p>
                        ) : null}
                        <Button
                          type="button"
                          className="w-full text-xs"
                          disabled={!puedeClickEnviarRetencionMesa}
                          onClick={() => {
                            if (!contextPrecalId || !retencionOpcion) return;
                            if (!puedeClickEnviarRetencionMesa) return;
                            setRetencionEnvioSaving(true);
                            void retencionEnvioMesaRepo
                              .save({
                                expedienteId: contextPrecalId,
                                opcion: retencionOpcion,
                                estado: "enviado",
                              })
                              .then((saved) => setRetencionEnvioMesa(saved))
                              .catch(() => {
                                alert(
                                  "No se pudo enviar Acuse/Aviso a Mesa Control. Intenta de nuevo.",
                                );
                              })
                              .finally(() => setRetencionEnvioSaving(false));
                          }}
                        >
                          {retencionEnvioSaving
                            ? "Enviando…"
                            : retencionEnvioUiEstado === "correccion_requerida"
                              ? "Reenviar Acuse/Aviso a Mesa Control"
                              : "Enviar Acuse/Aviso a Mesa Control"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                {!asesorIntegracionActiva ? (
                  <div
                    role="status"
                    className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"
                  >
                    {MSJ_ESPERA_MONTO_REVISOR}
                  </div>
                ) : null}

                {/* Documentos personales del cliente (tipos cliente_*) */}
                <div className="rounded-xl border border-gray-100 bg-white p-2">
                  <p className="text-sm font-semibold text-gray-900">
                    Documentos del cliente
                  </p>
                  <p className="mt-0.5 text-xs text-gray-600">
                    Sube los documentos personales del cliente requeridos en Integración.
                  </p>

                  <div className="mt-1.5 flex flex-col gap-1.5">
                    {CLIENTE_DOC_TIPOS.map(({ tipo, label }) => {
                      const item =
                        findRowPorTipoDocumento(archivosAll, tipo) ?? null;
                      const hasFile = Boolean(item?.id);
                      const esOpcional = CLIENTE_DOC_TIPOS_OPCIONALES.some((d) => d.tipo === tipo);

                      return (
                        <div
                          key={tipo}
                          className="rounded-lg border border-gray-100 bg-white p-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                {label}
                              </p>
                              <p className="mt-1 flex items-center gap-2 text-xs text-gray-800">
                                <span aria-hidden>{hasFile ? "✔" : esOpcional ? "○" : "❌"}</span>
                                <span>
                                  {hasFile
                                    ? "subido"
                                    : esOpcional
                                      ? "opcional — sin subir"
                                      : "faltante"}
                                </span>
                              </p>
                              {item?.nombre_original ? (
                                <p className="mt-0.5 truncate text-sm font-medium text-gray-900">
                                  {item.nombre_original}
                                </p>
                              ) : null}
                              {item?.mime_type ? (
                                <p className="mt-0.5 text-[11px] text-gray-500">
                                  Tipo: {item.mime_type}
                                </p>
                              ) : null}
                            </div>

                            <div className="flex flex-col items-end justify-center gap-1.5">
                              <FileUploadButton
                                accept={EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR}
                                label={hasFile ? "Reemplazar" : "Subir"}
                                disabled={!contextPrecalId || !asesorIntegracionActiva}
                                onFile={async (file) => {
                                  if (!contextPrecalId || !asesorIntegracionActiva) {
                                    if (!asesorIntegracionActiva) {
                                      window.alert(MSJ_ESPERA_MONTO_REVISOR);
                                    }
                                    return;
                                  }
                                  const pdfValidation = validatePdfFile(file);
                                  if (!pdfValidation.ok) {
                                    alert(pdfValidation.message);
                                    return;
                                  }
                                  await archivosRepo.replaceArchivo({
                                    expedienteId: contextPrecalId,
                                    tipo_documento: tipo,
                                    file,
                                    uploaded_by_role: "asesor",
                                    uploaded_by_email: contextAsesorId ?? "asesor",
                                  });
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Envío a mesa */}
                {asesorIntegracionActiva ? (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-2">
                    <p className="text-xs leading-tight text-blue-900">
                      En mesa-control se captura la cita en etapas específicas.
                    </p>
                    <div className="mt-1.5">
                      <Button
                        type="button"
                        variant="primary"
                        className={`w-full py-1.5 ${
                          !puedeEnviar && !submittedToMesa
                            ? "opacity-50 cursor-not-allowed"
                            : ""
                        }`}
                        disabled={submittedToMesa || !puedeEnviar}
                        onClick={async () => {
                          if (!asesorIntegracionActiva) {
                            window.alert(MSJ_ESPERA_MONTO_REVISOR);
                            return;
                          }
                          if (!puedeEnviar) {
                            alert(
                              "Debes subir todos los documentos del cliente antes de enviar",
                            );
                            return;
                          }

                          const idPrecal = contextPrecalId;
                          if (!idPrecal || !onEnviarAMesa) {
                            alert("No se pudo enviar: falta el contexto del expediente.");
                            return;
                          }
                          let persistResult: boolean | void;
                          try {
                            const etapaEnvio = etapaAlEnviarAMesaDesdeAsesor(
                              operativoEtapaId,
                            );
                            persistResult = await onEnviarAMesa({
                              id: idPrecal,
                              cliente_nombre: contextClienteNombre ?? "",
                              telefono_cliente: contextTelefono ?? "",
                              programa: contextPrograma ?? "",
                              asesorNombre: contextAsesorId ?? "",
                              etapaActual: etapaEnvio,
                              subestado: "en_validacion_mesa",
                              docs,
                            });
                          } catch (err) {
                            const msg =
                              err instanceof Error
                                ? err.message
                                : "No se pudo enviar a mesa de control.";
                            alert(msg);
                            return;
                          }
                          if (persistResult === false) {
                            return;
                          }

                          // UI post-envío: sigue en Integración (1) con subestado en validación mesa.
                          setSubmittedToMesa(true);
                          const etapaPostEnvio = etapaAlEnviarAMesaDesdeAsesor(
                            operativoEtapaId,
                          );
                          setTimeline((prev) => {
                            const ts = new Date().toISOString();
                            return {
                              ...prev,
                              [etapaPostEnvio]: {
                                ...(prev[etapaPostEnvio] ?? {
                                  notasInternas: "",
                                  motivo: undefined,
                                  fechaCita: undefined,
                                  fechaLiberacion: undefined,
                                  abogadoAsignado: undefined,
                                }),
                                estado: "en_validacion_mesa",
                                ultimaActualizacion: ts,
                              },
                            };
                          });
                          setOperativoEtapaId(etapaPostEnvio);
                          setSelectedStageId(etapaPostEnvio);
                        }}
                      >
                        {submittedToMesa
                          ? "Enviado a mesa de control"
                          : "Enviar a mesa de control"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    {MSJ_ESPERA_MONTO_REVISOR}
                  </div>
                )}
              </>
            )
          ) : currentRole === "mesa_control" ? (
            <div className="rounded-xl border border-gray-100 bg-white p-2.5 shadow-sm">
              <p className="text-sm font-semibold text-gray-900">
                Mesa de control
              </p>
              {!submittedToMesa ? (
                <p className="mt-1.5 text-xs text-yellow-800">
                  Aún no enviado por asesor. No puedes operar hasta que el asesor envíe el paquete.
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-2 py-1.5">
                    <p className="text-[11px] font-semibold text-gray-700">
                      Etapa en detalle (timeline)
                    </p>
                    <p className="mt-0.5 text-xs text-gray-800">
                      {etapaSeleccionada.id}. {etapaSeleccionada.nombre}
                    </p>
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      Etapa real del expediente:{" "}
                      {operativoEtapaId == null ? "—" : operativoEtapaId}
                    </p>
                  </div>

                  {readonlyHistoricalMesa && (
                    <div
                      role="status"
                      className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs leading-snug text-amber-950"
                    >
                      Estás visualizando una etapa histórica. Las acciones solo
                      aplican sobre la etapa actual del expediente.
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Acciones rápidas
                    </p>
                    <div className="mt-1.5 grid grid-cols-1 gap-1.5">
                      <Button
                        variant="primary"
                        onClick={handleAprobarYSiguiente}
                        className="text-xs"
                        disabled={!panelOperativoEditable}
                      >
                        Aprobar y pasar a siguiente
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleRegresarEtapaAnterior}
                        className="text-xs"
                        disabled={
                          !panelOperativoEditable ||
                          operativoEtapaId == null ||
                          operativoEtapaId <= 1
                        }
                      >
                        Regresar a etapa anterior
                      </Button>
                      <Button
                        variant="outline"
                        className="text-xs text-red-700 hover:text-red-800"
                        onClick={abrirModalRechazo}
                        disabled={!panelOperativoEditable}
                      >
                        Rechazar
                      </Button>
                    </div>
                  </div>

                  {operativoWarning && (
                    <p className="text-xs text-red-700">{operativoWarning}</p>
                  )}

                  {mostrarBloqueCita &&
                    (citaEditable ? (
                      <Input
                        type="datetime-local"
                        label="Fecha y hora de cita (firma)"
                        value={fechaCitaToDatetimeLocalInput(
                          estadoPanel.fechaCita ?? fechaCita,
                        )}
                        onChange={(e) =>
                          handleFechaCitaChange(
                            datetimeLocalInputToIso(e.target.value),
                          )
                        }
                      />
                    ) : (
                      <div className="rounded-lg border border-gray-100 bg-gray-50 px-2 py-2">
                        <p className="text-[11px] font-semibold text-gray-600">
                          Fecha de cita
                        </p>
                        <p className="mt-0.5 text-xs text-gray-900">
                          {formatFecha(estadoPanel.fechaCita ?? "")}
                        </p>
                        <p className="mt-1 text-[10px] text-gray-500">
                          Solo lectura (etapa histórica o no es la etapa operativa
                          actual).
                        </p>
                      </div>
                    ))}

                  {mostrarBloqueFechaLiberacion &&
                    (panelOperativoEditable ? (
                      <Input
                        type="date"
                        label="Fecha de liberación / registrado en"
                        value={estadoPanel.fechaLiberacion ?? fechaLiberacion}
                        onChange={(e) =>
                          handleFechaLiberacionChange(e.target.value)
                        }
                      />
                    ) : (
                      <div className="rounded-lg border border-gray-100 bg-gray-50 px-2 py-2">
                        <p className="text-[11px] font-semibold text-gray-600">
                          Fecha de liberación / registrado en
                        </p>
                        <p className="mt-0.5 text-xs text-gray-900">
                          {formatFecha(estadoPanel.fechaLiberacion ?? "")}
                        </p>
                      </div>
                    ))}

                  {mostrarBloqueAbogado &&
                    (panelOperativoEditable ? (
                      <Select
                        label="Abogado asignado"
                        value={estadoPanel.abogadoAsignado ?? abogadoAsignado}
                        onChange={(e) =>
                          handleAbogadoChange(e.target.value as Abogado | "")
                        }
                        options={[
                          { value: "", label: "Selecciona abogado" },
                          { value: "elis", label: "Elis" },
                          { value: "roberto", label: "Roberto" },
                        ]}
                      />
                    ) : (
                      <div className="rounded-lg border border-gray-100 bg-gray-50 px-2 py-2">
                        <p className="text-[11px] font-semibold text-gray-600">
                          Abogado asignado
                        </p>
                        <p className="mt-0.5 text-xs text-gray-900">
                          {estadoPanel.abogadoAsignado ?? abogadoAsignado ?? "—"}
                        </p>
                      </div>
                    ))}

                  {estadoPanel.estado === "rechazado" && estadoPanel.motivo && (
                    <div className="rounded-lg border border-red-100 bg-red-50/90 px-2 py-2 text-xs text-red-900">
                      <p className="font-semibold">Rechazo en esta etapa</p>
                      <p className="mt-0.5">
                        <span className="font-medium">Motivo:</span>{" "}
                        {motivosEtapaSeleccionada.find(
                          (m) => m.value === estadoPanel.motivo,
                        )?.label ?? estadoPanel.motivo}
                      </p>
                      {estadoPanel.comentarioRechazo?.trim() ? (
                        <p className="mt-1 whitespace-pre-wrap break-words">
                          <span className="font-medium">Comentario:</span>{" "}
                          {estadoPanel.comentarioRechazo}
                        </p>
                      ) : null}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="notas_internas"
                      className="text-sm font-medium text-gray-700"
                    >
                      Notas internas
                    </label>
                    <textarea
                      id="notas_internas"
                      value={estadoPanel.notasInternas}
                      onChange={(e) => handleGuardarNotas(e.target.value)}
                      disabled={!panelOperativoEditable}
                      placeholder="Notas internas de seguimiento..."
                      className="mt-1 h-24 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-600"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Modal Agenda eliminado: biométricos etapa 4 (asesor); firma etapa 9 (mesa admin). */}
      </div>

      {showRechazoModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="text-base font-semibold text-gray-900">
              Registrar rechazo de etapa
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Se persiste en el inbox mock (localStorage) vía mesa-control.
            </p>

            <div className="mt-4 space-y-3">
              <Select
                label="Motivo de rechazo"
                value={motivoRechazo}
                onChange={(e) => setMotivoRechazo(e.target.value)}
                options={[
                  { value: "", label: "Selecciona un motivo" },
                  ...motivosOperativa,
                ]}
              />
              <div>
                <label
                  htmlFor="nota_rechazo"
                  className="text-sm font-medium text-gray-700"
                >
                  Comentario del rechazo (opcional)
                </label>
                <textarea
                  id="nota_rechazo"
                  value={notaRechazo}
                  onChange={(e) => setNotaRechazo(e.target.value)}
                  placeholder="Detalle libre del rechazo..."
                  className="mt-1 h-24 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {operativoEtapaId === 2 &&
                motivoRechazo === "registrado_otro_proveedor" && (
                  <Input
                    type="date"
                    label="Fecha de liberación / registrado en"
                    value={fechaLiberacion}
                    onChange={(e) => setFechaLiberacion(e.target.value)}
                  />
                )}

              {operativoEtapaId === 12 &&
                motivoRechazo === "cliente_no_quiere_pagar" && (
                  <Select
                    label="Abogado asignado"
                    value={abogadoAsignado}
                    onChange={(e) =>
                      setAbogadoAsignado(e.target.value as Abogado | "")
                    }
                    options={[
                      { value: "", label: "Selecciona abogado" },
                      { value: "elis", label: "Elis" },
                      { value: "roberto", label: "Roberto" },
                    ]}
                  />
                )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={cerrarModalRechazo}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={handleConfirmarRechazo}
                disabled={!motivoRechazo}
              >
                Confirmar rechazo
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

