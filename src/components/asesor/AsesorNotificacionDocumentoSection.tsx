"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DocumentDropzone } from "@/components/documents/DocumentDropzone";
import {
  MesaArchivoPreviewDialog,
  openBlobUrlInNewTab,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import {
  CLIENTE_NOTIFICACION_ACCEPT_ATTR,
  findClienteNotificacionFromList,
  formatNotificacionDocumentoMimeLabel,
  shouldShowAsesorNotificacionDocumentoSection,
  validateClienteNotificacionFile,
  type ClienteNotificacionDocumento,
} from "@/domain/expediente-archivos/cliente-notificacion";
import {
  CLIENTE_NOTIFICACION_DOCUMENT_TIPO,
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
} from "@/domain/expediente-archivos";

export type AsesorNotificacionDocumentoSectionProps = Readonly<{
  expedienteId: string;
  etapaActual: number | null | undefined;
  /** Tras upload exitoso (p. ej. avance 7→9): refrescar expediente. */
  onExpedienteUpdated?: () => void | Promise<void>;
}>;

function formatDateTimeEsMx(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/**
 * P132: en etapa ≥ 7 permite upload/reemplazo de `cliente_notificacion`
 * vía `register_expediente_documento` (mismo tipo canónico que Mesa).
 */
export function AsesorNotificacionDocumentoSection({
  expedienteId,
  etapaActual,
  onExpedienteUpdated,
}: AsesorNotificacionDocumentoSectionProps) {
  const archivosRepo = useExpedienteArchivosRepo();
  const savingLockRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [documento, setDocumento] = useState<ClienteNotificacionDocumento | null>(null);
  const [archivoBusy, setArchivoBusy] = useState(false);
  const [archivoError, setArchivoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MesaArchivoPreviewState | null>(null);
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const visible = shouldShowAsesorNotificacionDocumentoSection(etapaActual);
  const canWrite = visible;

  const load = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    setError(null);
    try {
      const list = await archivosRepo.listByExpediente(expedienteId);
      setDocumento(findClienteNotificacionFromList(list));
    } catch (err) {
      setDocumento(null);
      setError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : "No se pudo consultar el Notificación.",
      );
    } finally {
      setLoading(false);
    }
  }, [archivosRepo, expedienteId, visible]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  if (!visible) return null;

  const mapArchivoError = (err: unknown): string => {
    if (err instanceof ExpedienteArchivosSupabaseError) return err.message;
    return "No se pudo abrir el archivo. Intenta de nuevo.";
  };

  const handleVer = async () => {
    if (!documento?.id || archivoBusy) return;
    setArchivoBusy(true);
    setArchivoError(null);
    try {
      const blob = await archivosRepo.getArchivoBlob(documento.id);
      const url = URL.createObjectURL(blob);
      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return {
          url,
          mime_type: documento.mimeType,
          nombre_original: documento.fileName,
        };
      });
    } catch (err) {
      setArchivoError(mapArchivoError(err));
    } finally {
      setArchivoBusy(false);
    }
  };

  const handleDescargar = async () => {
    if (!documento?.id || archivoBusy) return;
    setArchivoBusy(true);
    setArchivoError(null);
    try {
      const blob = await archivosRepo.getArchivoBlob(documento.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = documento.fileName || "notificacion-documento";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      setArchivoError(mapArchivoError(err));
    } finally {
      setArchivoBusy(false);
    }
  };

  const handleUpload = async (files: File[]) => {
    const file = files[0];
    if (!file || !canWrite || savingLockRef.current) return;
    const validation = validateClienteNotificacionFile(file);
    if (!validation.ok) {
      setWriteError(validation.error);
      return;
    }
    savingLockRef.current = true;
    setSaving(true);
    setWriteError(null);
    setSuccessMsg(null);
    try {
      if (documento) {
        await archivosRepo.replaceArchivo({
          expedienteId,
          tipo_documento: CLIENTE_NOTIFICACION_DOCUMENT_TIPO,
          file,
          uploaded_by_role: "asesor",
          uploaded_by_email: "",
        });
        setSuccessMsg("Notificación reemplazada correctamente.");
      } else {
        await archivosRepo.uploadArchivo({
          expedienteId,
          tipo_documento: CLIENTE_NOTIFICACION_DOCUMENT_TIPO,
          file,
          uploaded_by_role: "asesor",
          uploaded_by_email: "",
        });
        setSuccessMsg(
          "Notificación cargada. Si el expediente estaba en etapa 7, puede avanzar a agenda de firma.",
        );
      }
      await load();
      await onExpedienteUpdated?.();
    } catch (err) {
      setWriteError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : "No se pudo registrar el Notificación. Intenta de nuevo.",
      );
    } finally {
      savingLockRef.current = false;
      setSaving(false);
    }
  };

  const closePreview = () => {
    setPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  return (
    <section
      aria-label="Notificación"
      className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-4 text-sm text-gray-800"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Notificación</h3>
        {documento ? (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-2.5 py-0.5 text-xs font-medium text-emerald-900">
            Cargado
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-white px-2.5 py-0.5 text-xs font-medium text-amber-900">
            Pendiente
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-gray-600">
        Puedes cargar o reemplazar el Notificación (PDF/JPG/PNG). La primera carga válida en
        etapa 7 libera la agenda de firma (+5 días hábiles Monterrey).
      </p>

      {loading ? (
        <p className="mt-2 text-xs text-gray-500">Cargando Notificación…</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {!loading && !error && !documento ? (
        <p className="mt-2 text-sm text-gray-700">
          Aún no hay Notificación cargada para este expediente.
        </p>
      ) : null}

      {!loading && documento ? (
        <>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">Archivo</dt>
              <dd className="truncate font-medium text-gray-900">{documento.fileName}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Formato</dt>
              <dd className="font-medium text-gray-900">
                {formatNotificacionDocumentoMimeLabel(documento.mimeType)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Fecha</dt>
              <dd className="font-medium text-gray-900">
                {formatDateTimeEsMx(documento.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Versión</dt>
              <dd className="font-medium text-gray-900">{documento.version}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2.5 py-0 text-xs"
              disabled={archivoBusy}
              aria-label="Ver Notificación"
              onClick={() => void handleVer()}
            >
              {archivoBusy ? "Abriendo…" : "Ver"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2.5 py-0 text-xs"
              disabled={archivoBusy}
              aria-label="Descargar Notificación"
              onClick={() => void handleDescargar()}
            >
              Descargar
            </Button>
          </div>
        </>
      ) : null}

      {canWrite ? (
        <div className="mt-3 w-full max-w-md">
          <DocumentDropzone
            accept={CLIENTE_NOTIFICACION_ACCEPT_ATTR}
            busy={saving}
            disabled={saving}
            selectedFileName={null}
            aria-label={documento ? "Reemplazar Notificación" : "Subir Notificación"}
            onFiles={(files) => void handleUpload(files)}
          />
        </div>
      ) : null}

      {writeError ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {writeError}
        </p>
      ) : null}
      {archivoError ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {archivoError}
        </p>
      ) : null}
      {successMsg ? (
        <p aria-live="polite" className="mt-2 text-xs text-emerald-800">
          {successMsg}
        </p>
      ) : null}

      {preview ? (
        <MesaArchivoPreviewDialog
          preview={preview}
          onClose={closePreview}
          onOpenInNewTab={openBlobUrlInNewTab}
        />
      ) : null}
    </section>
  );
}
