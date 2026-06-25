"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  MesaArchivoPreviewDialog,
  openBlobUrlInNewTab,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import { MesaClienteDatosReadOnlySection } from "@/components/mesa-control/MesaClienteDatosReadOnlySection";
import { MesaAvanceOperativoSection, MESA_AVANCE_OPERATIVO_2A3_COPY, MESA_AVANCE_OPERATIVO_3A4_COPY } from "@/components/mesa-control/MesaAvanceOperativoSection";
import { MesaCierreValidacionDocumentalSection } from "@/components/mesa-control/MesaCierreValidacionDocumentalSection";
import { MesaControlDocumentosComplementariosSection } from "@/components/mesa-control/MesaControlDocumentosComplementariosSection";
import { MesaDocumentosAsesorSection } from "@/components/mesa-control/MesaDocumentosAsesorSection";
import { AsesorSeguimientoOperativo } from "@/components/asesor/AsesorSeguimientoOperativo";
import { Button } from "@/components/ui/Button";
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
  useExpedientesRepo,
  deriveAvanceOperativo2a3View,
  deriveAvanceOperativo3a4View,
  deriveCierreValidacionDocumentalView,
  type ExpedienteMock,
} from "@/domain/expedientes";
import { useSessionRepo, type Rol } from "@/domain/session";
import { subestadoOperativoLabel } from "@/lib/subestadoOperativoUi";

type LoadState = "loading" | "ready" | "not_found" | "error";

