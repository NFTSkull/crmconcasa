"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  MesaArchivoPreviewDialog,
  openBlobUrlInNewTab,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import {
  useExpedienteArchivosRepo,
  ExpedienteArchivosSupabaseError,
} from "@/domain/expediente-archivos";
import { rowMasRecientePorTipoDocumento } from "@/domain/expediente-archivos/types";
import type { ExpedienteArchivoListItem } from "@/domain/expediente-archivos/map-supabase-expediente-documentos";
import {
  isArchivoPreviewImageMime,
  isArchivoPreviewPdfMime,
} from "@/lib/archivoPreviewMime";
import {
  friendlyDocLabel,
  ineSideToDocKind,
  missingDocMessage,
  pickInitialIneSide,
  resolveActiveDocKind,
  type InfonavitSourceDocKind,
  type InfonavitSourcePreviewContext,
} from "@/domain/document-extractions/infonavit-source-preview";
import {
  detectClabeFromBankStatementPdfBytes,
  detectClabeUnsupportedForMime,
  shouldRunClabeShadowDetection,
  type ClabeBankStatementDetection,
} from "@/domain/document-extractions/clabe-bank-statement";
import { MesaClabeShadowDetectionPanel } from "@/components/mesa-control/MesaClabeShadowDetectionPanel";

export type MesaInfonavitSourceDocumentPreviewProps = Readonly<{
  expedienteId: string;
  context: InfonavitSourcePreviewContext;
  /** Clase opcional para sticky / altura en desktop */
  className?: string;
  /** Forzar modal (mobile); si null, usa dialog solo al pedir "vista grande" */
  preferModal?: boolean;
}>;

type DocIndex = Readonly<{
  frente: ExpedienteArchivoListItem | null;
  reverso: ExpedienteArchivoListItem | null;
  estadoCuenta: ExpedienteArchivoListItem | null;
  comprobante: ExpedienteArchivoListItem | null;
}>;

function pickByTipo(
  list: readonly ExpedienteArchivoListItem[],
  tipo: InfonavitSourceDocKind,
): ExpedienteArchivoListItem | null {
  return rowMasRecientePorTipoDocumento(list, tipo) ?? null;
}

