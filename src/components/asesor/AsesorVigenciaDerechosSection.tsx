"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DocumentDropzone } from "@/components/documents/DocumentDropzone";
import {
  MesaArchivoPreviewDialog,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import {
  CLIENTE_VIGENCIA_DERECHOS_ACCEPT_ATTR,
  CLIENTE_VIGENCIA_DERECHOS_UPLOAD_HINT,
  findClienteVigenciaDerechosFromList,
  formatBytesLabel,
  isClienteVigenciaDerechosPreviewableMime,
  sanitizeVigenciaDerechosDisplayName,
  validateClienteVigenciaDerechosFile,
  type ClienteVigenciaDerechosDocumento,
} from "@/domain/expediente-archivos/cliente-vigencia-derechos";
import {
  CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
} from "@/domain/expediente-archivos";

export type AsesorVigenciaDerechosSectionProps = Readonly<{
  expedienteId: string;
  /** Carga/reemplazo; independiente de monto aprobado. */
  canUpload: boolean;
  onUploaded?: () => void | Promise<void>;
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
 * Sección dedicada Vigencia de derechos (opcional).
 * No forma parte del checklist de obligatorios ni del progreso de envío.
 */
export function AsesorVigenciaDerechosSection({
  expedienteId,
  canUpload,
  onUploaded,
}: AsesorVigenciaDerechosSectionProps) {
  const archivosRepo = useExpedienteArchivosRepo();
  const savingLockRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [documento, setDocumento] = useState<ClienteVigenciaDerechosDocumento | null>(null);
  const [archivoBusy, setArchivoBusy] = useState(false);
  const [archivoError, setArchivoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MesaArchivoPreviewState | null>(null);
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await archivosRepo.listByExpediente(expedienteId);
      setDocumento(findClienteVigenciaDerechosFromList(list));
    } catch (err) {
      setDocumento(null);
      setError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : "No se pudo consultar vigencia de derechos.",
      );
    } finally {
      setLoading(false);
    }
  }, [archivosRepo, expedienteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  const mapArchivoError = (err: unknown): string => {
    if (err instanceof ExpedienteArchivosSupabaseError) return err.message;
    return "No se pudo abrir el archivo. Intenta de nuevo.";
  };

  const handleVer = async () => {
    if (!documento?.id || archivoBusy) return;
    if (!isClienteVigenciaDerechosPreviewableMime(documento.mimeType)) return;
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
          nombre_original: sanitizeVigenciaDerechosDisplayName(documento.fileName),
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
      a.download = sanitizeVigenciaDerechosDisplayName(documento.fileName);
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

  const handleFiles = async (files: File[]) => {
    const file = files[0];
    if (!file || !canUpload || savingLockRef.current) return;
    const validation = validateClienteVigenciaDerechosFile(file);
    if (!validation.ok) {
      setWriteError(validation.error);
      return;
    }

    savingLockRef.current = true;
    setSaving(true);
    setWriteError(null);
    setSuccessMsg(null);
    const previous = documento;
    try {
      if (documento?.id) {
        await archivosRepo.replaceArchivo({
          expedienteId,
          tipo_documento: CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
          file,
          uploaded_by_role: "asesor",
          uploaded_by_email: "",
        });
      } else {
        await archivosRepo.uploadArchivo({
          expedienteId,
          tipo_documento: CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
          file,
          uploaded_by_role: "asesor",
          uploaded_by_email: "",
        });
      }
      await load();
      setSuccessMsg(
        documento?.id
          ? "Vigencia de derechos reemplazada."
          : "Vigencia de derechos cargada.",
      );
      await onUploaded?.();
    } catch (err) {
      setDocumento(previous);
      setWriteError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : "No se pudo guardar vigencia de derechos. Intenta de nuevo.",
      );
    } finally {
      setSaving(false);
      savingLockRef.current = false;
    }
  };

  const canPreview = Boolean(
    documento && isClienteVigenciaDerechosPreviewableMime(documento.mimeType),
  );

  return (
    <section
      aria-label="Vigencia de derechos"
      className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-4 text-sm text-gray-800"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Vigencia de derechos</h3>
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-700">
          Opcional
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-600">
        Documento opcional para compartir información adicional con Mesa de Control.
      </p>

      {loading ? (
        <p className="mt-2 text-xs text-gray-500">Cargando vigencia de derechos…</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {!loading && !error && !documento ? (
        <p className="mt-2 text-sm text-gray-700">No se ha cargado vigencia de derechos.</p>
      ) : null}

      {!loading && documento ? (
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Archivo</dt>
            <dd className="truncate font-medium text-gray-900">
              {sanitizeVigenciaDerechosDisplayName(documento.fileName)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Tamaño</dt>
            <dd className="font-medium text-gray-900">
              {formatBytesLabel(documento.fileSize)}
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
      ) : null}

      {!loading && documento ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {canPreview ? (
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2.5 py-0 text-xs"
              disabled={archivoBusy || saving}
              aria-label="Ver vigencia de derechos"
              onClick={() => void handleVer()}
            >
              {archivoBusy ? "Abriendo…" : "Ver"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="h-8 px-2.5 py-0 text-xs"
            disabled={archivoBusy || saving}
            aria-label="Descargar vigencia de derechos"
            onClick={() => void handleDescargar()}
          >
            Descargar
          </Button>
        </div>
      ) : null}

      {canUpload ? (
        <div className="mt-3 space-y-2">
          <DocumentDropzone
            accept={CLIENTE_VIGENCIA_DERECHOS_ACCEPT_ATTR}
            busy={saving}
            disabled={saving}
            hint={CLIENTE_VIGENCIA_DERECHOS_UPLOAD_HINT}
            aria-label={
              documento ? "Reemplazar vigencia de derechos" : "Subir vigencia de derechos"
            }
            selectedFileName={null}
            error={writeError}
            onFiles={(files) => void handleFiles(files)}
          />
          <p className="text-xs font-medium text-gray-800">
            {documento ? "Reemplazar vigencia de derechos" : "Subir vigencia de derechos"}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-500">
          {documento
            ? "El expediente está en solo lectura: puedes ver o descargar vigencia de derechos."
            : "El expediente está en solo lectura: no se puede cargar vigencia de derechos ahora."}
        </p>
      )}

      {saving ? (
        <p className="mt-2 text-xs text-gray-500" role="status">
          Guardando vigencia de derechos…
        </p>
      ) : null}

      {successMsg ? (
        <p className="mt-2 text-xs text-emerald-800" role="status">
          {successMsg}
        </p>
      ) : null}

      {archivoError ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {archivoError}
        </p>
      ) : null}

      {preview ? (
        <MesaArchivoPreviewDialog
          preview={preview}
          onClose={closePreview}
          onOpenInNewTab={() => {
            /* Vigencia de derechos insegura: no abrir en pestaña; solo modal para MIME seguros */
          }}
        />
      ) : null}
    </section>
  );
}
