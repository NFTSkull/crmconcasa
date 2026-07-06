"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { useSessionRepo } from "@/domain/session";
import { AgendaBiometricosCard } from "@/components/asesor/AgendaBiometricosCard";
import { AsesorAgendaBiometricosSupabaseGate } from "@/components/asesor/AsesorAgendaBiometricosSupabaseGate";
import { AsesorAgendaFirmasSupabaseGate } from "@/components/asesor/AsesorAgendaFirmasSupabaseGate";
import { RetencionAcuseAvisoSupabaseCard } from "@/components/asesor/RetencionAcuseAvisoSupabaseCard";
import { AsesorIntegracionDocsUpload } from "@/components/asesor/AsesorIntegracionDocsUpload";
import { AsesorSeguimientoOperativo } from "@/components/asesor/AsesorSeguimientoOperativo";
import { canMountAgendaBiometricosUI } from "@/lib/agendaFirmasBookingsGuard";
import { AgendaFirmasAsesorCard } from "@/components/asesor/AgendaFirmasAsesorCard";
import { ExpedienteClienteDatosFormSection } from "@/components/asesor/ExpedienteClienteDatosFormSection";
import { Button } from "@/components/ui/Button";
import { SeguimientoOperativoMock } from "@/components/seguimiento/SeguimientoOperativoMock";
import {
  ExpedientesSupabaseError,
  useExpedientesRepo,
  isProgramaMejoravit,
  mapProgramaUiToDb,
  type ExpedienteMock,
} from "@/domain/expedientes";
import {
  MockExpedientesRepo,
} from "@/domain/expedientes/mock.repo";
import { isDataModeSupabase } from "@/lib/dataMode";
import { parseMontoAprobado } from "@/lib/monto";
import { canShowAsesorRetencionSupabasePanel } from "@/domain/expediente-retencion";
import {
  DOCUMENTO_CATALOGO_MAP,
  ExpedienteArchivosSupabaseError,
  countIntegrationDocsPresentes,
  deriveIntegrationDocsChecklist,
  deriveIntegrationDocsChecklistOpcionales,
  filterChecklistDocumentoItemsPorOwnerRole,
  getChecklistDocumentos,
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  integrationDocsCompletos,
  integrationDocsResumenFromArchivoResumen,
  useExpedienteArchivosRepo,
  type ExpedienteArchivoResumen,
  type IntegrationDocChecklistItem,
} from "@/domain/expediente-archivos";
import {
  ClienteDatosSupabaseError,
  useExpedienteClienteDatosRepo,
  type ExpedienteClienteDatos,
} from "@/domain/expediente-cliente-datos";
import {
  getClienteDatosCamposFaltantes,
  getNotaMesaLongitudError,
} from "@/lib/clienteDatosFormCompleteness";
import {
  formatClienteDatosValidationSummary,
  normalizeClienteDatosForSave,
  validateClienteDatos,
  type ClienteDatosFieldErrors,
} from "@/lib/clienteDatosValidation";
import {
  applyMontoCalculadoSugeridoSiNoBloqueado,
  applyMontoCalculadoSugeridoSiNoEditado,
  applyMontoMejoravitSugeridoSiVacio,
  calcMontoCalculadoCobro,
  cobroInputsAfectanMontoCalculado,
  isMontoCalculadoManualRespectoAuto,
  isMontoMejoravitGuardado,
  isProgramaMejoravitDb,
  parsePorcentajeCobroInput,
} from "@/lib/clienteDatosCobro";
import {
  isDraftNewerThanOfficial,
  readClienteDatosDraft,
  removeClienteDatosDraft,
  writeClienteDatosDraft,
} from "@/lib/clienteDatosDraftLocalStorage";
import { asesorDebeUsarCorreccionClienteDatos } from "@/domain/expediente-archivos/asesor-correccion-post-mesa";

type ClienteDatosFormState = ExpedienteClienteDatos["datos"];

const EMPTY_CLIENTE_DATOS: ClienteDatosFormState = {
  nombreCliente: "",
  nss: "",
  curp: "",
  rfc: "",
  celular: "",
  correo: "",
  empresa: "",
  registroPatronal: "",
  telefonoEmpresa: "",
  referencias: [
    { nombre: "", celular: "" },
    { nombre: "", celular: "" },
  ],
  beneficiario: { nombre: "", parentesco: "" },
  direccionEmpresa: { calle: "", colonia: "", municipio: "", cp: "" },
  montoMejoravit: "",
  plazo: "",
  porcentajeCobro: "",
  montoCalculado: "",
  metodoPago: "",
  notaMesa: "",
};

interface PrecalificacionMock {
  id: string;
  programa: string;
  nss: string;
  cliente_nombre: string;
  telefono_cliente: string;
  direccion_opcional: string;
  asesorId: string;
  createdAt: string;
}

interface OperativoStatus {
  etapaActual: number | null;
  subestado?: string | null;
  fechaCita?: string | null;
  updatedAt?: string | null;
  motivoRechazo?: string | null;
  comentarioRechazo?: string | null;
  submittedToMesa: boolean;
  fechaEnvioMesa?: string | null;
  cicloEstado?: string | null;
  origenMesa?: string | null;
}

type EstadoEtapa =
  | "pendiente"
  | "en_validacion_mesa"
  | "en_proceso"
  | "aprobado"
  | "rechazado";

const MSJ_ESPERA_MONTO_REVISOR =
  "Registra un monto aprobado mayor a cero para capturar datos, subir documentos o enviar a Mesa.";

const MSJ_UPLOAD_FORMATO =
  "Sube el documento en formato PDF (máx. 15 MB) por cada documento del asesor requerido.";

const MSJ_ENVIO_MESA_REQUISITOS =
  "El envío a Mesa se habilitará cuando editor, datos generales y los 4 documentos del asesor estén completos. Acta y constancia SAT las sube Mesa después.";

function editorDecisionLabel(decision?: string | null): string {
  if (decision === "aprobado") return "Aprobado";
  if (decision === "no_cumple") return "No cumple";
  return "Pendiente";
}

function checklistLabel(ok: boolean): string {
  return ok ? "OK" : "Falta";
}

