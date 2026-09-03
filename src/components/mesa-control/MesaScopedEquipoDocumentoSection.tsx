"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  MesaArchivoPreviewDialog,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import {
  formatBytesLabel,
  findScopedEquipoDocumentoFromList,
  isScopedEquipoPreviewableMime,
  sanitizeScopedEquipoDisplayName,
  type ScopedEquipoDocumento,
} from "@/domain/expediente-archivos/cliente-scoped-equipo-documento";
import {
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
  type IntegrationDocAsesorScopedPorEquipoTipo,
} from "@/domain/expediente-archivos";

export type MesaScopedEquipoDocumentoSectionProps = Readonly<{
  expedienteId: string;
  tipo: IntegrationDocAsesorScopedPorEquipoTipo;
  label: string;
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
 * Solo lectura: Mesa consulta documentos scoped del asesor (sin upload).
 */
export function MesaScopedEquipoDocumentoSection({
  expedienteId,
  tipo,
  label,
}: MesaScopedEquipoDocumentoSectionProps) {
  const archivosRepo = useExpedienteArchivosRepo();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [documento, setDocumento] = useState<ScopedEquipoDocumento | null>(null);
  const [archivoBusy, setArchivoBusy] = useState(false);
  const [archivoError, setArchivoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MesaArchivoPreviewState | null>(null);
  const fallbackName = `${tipo}.pdf`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await archivosRepo.listByExpediente(expedienteId);
      setDocumento(findScopedEquipoDocumentoFromList(list, tipo));
    } catch (err) {
      setDocumento(null);
      setError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : `No se pudo consultar ${label}.`,
      );
    } finally {
      setLoading(false);
    }
  }, [archivosRepo, expedienteId, label, tipo]);

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
    if (!isScopedEquipoPreviewableMime(documento.mimeType)) return;
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
          nombre_original: sanitizeScopedEquipoDisplayName(
            documento.fileName,
            fallbackName,
          ),
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
      a.download = sanitizeScopedEquipoDisplayName(documento.fileName, fallbackName);
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

  const canPreview = Boolean(
    documento && isScopedEquipoPreviewableMime(documento.mimeType),
  );

  return (
    <section aria-label={label} className="px-4 py-3 text-sm text-gray-800">
      <p className="text-xs text-gray-600">
        Documento opcional cargado por el asesor. Solo consulta y descarga.
      </p>

      {loading ? (
        <p className="mt-2 text-xs text-gray-500">Cargando {label}…</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {!loading && !error && !documento ? (
        <p className="mt-2 text-sm text-gray-700">
          El asesor no ha cargado {label}.
        </p>
      ) : null}

      {!loading && documento ? (
        <>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">Archivo</dt>
              <dd className="truncate font-medium text-gray-900">
                {sanitizeScopedEquipoDisplayName(documento.fileName, fallbackName)}
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
          <div className="mt-3 flex flex-wrap gap-2">
            {canPreview ? (
              <Button
                type="button"
                variant="outline"
                className="h-8 px-2.5 py-0 text-xs"
                disabled={archivoBusy}
                aria-label={`Ver ${label}`}
                onClick={() => void handleVer()}
              >
                {archivoBusy ? "Abriendo…" : "Ver"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2.5 py-0 text-xs"
              disabled={archivoBusy}
              aria-label={`Descargar ${label}`}
              onClick={() => void handleDescargar()}
            >
              Descargar
            </Button>
          </div>
          {!canPreview ? (
            <p className="mt-2 text-xs text-gray-500">
              Este formato no se previsualiza; usa Descargar.
            </p>
          ) : null}
        </>
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
            /* Solo MIME seguros */
          }}
        />
      ) : null}
    </section>
  );
}
