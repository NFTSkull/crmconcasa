"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSessionRepo } from "@/domain/session";
import { AgendaBiometricosCard } from "@/components/asesor/AgendaBiometricosCard";
import { canMountAgendaBiometricosUI } from "@/lib/agendaFirmasBookingsGuard";
import { AgendaFirmasAsesorCard } from "@/components/asesor/AgendaFirmasAsesorCard";
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
  filterChecklistDocumentoItemsPorOwnerRole,
  getChecklistDocumentos,
} from "@/domain/expediente-archivos";
import {
  MockExpedienteClienteDatosLocalStorageRepo,
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

const MSJ_READONLY_SUPABASE =
  "Vista read-only desde Supabase. Integración, documentos, datos extendidos y agenda se conectarán en fases posteriores.";

function editorDecisionLabel(decision?: string | null): string {
  if (decision === "aprobado") return "Aprobado";
  if (decision === "no_cumple") return "No cumple";
  return "Pendiente";
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
  const clienteDatosRepo = useMemo(
    () => new MockExpedienteClienteDatosLocalStorageRepo(),
    [],
  );
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
  const [clienteDatosError, setClienteDatosError] = useState<string | null>(null);
  const [editorDecision, setEditorDecision] = useState<
    ExpedienteMock["editorDecision"] | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const puedeIntegrar = useMemo(
    () =>
      editorDecision !== null &&
      asesorPuedeIntegrarTrasMontoRevisor(editorDecision),
    [editorDecision],
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
    // Carga inicial + refetch cuando cambia id/repo; setState tras async es el patrón de esta pantalla.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincronizar expediente mock al montar
    void loadExpediente();
  }, [loadExpediente]);

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
    if (dataSupabase || !precal?.id) return;
    let cancelled = false;

    const load = () => {
      void clienteDatosRepo
        .getByExpedienteId(String(precal.id))
        .then((found) => {
          if (cancelled) return;
          if (!found) {
            // Prefill mínimo desde expediente base (sin imponer validación).
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
        })
        .catch(() => {
          if (cancelled) return;
          setClienteDatosMeta(null);
        });
    };

    load();

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
  }, [clienteDatosRepo, dataSupabase, precal?.cliente_nombre, precal?.id, precal?.nss, precal?.telefono_cliente]);

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
    setClienteDatosSaving(true);
    setClienteDatosError(null);
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
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "No se pudo guardar los datos del cliente.";
      setClienteDatosError(message);
      return { ok: false, message };
    } finally {
      setClienteDatosSaving(false);
    }
  }, [
    clienteDatos,
    clienteDatosRepo,
    currentUser?.email,
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
            <div
              role="status"
              className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"
            >
              {MSJ_READONLY_SUPABASE}
            </div>
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

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <fieldset
                disabled={!puedeIntegrar}
                className="min-w-0 border-0 p-0 disabled:opacity-70"
              >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    Datos Generales del Cliente
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {clienteDatosMeta
                      ? `Estado: ${clienteDatosMeta.estado} · Actualizado: ${formatDateTime(
                          clienteDatosMeta.updatedAt,
                        )} · Por: ${clienteDatosMeta.updatedBy}`
                      : "Aún no guardado en expediente."}{" "}
                    <span className="text-gray-400">
                      Al enviar a mesa se guardan automáticamente si el formulario está completo.
                    </span>
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="text-xs"
                  disabled={!puedeIntegrar || clienteDatosSaving}
                  onClick={async () => {
                    const r = await handleSaveClienteDatos();
                    if (!r.ok && r.message && r.message !== MSJ_ESPERA_MONTO_REVISOR) {
                      window.alert(r.message);
                    }
                  }}
                >
                  {clienteDatosSaving ? "Guardando..." : "Guardar borrador"}
                </Button>
              </div>

              {clienteDatosError ? (
                <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
                  {clienteDatosError}
                </p>
              ) : null}

              {clienteDatosMeta?.estado === "rechazado" ? (
                <p
                  className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950"
                  role="status"
                >
                  Los datos fueron rechazados por mesa. Corrige la información.{" "}
                  {clienteDatosMeta.comentarioRechazo?.trim() ? (
                    <span className="block pt-1 text-amber-950">
                      Motivo: {clienteDatosMeta.comentarioRechazo}
                    </span>
                  ) : null}
                  <span className="text-amber-900/90">
                    (Actualizado: {formatDateTime(clienteDatosMeta.updatedAt)} · Por:{" "}
                    {clienteDatosMeta.updatedBy})
                  </span>
                </p>
              ) : null}
              {clienteDatosMeta?.estado === "validado" ? (
                <p
                  className="mt-2 rounded-md border border-green-200 bg-green-50 px-2 py-1.5 text-xs text-green-900"
                  role="status"
                >
                  Mesa-control validó tus datos generales.{" "}
                  <span className="text-green-800/90">
                    {clienteDatosMeta.validatedAt
                      ? `(Validado: ${formatDateTime(clienteDatosMeta.validatedAt)}`
                      : "(Validado"}
                    {clienteDatosMeta.validatedBy
                      ? ` · Por: ${clienteDatosMeta.validatedBy})`
                      : ")"}
                  </span>
                </p>
              ) : null}

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">Nombre del cliente</span>
                  <input
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    value={clienteDatos.nombreCliente}
                    onChange={(e) =>
                      setClienteDatos((p) => ({ ...p, nombreCliente: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">NSS</span>
                  <input
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    value={clienteDatos.nss}
                    onChange={(e) => setClienteDatos((p) => ({ ...p, nss: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">CURP</span>
                  <input
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    value={clienteDatos.curp}
                    onChange={(e) => setClienteDatos((p) => ({ ...p, curp: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">RFC</span>
                  <input
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm uppercase"
                    value={clienteDatos.rfc}
                    onChange={(e) =>
                      setClienteDatos((p) => ({ ...p, rfc: e.target.value.toUpperCase() }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">Celular</span>
                  <input
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    value={clienteDatos.celular}
                    onChange={(e) =>
                      setClienteDatos((p) => ({ ...p, celular: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">Correo</span>
                  <input
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    value={clienteDatos.correo}
                    onChange={(e) =>
                      setClienteDatos((p) => ({ ...p, correo: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">Empresa</span>
                  <input
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    value={clienteDatos.empresa}
                    onChange={(e) =>
                      setClienteDatos((p) => ({ ...p, empresa: e.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">Registro patronal</span>
                  <input
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    value={clienteDatos.registroPatronal}
                    onChange={(e) =>
                      setClienteDatos((p) => ({
                        ...p,
                        registroPatronal: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">Teléfono empresa</span>
                  <input
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    value={clienteDatos.telefonoEmpresa}
                    onChange={(e) =>
                      setClienteDatos((p) => ({
                        ...p,
                        telefonoEmpresa: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-gray-200 p-3">
                  <p className="text-xs font-semibold text-gray-900">Referencias</p>
                  {[0, 1].map((idx) => (
                    <div key={idx} className="mt-2 grid grid-cols-1 gap-2">
                      <label className="grid gap-1 text-xs text-gray-600">
                        <span className="font-medium text-gray-800">Nombre (ref {idx + 1})</span>
                        <input
                          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                          value={clienteDatos.referencias[idx]?.nombre ?? ""}
                          onChange={(e) =>
                            setClienteDatos((p) => {
                              const nextRefs = [...p.referencias];
                              nextRefs[idx] = { ...nextRefs[idx], nombre: e.target.value };
                              return { ...p, referencias: nextRefs };
                            })
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-xs text-gray-600">
                        <span className="font-medium text-gray-800">Celular (ref {idx + 1})</span>
                        <input
                          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                          value={clienteDatos.referencias[idx]?.celular ?? ""}
                          onChange={(e) =>
                            setClienteDatos((p) => {
                              const nextRefs = [...p.referencias];
                              nextRefs[idx] = { ...nextRefs[idx], celular: e.target.value };
                              return { ...p, referencias: nextRefs };
                            })
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>

                <div className="rounded-md border border-gray-200 p-3">
                  <p className="text-xs font-semibold text-gray-900">Beneficiario</p>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    <label className="grid gap-1 text-xs text-gray-600">
                      <span className="font-medium text-gray-800">Nombre</span>
                      <input
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                        value={clienteDatos.beneficiario.nombre}
                        onChange={(e) =>
                          setClienteDatos((p) => ({
                            ...p,
                            beneficiario: { ...p.beneficiario, nombre: e.target.value },
                          }))
                        }
                      />
                    </label>
                    <label className="grid gap-1 text-xs text-gray-600">
                      <span className="font-medium text-gray-800">Parentesco</span>
                      <input
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                        value={clienteDatos.beneficiario.parentesco}
                        onChange={(e) =>
                          setClienteDatos((p) => ({
                            ...p,
                            beneficiario: { ...p.beneficiario, parentesco: e.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-md border border-gray-200 p-3">
                <p className="text-xs font-semibold text-gray-900">Dirección de la empresa</p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs text-gray-600 sm:col-span-2">
                    <span className="font-medium text-gray-800">Calle</span>
                    <input
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={clienteDatos.direccionEmpresa.calle}
                      onChange={(e) =>
                        setClienteDatos((p) => ({
                          ...p,
                          direccionEmpresa: { ...p.direccionEmpresa, calle: e.target.value },
                        }))
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-gray-600">
                    <span className="font-medium text-gray-800">Colonia</span>
                    <input
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={clienteDatos.direccionEmpresa.colonia}
                      onChange={(e) =>
                        setClienteDatos((p) => ({
                          ...p,
                          direccionEmpresa: { ...p.direccionEmpresa, colonia: e.target.value },
                        }))
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-gray-600">
                    <span className="font-medium text-gray-800">Municipio</span>
                    <input
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={clienteDatos.direccionEmpresa.municipio}
                      onChange={(e) =>
                        setClienteDatos((p) => ({
                          ...p,
                          direccionEmpresa: { ...p.direccionEmpresa, municipio: e.target.value },
                        }))
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-gray-600">
                    <span className="font-medium text-gray-800">CP</span>
                    <input
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={clienteDatos.direccionEmpresa.cp}
                      onChange={(e) =>
                        setClienteDatos((p) => ({
                          ...p,
                          direccionEmpresa: { ...p.direccionEmpresa, cp: e.target.value },
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
              </fieldset>
            </div>

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
              await mockRepo.enviarAMesa(String(payload.id), {
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

