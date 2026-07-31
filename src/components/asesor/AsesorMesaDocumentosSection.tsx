"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  MesaArchivoPreviewDialog,
  openBlobUrlInNewTab,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import {
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
} from "@/domain/expediente-archivos";
import {
  buildAsesorMesaDocumentosViews,
  labelAsesorMesaDocumento,
  shouldShowAsesorMesaDocumentosSection,
  type AsesorMesaDocumentoView,
} from "@/domain/expediente-archivos/asesor-mesa-documentos";
import { formatPagareMimeLabel } from "@/domain/expediente-archivos/cliente-pagare";

export type AsesorMesaDocumentosSectionProps = Readonly<{
  expedienteId: string;
  /** Si se pasa desde el padre, evita un fetch extra; si no, la sección carga sola. */
  listaActiva?: Parameters<typeof buildAsesorMesaDocumentosViews>[0] | null;
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
 * Solo lectura: documentos compartibles cargados por Mesa (constancia SAT, semanas, acta).
 * Sin subir / reemplazar / eliminar.
 */
export function AsesorMesaDocumentosSection({
  expedienteId,
  listaActiva = null,
}: AsesorMesaDocumentosSectionProps) {
  const archivosRepo = useExpedienteArchivosRepo();
  const [loading, setLoading] = useState(listaActiva == null);
  const [error, setError] = useState<string | null>(null);
  const [views, setViews] = useState<AsesorMesaDocumentoView[]>(() =>
    listaActiva ? buildAsesorMesaDocumentosViews(listaActiva) : [],
  );
  const [archivoBusyId, setArchivoBusyId] = useState<string | null>(null);
  const [archivoError, setArchivoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MesaArchivoPreviewState | null>(null);

  const load = useCallback(async () => {
    if (listaActiva) {
      setViews(buildAsesorMesaDocumentosViews(listaActiva));
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await archivosRepo.listByExpediente(expedienteId);
      setViews(buildAsesorMesaDocumentosViews(list));
    } catch (err) {
      setViews([]);
      setError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : "No se pudieron consultar los documentos de Mesa.",
      );
    } finally {
      setLoading(false);
    }
  }, [archivosRepo, expedienteId, listaActiva]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  const visible = useMemo(
    () => shouldShowAsesorMesaDocumentosSection(views) || loading || Boolean(error),
    [views, loading, error],
  );

  if (!visible) return null;
  if (!loading && !error && views.length === 0) return null;

  const mapArchivoError = (err: unknown): string => {
    if (err instanceof ExpedienteArchivosSupabaseError) return err.message;
    return "No se pudo abrir el archivo. Intenta de nuevo.";
  };

  const handleVer = async (view: AsesorMesaDocumentoView) => {
    if (!view.archivo.id || archivoBusyId) return;
    setArchivoBusyId(view.archivo.id);
    setArchivoError(null);
    try {
      const blob = await archivosRepo.getArchivoBlob(view.archivo.id);
      const url = URL.createObjectURL(blob);
      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return {
          url,
          mime_type: view.archivo.mime_type ?? "application/octet-stream",
          nombre_original: view.archivo.nombre_original ?? view.tipo_documento,
        };
      });
    } catch (err) {
      setArchivoError(mapArchivoError(err));
    } finally {
      setArchivoBusyId(null);
    }
  };

  const handleDescargar = async (view: AsesorMesaDocumentoView) => {
    if (!view.archivo.id || archivoBusyId) return;
    setArchivoBusyId(view.archivo.id);
    setArchivoError(null);
    try {
      const blob = await archivosRepo.getArchivoBlob(view.archivo.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = view.archivo.nombre_original || view.tipo_documento;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      setArchivoError(mapArchivoError(err));
    } finally {
      setArchivoBusyId(null);
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
      aria-label="Documentos cargados por Mesa"
      className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-4 text-sm text-gray-800"
    >
      <h3 className="text-sm font-semibold text-gray-900">
        Documentos cargados por Mesa
      </h3>
      <p className="mt-1 text-xs text-gray-600">
        Solo lectura. Puedes ver o descargar la versión activa; no puedes
        reemplazar ni eliminar estos archivos.
      </p>

      {loading ? (
        <p className="mt-2 text-xs text-gray-500">Cargando documentos de Mesa…</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {!loading && !error ? (
        <ul className="mt-3 space-y-3">
          {views.map((view) => {
            const busy = archivoBusyId === view.archivo.id;
            const label = labelAsesorMesaDocumento(view.tipo_documento);
            return (
              <li
                key={view.tipo_documento}
                className="rounded-md border border-gray-100 bg-white px-3 py-2"
              >
                <p className="font-medium text-gray-900">{label}</p>
                <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-gray-500">Archivo</dt>
                    <dd className="truncate font-medium text-gray-900">
                      {view.archivo.nombre_original}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Formato</dt>
                    <dd className="font-medium text-gray-900">
                      {formatPagareMimeLabel(view.archivo.mime_type)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Fecha</dt>
                    <dd className="font-medium text-gray-900">
                      {formatDateTimeEsMx(view.archivo.created_at)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 px-2.5 py-0 text-xs"
                    disabled={busy}
                    aria-label={`Ver ${label}`}
                    onClick={() => void handleVer(view)}
                  >
                    {busy ? "Abriendo…" : "Ver"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 px-2.5 py-0 text-xs"
                    disabled={busy}
                    aria-label={`Descargar ${label}`}
                    onClick={() => void handleDescargar(view)}
                  >
                    Descargar
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
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
