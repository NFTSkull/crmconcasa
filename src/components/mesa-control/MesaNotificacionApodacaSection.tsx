"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DocumentDropzone } from "@/components/documents/DocumentDropzone";
import {
  MesaArchivoPreviewDialog,
  openBlobUrlInNewTab,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import { MesaPagareUploadDialog } from "@/components/mesa-control/MesaPagareUploadDialog";
import { MesaDocumentoEliminarDialog } from "@/components/mesa-control/MesaDocumentoEliminarDialog";
import {
  CLIENTE_NOTIFICACION_APODACA_DOCUMENT_CONTRACT,
  CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO,
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
  type ExpedienteArchivoListItem,
} from "@/domain/expediente-archivos";
import { getExpedienteDocumentoAcceptAttr, validateExpedienteDocumentoUploadFile } from "@/lib/fileUploadValidation";
import { formatBytesLabel } from "@/domain/expediente-archivos/cliente-pagare";

export type MesaNotificacionApodacaSectionProps = Readonly<{
  expedienteId: string;
  puedeOperar: boolean;
  submittedToMesa?: boolean;
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

function findApodaca(list: ExpedienteArchivoListItem[]) {
  const row = list.find((d) => d.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO);
  if (!row) return null;
  return {
    id: row.id,
    fileName: row.nombre_original,
    mimeType: row.mime_type,
    fileSize: row.size_bytes,
    version: row.version,
    createdAt: row.created_at,
    createdByName: row.uploaded_by_name,
  };
}

/**
 * P136: Mesa puede cargar/reemplazar/eliminar Notificación (`cliente_notificacion_apodaca`).
 * Distinto de cliente_notificacion y de agenda kind=notificacion.
 */
export function MesaNotificacionApodacaSection({
  expedienteId,
  puedeOperar,
  submittedToMesa = true,
}: MesaNotificacionApodacaSectionProps) {
  const archivosRepo = useExpedienteArchivosRepo();
  const savingLockRef = useRef(false);
  const deleteLockRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [documento, setDocumento] = useState<ReturnType<typeof findApodaca>>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dialogMode, setDialogMode] = useState<"upload" | "replace">("upload");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [archivoBusy, setArchivoBusy] = useState(false);
  const [archivoError, setArchivoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MesaArchivoPreviewState | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const writeEnabled = puedeOperar && submittedToMesa;

  const loadDoc = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await archivosRepo.listByExpediente(expedienteId);
      setDocumento(findApodaca(list));
    } catch (err) {
      setDocumento(null);
      setLoadError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : "No se pudo cargar la Notificación.",
      );
    } finally {
      setLoading(false);
    }
  }, [archivosRepo, expedienteId]);

  useEffect(() => {
    void loadDoc();
  }, [loadDoc]);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
    setSelectedFile(null);
    setWriteError(null);
    setProgressLabel(null);
  };

  const applySelectedFile = (file: File) => {
    if (!writeEnabled || saving || deleting) return;
    const validation = validateExpedienteDocumentoUploadFile(
      file,
      CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO,
    );
    if (!validation.ok) {
      setWriteError(validation.message);
      setSelectedFile(null);
      setDialogOpen(false);
      return;
    }
    setSelectedFile(file);
    setWriteError(null);
    setDialogMode(documento ? "replace" : "upload");
    setDialogOpen(true);
  };

  const handleConfirmUpload = async () => {
    if (savingLockRef.current || !selectedFile) return;
    savingLockRef.current = true;
    setSaving(true);
    setWriteError(null);
    setProgressLabel("Subiendo archivo…");
    try {
      if (dialogMode === "replace") {
        await archivosRepo.replaceMesaDocumento({
          expedienteId,
          tipo_documento: CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO,
          file: selectedFile,
        });
      } else {
        await archivosRepo.uploadMesaDocumento({
          expedienteId,
          tipo_documento: CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO,
          file: selectedFile,
        });
      }
      setSuccessMsg(
        dialogMode === "replace"
          ? "Notificación reemplazada correctamente."
          : "Notificación cargada correctamente.",
      );
      setDialogOpen(false);
      setSelectedFile(null);
      setProgressLabel(null);
      await loadDoc();
    } catch (err) {
      setProgressLabel(null);
      setWriteError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : "No se pudo registrar la Notificación. Intenta de nuevo.",
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

  const handleConfirmDelete = async () => {
    if (deleteLockRef.current || !documento || !writeEnabled) return;
    deleteLockRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      await archivosRepo.deleteMesaDocumento({
        expedienteId,
        tipo_documento: CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO,
      });
      setDeleteOpen(false);
      setDocumento(null);
      setSuccessMsg("Notificación eliminada correctamente.");
      closePreview();
      await loadDoc();
    } catch (err) {
      setDeleteError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : "No se pudo eliminar la Notificación. Intenta de nuevo.",
      );
    } finally {
      deleteLockRef.current = false;
      setDeleting(false);
    }
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
      setArchivoError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : "No se pudo abrir el archivo. Intenta de nuevo.",
      );
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
      a.download = documento.fileName || "notificacion-apodaca.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      setArchivoError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : "No se pudo abrir el archivo. Intenta de nuevo.",
      );
    } finally {
      setArchivoBusy(false);
    }
  };

  return (
    <section aria-label="Notificación" className="space-y-3 px-2 py-2 sm:px-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          {CLIENTE_NOTIFICACION_APODACA_DOCUMENT_CONTRACT.label}
        </h3>
        {!documento ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
            Pendiente
          </span>
        ) : (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
            Cargado
          </span>
        )}
      </div>

      {loading ? <p className="text-xs text-gray-500">Cargando…</p> : null}
      {loadError ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {loadError}
        </p>
      ) : null}

      {!submittedToMesa ? (
        <p className="text-xs text-amber-800">
          El expediente aún no fue enviado a Mesa. Puedes consultar el documento si existe, pero
          no cargar ni reemplazar.
        </p>
      ) : null}

      {!loading && !documento ? (
        <p className="text-sm text-gray-600">Notificación pendiente de carga.</p>
      ) : null}

      {!loading && documento ? (
        <dl className="grid grid-cols-1 gap-2 text-xs text-gray-700 sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Archivo</dt>
            <dd className="truncate font-medium text-gray-900">{documento.fileName}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Tamaño</dt>
            <dd className="font-medium text-gray-900">{formatBytesLabel(documento.fileSize)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Versión</dt>
            <dd className="font-medium text-gray-900">{documento.version}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Fecha</dt>
            <dd className="font-medium text-gray-900">{formatDateTimeEsMx(documento.createdAt)}</dd>
          </div>
        </dl>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {documento ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2.5 py-0 text-xs"
              disabled={archivoBusy || saving || deleting}
              onClick={() => void handleVer()}
            >
              {archivoBusy ? "Abriendo…" : "Ver"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2.5 py-0 text-xs"
              disabled={archivoBusy || saving || deleting}
              onClick={() => void handleDescargar()}
            >
              Descargar
            </Button>
            {writeEnabled ? (
              <Button
                type="button"
                variant="outline"
                className="h-8 px-2.5 py-0 text-xs border-red-300 text-red-800 hover:bg-red-50"
                disabled={saving || deleting || archivoBusy}
                onClick={() => {
                  setDeleteError(null);
                  setSuccessMsg(null);
                  setDeleteOpen(true);
                }}
              >
                {deleting ? "Eliminando…" : "Eliminar"}
              </Button>
            ) : null}
          </>
        ) : null}

        {writeEnabled ? (
          <div className="w-full min-w-[14rem] max-w-md basis-full sm:basis-auto">
            <DocumentDropzone
              accept={getExpedienteDocumentoAcceptAttr(CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO)}
              busy={saving || deleting}
              disabled={!writeEnabled || saving || deleting}
              selectedFileName={selectedFile?.name ?? null}
              aria-label={documento ? "Reemplazar Notificación" : "Subir Notificación"}
              onFiles={(files) => {
                const file = files[0];
                if (file) applySelectedFile(file);
              }}
            />
          </div>
        ) : null}
      </div>

      {writeError && !dialogOpen ? (
        <p role="alert" className="text-xs text-red-700">{writeError}</p>
      ) : null}
      {archivoError ? <p role="alert" className="text-xs text-red-700">{archivoError}</p> : null}
      {successMsg ? (
        <p aria-live="polite" className="text-xs text-emerald-800">{successMsg}</p>
      ) : null}

      {selectedFile ? (
        <MesaPagareUploadDialog
          open={dialogOpen}
          mode={dialogMode}
          fileName={selectedFile.name}
          mime="application/pdf"
          fileSize={selectedFile.size}
          saving={saving}
          progressLabel={progressLabel}
          error={writeError}
          documentLabel="Notificación"
          onClose={closeDialog}
          onConfirm={() => void handleConfirmUpload()}
        />
      ) : null}

      <MesaDocumentoEliminarDialog
        open={deleteOpen}
        label="Notificación"
        deleting={deleting}
        error={deleteError}
        onClose={() => {
          if (deleting) return;
          setDeleteOpen(false);
          setDeleteError(null);
        }}
        onConfirm={() => void handleConfirmDelete()}
      />

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
