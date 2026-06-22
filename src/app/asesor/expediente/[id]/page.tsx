"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSessionRepo } from "@/domain/session";
import { AgendaBiometricosCard } from "@/components/asesor/AgendaBiometricosCard";
import { canMountAgendaBiometricosUI } from "@/lib/agendaFirmasBookingsGuard";
import { AgendaFirmasAsesorCard } from "@/components/asesor/AgendaFirmasAsesorCard";
import { ExpedienteClienteDatosFormSection } from "@/components/asesor/ExpedienteClienteDatosFormSection";
import { Button } from "@/components/ui/Button";
import { SeguimientoOperativoMock } from "@/components/seguimiento/SeguimientoOperativoMock";
import {
  ExpedientesSupabaseError,
  useExpedientesRepo,
  type ExpedienteMock,
} from "@/domain/expedientes";
import {
  asesorPuedeIntegrarTrasMontoRevisor,
  MockExpedientesRepo,
} from "@/domain/expedientes/mock.repo";
import { isDataModeSupabase } from "@/lib/dataMode";
import { subestadoOperativoLabel } from "@/lib/subestadoOperativoUi";
import {
  DOCUMENTO_CATALOGO_MAP,
  ExpedienteArchivosSupabaseError,
  countIntegrationDocsPresentes,
  deriveIntegrationDocsChecklist,
  filterChecklistDocumentoItemsPorOwnerRole,
  getChecklistDocumentos,
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  integrationDocsCompletos,
  integrationDocsResumenFromArchivoResumen,
  useExpedienteArchivosRepo,
  type ExpedienteArchivoResumen,
  type IntegrationDocChecklistItem,
  type ResumenEstatus,
} from "@/domain/expediente-archivos";
import {
  ClienteDatosSupabaseError,
  useExpedienteClienteDatosRepo,
  type ExpedienteClienteDatos,
} from "@/domain/expediente-cliente-datos";
import { getClienteDatosCamposFaltantes } from "@/lib/clienteDatosFormCompleteness";

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
}

type EstadoEtapa =
  | "pendiente"
  | "en_validacion_mesa"
  | "en_proceso"
  | "aprobado"
  | "rechazado";

const MSJ_ESPERA_MONTO_REVISOR =
  "Debes esperar a que el editor apruebe un monto antes de capturar datos, subir documentos o enviar a mesa.";

const MSJ_UPLOAD_P3H2 =
  "La carga real de documentos se conectará en P3H.2.";

const MSJ_ENVIO_MESA_REQUISITOS =
  "El envío a Mesa se habilitará cuando editor, datos generales y documentos estén completos.";

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

function estatusDocumentoIntegracionLabel(estatus: ResumenEstatus): string {
  if (estatus === "faltante") return "faltante";
  return estatus;
}

