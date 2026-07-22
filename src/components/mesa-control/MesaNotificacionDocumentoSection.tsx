"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DocumentDropzone } from "@/components/documents/DocumentDropzone";
import {
  MesaArchivoPreviewDialog,
  openBlobUrlInNewTab,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import { MesaNotificacionDocumentoUploadDialog } from "@/components/mesa-control/MesaNotificacionDocumentoUploadDialog";
import {
  CLIENTE_NOTIFICACION_ACCEPT_ATTR,
  canMesaOperateNotificacionDocumento,
  findClienteNotificacionFromList,
  formatBytesLabel,
  formatNotificacionDocumentoMimeLabel,
  mesaNotificacionDocumentoWriteEnabled,
  resolveMesaNotificacionDocumentoUiMode,
  validateClienteNotificacionFile,
  type ClienteNotificacionDocumento,
  type ClienteNotificacionMime,
} from "@/domain/expediente-archivos/cliente-notificacion";
import {
  CLIENTE_NOTIFICACION_DOCUMENT_CONTRACT,
  CLIENTE_NOTIFICACION_DOCUMENT_TIPO,
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
} from "@/domain/expediente-archivos";

export type MesaNotificacionDocumentoSectionProps = Readonly<{
  expedienteId: string;
  etapaActual: number | null | undefined;
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

export function MesaNotificacionDocumentoSection({
  expedienteId,
  etapaActual,
  puedeOperar,
  submittedToMesa = true,
}: MesaNotificacionDocumentoSectionProps) {
  const archivosRepo = useExpedienteArchivosRepo();
  const uploadButtonRef = useRef<HTMLElement | null>(null);
  const savingLockRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [documento, setDocumento] = useState<ClienteNotificacionDocumento | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedMime, setSelectedMime] = useState<ClienteNotificacionMime | null>(null);
  const [dialogMode, setDialogMode] = useState<"upload" | "replace">("upload");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [archivoBusy, setArchivoBusy] = useState(false);
  const [archivoError, setArchivoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MesaArchivoPreviewState | null>(null);

  const operableWrite =
    puedeOperar &&
    submittedToMesa &&
    canMesaOperateNotificacionDocumento({ etapaActual, puedeOperar: true });

  const uiMode = resolveMesaNotificacionDocumentoUiMode({
    etapaActual,
    puedeOperar: operableWrite,
    hasDocumento: documento != null,
  });
  const writeEnabled = mesaNotificacionDocumentoWriteEnabled(uiMode) && operableWrite;

  const loadNotificacionDocumento = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await archivosRepo.listByExpediente(expedienteId);
      setDocumento(findClienteNotificacionFromList(list));
    } catch (err) {
      setDocumento(null);
      setLoadError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : "No se pudo cargar el Notificación.",
      );
    } finally {
      setLoading(false);
    }
  }, [archivosRepo, expedienteId]);

  useEffect(() => {
    void loadNotificacionDocumento();
  }, [loadNotificacionDocumento]);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
    setSelectedFile(null);
    setSelectedMime(null);
    setWriteError(null);
    setProgressLabel(null);
    window.setTimeout(() => uploadButtonRef.current?.focus(), 0);
  };

  const beginUploadMode = (mode: "upload" | "replace") => {
    if (!writeEnabled || saving) return;
    setDialogMode(mode);
    setWriteError(null);
    setSuccessMsg(null);
    setArchivoError(null);
  };

  const applySelectedFile = (file: File) => {
    if (!writeEnabled || saving) return;
    const validation = validateClienteNotificacionFile(file);
    if (!validation.ok) {
      setWriteError(validation.error);
      setSelectedFile(null);
      setSelectedMime(null);
      setDialogOpen(false);
      return;
    }
    setSelectedFile(file);
    setSelectedMime(validation.mime);
    setWriteError(null);
    setDialogOpen(true);
  };

  const handleDropzoneFiles = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    beginUploadMode(documento ? "replace" : "upload");
    applySelectedFile(file);
  };

  const handleConfirmUpload = async () => {
    if (savingLockRef.current || !selectedFile || !selectedMime) return;
    savingLockRef.current = true;
    setSaving(true);
    setWriteError(null);
    setProgressLabel("Subiendo archivo…");
    try {
      if (dialogMode === "replace") {
        await archivosRepo.replaceMesaDocumento({
          expedienteId,
          tipo_documento: CLIENTE_NOTIFICACION_DOCUMENT_TIPO,
          file: selectedFile,
        });
      } else {
        await archivosRepo.uploadMesaDocumento({
          expedienteId,
          tipo_documento: CLIENTE_NOTIFICACION_DOCUMENT_TIPO,
          file: selectedFile,
        });
      }
      setSuccessMsg(
        dialogMode === "replace"
          ? "Notificación reemplazado correctamente."
          : "Notificación cargado correctamente.",
      );
      setDialogOpen(false);
      setSelectedFile(null);
      setSelectedMime(null);
      setProgressLabel(null);
      await loadNotificacionDocumento();
      window.setTimeout(() => uploadButtonRef.current?.focus(), 0);
    } catch (err) {
      setProgressLabel(null);
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

  const closePreview = () => {
    setPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  const etapaLabel =
    typeof etapaActual === "number" &&
    etapaActual < CLIENTE_NOTIFICACION_DOCUMENT_CONTRACT.etapaMinima
      ? "Disponible después de Inscripción"
      : null;

  return (
    <section aria-label="Notificación" className="space-y-3 px-2 py-2 sm:px-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Notificación</h3>
        {uiMode === "etapa_bloqueada" ? (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
            {etapaLabel}
          </span>
        ) : null}
        {uiMode === "pendiente" || (uiMode === "solo_lectura" && !documento) ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
            Notificación pendiente
          </span>
        ) : null}
        {documento ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
            Cargado
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="text-xs text-gray-500">Cargando Notificación…</p>
      ) : null}

      {loadError ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {loadError}
        </p>
      ) : null}

      {uiMode === "etapa_bloqueada" ? (
        <p className="text-sm text-gray-600">
          El Notificación podrá cargarse después de concluir la inscripción.
        </p>
      ) : null}

      {!submittedToMesa && uiMode !== "etapa_bloqueada" ? (
        <p className="text-xs text-amber-800">
          El expediente aún no fue enviado a Mesa. Puedes consultar el documento si existe, pero
          no cargar ni reemplazar.
        </p>
      ) : null}

      {!loading && !loadError && uiMode !== "etapa_bloqueada" && !documento ? (
        <p className="text-sm text-gray-600">Notificación pendiente de carga.</p>
      ) : null}

      {!loading && documento ? (
        <dl className="grid grid-cols-1 gap-2 text-xs text-gray-700 sm:grid-cols-2">
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
          <div>
            <dt className="text-gray-500">Cargado por</dt>
            <dd className="truncate font-medium text-gray-900">
              {documento.createdByName ?? "Mesa Control"}
            </dd>
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
          </>
        ) : null}

        {writeEnabled ? (
          <div className="w-full min-w-[14rem] max-w-md basis-full sm:basis-auto">
            <DocumentDropzone
              accept={CLIENTE_NOTIFICACION_ACCEPT_ATTR}
              busy={saving}
              disabled={!writeEnabled || saving}
              selectedFileName={selectedFile?.name ?? null}
              aria-label={documento ? "Reemplazar Notificación" : "Subir Notificación"}
              onFiles={handleDropzoneFiles}
            />
          </div>
        ) : null}
      </div>

      {writeError && !dialogOpen ? (
        <p role="alert" className="text-xs text-red-700">
          {writeError}
        </p>
      ) : null}
      {archivoError ? (
        <p role="alert" className="text-xs text-red-700">
          {archivoError}
        </p>
      ) : null}
      {successMsg ? (
        <p aria-live="polite" className="text-xs text-emerald-800">
          {successMsg}
        </p>
      ) : null}

      {selectedFile && selectedMime ? (
        <MesaNotificacionDocumentoUploadDialog
          open={dialogOpen}
          mode={dialogMode}
          fileName={selectedFile.name}
          mime={selectedMime}
          fileSize={selectedFile.size}
          saving={saving}
          progressLabel={progressLabel}
          error={writeError}
          onClose={closeDialog}
          onConfirm={() => void handleConfirmUpload()}
        />
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
