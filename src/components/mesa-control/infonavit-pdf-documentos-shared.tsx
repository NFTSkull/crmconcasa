"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  MesaArchivoPreviewDialog,
  openBlobUrlInNewTab,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import { isArchivoPreviewPdfMime } from "@/lib/archivoPreviewMime";
import {
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
} from "@/domain/expediente-archivos";
import { formatBytesLabel } from "@/domain/expediente-archivos/cliente-pagare";
import {
  infonavitAutoDocumentLabel,
  type InfonavitAutoDocumentType,
} from "@/domain/expediente-archivos/infonavit-auto-document-types";
import {
  displayNameForInfonavitPdfDoc,
  infonavitPdfEstadoNeedsPoll,
  infonavitPdfUiStatusLabel,
  INFONAVIT_PDF_ESTADO_POLL_MS,
  shouldShowInfonavitPdfSection,
  startInfonavitPdfEstadoPolling,
  type InfonavitPdfDocumentEstado,
  type InfonavitPdfDocumentoMeta,
  type InfonavitPdfEstado,
} from "@/domain/expediente-archivos/infonavit-pdf-estado";
import { fetchExpedienteInfonavitPdfEstado } from "@/domain/expediente-archivos/infonavit-pdf-estado.repo";

function formatDateTimeEsMx(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function useInfonavitPdfSection(args: {
  expedienteId: string;
  enabled: boolean;
}) {
  const archivosRepo = useExpedienteArchivosRepo();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState<InfonavitPdfEstado | null>(null);
  const [archivoBusyId, setArchivoBusyId] = useState<string | null>(null);
  const [archivoError, setArchivoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MesaArchivoPreviewState | null>(null);

  const refetch = useCallback(
    async (silent: boolean) => {
      if (!args.enabled) return;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const next = await fetchExpedienteInfonavitPdfEstado(args.expedienteId);
        setEstado(next);
        setError(null);
      } catch (err) {
        setEstado(null);
        setError(
          err instanceof ExpedienteArchivosSupabaseError
            ? err.message
            : "No se pudo consultar los documentos INFONAVIT.",
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [args.enabled, args.expedienteId],
  );

  useEffect(() => {
    void refetch(false);
  }, [refetch]);

  const needsPoll = infonavitPdfEstadoNeedsPoll(estado);
  useEffect(() => {
    return startInfonavitPdfEstadoPolling({
      enabled: args.enabled,
      needsPoll,
      onTick: () => {
        void refetch(true);
      },
      intervalMs: INFONAVIT_PDF_ESTADO_POLL_MS,
      setIntervalFn: (handler, ms) => window.setInterval(handler, ms),
      clearIntervalFn: (id) => window.clearInterval(id),
    });
  }, [args.enabled, needsPoll, refetch]);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  const mapArchivoError = (err: unknown): string => {
    if (err instanceof ExpedienteArchivosSupabaseError) return err.message;
    return "No se pudo abrir el archivo. Intenta de nuevo.";
  };

  const handleVer = async (meta: InfonavitPdfDocumentoMeta, tipo: string) => {
    if (!meta.id || archivoBusyId) return;
    if (!isArchivoPreviewPdfMime(meta.mime_type ?? "application/pdf")) return;
    setArchivoBusyId(meta.id);
    setArchivoError(null);
    try {
      const blob = await archivosRepo.getArchivoBlob(meta.id);
      const url = URL.createObjectURL(blob);
      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return {
          url,
          mime_type: meta.mime_type ?? "application/pdf",
          nombre_original: displayNameForInfonavitPdfDoc(tipo, meta),
        };
      });
    } catch (err) {
      setArchivoError(mapArchivoError(err));
    } finally {
      setArchivoBusyId(null);
    }
  };

  const handleDescargar = async (
    meta: InfonavitPdfDocumentoMeta,
    tipo: string,
  ) => {
    if (!meta.id || archivoBusyId) return;
    setArchivoBusyId(meta.id);
    setArchivoError(null);
    try {
      const blob = await archivosRepo.getArchivoBlob(meta.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = displayNameForInfonavitPdfDoc(tipo, meta);
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

  const visible = shouldShowInfonavitPdfSection({
    aplica: estado?.aplica === true,
    has_submission: estado?.has_submission === true,
  });

  return {
    loading,
    error,
    estado,
    visible,
    archivoBusyId,
    archivoError,
    preview,
    handleVer,
    handleDescargar,
    closePreview,
  };
}

function PdfActions(props: {
  meta: InfonavitPdfDocumentoMeta;
  tipo: InfonavitAutoDocumentType;
  busyId: string | null;
  verAria: string;
  descargarAria: string;
  onVer: (meta: InfonavitPdfDocumentoMeta, tipo: string) => void;
  onDescargar: (meta: InfonavitPdfDocumentoMeta, tipo: string) => void;
}) {
  const busy = props.busyId === props.meta.id;
  const canPreview = isArchivoPreviewPdfMime(
    props.meta.mime_type ?? "application/pdf",
  );
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {canPreview ? (
        <Button
          type="button"
          variant="outline"
          className="h-8 px-2.5 py-0 text-xs"
          disabled={busy}
          aria-label={props.verAria}
          onClick={() => props.onVer(props.meta, props.tipo)}
        >
          {busy ? "Abriendo…" : "Ver PDF"}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        className="h-8 px-2.5 py-0 text-xs"
        disabled={busy}
        aria-label={props.descargarAria}
        onClick={() => props.onDescargar(props.meta, props.tipo)}
      >
        Descargar
      </Button>
    </div>
  );
}

function DocumentCard(props: {
  doc: InfonavitPdfDocumentEstado;
  busyId: string | null;
  onVer: (meta: InfonavitPdfDocumentoMeta, tipo: string) => void;
  onDescargar: (meta: InfonavitPdfDocumentoMeta, tipo: string) => void;
}) {
  const label = infonavitAutoDocumentLabel(props.doc.document_type);
  const statusLabel = infonavitPdfUiStatusLabel(props.doc.status);
  const latest = props.doc.latest_document;
  const previous = props.doc.previous_document;
  return (
    <article className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium text-gray-900">{label}</h4>
        <p className="text-xs font-medium text-gray-700">{statusLabel}</p>
      </div>
      {props.doc.status === "pending" || props.doc.status === "processing" ? (
        <p className="mt-1 text-xs text-gray-600">Generando automáticamente…</p>
      ) : null}
      {props.doc.status === "failed" ? (
        <p className="mt-1 text-xs text-gray-700">
          No se pudo generar este documento automáticamente. Esto no bloquea el
          expediente.
        </p>
      ) : null}
      {props.doc.status === "done" && latest ? (
        <>
          <p className="mt-1 truncate text-xs text-gray-600">
            {displayNameForInfonavitPdfDoc(props.doc.document_type, latest)}
            {latest.size_bytes != null
              ? ` · ${formatBytesLabel(latest.size_bytes)}`
              : ""}
            {latest.created_at
              ? ` · ${formatDateTimeEsMx(latest.created_at)}`
              : ""}
          </p>
          <PdfActions
            meta={latest}
            tipo={props.doc.document_type}
            busyId={props.busyId}
            verAria={`Ver PDF ${label}`}
            descargarAria={`Descargar ${label}`}
            onVer={props.onVer}
            onDescargar={props.onDescargar}
          />
        </>
      ) : null}
      {previous && props.doc.status !== "done" ? (
        <div className="mt-3 border-t border-gray-200 pt-2">
          <p className="text-xs font-medium text-gray-700">
            Versión anterior disponible
          </p>
          <p className="mt-0.5 truncate text-xs text-gray-500">
            {displayNameForInfonavitPdfDoc(props.doc.document_type, previous)}
          </p>
          <PdfActions
            meta={previous}
            tipo={props.doc.document_type}
            busyId={props.busyId}
            verAria={`Ver versión anterior ${label}`}
            descargarAria={`Descargar versión anterior ${label}`}
            onVer={props.onVer}
            onDescargar={props.onDescargar}
          />
        </div>
      ) : null}
    </article>
  );
}

export function InfonavitPdfDocumentosCards(props: {
  estado: InfonavitPdfEstado;
  busyId: string | null;
  archivoError: string | null;
  preview: MesaArchivoPreviewState | null;
  onVer: (meta: InfonavitPdfDocumentoMeta, tipo: string) => void;
  onDescargar: (meta: InfonavitPdfDocumentoMeta, tipo: string) => void;
  onClosePreview: () => void;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3">
        {props.estado.documents.map((doc) => (
          <DocumentCard
            key={doc.document_type}
            doc={doc}
            busyId={props.busyId}
            onVer={props.onVer}
            onDescargar={props.onDescargar}
          />
        ))}
      </div>
      {props.archivoError ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {props.archivoError}
        </p>
      ) : null}
      {props.preview ? (
        <MesaArchivoPreviewDialog
          preview={props.preview}
          onClose={props.onClosePreview}
          onOpenInNewTab={openBlobUrlInNewTab}
        />
      ) : null}
    </>
  );
}
