"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  MesaArchivoPreviewDialog,
  openBlobUrlInNewTab,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import { isArchivoPreviewPdfMime } from "@/lib/archivoPreviewMime";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
} from "@/domain/expediente-archivos";
import { formatBytesLabel } from "@/domain/expediente-archivos/cliente-pagare";
import {
  infonavitAutoDocumentDocxFilename,
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

function wordBusyKey(tipo: string): string {
  return `word:${tipo}`;
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const m = /filename="([^"]+)"/i.exec(header);
  const name = m?.[1]?.trim();
  return name || null;
}

export function useInfonavitPdfSection(args: {
  expedienteId: string;
  enabled: boolean;
  allowWordDownload?: boolean;
}) {
  const allowWordDownload = args.allowWordDownload === true;
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

  const handleDescargarWord = async (tipo: InfonavitAutoDocumentType) => {
    if (!allowWordDownload || archivoBusyId) return;
    const version = estado?.submission_version;
    if (version == null) return;
    setArchivoBusyId(wordBusyKey(tipo));
    setArchivoError(null);
    try {
      if (!supabaseBrowser) {
        throw new ExpedienteArchivosSupabaseError(
          "No se pudo descargar el Word editable.",
        );
      }
      const {
        data: { session },
        error: sessionError,
      } = await supabaseBrowser.auth.getSession();
      if (sessionError || !session?.access_token) {
        throw new ExpedienteArchivosSupabaseError("No hay sesión activa.");
      }
      const res = await fetch("/api/mesa/infonavit-docx", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          expedienteId: args.expedienteId,
          documentType: tipo,
          submissionVersion: version,
        }),
      });
      if (!res.ok) {
        let message = "No se pudo descargar el Word editable.";
        try {
          const json = (await res.json()) as { message?: unknown };
          if (typeof json.message === "string" && json.message.trim()) {
            message = json.message.trim();
          }
        } catch {
          /* cuerpo no JSON */
        }
        throw new ExpedienteArchivosSupabaseError(message);
      }
      const blob = await res.blob();
      const filename =
        filenameFromContentDisposition(res.headers.get("Content-Disposition")) ??
        infonavitAutoDocumentDocxFilename(tipo);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
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
    allowWordDownload,
    handleVer,
    handleDescargar,
    handleDescargarWord,
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
  allowWordDownload?: boolean;
  submissionVersion?: number | null;
  onDescargarWord?: (tipo: InfonavitAutoDocumentType) => void;
}) {
  const busyPdf = props.busyId === props.meta.id;
  const busyWord = props.busyId === wordBusyKey(props.tipo);
  const busy = busyPdf || busyWord;
  const canPreview = isArchivoPreviewPdfMime(
    props.meta.mime_type ?? "application/pdf",
  );
  const showWord =
    props.allowWordDownload === true &&
    props.submissionVersion != null &&
    typeof props.onDescargarWord === "function";
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
          {busyPdf ? "Abriendo…" : "Vista previa"}
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
        Descargar PDF
      </Button>
      {showWord ? (
        <Button
          type="button"
          variant="outline"
          className="h-8 px-2.5 py-0 text-xs"
          disabled={busy}
          aria-label={`Descargar Word editable ${infonavitAutoDocumentLabel(props.tipo)}`}
          onClick={() => props.onDescargarWord?.(props.tipo)}
        >
          {busyWord ? "Generando Word…" : "Descargar Word editable"}
        </Button>
      ) : null}
    </div>
  );
}

function DocumentCard(props: {
  doc: InfonavitPdfDocumentEstado;
  busyId: string | null;
  onVer: (meta: InfonavitPdfDocumentoMeta, tipo: string) => void;
  onDescargar: (meta: InfonavitPdfDocumentoMeta, tipo: string) => void;
  allowWordDownload?: boolean;
  submissionVersion?: number | null;
  onDescargarWord?: (tipo: InfonavitAutoDocumentType) => void;
}) {
  const label = infonavitAutoDocumentLabel(props.doc.document_type);
  const statusLabel = infonavitPdfUiStatusLabel(props.doc.status);
  const latest = props.doc.latest_document;
  const previous = props.doc.previous_document;
  const wordOnLatest =
    props.allowWordDownload === true &&
    props.doc.status === "done" &&
    latest != null &&
    props.submissionVersion != null;
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
            verAria={`Vista previa ${label}`}
            descargarAria={`Descargar PDF ${label}`}
            onVer={props.onVer}
            onDescargar={props.onDescargar}
            allowWordDownload={wordOnLatest}
            submissionVersion={props.submissionVersion}
            onDescargarWord={props.onDescargarWord}
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
            verAria={`Vista previa versión anterior ${label}`}
            descargarAria={`Descargar PDF versión anterior ${label}`}
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
  allowWordDownload?: boolean;
  onDescargarWord?: (tipo: InfonavitAutoDocumentType) => void;
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
            allowWordDownload={props.allowWordDownload}
            submissionVersion={props.estado.submission_version}
            onDescargarWord={props.onDescargarWord}
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
