"use client";

import { useCallback, useRef } from "react";
import { Button } from "@/components/ui/Button";
import {
  EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR,
  labelPresenciaComplementario,
  mesaPuedeAbrirArchivo,
  type IntegrationDocMesaUploadTipo,
  type MesaComplementarioDocView,
} from "@/domain/expediente-archivos";

function presenciaBadgeClass(presencia: MesaComplementarioDocView["presencia"]): string {
  if (presencia === "cargado") return "bg-sky-50 text-sky-800 ring-sky-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function fileKindLabel(mime: string | null | undefined, nombre: string | null | undefined): string {
  const m = (mime ?? "").toLowerCase();
  const n = (nombre ?? "").toLowerCase();
  if (m.includes("pdf") || n.endsWith(".pdf")) return "PDF";
  if (m.includes("png") || n.endsWith(".png")) return "PNG";
  if (m.includes("jpeg") || m.includes("jpg") || n.endsWith(".jpg") || n.endsWith(".jpeg")) {
    return "JPG";
  }
  return "DOC";
}

function fileKindClass(kind: string): string {
  if (kind === "PDF") return "bg-red-50 text-red-700 ring-red-100";
  if (kind === "PNG" || kind === "JPG") return "bg-violet-50 text-violet-700 ring-violet-100";
  return "bg-gray-100 text-gray-600 ring-gray-200";
}

type DocumentoRowProps = {
  item: MesaComplementarioDocView;
  puedeOperar: boolean;
  archivoLoading: boolean;
  uploadLoading: boolean;
  archivoError: string | null;
  uploadError: string | null;
  onSeleccionarArchivo: (file: File) => void;
  onVer: () => void;
  onDescargar: () => void;
};