function estatusDocumentoIntegracionIcon(completo: boolean, estatus: ResumenEstatus): string {
  if (completo) return "🟢";
  if (estatus === "rechazado") return "🔴";
  return "🟡";
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
  const [editorDecision, setEditorDecision] = useState<
    ExpedienteMock["editorDecision"] | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enviandoMesa, setEnviandoMesa] = useState(false);
  const [enviarMesaError, setEnviarMesaError] = useState<string | null>(null);
  const [enviarMesaExito, setEnviarMesaExito] = useState<string | null>(null);
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

  const integrationChecklist = useMemo((): IntegrationDocChecklistItem[] | null => {
    if (!integrationDocsInput) return null;
    return deriveIntegrationDocsChecklist(integrationDocsInput);
  }, [integrationDocsInput]);

  const integrationDocsPresentes = useMemo(() => {
    if (!integrationDocsInput) return 0;
    return countIntegrationDocsPresentes(integrationDocsInput);
  }, [integrationDocsInput]);

  const documentosCompletos = useMemo(() => {
    if (!integrationDocsInput) return false;
    return integrationDocsCompletos(integrationDocsInput);
  }, [integrationDocsInput]);

  const puedeIntegrar = useMemo(
    () =>
      editorDecision !== null &&
      asesorPuedeIntegrarTrasMontoRevisor(editorDecision),
    [editorDecision],
  );

  const camposFaltantesClienteDatos = useMemo(
    () => getClienteDatosCamposFaltantes(clienteDatos),
    [clienteDatos],
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
      puedeIntegrar &&
      datosGeneralesCompletos &&
      documentosCompletos &&
      !operativo?.submittedToMesa,
    [
      datosGeneralesCompletos,
      documentosCompletos,
      operativo?.submittedToMesa,
      puedeIntegrar,
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
      setOperativo({
        etapaActual: exp.operativo.etapaActual,
        subestado: exp.operativo.subestado,
        fechaCita: exp.operativo.fechaCita,
        updatedAt: exp.operativo.updatedAt,
        motivoRechazo: exp.operativo.motivoRechazo,
        comentarioRechazo: exp.operativo.comentarioRechazo,
        submittedToMesa: exp.operativo.submittedToMesa,
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
      if (!found) {
        setClienteDatos((prev) => ({
          ...prev,
          nombreCliente: prev.nombreCliente || precal.cliente_nombre || "",
          nss: prev.nss || precal.nss || "",
          celular: prev.celular || precal.telefono_cliente || "",
        }));
        setClienteDatosMeta(null);
        return;
      }
      setClienteDatos({
        ...found.datos,
        rfc: found.datos.rfc ?? "",
      });
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
    dataSupabase,
    precal?.cliente_nombre,
    precal?.id,
    precal?.nss,
    precal?.telefono_cliente,
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
    if (!puedeIntegrar) {
      window.alert(MSJ_ESPERA_MONTO_REVISOR);
      return { ok: false, message: MSJ_ESPERA_MONTO_REVISOR };
    }
    if (dataSupabase) {
      const camposFaltantes = getClienteDatosCamposFaltantes(clienteDatos);
      if (camposFaltantes.length > 0) {
        const message = `Completa los datos del cliente antes de guardar:\n\n- ${camposFaltantes.join(
          "\n- ",
        )}`;
        setClienteDatosError(message);
        return { ok: false, message };
      }
    }
    setClienteDatosSaving(true);
    setClienteDatosError(null);
    setClienteDatosSaved(false);
    try {
      const saved = await clienteDatosRepo.save({
        expedienteId: String(precal.id),
        datos: clienteDatos,
        updatedBy: currentUser.email,
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
      setClienteDatosSaved(true);
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
    clienteDatos,
    clienteDatosRepo,
    currentUser?.email,
    dataSupabase,
    precal?.id,
    puedeIntegrar,
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
                Estado del expediente
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <p>
                  <span className="font-medium text-gray-900">Decisión editor:</span>{" "}
                  {editorDecisionLabel(editorDecision?.decision)}
                </p>
                <p>
                  <span className="font-medium text-gray-900">Monto aprobado:</span>{" "}
                  {editorDecision?.decision === "aprobado" &&
                  typeof editorDecision.monto_aprobado === "number"
                    ? `$${editorDecision.monto_aprobado.toLocaleString("es-MX")}`
                    : "—"}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-medium text-gray-900">Notas revisión:</span>{" "}
                  {editorDecision?.notas_revision?.trim() || "—"}
                </p>
                <p>
                  <span className="font-medium text-gray-900">Etapa:</span>{" "}
                  {operativo?.etapaActual != null ? operativo.etapaActual : "—"}
                </p>
                <p>
                  <span className="font-medium text-gray-900">Subestado:</span>{" "}
                  {subestadoOperativoLabel(operativo?.subestado)}
                </p>
                <p>
                  <span className="font-medium text-gray-900">Enviado a mesa:</span>{" "}
                  {operativo?.submittedToMesa ? "Sí" : "No"}
                </p>
                <p>
                  <span className="font-medium text-gray-900">Fecha cita:</span>{" "}
                  {operativo?.fechaCita ? formatDateTime(operativo.fechaCita) : "—"}
                </p>
                {operativo?.updatedAt ? (
                  <p className="sm:col-span-2">
                    <span className="font-medium text-gray-900">Última actualización:</span>{" "}
                    {formatDateTime(operativo.updatedAt)}
                  </p>
                ) : null}
              </div>
            </div>
            {!puedeIntegrar ? (
              <div
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              >
                {MSJ_ESPERA_MONTO_REVISOR}
              </div>
            ) : null}
            <ExpedienteClienteDatosFormSection
              clienteDatos={clienteDatos}
              setClienteDatos={setClienteDatos}
              clienteDatosMeta={clienteDatosMeta}
              clienteDatosSaving={clienteDatosSaving}
              clienteDatosLoading={clienteDatosLoading}
              clienteDatosSaved={clienteDatosSaved}
              clienteDatosError={clienteDatosError}
              camposFaltantes={camposFaltantesClienteDatos}
              puedeIntegrar={puedeIntegrar}
              dataSupabase
              formatDateTime={formatDateTime}
              onSave={handleSaveClienteDatos}
              esperaMontoMessage={MSJ_ESPERA_MONTO_REVISOR}
            />
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
              <p className="text-sm font-semibold text-gray-900">
                Documentos requeridos
              </p>
              <p className="mt-1 text-xs text-gray-500">{MSJ_UPLOAD_P3H2}</p>
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
              {!archivosLoading && !archivosError && integrationChecklist ? (
                <>
                  <p className="mt-2 text-xs text-gray-600">
                    Progreso: {integrationDocsPresentes} /{" "}
                    {INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.length} documentos completos (
                    {Math.round(
                      (integrationDocsPresentes /
                        INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.length) *
                        100,
                    )}
                    %)
                  </p>
                  <ul className="mt-3 space-y-1.5 text-xs text-gray-800">
                    {integrationChecklist.map((item) => (
                      <li
                        key={item.tipo_documento}
                        className="flex items-start gap-2 rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5"
                      >
                        <span aria-hidden className="mt-0.5">
                          {estatusDocumentoIntegracionIcon(
                            item.completo,
                            item.estatus_revision,
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-gray-900">{item.label}</span>
                          <span className="mt-0.5 block text-gray-600">
                            {estatusDocumentoIntegracionLabel(item.estatus_revision)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
              <p className="text-sm font-semibold text-gray-900">Enviar a Mesa</p>
              <p className="mt-2 text-xs text-gray-500">{MSJ_ENVIO_MESA_REQUISITOS}</p>
              <ul className="mt-3 space-y-2 text-xs">
                <li
                  className={`inline-flex rounded-full border px-2.5 py-1 font-medium ${checklistClass(
                    puedeIntegrar,
                  )}`}
                >
                  Editor aprobado: {checklistLabel(puedeIntegrar)}
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
          </>
        ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,300px)] lg:items-start">
          <div className="space-y-6">
            {!puedeIntegrar ? (
              <div
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              >
                {MSJ_ESPERA_MONTO_REVISOR}
              </div>
            ) : null}

            <ExpedienteClienteDatosFormSection
              clienteDatos={clienteDatos}
              setClienteDatos={setClienteDatos}
              clienteDatosMeta={clienteDatosMeta}
              clienteDatosSaving={clienteDatosSaving}
              clienteDatosError={clienteDatosError}
              camposFaltantes={camposFaltantesClienteDatos}
              puedeIntegrar={puedeIntegrar}
              dataSupabase={false}
              formatDateTime={formatDateTime}
              onSave={handleSaveClienteDatos}
              esperaMontoMessage={MSJ_ESPERA_MONTO_REVISOR}
            />

            <SeguimientoOperativoMock
              asesorIntegracionHabilitada={puedeIntegrar}
              contextPrecalId={String(precal.id)}
              contextClienteNombre={precal.cliente_nombre}
              contextTelefono={precal.telefono_cliente}
              contextPrograma={precal.programa}
              contextAsesorId={precal.asesorId}
              onEnviarAMesa={async (payload) => {
              if (!puedeIntegrar) {
                window.alert(MSJ_ESPERA_MONTO_REVISOR);
                return false;
              }
              const camposFaltantes = getClienteDatosCamposFaltantes(clienteDatos);
              if (camposFaltantes.length > 0) {
                window.alert(
                  `Completa los datos del cliente antes de enviar a mesa:\n\n- ${camposFaltantes.join(
                    "\n- ",
                  )}`,
                );
                return false;
              }
              if (!currentUser?.email) {
                window.alert("Sesión inválida.");
                return false;
              }
              const datosFormularioActuales = clienteDatos;
              try {
                const saved = await clienteDatosRepo.save({
                  expedienteId: String(precal.id),
                  datos: datosFormularioActuales,
                  updatedBy: currentUser.email,
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

