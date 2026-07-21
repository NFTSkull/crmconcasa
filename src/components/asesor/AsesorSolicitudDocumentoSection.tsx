"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  MesaArchivoPreviewDialog,
  openBlobUrlInNewTab,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import {
  findClienteSolicitudFromList,
  formatSolicitudDocumentoMimeLabel,
  shouldShowAsesorSolicitudDocumentoSection,
  type ClienteSolicitudDocumento,
} from "@/domain/expediente-archivos/cliente-solicitud";
import {
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
} from "@/domain/expediente-archivos";

export type AsesorSolicitudDocumentoSectionProps = Readonly<{
  expedienteId: string;
  etapaActual: number | null | undefined;
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
 * Solo lectura: consulta metadata activa y preview/descarga.
 * No importa upload ni register_mesa_documento.
 */
export function AsesorSolicitudDocumentoSection({
  expedienteId,
  etapaActual,
}: AsesorSolicitudDocumentoSectionProps) {
  const archivosRepo = useExpedienteArchivosRepo();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [documento, setDocumento] = useState<ClienteSolicitudDocumento | null>(null);
  const [archivoBusy, setArchivoBusy] = useState(false);
  const [archivoError, setArchivoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MesaArchivoPreviewState | null>(null);

  const visible = shouldShowAsesorSolicitudDocumentoSection(etapaActual);

  const load = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    setError(null);
    try {
      const list = await archivosRepo.listByExpediente(expedienteId);
      setDocumento(findClienteSolicitudFromList(list));
    } catch (err) {
      setDocumento(null);
      setError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : "No se pudo consultar el Solicitud.",
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
      a.download = documento.fileName || "solicitud-documento";
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

  return (
    <section
      aria-label="Solicitud"
      className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-4 text-sm text-gray-800"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Solicitud</h3>
        {documento ? (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-2.5 py-0.5 text-xs font-medium text-emerald-900">
            Cargado por Mesa
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-white px-2.5 py-0.5 text-xs font-medium text-amber-900">
            Pendiente de Mesa
          </span>
        )}
      </div>

      {loading ? (
        <p className="mt-2 text-xs text-gray-500">Cargando Solicitud…</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {!loading && !error && !documento ? (
        <p className="mt-2 text-sm text-gray-700">
          Mesa Control todavía no ha cargado el Solicitud de este expediente.
        </p>
      ) : null}

      {!loading && documento ? (
        <>
          <p className="mt-2 text-sm text-gray-700">
            Mesa Control cargó el Solicitud correspondiente a este expediente.
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">Archivo</dt>
              <dd className="truncate font-medium text-gray-900">{documento.fileName}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Formato</dt>
              <dd className="font-medium text-gray-900">
                {formatSolicitudDocumentoMimeLabel(documento.mimeType)}
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
              aria-label="Ver Solicitud"
              onClick={() => void handleVer()}
            >
              {archivoBusy ? "Abriendo…" : "Ver"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2.5 py-0 text-xs"
              disabled={archivoBusy}
              aria-label="Descargar Solicitud"
              onClick={() => void handleDescargar()}
            >
              Descargar
            </Button>
          </div>
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
          onOpenInNewTab={openBlobUrlInNewTab}
        />
      ) : null}
    </section>
  );
}