function DocumentoRow({
  item,
  puedeOperar,
  archivoLoading,
  uploadLoading,
  archivoError,
  uploadError,
  onSeleccionarArchivo,
  onVer,
  onDescargar,
}: DocumentoRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const puedeAbrir = mesaPuedeAbrirArchivo(item.archivo);
  const tieneArchivo = Boolean(item.archivo?.id);
  const nombre = item.archivo?.nombre_original ?? null;
  const kind = fileKindLabel(item.archivo?.mime_type, nombre);
  const busy = archivoLoading || uploadLoading;
  const faltante = item.presencia === "faltante";

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) onSeleccionarArchivo(file);
    },
    [onSeleccionarArchivo],
  );

  return (
    <article className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm border-l-4 border-l-violet-400">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ring-1 ${tieneArchivo ? fileKindClass(kind) : "bg-slate-50 text-slate-400 ring-slate-200"}`}
            aria-hidden
          >
            {tieneArchivo ? kind : "—"}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">{item.label}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                Opcional / Complementario
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-500">
              {nombre ?? (faltante ? "Sin archivo" : "—")}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${presenciaBadgeClass(item.presencia)}`}
        >
          {labelPresenciaComplementario(item.presencia)}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 bg-slate-50/80 px-4 py-2.5">
        {faltante && puedeOperar ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              ref={inputRef}
              type="file"
              accept={EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR}
              className="sr-only"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2.5 py-0 text-xs"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {uploadLoading ? "Subiendo…" : "Subir archivo"}
            </Button>
          </div>
        ) : puedeAbrir ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Archivo
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2.5 py-0 text-xs"
              disabled={busy}
              onClick={onVer}
            >
              {archivoLoading ? "Abriendo…" : "Ver archivo"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2.5 py-0 text-xs"
              disabled={busy}
              onClick={onDescargar}
            >
              Descargar
            </Button>
            {puedeOperar ? (
              <>
                <input
                  ref={inputRef}
                  type="file"
                  accept={EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR}
                  className="sr-only"
                  onChange={handleFileChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 px-2.5 py-0 text-xs"
                  disabled={busy}
                  onClick={() => inputRef.current?.click()}
                >
                  {uploadLoading ? "…" : "Reemplazar archivo"}
                </Button>
              </>
            ) : null}
          </div>
        ) : (
          <span />
        )}
      </div>

      {archivoError || uploadError ? (
        <p role="alert" className="border-t border-red-100 bg-red-50/50 px-4 py-2 text-[11px] text-red-700">
          {uploadError ?? archivoError}
        </p>
      ) : null}
    </article>
  );
}

type Props = {
  documentos: MesaComplementarioDocView[];
  puedeOperar: boolean;
  archivoLoadingTipo: IntegrationDocMesaUploadTipo | null;
  uploadLoadingTipo: IntegrationDocMesaUploadTipo | null;
  archivoErrorByTipo: Record<string, string>;
  uploadErrorByTipo: Record<string, string>;
  onVer: (
    tipo: IntegrationDocMesaUploadTipo,
    archivo: NonNullable<MesaComplementarioDocView["archivo"]>,
  ) => void;
  onDescargar: (
    tipo: IntegrationDocMesaUploadTipo,
    archivo: NonNullable<MesaComplementarioDocView["archivo"]>,
  ) => void;
  onSubir: (tipo: IntegrationDocMesaUploadTipo, file: File) => Promise<void>;
  onReemplazar: (tipo: IntegrationDocMesaUploadTipo, file: File) => Promise<void>;
  embedded?: boolean;
};

export function MesaControlDocumentosComplementariosSection({
  documentos,
  puedeOperar,
  archivoLoadingTipo,
  uploadLoadingTipo,
  archivoErrorByTipo,
  uploadErrorByTipo,
  onVer,
  onDescargar,
  onSubir,
  onReemplazar,
  embedded = false,
}: Props) {
  const resolveArchivo = useCallback(
    (tipo: IntegrationDocMesaUploadTipo) => {
      const item = documentos.find((d) => d.tipo_documento === tipo);
      return item?.archivo ?? null;
    },
    [documentos],
  );

  if (documentos.length === 0) {
    return (
      <p className={embedded ? "px-4 py-3 text-sm text-gray-500" : "text-sm text-gray-500"}>
        No hay documentos complementarios configurados.
      </p>
    );
  }

  return (
    <section
      className={
        embedded
          ? "bg-white"
          : "overflow-hidden rounded-xl border border-violet-200 bg-gradient-to-b from-violet-50/40 to-white shadow-sm"
      }
    >
      {embedded ? null : (
      <header className="border-b border-violet-100 bg-white px-4 py-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Documentos complementarios / Mesa de Control
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            Documentos opcionales que Mesa puede cargar para el expediente. No bloquean la
            validación documental ni el avance de etapa.
          </p>
        </div>
      </header>
      )}

      <div className={embedded ? "space-y-2 px-4 pb-4" : "space-y-2 p-4"}>
        {documentos.map((item) => (
          <DocumentoRow
            key={item.tipo_documento}
            item={item}
            puedeOperar={puedeOperar}
            archivoLoading={archivoLoadingTipo === item.tipo_documento}
            uploadLoading={uploadLoadingTipo === item.tipo_documento}
            archivoError={archivoErrorByTipo[item.tipo_documento] ?? null}
            uploadError={uploadErrorByTipo[item.tipo_documento] ?? null}
            onSeleccionarArchivo={(file) => {
              void (item.presencia === "faltante"
                ? onSubir(item.tipo_documento, file)
                : onReemplazar(item.tipo_documento, file));
            }}
            onVer={() => {
              const archivo = resolveArchivo(item.tipo_documento);
              if (archivo) onVer(item.tipo_documento, archivo);
            }}
            onDescargar={() => {
              const archivo = resolveArchivo(item.tipo_documento);
              if (archivo) onDescargar(item.tipo_documento, archivo);
            }}
          />
        ))}
      </div>
    </section>
  );
}