function checklistClass(ok: boolean): string {
  return ok
    ? "text-green-800 bg-green-50 border-green-200"
    : "text-amber-950 bg-amber-50 border-amber-200";
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

export default function AsesorExpedientePage() {
  const { id } = useParams<{ id: string }>();
  const { currentUser } = useSessionRepo();
  const repo = useExpedientesRepo();
  const mockRepo = useMemo(() => new MockExpedientesRepo(), []);
  const dataSupabase = isDataModeSupabase();
  const clienteDatosRepo = useExpedienteClienteDatosRepo();
  const archivosRepo = useExpedienteArchivosRepo();
  const [precal, setPrecal] = useState<PrecalificacionMock | null | undefined>(
    undefined
  );
  const [operativo, setOperativo] = useState<OperativoStatus | null>(null);
  const [checklist, setChecklist] = useState<
    Awaited<ReturnType<typeof getChecklistDocumentos>> | null
  >(null);
  const [clienteDatos, setClienteDatos] = useState<ClienteDatosFormState>(
    EMPTY_CLIENTE_DATOS,
  );
  const [clienteDatosMeta, setClienteDatosMeta] = useState<{
    estado: ExpedienteClienteDatos["estado"];
    comentarioRechazo?: string;
    validatedAt?: string;
    validatedBy?: string;
    rejectedAt?: string;
    rejectedBy?: string;
    updatedAt: string;
    updatedBy: string;
  } | null>(null);
  const [clienteDatosSaving, setClienteDatosSaving] = useState(false);
  const [clienteDatosLoading, setClienteDatosLoading] = useState(false);
  const [clienteDatosSaved, setClienteDatosSaved] = useState(false);
  const [clienteDatosError, setClienteDatosError] = useState<string | null>(null);
  const [clienteDatosFieldErrors, setClienteDatosFieldErrors] =
    useState<ClienteDatosFieldErrors>({});
  const [clienteDatosShowValidation, setClienteDatosShowValidation] = useState(false);
  const montoMejoravitLockedRef = useRef(false);
  const montoCalculadoLockedRef = useRef(false);
  const [direccionOpcional, setDireccionOpcional] = useState("");
  const [clienteDatosLocalDraftSaved, setClienteDatosLocalDraftSaved] =
    useState(false);
  const [clienteDatosLocalDraftRestored, setClienteDatosLocalDraftRestored] =
    useState(false);
  const [clienteDatosHasUnsavedChanges, setClienteDatosHasUnsavedChanges] =
    useState(false);
  const hasUserEditedClienteDatos = useRef(false);
  const suppressDraftAutosave = useRef(false);
  const [editorDecision, setEditorDecision] = useState<
    ExpedienteMock["editorDecision"] | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enviandoMesa, setEnviandoMesa] = useState(false);
  const [enviarMesaError, setEnviarMesaError] = useState<string | null>(null);
  const [enviarMesaExito, setEnviarMesaExito] = useState<string | null>(null);
  const [montoAprobadoInput, setMontoAprobadoInput] = useState("");
  const [montoSaving, setMontoSaving] = useState(false);
  const [montoError, setMontoError] = useState<string | null>(null);
  const [montoExito, setMontoExito] = useState<string | null>(null);
  const [archivosResumen, setArchivosResumen] = useState<
    ExpedienteArchivoResumen[] | null
  >(null);
  const [archivosLoading, setArchivosLoading] = useState(false);
  const [archivosError, setArchivosError] = useState<string | null>(null);

  const integrationDocsInput = useMemo(
    () =>
      archivosResumen
        ? integrationDocsResumenFromArchivoResumen(archivosResumen)
        : null,
    [archivosResumen],
  );

  const integrationChecklistObligatorios = useMemo((): IntegrationDocChecklistItem[] | null => {
    if (!integrationDocsInput) return null;
    return deriveIntegrationDocsChecklist(integrationDocsInput);
  }, [integrationDocsInput]);

  const integrationChecklistOpcionales = useMemo((): IntegrationDocChecklistItem[] | null => {
    if (!integrationDocsInput) return null;
    return deriveIntegrationDocsChecklistOpcionales(integrationDocsInput);
  }, [integrationDocsInput]);

  const integrationDocsPresentes = useMemo(() => {
    if (!integrationDocsInput) return 0;
    return countIntegrationDocsPresentes(integrationDocsInput);
  }, [integrationDocsInput]);

  const documentosCompletos = useMemo(() => {
    if (!integrationDocsInput) return false;
    return integrationDocsCompletos(integrationDocsInput);
  }, [integrationDocsInput]);

  const hasMontoAprobado = useMemo(
    () => Number(editorDecision?.monto_aprobado ?? 0) > 0,
    [editorDecision],
  );

  const montoAprobadoEditor = useMemo(() => {
    const m = editorDecision?.monto_aprobado;
    return typeof m === "number" && Number.isFinite(m) && m > 0 ? m : null;
  }, [editorDecision]);

  const programaDb = useMemo(
    () => (precal?.programa ? mapProgramaUiToDb(precal.programa) : null),
    [precal?.programa],
  );

  const esMejoravit = useMemo(
    () => (precal?.programa ? isProgramaMejoravit(precal.programa) : false),
    [precal?.programa],
  );

  const handleClienteDatosChange = useCallback(
    (value: SetStateAction<ClienteDatosFormState>) => {
      hasUserEditedClienteDatos.current = true;
      setClienteDatosHasUnsavedChanges(true);
      setClienteDatos((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        if (montoCalculadoLockedRef.current) return next;
        if (!cobroInputsAfectanMontoCalculado(prev, next)) return next;
        return applyMontoCalculadoSugeridoSiNoBloqueado(
          next,
          montoAprobadoEditor,
          programaDb,
          false,
        );
      });
    },
    [montoAprobadoEditor, programaDb],
  );

  const clearClienteDatosLocalDraft = useCallback(
    (expedienteId: string) => {
      if (currentUser?.email) {
        removeClienteDatosDraft(currentUser.email, expedienteId);
      }
      setClienteDatosLocalDraftSaved(false);
      setClienteDatosLocalDraftRestored(false);
      setClienteDatosHasUnsavedChanges(false);
      hasUserEditedClienteDatos.current = false;
    },
    [currentUser?.email],
  );

  const tryRestoreClienteDatosDraft = useCallback(
    (expedienteId: string, found: ExpedienteClienteDatos | null) => {
      const userEmail = currentUser?.email;
      if (!userEmail) return;

      const draft = readClienteDatosDraft(userEmail, expedienteId);
      if (!draft) return;

      if (
        !isDraftNewerThanOfficial(draft.updatedAt, found?.updatedAt ?? null)
      ) {
        removeClienteDatosDraft(userEmail, expedienteId);
        return;
      }

      suppressDraftAutosave.current = true;

      let shouldRestore = false;
      if (!found) {
        shouldRestore = true;
      } else {
        shouldRestore = window.confirm(
          "Tienes un borrador sin guardar. ¿Quieres recuperarlo?",
        );
      }

      if (shouldRestore) {
        const autoDraft = calcMontoCalculadoCobro(
          montoAprobadoEditor,
          parsePorcentajeCobroInput(draft.clienteDatos.porcentajeCobro),
          { programaDb, montoMejoravitForm: draft.clienteDatos.montoMejoravit },
        );
        montoCalculadoLockedRef.current =
          autoDraft != null &&
          isMontoCalculadoManualRespectoAuto(draft.clienteDatos.montoCalculado, autoDraft);
        const draftConAuto = applyMontoCalculadoSugeridoSiNoBloqueado(
          draft.clienteDatos,
          montoAprobadoEditor,
          programaDb,
          montoCalculadoLockedRef.current,
        );
        setClienteDatos(draftConAuto);
        setClienteDatosLocalDraftSaved(true);
        setClienteDatosLocalDraftRestored(true);
        setClienteDatosHasUnsavedChanges(false);
        hasUserEditedClienteDatos.current = false;
      }

      queueMicrotask(() => {
        suppressDraftAutosave.current = false;
      });
    },
    [currentUser?.email, montoAprobadoEditor, programaDb],
  );

  useEffect(() => {
    if (suppressDraftAutosave.current) return;
    if (!hasUserEditedClienteDatos.current) return;
    if (!precal?.id || !currentUser?.email) return;

    const timer = window.setTimeout(() => {
      writeClienteDatosDraft(
        currentUser.email,
        String(precal.id),
        clienteDatos,
      );
      setClienteDatosLocalDraftSaved(true);
    }, 600);

    return () => window.clearTimeout(timer);
  }, [clienteDatos, currentUser?.email, precal?.id]);

  const camposFaltantesClienteDatos = useMemo(
    () =>
      getClienteDatosCamposFaltantes(clienteDatos, {
        montoAprobado: montoAprobadoEditor,
        direccionOpcional,
        programaDb,
      }),
    [clienteDatos, direccionOpcional, montoAprobadoEditor, programaDb],
  );

  const datosGeneralesCompletos = useMemo(() => {
    if (camposFaltantesClienteDatos.length > 0) return false;
    if (!clienteDatosMeta) return false;
    return (
      clienteDatosMeta.estado === "completo" ||
      clienteDatosMeta.estado === "validado"
    );
  }, [camposFaltantesClienteDatos, clienteDatosMeta]);

  const puedeEnviarAMesaSupabase = useMemo(
    () =>
      hasMontoAprobado &&
      datosGeneralesCompletos &&
      documentosCompletos &&
      !operativo?.submittedToMesa,
    [
      datosGeneralesCompletos,
      documentosCompletos,
      hasMontoAprobado,
      operativo?.submittedToMesa,
    ],
  );

  const initialSubestado: EstadoEtapa | undefined =
    operativo?.subestado ? (operativo.subestado as EstadoEtapa) : undefined;

  const loadExpediente = useCallback(async () => {
    try {
      const exp = await repo.getById(id);
      if (!exp) {
        setPrecal(null);
        setOperativo(null);
        setEditorDecision(null);
        setLoadError(null);
        return;
      }
      setLoadError(null);
      setEditorDecision(exp.editorDecision);
      setPrecal({
        id: exp.id,
        programa: exp.base.programa,
        nss: exp.base.nss,
        cliente_nombre: exp.base.cliente_nombre,
        telefono_cliente: exp.base.telefono_cliente,
        direccion_opcional: exp.base.direccion_opcional,
        asesorId: exp.base.asesorId,
        createdAt: exp.base.createdAt,
      });
      setDireccionOpcional(exp.base.direccion_opcional ?? "");
      setOperativo({
        etapaActual: exp.operativo.etapaActual,
        subestado: exp.operativo.subestado,
        fechaCita: exp.operativo.fechaCita,
        updatedAt: exp.operativo.updatedAt,
        motivoRechazo: exp.operativo.motivoRechazo,
        comentarioRechazo: exp.operativo.comentarioRechazo,
        submittedToMesa: exp.operativo.submittedToMesa,
        fechaEnvioMesa: exp.operativo.fechaEnvioMesa,
        cicloEstado: exp.operativo.cicloEstado,
        origenMesa: exp.base.origenMesa,
      });
    } catch (err) {
      setPrecal(null);
      setOperativo(null);
      setEditorDecision(null);
      if (err instanceof ExpedientesSupabaseError) {
        setLoadError(err.message);
      } else {
        setLoadError("No se pudo cargar el expediente.");
      }
    }
  }, [id, repo]);

  useEffect(() => {
    void loadExpediente();
  }, [loadExpediente]);

  useEffect(() => {
    const m = editorDecision?.monto_aprobado;
    if (typeof m === "number" && Number.isFinite(m) && m > 0) {
      setMontoAprobadoInput(String(m));
    } else {
      setMontoAprobadoInput("");
    }
  }, [editorDecision?.monto_aprobado]);

  useEffect(() => {
    if (!isProgramaMejoravitDb(programaDb)) {
      montoMejoravitLockedRef.current = false;
      setClienteDatos((prev) =>
        prev.montoMejoravit === "" && prev.plazo === ""
          ? prev
          : { ...prev, montoMejoravit: "", plazo: "" },
      );
      return;
    }
    if (montoMejoravitLockedRef.current) return;
    setClienteDatos((prev) => {
      const withMejoravit = applyMontoMejoravitSugeridoSiVacio(
        prev,
        programaDb,
        montoAprobadoEditor,
      );
      if (montoCalculadoLockedRef.current) return withMejoravit;
      return applyMontoCalculadoSugeridoSiNoEditado(
        withMejoravit,
        montoAprobadoEditor,
        programaDb,
      );
    });
  }, [programaDb, montoAprobadoEditor]);

  const handleMontoMejoravitEdited = useCallback(() => {
    montoMejoravitLockedRef.current = true;
  }, []);

  useEffect(() => {
    if (montoCalculadoLockedRef.current) return;
    setClienteDatos((prev) =>
      applyMontoCalculadoSugeridoSiNoEditado(prev, montoAprobadoEditor, programaDb),
    );
  }, [programaDb, montoAprobadoEditor]);

  const handleMontoCalculadoEdited = useCallback(() => {
    montoCalculadoLockedRef.current = true;
  }, []);

  const handleGuardarMontoAprobado = useCallback(async () => {
    if (!precal?.id || montoSaving || operativo?.submittedToMesa) return;

    const parsed = parseMontoAprobado(String(montoAprobadoInput).trim());
    if (parsed === null || parsed <= 0) {
      setMontoError("El monto aprobado debe ser mayor a cero.");
      setMontoExito(null);
      return;
    }

    setMontoSaving(true);
    setMontoError(null);
    setMontoExito(null);

    try {
      await repo.asesorUpdateMontoAprobado(String(precal.id), parsed);
      await loadExpediente();
      setMontoExito("Monto aprobado guardado correctamente.");
    } catch (err) {
      if (err instanceof ExpedientesSupabaseError) {
        setMontoError(err.message);
      } else {
        setMontoError("No se pudo guardar el monto aprobado.");
      }
    } finally {
      setMontoSaving(false);
    }
  }, [
    loadExpediente,
    montoAprobadoInput,
    montoSaving,
    operativo?.submittedToMesa,
    precal?.id,
    repo,
  ]);

  const handleEnviarAMesaSupabase = useCallback(async () => {
    if (
      !precal?.id ||
      enviandoMesa ||
      operativo?.submittedToMesa ||
      !puedeEnviarAMesaSupabase
    ) {
      return;
    }

    const confirmar = window.confirm(
      "¿Confirmas enviar este expediente a Mesa de control? La validación la realiza Supabase.",
    );
    if (!confirmar) return;

    setEnviandoMesa(true);
    setEnviarMesaError(null);
    setEnviarMesaExito(null);

    try {
      await repo.enviarAMesa(String(precal.id));
      await loadExpediente();
      setEnviarMesaExito("Expediente enviado a Mesa de control correctamente.");
    } catch (err) {
      if (err instanceof ExpedientesSupabaseError) {
        setEnviarMesaError(err.message);
      } else {
        setEnviarMesaError("No se pudo enviar a Mesa. Intenta de nuevo más tarde.");
      }
    } finally {
      setEnviandoMesa(false);
    }
  }, [
    enviandoMesa,
    loadExpediente,
    operativo?.submittedToMesa,
    puedeEnviarAMesaSupabase,
    precal?.id,
    repo,
  ]);

  const refreshArchivos = useCallback(() => {
    if (!dataSupabase || !precal?.id) return;
    setArchivosLoading(true);
    setArchivosError(null);
    void archivosRepo
      .listResumenByExpediente(String(precal.id))
      .then((resumen) => {
        setArchivosResumen(resumen);
      })
      .catch((err) => {
        setArchivosResumen(null);
        if (err instanceof ExpedienteArchivosSupabaseError) {
          setArchivosError(err.message);
        } else {
          setArchivosError("No se pudieron cargar los documentos.");
        }
      })
      .finally(() => {
        setArchivosLoading(false);
      });
  }, [archivosRepo, dataSupabase, precal?.id]);

  useEffect(() => {
    if (!dataSupabase || !precal?.id) return;
    let cancelled = false;

    const loadArchivos = () => {
      setArchivosLoading(true);
      setArchivosError(null);
      void archivosRepo
        .listResumenByExpediente(String(precal.id))
        .then((resumen) => {
          if (cancelled) return;
          setArchivosResumen(resumen);
        })
        .catch((err) => {
          if (cancelled) return;
          setArchivosResumen(null);
          if (err instanceof ExpedienteArchivosSupabaseError) {
            setArchivosError(err.message);
          } else {
            setArchivosError("No se pudieron cargar los documentos.");
          }
        })
        .finally(() => {
          if (!cancelled) setArchivosLoading(false);
        });
    };

    loadArchivos();

    return () => {
      cancelled = true;
    };
  }, [archivosRepo, dataSupabase, precal?.id]);

  useEffect(() => {
    if (dataSupabase || !precal?.id) return;
    let cancelled = false;
    const refresh = () => {
      void getChecklistDocumentos(String(precal.id), 1, {
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
        String(changedId) !== String(precal.id)
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
  }, [dataSupabase, precal?.id]);

  useEffect(() => {
    if (!precal?.id) return;
    let cancelled = false;

    const applyFound = (found: ExpedienteClienteDatos | null) => {
      if (cancelled) return;
      hasUserEditedClienteDatos.current = false;
      suppressDraftAutosave.current = true;
      setClienteDatosLocalDraftSaved(false);
      setClienteDatosLocalDraftRestored(false);
      setClienteDatosHasUnsavedChanges(false);
      if (!found) {
        montoMejoravitLockedRef.current = false;
        montoCalculadoLockedRef.current = false;
        setClienteDatos((prev) => ({
          ...prev,
          nombreCliente: prev.nombreCliente || precal.cliente_nombre || "",
          nss: prev.nss || precal.nss || "",
          celular: prev.celular || precal.telefono_cliente || "",
        }));
        setClienteDatosMeta(null);
        tryRestoreClienteDatosDraft(String(precal.id), null);
        queueMicrotask(() => {
          suppressDraftAutosave.current = false;
        });
        return;
      }
      montoMejoravitLockedRef.current = isMontoMejoravitGuardado(
        found.datos.montoMejoravit ?? "",
      );
      const pctCargado = parsePorcentajeCobroInput(
        found.datos.porcentajeCobro ||
          (found.porcentajeCobro != null ? String(found.porcentajeCobro) : ""),
      );
      const montoAutoCargado = calcMontoCalculadoCobro(montoAprobadoEditor, pctCargado, {
        programaDb,
        montoMejoravitForm: found.datos.montoMejoravit ?? "",
      });
      const montoCalculadoCargado =
        found.datos.montoCalculado ||
        (found.montoCalculado != null ? String(found.montoCalculado) : "");
      montoCalculadoLockedRef.current =
        montoAutoCargado != null &&
        isMontoCalculadoManualRespectoAuto(montoCalculadoCargado, montoAutoCargado);
      const datosCargados = {
        ...found.datos,
        rfc: found.datos.rfc ?? "",
        montoMejoravit: found.datos.montoMejoravit ?? "",
        plazo: found.datos.plazo ?? "",
        porcentajeCobro:
          found.datos.porcentajeCobro ||
          (found.porcentajeCobro != null ? String(found.porcentajeCobro) : ""),
        montoCalculado: montoCalculadoCargado,
        metodoPago: found.datos.metodoPago || found.metodoPago || "",
      };
      setClienteDatos(
        applyMontoCalculadoSugeridoSiNoBloqueado(
          datosCargados,
          montoAprobadoEditor,
          programaDb,
          montoCalculadoLockedRef.current,
        ),
      );
      setClienteDatosMeta({
        estado: found.estado,
        comentarioRechazo: found.comentarioRechazo,
        validatedAt: found.validatedAt,
        validatedBy: found.validatedBy,
        rejectedAt: found.rejectedAt,
        rejectedBy: found.rejectedBy,
        updatedAt: found.updatedAt,
        updatedBy: found.updatedBy,
      });
      tryRestoreClienteDatosDraft(String(precal.id), found);
      queueMicrotask(() => {
        suppressDraftAutosave.current = false;
      });
    };

    const load = () => {
      if (dataSupabase) setClienteDatosLoading(true);
      void clienteDatosRepo
        .getByExpedienteId(String(precal.id))
        .then((found) => {
          applyFound(found);
        })
        .catch((err) => {
          if (cancelled) return;
          setClienteDatosMeta(null);
          if (err instanceof ClienteDatosSupabaseError) {
            setClienteDatosError(err.message);
          }
        })
        .finally(() => {
          if (!cancelled && dataSupabase) setClienteDatosLoading(false);
        });
    };

    load();

    if (dataSupabase) {
      return () => {
        cancelled = true;
      };
    }

    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ expedienteId?: string | null }>;
      const changedId = ce.detail?.expedienteId;
      if (
        changedId != null &&
        changedId !== "" &&
        String(changedId) !== String(precal.id)
      ) {
        return;
      }
      load();
    };

    window.addEventListener(
      "expediente_cliente_datos_updated",
      handler as EventListener,
    );
    return () => {
      cancelled = true;
      window.removeEventListener(
        "expediente_cliente_datos_updated",
        handler as EventListener,
      );
    };
  }, [
    clienteDatosRepo,
    currentUser?.email,
    dataSupabase,
    precal?.cliente_nombre,
    precal?.id,
    precal?.nss,
    precal?.telefono_cliente,
    tryRestoreClienteDatosDraft,
  ]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "mesa_control_inbox") {
        void loadExpediente();
      }
    };
    window.addEventListener("storage", handler);
    const customHandler = () => {
      void loadExpediente();
    };
    window.addEventListener("mesa_control_inbox_updated", customHandler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("mesa_control_inbox_updated", customHandler);
    };
  }, [loadExpediente]);

  useEffect(() => {
    const onDecisionsUpdated = () => {
      void loadExpediente();
    };
    window.addEventListener("decisions_mock_updated", onDecisionsUpdated);
    return () =>
      window.removeEventListener("decisions_mock_updated", onDecisionsUpdated);
  }, [loadExpediente]);

  const handleSaveClienteDatos = useCallback(async (): Promise<
    { ok: true } | { ok: false; message: string }
  > => {
    if (!precal?.id) {
      return { ok: false, message: "No hay expediente para guardar." };
    }
    if (!currentUser?.email) {
      return { ok: false, message: "Sesión inválida." };
    }
    if (!hasMontoAprobado) {
      window.alert(MSJ_ESPERA_MONTO_REVISOR);
      return { ok: false, message: MSJ_ESPERA_MONTO_REVISOR };
    }
    const notaError = getNotaMesaLongitudError(clienteDatos.notaMesa);
    if (notaError) {
      setClienteDatosError(notaError);
      return { ok: false, message: notaError };
    }
    const validation = validateClienteDatos(clienteDatos, {
      montoAprobado: montoAprobadoEditor,
      direccionOpcional,
      programaDb,
    });
    if (!validation.isValid) {
      setClienteDatosShowValidation(true);
      setClienteDatosFieldErrors(validation.errors);
      const message = formatClienteDatosValidationSummary(validation);
      setClienteDatosError(message);
      return { ok: false, message };
    }
    setClienteDatosSaving(true);
    setClienteDatosError(null);
    setClienteDatosFieldErrors({});
    setClienteDatosShowValidation(false);
    setClienteDatosSaved(false);
    const datosAGuardar = normalizeClienteDatosForSave(clienteDatos);
    try {
      const usarCorreccion = asesorDebeUsarCorreccionClienteDatos(
        Boolean(operativo?.submittedToMesa),
        clienteDatosMeta !== null,
      );
      const saveInput = {
        expedienteId: String(precal.id),
        datos: datosAGuardar,
        direccionOpcional,
        updatedBy: currentUser.email,
        programaDb,
        montoCalculadoEsManual: montoCalculadoLockedRef.current,
      };
      const saved = usarCorreccion
        ? await clienteDatosRepo.saveCorreccion(saveInput)
        : await clienteDatosRepo.save(saveInput);
      setClienteDatos(datosAGuardar);
      if (isMontoMejoravitGuardado(datosAGuardar.montoMejoravit)) {
        montoMejoravitLockedRef.current = true;
      }
      setDireccionOpcional(direccionOpcional.trim());
      const nombreGuardado = datosAGuardar.nombreCliente.trim();
      setPrecal((prev) =>
        prev
          ? {
              ...prev,
              direccion_opcional: direccionOpcional.trim(),
              cliente_nombre: nombreGuardado || prev.cliente_nombre,
            }
          : prev,
      );
      await loadExpediente();
      setClienteDatosMeta({
        estado: saved.estado,
        comentarioRechazo: saved.comentarioRechazo,
        validatedAt: saved.validatedAt,
        validatedBy: saved.validatedBy,
        rejectedAt: saved.rejectedAt,
        rejectedBy: saved.rejectedBy,
        updatedAt: saved.updatedAt,
        updatedBy: saved.updatedBy,
      });
      setClienteDatosSaved(true);
      clearClienteDatosLocalDraft(String(precal.id));
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof ClienteDatosSupabaseError
          ? err.message
          : err instanceof Error
            ? err.message
            : "No se pudo guardar los datos del cliente.";
      setClienteDatosError(message);
      return { ok: false, message };
    } finally {
      setClienteDatosSaving(false);
    }
  }, [
    clearClienteDatosLocalDraft,
    clienteDatos,
    clienteDatosMeta?.estado,
    clienteDatosRepo,
    currentUser?.email,
    direccionOpcional,
    operativo?.submittedToMesa,
    precal?.id,
    hasMontoAprobado,
    montoAprobadoEditor,
    programaDb,
    loadExpediente,
  ]);

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

  if (precal === null) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="border-b border-gray-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <Link
              href="/asesor"
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Volver al dashboard
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {loadError ??
              (dataSupabase
                ? "Expediente no encontrado o no tienes permiso para verlo."
                : "Expediente no encontrado.")}
          </p>
          <Link href="/asesor" className="mt-4 inline-block">
            <Button variant="secondary">Volver al dashboard</Button>
          </Link>
        </main>
      </div>
    );
  }

  if (!precal) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando expediente...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link
            href="/asesor"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Volver al dashboard
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">
            ConCasa CRM · Expediente asesor
          </h1>
          <span />
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          <p>
            <span className="font-medium text-gray-900">Programa:</span>{" "}
            {precal.programa}
          </p>
          <p>
            <span className="font-medium text-gray-900">NSS:</span> {precal.nss}
          </p>
          <p>
            <span className="font-medium text-gray-900">Cliente:</span>{" "}
            {precal.cliente_nombre || "—"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Teléfono:</span>{" "}
            {precal.telefono_cliente || "—"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Dirección:</span>{" "}
            {precal.direccion_opcional || "—"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Asesor:</span>{" "}
            {precal.asesorId}
          </p>
          <p>
            <span className="font-medium text-gray-900">Creada:</span>{" "}
            {formatDateTime(precal.createdAt)}
          </p>
        </div>

        {loadError ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {loadError}
          </p>
        ) : null}

        {dataSupabase ? (
          <>
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
              <p className="text-sm font-semibold text-gray-900">
                Decisión del editor
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <p>
                  <span className="font-medium text-gray-900">Decisión:</span>{" "}
                  {editorDecisionLabel(editorDecision?.decision)}
                </p>
                <p>
                  <span className="font-medium text-gray-900">
                    {esMejoravit ? "Subcuenta de vivienda:" : "Monto aprobado:"}
                  </span>{" "}
                  {hasMontoAprobado && typeof editorDecision?.monto_aprobado === "number"
                    ? `$${editorDecision.monto_aprobado.toLocaleString("es-MX")}`
                    : "—"}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-medium text-gray-900">Notas revisión:</span>{" "}
                  {editorDecision?.notas_revision?.trim() || "—"}
                </p>
              </div>
              {!operativo?.submittedToMesa ? (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="flex-1 text-xs text-gray-600">
                    <span className="mb-1 block font-medium text-gray-900">
                      {esMejoravit ? "Subcuenta de vivienda (MXN)" : "Monto aprobado (MXN)"}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={montoAprobadoInput}
                      onChange={(e) => {
                        setMontoAprobadoInput(e.target.value);
                        setMontoError(null);
                        setMontoExito(null);
                      }}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
                      placeholder="Ej. 250000"
                    />
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={montoSaving}
                    onClick={() => void handleGuardarMontoAprobado()}
                  >
                    {montoSaving ? "Guardando…" : "Guardar monto"}
                  </Button>
                </div>
              ) : null}
              {montoExito ? (
                <p
                  role="status"
                  className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900"
                >
                  {montoExito}
                </p>
              ) : null}
              {montoError ? (
                <p
                  role="alert"
                  className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                >
                  {montoError}
                </p>
              ) : null}
            </div>
            {!hasMontoAprobado ? (
              <div
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              >
                {MSJ_ESPERA_MONTO_REVISOR}
              </div>
            ) : null}
            <ExpedienteClienteDatosFormSection
              clienteDatos={clienteDatos}
              setClienteDatos={handleClienteDatosChange}
              direccionOpcional={direccionOpcional}
              setDireccionOpcional={setDireccionOpcional}
              clienteDatosMeta={clienteDatosMeta}
              clienteDatosSaving={clienteDatosSaving}
              clienteDatosLoading={clienteDatosLoading}
              clienteDatosSaved={clienteDatosSaved}
              clienteDatosError={clienteDatosError}
              localDraftSaved={clienteDatosLocalDraftSaved}
              localDraftRestored={clienteDatosLocalDraftRestored}
              hasUnsavedLocalChanges={clienteDatosHasUnsavedChanges}
              camposFaltantes={camposFaltantesClienteDatos}
              fieldErrors={clienteDatosFieldErrors}
              showFieldErrors={clienteDatosShowValidation}
              puedeIntegrar={hasMontoAprobado}
              submittedToMesa={operativo?.submittedToMesa ?? false}
              dataSupabase
              formatDateTime={formatDateTime}
              onSave={handleSaveClienteDatos}
              esperaMontoMessage={MSJ_ESPERA_MONTO_REVISOR}
              montoAprobado={montoAprobadoEditor}
              programaDb={programaDb}
              onMontoMejoravitEdited={handleMontoMejoravitEdited}
              onMontoCalculadoEdited={handleMontoCalculadoEdited}
            />
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
              <p className="text-sm font-semibold text-gray-900">
                Documentos requeridos
              </p>
              <p className="mt-1 text-xs text-gray-500">{MSJ_UPLOAD_FORMATO}</p>
              {archivosLoading ? (
                <p className="mt-2 text-xs text-gray-500">Cargando documentos…</p>
              ) : null}
              {archivosError ? (
                <p
                  role="alert"
                  className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
                >
                  {archivosError}
                </p>
              ) : null}
              {!archivosLoading &&
              !archivosError &&
              integrationChecklistObligatorios &&
              integrationChecklistOpcionales ? (
                <>
                  <p className="mt-2 text-xs text-gray-600">
                    Progreso obligatorio: {integrationDocsPresentes} /{" "}
                    {INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.length} documentos (
                    {Math.round(
                      (integrationDocsPresentes /
                        INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.length) *
                        100,
                    )}
                    %)
                  </p>
                  <AsesorIntegracionDocsUpload
                    expedienteId={String(precal?.id ?? "")}
                    checklistObligatorios={integrationChecklistObligatorios}
                    checklistOpcionales={integrationChecklistOpcionales}
                    archivosResumen={archivosResumen}
                    puedeIntegrar={hasMontoAprobado}
                    submittedToMesa={operativo?.submittedToMesa ?? false}
                    onUploaded={refreshArchivos}
                  />
                </>
              ) : null}
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
              <p className="text-sm font-semibold text-gray-900">Enviar a Mesa</p>
              <p className="mt-2 text-xs text-gray-500">{MSJ_ENVIO_MESA_REQUISITOS}</p>
              <ul className="mt-3 space-y-2 text-xs">
                <li
                  className={`inline-flex rounded-full border px-2.5 py-1 font-medium ${checklistClass(
                    hasMontoAprobado,
                  )}`}
                >
                  Monto aprobado: {checklistLabel(hasMontoAprobado)}
                </li>
                <li
                  className={`inline-flex rounded-full border px-2.5 py-1 font-medium ${checklistClass(
                    datosGeneralesCompletos,
                  )}`}
                >
                  Datos generales: {checklistLabel(datosGeneralesCompletos)}
                </li>
                <li
                  className={`inline-flex rounded-full border px-2.5 py-1 font-medium ${checklistClass(
                    documentosCompletos,
                  )}`}
                >
                  Documentos: {checklistLabel(documentosCompletos)}
                </li>
              </ul>
              {enviarMesaExito ? (
                <p
                  role="status"
                  className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900"
                >
                  {enviarMesaExito}
                </p>
              ) : null}
              {enviarMesaError ? (
                <p
                  role="alert"
                  className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                >
                  {enviarMesaError}
                </p>
              ) : null}
              {operativo?.submittedToMesa ? (
                <p
                  role="status"
                  className="mt-3 inline-flex rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-900"
                >
                  Enviado a Mesa
                </p>
              ) : (
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!puedeEnviarAMesaSupabase || enviandoMesa}
                    onClick={() => void handleEnviarAMesaSupabase()}
                  >
                    {enviandoMesa ? "Enviando a Mesa…" : "Enviar a Mesa"}
                  </Button>
                </div>
              )}
            </div>
            <AsesorSeguimientoOperativo
              etapaActual={operativo?.etapaActual ?? null}
              subestado={operativo?.subestado}
              submittedToMesa={operativo?.submittedToMesa ?? false}
              fechaEnvioMesa={operativo?.fechaEnvioMesa}
              updatedAt={operativo?.updatedAt}
              cicloEstado={operativo?.cicloEstado}
              origenMesa={operativo?.origenMesa}
              formatDateTime={formatDateTime}
            />
            {canMountAgendaBiometricosUI() && precal?.id ? (
              <AsesorAgendaBiometricosSupabaseGate
                expedienteId={String(precal.id)}
                submittedToMesa={operativo?.submittedToMesa ?? false}
                etapaActual={operativo?.etapaActual}
                fechaCita={operativo?.fechaCita}
                onUpdated={() => void loadExpediente()}
              />
            ) : null}
            {canMountAgendaBiometricosUI() && precal?.id ? (
              <AsesorAgendaFirmasSupabaseGate
                expedienteId={String(precal.id)}
                submittedToMesa={operativo?.submittedToMesa ?? false}
                etapaActual={operativo?.etapaActual}
                fechaCita={operativo?.fechaCita}
                onUpdated={() => void loadExpediente()}
              />
            ) : null}
            {canShowAsesorRetencionSupabasePanel({
              dataModeSupabase: isDataModeSupabase(),
              etapaActual: operativo?.etapaActual,
              submittedToMesa: operativo?.submittedToMesa ?? false,
            }) && precal?.id ? (
              <RetencionAcuseAvisoSupabaseCard
                expedienteId={String(precal.id)}
                archivosResumen={archivosResumen}
                onUpdated={() => {
                  refreshArchivos();
                  void loadExpediente();
                }}
              />
            ) : null}
          </>
        ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,300px)] lg:items-start">
          <div className="space-y-6">
            {!hasMontoAprobado ? (
              <div
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              >
                {MSJ_ESPERA_MONTO_REVISOR}
              </div>
            ) : null}

            <ExpedienteClienteDatosFormSection
              clienteDatos={clienteDatos}
              setClienteDatos={handleClienteDatosChange}
              direccionOpcional={direccionOpcional}
              setDireccionOpcional={setDireccionOpcional}
              clienteDatosMeta={clienteDatosMeta}
              clienteDatosSaving={clienteDatosSaving}
              clienteDatosError={clienteDatosError}
              localDraftSaved={clienteDatosLocalDraftSaved}
              localDraftRestored={clienteDatosLocalDraftRestored}
              hasUnsavedLocalChanges={clienteDatosHasUnsavedChanges}
              camposFaltantes={camposFaltantesClienteDatos}
              fieldErrors={clienteDatosFieldErrors}
              showFieldErrors={clienteDatosShowValidation}
              puedeIntegrar={hasMontoAprobado}
              dataSupabase={false}
              formatDateTime={formatDateTime}
              onSave={handleSaveClienteDatos}
              esperaMontoMessage={MSJ_ESPERA_MONTO_REVISOR}
              montoAprobado={montoAprobadoEditor}
              programaDb={programaDb}
              onMontoMejoravitEdited={handleMontoMejoravitEdited}
              onMontoCalculadoEdited={handleMontoCalculadoEdited}
            />

            <SeguimientoOperativoMock
              asesorIntegracionHabilitada={hasMontoAprobado}
              contextPrecalId={String(precal.id)}
              contextClienteNombre={precal.cliente_nombre}
              contextTelefono={precal.telefono_cliente}
              contextPrograma={precal.programa}
              contextAsesorId={precal.asesorId}
              onEnviarAMesa={async (payload) => {
              if (!hasMontoAprobado) {
                window.alert(MSJ_ESPERA_MONTO_REVISOR);
                return false;
              }
              const camposFaltantes = getClienteDatosCamposFaltantes(clienteDatos, {
                montoAprobado: montoAprobadoEditor,
                direccionOpcional,
                programaDb,
              });
              if (camposFaltantes.length > 0) {
                window.alert(
                  `Completa los datos del cliente antes de enviar a mesa:\n\n- ${camposFaltantes.join(
                    "\n- ",
                  )}`,
                );
                return false;
              }
              const validation = validateClienteDatos(clienteDatos, {
                montoAprobado: montoAprobadoEditor,
                direccionOpcional,
                programaDb,
              });
              if (!validation.isValid) {
                setClienteDatosShowValidation(true);
                setClienteDatosFieldErrors(validation.errors);
                window.alert(formatClienteDatosValidationSummary(validation));
                return false;
              }
              if (!currentUser?.email) {
                window.alert("Sesión inválida.");
                return false;
              }
              const datosFormularioActuales = normalizeClienteDatosForSave(clienteDatos);
              try {
                const saved = await clienteDatosRepo.save({
                  expedienteId: String(precal.id),
                  datos: datosFormularioActuales,
                  direccionOpcional,
                  updatedBy: currentUser.email,
                  programaDb,
                });
                setClienteDatosMeta({
                  estado: saved.estado,
                  comentarioRechazo: saved.comentarioRechazo,
                  validatedAt: saved.validatedAt,
                  validatedBy: saved.validatedBy,
                  rejectedAt: saved.rejectedAt,
                  rejectedBy: saved.rejectedBy,
                  updatedAt: saved.updatedAt,
                  updatedBy: saved.updatedBy,
                });
                const nombreGuardado = datosFormularioActuales.nombreCliente.trim();
                setPrecal((prev) =>
                  prev
                    ? {
                        ...prev,
                        cliente_nombre: nombreGuardado || prev.cliente_nombre,
                      }
                    : prev,
                );
                await loadExpediente();
                clearClienteDatosLocalDraft(String(precal.id));
              } catch (err) {
                const message =
                  err instanceof Error
                    ? err.message
                    : "No se pudo guardar los datos del cliente.";
                setClienteDatosError(message);
                window.alert(message);
                return false;
              }
              const checklist = await getChecklistDocumentos(String(payload.id), 1, {
                pendienteRevisionCuentaComoCompleto: true,
              });
              const faltantesCliente = filterChecklistDocumentoItemsPorOwnerRole(
                checklist.faltantes,
                "cliente",
              );
              if (faltantesCliente.length > 0) {
                alert(
                  `No puedes enviar a mesa: faltan documentos del cliente.\n\n- ${faltantesCliente
                    .map((x) => x.label)
                    .join("\n- ")}`,
                );
                return false;
              }
              await mockRepo.enviarAMesaWithPayload(String(payload.id), {
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
              const enviado = await repo.getById(String(payload.id));
              if (!enviado?.operativo.submittedToMesa) {
                window.alert("No se pudo confirmar el envío a mesa de control.");
                return false;
              }
              setOperativo({
                etapaActual: enviado.operativo.etapaActual,
                subestado: enviado.operativo.subestado,
                fechaCita: enviado.operativo.fechaCita,
                updatedAt: enviado.operativo.updatedAt,
                motivoRechazo: enviado.operativo.motivoRechazo,
                comentarioRechazo: enviado.operativo.comentarioRechazo,
                submittedToMesa: enviado.operativo.submittedToMesa,
              });
              return true;
              }}
              initialSubmittedToMesa={operativo?.submittedToMesa ?? false}
              initialEtapaActualId={operativo?.etapaActual ?? undefined}
              initialSubestado={initialSubestado}
              initialMotivo={operativo?.motivoRechazo ?? undefined}
              initialComentarioRechazo={operativo?.comentarioRechazo ?? undefined}
              initialFechaCita={operativo?.fechaCita ?? undefined}
              initialUpdatedAt={operativo?.updatedAt ?? undefined}
            />
          </div>
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
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
                          {completosCliente.map((it) => (
                            <li key={`ok-${it.tipo_documento}`} className="flex gap-2">
                              <span aria-hidden>🟢</span>
                              <span>{it.label}</span>
                            </li>
                          ))}
                          {faltantesCliente.map((it) => {
                            const obligatorio =
                              DOCUMENTO_CATALOGO_MAP[it.tipo_documento].obligatorio ??
                              "obligatorio";
                            return (
                              <li key={`miss-${it.tipo_documento}`} className="flex gap-2">
                                <span aria-hidden>
                                  {obligatorio === "opcional" ? "🟡" : "🔴"}
                                </span>
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
            {canMountAgendaBiometricosUI() ? (
              <AgendaBiometricosCard
                expedienteId={String(precal.id)}
                submittedToMesa={operativo?.submittedToMesa ?? false}
                etapaActual={operativo?.etapaActual ?? null}
                subestado={operativo?.subestado}
                fechaCita={operativo?.fechaCita}
                repo={mockRepo}
                onUpdated={() => void loadExpediente()}
              />
            ) : null}
            <AgendaFirmasAsesorCard
              expedienteId={String(precal.id)}
              submittedToMesa={operativo?.submittedToMesa ?? false}
              etapaActual={operativo?.etapaActual ?? null}
              fechaCita={operativo?.fechaCita}
              repo={mockRepo}
              onUpdated={() => void loadExpediente()}
            />
          </aside>
        </div>
        )}
      </main>
    </div>
  );
}