function formatDateTime(iso: string): string {
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
  const [avance3a4Loading, setAvance3a4Loading] = useState(false);
  const [avance3a4Error, setAvance3a4Error] = useState<string | null>(null);
  const [avance3a4Success, setAvance3a4Success] = useState<string | null>(null);

  const puedeRevisar = puedeRevisarDocumentos(currentUser?.role);

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
          setLoadState("not_found");
          return;
        }

        const [datos, archivos, lista] = await Promise.all([
          clienteDatosRepo.getByExpedienteId(routeExpedienteId).catch(() => null),
          archivosRepo.listResumenByExpediente(routeExpedienteId).catch(() => []),
          archivosRepo.listByExpediente(routeExpedienteId).catch(() => []),
        ]);

        setExpediente(exp);
        setClienteDatos(datos);
        setArchivosResumen(archivos);
        setArchivosLista(lista);
        setLoadState("ready");
      } catch (err) {
        setExpediente(null);
        setClienteDatos(null);
        setArchivosResumen([]);
        setArchivosLista([]);
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
    clienteDatosRepo,
    currentUser,
    expedientesRepo,
    routeExpedienteId,
  ]);

  useEffect(() => {
    if (!currentUser) return;
    load();
  }, [currentUser, load]);

  const documentosAsesor = useMemo(
    () => buildMesaIntegrationDocViews(archivosResumen, archivosLista),
    [archivosLista, archivosResumen],
  );

  const documentosComplementarios = useMemo(
    () => buildMesaComplementariosDocViews(archivosResumen, archivosLista),
    [archivosLista, archivosResumen],
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
    [archivosRepo, refreshArchivos],
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
    [archivosRepo, refreshArchivos, routeExpedienteId],
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

  const avanceOperativo3a4View = useMemo(
    () => deriveAvanceOperativo3a4View(avanceOperativoContext),
    [avanceOperativoContext],
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

  const handleAvanzarOperativo3a4 = useCallback(async () => {
    if (!routeExpedienteId || !avanceOperativo3a4View.puedeAvanzar) return;
    setAvance3a4Loading(true);
    setAvance3a4Error(null);
    setAvance3a4Success(null);
    try {
      await expedientesRepo.avanzarEtapaOperativa(routeExpedienteId);
      setAvance3a4Success(
        "Expediente avanzado a etapa 4 (Cita agendada — biométricos)",
      );
      load();
    } catch (err) {
      setAvance3a4Error(
        err instanceof ExpedientesSupabaseError
          ? err.message
          : "No se pudo avanzar la etapa del expediente.",
      );
    } finally {
      setAvance3a4Loading(false);
    }
  }, [avanceOperativo3a4View.puedeAvanzar, expedientesRepo, load, routeExpedienteId]);

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

  return (
    <MesaDetalleShell>
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
            {expediente.base.asesorId || "—"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Origen Mesa:</span>{" "}
            {origenMesaLabel(expediente.base.origenMesa)}
          </p>
          <p>
            <span className="font-medium text-gray-900">Etapa actual:</span>{" "}
            {op.etapaActual ?? "—"}
          </p>
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

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <h2 className="text-sm font-semibold text-gray-900">Decisión del editor</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <p>
            <span className="font-medium text-gray-900">Decisión:</span>{" "}
            {editorDecisionLabel(ed.decision)}
          </p>
          <p>
            <span className="font-medium text-gray-900">Monto aprobado:</span>{" "}
            {ed.decision === "aprobado" && typeof ed.monto_aprobado === "number"
              ? `$${ed.monto_aprobado.toLocaleString("es-MX")}`
              : "—"}
          </p>
          <p className="sm:col-span-2">
            <span className="font-medium text-gray-900">Notas revisión:</span>{" "}
            {ed.notas_revision?.trim() || "—"}
          </p>
        </div>
      </section>

      {clienteDatos ? (
        <MesaClienteDatosReadOnlySection
          clienteDatos={clienteDatos}
          direccionOpcional={expediente.base.direccion_opcional}
          submittedToMesa={op.submittedToMesa}
          formatDateTime={formatDateTime}
          puedeRevisar={puedeRevisar}
          saving={clienteDatosSaving}
          revisionError={clienteDatosRevisionError}
          onValidar={handleValidarClienteDatos}
          onRechazar={handleRechazarClienteDatos}
        />
      ) : (
        <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          <h2 className="text-sm font-semibold text-gray-900">Datos generales del cliente</h2>
          <p className="mt-2 text-sm text-gray-500">Sin datos generales registrados todavía.</p>
        </section>
      )}

      <MesaDocumentosAsesorSection
        documentos={documentosAsesor}
        puedeRevisar={puedeRevisar}
        archivoLoadingTipo={archivoLoadingTipo}
        revisionSavingTipo={revisionSavingTipo as IntegrationDocAsesorUploadTipo | null}
        archivoErrorByTipo={archivoErrorByTipo}
        revisionErrorByTipo={revisionErrorByTipo}
        onVer={(tipo, archivo) => void handleVerArchivo(tipo, archivo)}
        onDescargar={(tipo, archivo) => void handleDescargarArchivo(tipo, archivo)}
        onValidar={(tipo, documentoId) => void handleValidarDocumento(tipo, documentoId)}
        onGuardarRechazo={handleGuardarRechazo}
      />

      <MesaControlDocumentosComplementariosSection
        documentos={documentosComplementarios}
        puedeOperar={puedeRevisar}
        archivoLoadingTipo={complementarioArchivoLoadingTipo}
        uploadLoadingTipo={uploadLoadingTipo}
        archivoErrorByTipo={complementarioArchivoErrorByTipo}
        uploadErrorByTipo={uploadErrorByTipo}
        onVer={(tipo, archivo) => void handleVerComplementario(tipo, archivo)}
        onDescargar={(tipo, archivo) => void handleDescargarComplementario(tipo, archivo)}
        onSubir={handleSubirComplementario}
        onReemplazar={handleReemplazarComplementario}
      />

      <MesaCierreValidacionDocumentalSection
        view={cierreValidacionView}
        puedeOperar={puedeRevisar}
        loading={continuarLoading}
        error={continuarError}
        success={continuarSuccess}
        onAvanzar={handleAvanzarIntegracion}
      />

      <MesaAvanceOperativoSection
        view={avanceOperativo2a3View}
        copy={MESA_AVANCE_OPERATIVO_2A3_COPY}
        puedeOperar={puedeRevisar}
        loading={avance2a3Loading}
        error={avance2a3Error}
        success={avance2a3Success}
        onAvanzar={handleAvanzarOperativo2a3}
      />

      <MesaAvanceOperativoSection
        view={avanceOperativo3a4View}
        copy={MESA_AVANCE_OPERATIVO_3A4_COPY}
        puedeOperar={puedeRevisar}
        loading={avance3a4Loading}
        error={avance3a4Error}
        success={avance3a4Success}
        onAvanzar={handleAvanzarOperativo3a4}
      />

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