export function MesaInfonavitSourceDocumentPreview({
  expedienteId,
  context,
  className,
}: MesaInfonavitSourceDocumentPreviewProps) {
  const archivosRepo = useExpedienteArchivosRepo();
  const [index, setIndex] = useState<DocIndex>({
    frente: null,
    reverso: null,
    estadoCuenta: null,
    comprobante: null,
  });
  const [listError, setListError] = useState<string | null>(null);
  const [ineSide, setIneSide] = useState<"frente" | "reverso" | null>(null);
  const [loadingBlob, setLoadingBlob] = useState(false);
  const [blobError, setBlobError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MesaArchivoPreviewState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeBlob, setActiveBlob] = useState<Blob | null>(null);
  const [clabeAnalyzing, setClabeAnalyzing] = useState(false);
  const [clabeDetection, setClabeDetection] =
    useState<ClabeBankStatementDetection | null>(null);
  const clabeCacheRef = useRef<Map<string, ClabeBankStatementDetection>>(
    new Map(),
  );
  const clabeGenRef = useRef(0);

  const loadIndex = useCallback(async () => {
    setListError(null);
    try {
      const list = await archivosRepo.listByExpediente(expedienteId);
      // listByExpediente ya excluye deleted_at; solo current
      setIndex({
        frente: pickByTipo(list, "cliente_ine_frente"),
        reverso: pickByTipo(list, "cliente_ine_reverso"),
        estadoCuenta: pickByTipo(list, "cliente_estado_cuenta"),
        comprobante: pickByTipo(list, "cliente_comprobante_domicilio"),
      });
    } catch (err) {
      setIndex({
        frente: null,
        reverso: null,
        estadoCuenta: null,
        comprobante: null,
      });
      setListError(
        err instanceof ExpedienteArchivosSupabaseError
          ? err.message
          : "No se pudieron cargar documentos fuente.",
      );
    }
  }, [archivosRepo, expedienteId]);

  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);

  // Al entrar a identidad, preferir Frente si existe (una vez por contexto)
  useEffect(() => {
    if (context !== "identidad") return;
    setIneSide((prev) => {
      if (prev) return prev;
      return pickInitialIneSide({
        frente: Boolean(index.frente),
        reverso: Boolean(index.reverso),
      });
    });
  }, [context, index.frente, index.reverso]);

  const activeKind = useMemo(
    () =>
      resolveActiveDocKind({
        context,
        ineSide,
        hasFrente: Boolean(index.frente),
        hasReverso: Boolean(index.reverso),
        hasEstadoCuenta: Boolean(index.estadoCuenta),
        hasComprobante: Boolean(index.comprobante),
      }),
    [context, ineSide, index],
  );

  const activeRow: ExpedienteArchivoListItem | null = useMemo(() => {
    if (!activeKind) return null;
    switch (activeKind) {
      case "cliente_ine_frente":
        return index.frente;
      case "cliente_ine_reverso":
        return index.reverso;
      case "cliente_estado_cuenta":
        return index.estadoCuenta;
      case "cliente_comprobante_domicilio":
        return index.comprobante;
      default:
        return null;
    }
  }, [activeKind, index]);

  // Cargar blob cuando cambia documento activo; revocar anterior
  useEffect(() => {
    let cancelled = false;
    const docId = activeRow?.id ?? null;

    setBlobError(null);
    setModalOpen(false);

    if (!docId || !activeRow) {
      setActiveBlob(null);
      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return null;
      });
      return;
    }

    setLoadingBlob(true);
    setActiveBlob(null);
    void (async () => {
      try {
        const blob = await archivosRepo.getArchivoBlob(docId);
        if (cancelled) return;
        setActiveBlob(blob);
        const url = URL.createObjectURL(blob);
        setPreview((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return {
            url,
            mime_type: activeRow.mime_type,
            nombre_original:
              activeRow.nombre_original ||
              (activeKind ? friendlyDocLabel(activeKind) : "Documento"),
          };
        });
      } catch (err) {
        if (cancelled) return;
        setActiveBlob(null);
        setPreview((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return null;
        });
        setBlobError(
          err instanceof ExpedienteArchivosSupabaseError
            ? err.message
            : "No se pudo abrir el documento privado.",
        );
      } finally {
        if (!cancelled) setLoadingBlob(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeRow?.id, activeRow, activeKind, archivosRepo]);

  // Unmount / cambio de URL: revoke
  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  // Cambio de expediente: limpiar lado INE + cache CLABE shadow
  useEffect(() => {
    setIneSide(null);
    clabeCacheRef.current.clear();
    setClabeDetection(null);
    setClabeAnalyzing(false);
    clabeGenRef.current += 1;
  }, [expedienteId]);

  // P4B: detección CLABE solo en context=clabe (shadow, sin escritura al formulario)
  useEffect(() => {
    if (!shouldRunClabeShadowDetection(context)) {
      setClabeAnalyzing(false);
      setClabeDetection(null);
      return;
    }

    const docId = activeRow?.id ?? null;
    const mime = activeRow?.mime_type ?? preview?.mime_type ?? "";

    if (!docId || activeKind !== "cliente_estado_cuenta") {
      setClabeAnalyzing(false);
      setClabeDetection(null);
      return;
    }

    if (!mime) {
      // espera metadata MIME del documento activo
      return;
    }

    if (detectClabeUnsupportedForMime(mime)) {
      setClabeAnalyzing(false);
      setClabeDetection({ status: "unsupported" });
      return;
    }

    const cached = clabeCacheRef.current.get(docId);
    if (cached) {
      setClabeAnalyzing(false);
      setClabeDetection(cached);
      return;
    }

    if (!activeBlob) {
      // espera blob del preview
      return;
    }

    const gen = ++clabeGenRef.current;
    setClabeAnalyzing(true);
    setClabeDetection(null);

    let cancelled = false;
    void (async () => {
      try {
        const buf = await activeBlob.arrayBuffer();
        if (cancelled || gen !== clabeGenRef.current) return;
        const result = await detectClabeFromBankStatementPdfBytes(buf);
        if (cancelled || gen !== clabeGenRef.current) return;
        clabeCacheRef.current.set(docId, result);
        setClabeDetection(result);
      } catch {
        if (cancelled || gen !== clabeGenRef.current) return;
        const fallback: ClabeBankStatementDetection = { status: "no_text_layer" };
        clabeCacheRef.current.set(docId, fallback);
        setClabeDetection(fallback);
      } finally {
        if (!cancelled && gen === clabeGenRef.current) {
          setClabeAnalyzing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    context,
    activeRow?.id,
    activeRow?.mime_type,
    activeKind,
    activeBlob,
    preview?.mime_type,
  ]);

  const title =
    activeKind != null
      ? friendlyDocLabel(activeKind)
      : context === "none"
        ? "Documento fuente"
        : "Documento no disponible";

  const showIneToggle =
    context === "identidad" && (index.frente != null || index.reverso != null);

  return (
    <aside
      className={[
        "flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm",
        className ?? "",
      ].join(" ")}
      data-testid="infonavit-source-preview"
      aria-label="Vista previa del documento fuente"
    >
      <div className="flex items-start justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{title}</p>
          {context === "rfc" ? (
            <p className="text-[11px] text-gray-500">
              Solo referencia visual. No se extrae RFC automáticamente.
            </p>
          ) : null}
          {context === "identidad" ? (
            <p className="text-[11px] text-gray-500">
              Número de identificación (T7) no se completa automáticamente.
            </p>
          ) : null}
        </div>
        {preview ? (
          <Button
            type="button"
            variant="outline"
            className="shrink-0 px-2 py-1 text-[11px]"
            onClick={() => setModalOpen(true)}
          >
            Abrir vista grande
          </Button>
        ) : null}
      </div>

      {showIneToggle ? (
        <div className="flex gap-1 border-b border-gray-100 px-3 py-2">
          <Button
            type="button"
            variant={ineSide === "frente" || (!ineSide && index.frente) ? "primary" : "outline"}
            className="px-2 py-1 text-[11px]"
            disabled={!index.frente}
            onClick={() => setIneSide("frente")}
            aria-pressed={ineSideToDocKind("frente") === activeKind}
          >
            Frente
          </Button>
          <Button
            type="button"
            variant={ineSide === "reverso" ? "primary" : "outline"}
            className="px-2 py-1 text-[11px]"
            disabled={!index.reverso}
            onClick={() => setIneSide("reverso")}
            aria-pressed={ineSideToDocKind("reverso") === activeKind}
          >
            Reverso
          </Button>
        </div>
      ) : null}

      {shouldRunClabeShadowDetection(context) ? (
        <MesaClabeShadowDetectionPanel
          analyzing={clabeAnalyzing}
          result={clabeDetection}
        />
      ) : null}

      <div className="min-h-[280px] flex-1 bg-gray-50 p-3 lg:min-h-[420px]">
        {listError ? (
          <p className="text-sm text-red-700" role="alert">
            {listError}
          </p>
        ) : context === "none" ? (
          <p className="text-sm text-gray-600">
            Haz clic o enfoca un campo de identidad, RFC, CLABE o vivienda para
            ver el documento fuente.
          </p>
        ) : loadingBlob ? (
          <p className="text-sm text-gray-600">Cargando documento…</p>
        ) : blobError ? (
          <p className="text-sm text-red-700" role="alert">
            {blobError}
          </p>
        ) : !activeRow || !preview ? (
          <div data-testid="infonavit-source-unavailable">
            <p className="text-sm font-medium text-gray-800">
              Documento no disponible
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {missingDocMessage(context)}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Puedes seguir capturando manualmente.
            </p>
          </div>
        ) : isArchivoPreviewImageMime(preview.mime_type) ? (
          <div className="flex h-full justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- blob URL privado */}
            <img
              src={preview.url}
              alt={preview.nombre_original}
              className="max-h-[min(60vh,640px)] max-w-full object-contain"
            />
          </div>
        ) : isArchivoPreviewPdfMime(preview.mime_type) ? (
          <iframe
            title={preview.nombre_original}
            src={preview.url}
            className="h-[min(60vh,640px)] w-full border-0 bg-white"
          />
        ) : (
          <div className="py-6 text-center">
            <p className="text-sm text-gray-600">
              Vista previa inline no disponible para este tipo.
            </p>
            <Button
              type="button"
              variant="primary"
              className="mt-3 px-3 py-1.5 text-xs"
              onClick={() => setModalOpen(true)}
            >
              Abrir vista grande
            </Button>
          </div>
        )}
      </div>

      {modalOpen && preview ? (
        <MesaArchivoPreviewDialog
          preview={preview}
          onClose={() => setModalOpen(false)}
          onOpenInNewTab={openBlobUrlInNewTab}
        />
      ) : null}
    </aside>
  );
}
