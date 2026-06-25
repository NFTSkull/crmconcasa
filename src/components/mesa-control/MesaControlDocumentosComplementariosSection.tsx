"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR,
  MESA_RECHAZO_MOTIVOS_SUGERIDOS,
  buildComentarioRechazoDocumento,
  isMotivoOtro,
  mesaPuedeAbrirArchivo,
  type IntegrationDocMesaUploadTipo,
  type MesaComplementarioDocView,
} from "@/domain/expediente-archivos";

function estatusRevisionLabel(estatus: MesaComplementarioDocView["estatus_revision"]): string {
  if (estatus === "faltante") return "Faltante";
  if (estatus === "subido") return "Subido";
  if (estatus === "resubido") return "Resubido";
  if (estatus === "validado") return "Validado";
  if (estatus === "rechazado") return "Rechazado";
  return estatus;
}

function estatusRevisionBadgeClass(
  estatus: MesaComplementarioDocView["estatus_revision"],
): string {
  if (estatus === "validado") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (estatus === "rechazado") return "bg-red-50 text-red-800 ring-red-200";
  if (estatus === "resubido") return "bg-orange-50 text-orange-900 ring-orange-200";
  if (estatus === "subido") return "bg-sky-50 text-sky-800 ring-sky-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function etiquetaLabel(etiqueta: MesaComplementarioDocView["etiqueta"]): string {
  if (etiqueta === "opcional") return "Opcional";
  return "Requerido para validación Mesa";
}

function etiquetaBadgeClass(etiqueta: MesaComplementarioDocView["etiqueta"]): string {
  if (etiqueta === "opcional") return "bg-slate-100 text-slate-600";
  return "bg-amber-50 text-amber-900 ring-1 ring-amber-100";
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
  revisionSaving: boolean;
  archivoError: string | null;
  uploadError: string | null;
  revisionError: string | null;
  onSeleccionarArchivo: (file: File) => void;
  onVer: () => void;
  onDescargar: () => void;
  onValidar: () => void;
  onAbrirRechazo: () => void;
};

function DocumentoRow({
  item,
  puedeOperar,
  archivoLoading,
  uploadLoading,
  revisionSaving,
  archivoError,
  uploadError,
  revisionError,
  onSeleccionarArchivo,
  onVer,
  onDescargar,
  onValidar,
  onAbrirRechazo,
}: DocumentoRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const puedeAbrir = mesaPuedeAbrirArchivo(item.archivo);
  const tieneArchivo = Boolean(item.archivo?.id);
  const nombre = item.archivo?.nombre_original ?? null;
  const kind = fileKindLabel(item.archivo?.mime_type, nombre);
  const busy = archivoLoading || uploadLoading || revisionSaving;
  const faltante = item.estatus_revision === "faltante";

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
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${etiquetaBadgeClass(item.etiqueta)}`}
              >
                {etiquetaLabel(item.etiqueta)}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-500">
              {nombre ?? (faltante ? "Sin archivo" : "—")}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${estatusRevisionBadgeClass(item.estatus_revision)}`}
        >
          {estatusRevisionLabel(item.estatus_revision)}
        </span>
      </div>

      {item.estatus_revision === "rechazado" && item.comentario_mesa ? (
        <div className="mx-4 mb-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-900">
          <span className="font-medium">Motivo de rechazo:</span> {item.comentario_mesa}
        </div>
      ) : null}

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

        {puedeOperar && tieneArchivo ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Revisión
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-8 border-emerald-200 px-2.5 py-0 text-xs text-emerald-800 hover:bg-emerald-50"
              disabled={busy || item.estatus_revision === "validado"}
              onClick={onValidar}
            >
              {revisionSaving ? "…" : "Validar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 border-red-200 px-2.5 py-0 text-xs text-red-800 hover:bg-red-50"
              disabled={busy}
              onClick={onAbrirRechazo}
            >
              {item.estatus_revision === "validado" ? "Corregir" : "Rechazar"}
            </Button>
          </div>
        ) : null}
      </div>

      {archivoError || uploadError || revisionError ? (
        <p role="alert" className="border-t border-red-100 bg-red-50/50 px-4 py-2 text-[11px] text-red-700">
          {revisionError ?? uploadError ?? archivoError}
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
  revisionSavingTipo: IntegrationDocMesaUploadTipo | null;
  archivoErrorByTipo: Record<string, string>;
  uploadErrorByTipo: Record<string, string>;
  revisionErrorByTipo: Record<string, string>;
  onVer: (
    tipo: IntegrationDocMesaUploadTipo,
    archivo: NonNullable<MesaComplementarioDocView["archivo"]>,
  ) => void;
  onDescargar: (
    tipo: IntegrationDocMesaUploadTipo,
    archivo: NonNullable<MesaComplementarioDocView["archivo"]>,
  ) => void;
  onValidar: (tipo: IntegrationDocMesaUploadTipo, documentoId: string) => void;
  onGuardarRechazo: (
    tipo: IntegrationDocMesaUploadTipo,
    documentoId: string,
    comentario: string,
  ) => Promise<boolean>;
  onSubir: (tipo: IntegrationDocMesaUploadTipo, file: File) => Promise<void>;
  onReemplazar: (tipo: IntegrationDocMesaUploadTipo, file: File) => Promise<void>;
};

export function MesaControlDocumentosComplementariosSection({
  documentos,
  puedeOperar,
  archivoLoadingTipo,
  uploadLoadingTipo,
  revisionSavingTipo,
  archivoErrorByTipo,
  uploadErrorByTipo,
  revisionErrorByTipo,
  onVer,
  onDescargar,
  onValidar,
  onGuardarRechazo,
  onSubir,
  onReemplazar,
}: Props) {
  const faltantesMesa = useMemo(
    () => documentos.filter((d) => d.etiqueta === "requerido_mesa" && d.estatus_revision === "faltante").length,
    [documentos],
  );

  const [rejectTarget, setRejectTarget] = useState<MesaComplementarioDocView | null>(null);
  const [rejectMotivo, setRejectMotivo] = useState("");
  const [rejectTexto, setRejectTexto] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);

  const comentarioRechazoFinal = buildComentarioRechazoDocumento(rejectMotivo, rejectTexto);
  const rejectSaving =
    rejectTarget !== null && revisionSavingTipo === rejectTarget.tipo_documento;

  const closeRejectModal = useCallback(() => {
    setRejectTarget(null);
    setRejectMotivo("");
    setRejectTexto("");
    setRejectError(null);
  }, []);

  const openRejectModal = useCallback((item: MesaComplementarioDocView) => {
    setRejectTarget(item);
    setRejectMotivo("");
    setRejectTexto(item.estatus_revision === "rechazado" ? (item.comentario_mesa ?? "") : "");
    setRejectError(null);
  }, []);

  const resolveArchivo = useCallback(
    (tipo: IntegrationDocMesaUploadTipo) => {
      const item = documentos.find((d) => d.tipo_documento === tipo);
      return item?.archivo ?? null;
    },
    [documentos],
  );

  if (documentos.length === 0) return null;

  return (
    <>
      <section className="overflow-hidden rounded-xl border border-violet-200 bg-gradient-to-b from-violet-50/40 to-white shadow-sm">
        <header className="border-b border-violet-100 bg-white px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Documentos complementarios / Mesa de Control
              </h2>
              <p className="mt-1 max-w-2xl text-xs text-gray-500">
                Estos documentos pueden ser cargados por Mesa de Control para completar la
                validación documental.
              </p>
            </div>
            {faltantesMesa > 0 ? (
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 ring-1 ring-amber-100">
                {faltantesMesa} requerido{faltantesMesa === 1 ? "" : "s"} faltante
                {faltantesMesa === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </header>

        <div className="space-y-2 p-4">
          {documentos.map((item) => (
            <DocumentoRow
              key={item.tipo_documento}
              item={item}
              puedeOperar={puedeOperar}
              archivoLoading={archivoLoadingTipo === item.tipo_documento}
              uploadLoading={uploadLoadingTipo === item.tipo_documento}
              revisionSaving={revisionSavingTipo === item.tipo_documento}
              archivoError={archivoErrorByTipo[item.tipo_documento] ?? null}
              uploadError={uploadErrorByTipo[item.tipo_documento] ?? null}
              revisionError={revisionErrorByTipo[item.tipo_documento] ?? null}
              onSeleccionarArchivo={(file) => {
                void (item.estatus_revision === "faltante"
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
              onValidar={() => {
                const archivo = resolveArchivo(item.tipo_documento);
                if (archivo?.id) onValidar(item.tipo_documento, archivo.id);
              }}
              onAbrirRechazo={() => openRejectModal(item)}
            />
          ))}
        </div>
      </section>

      {rejectTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={closeRejectModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mesa-rechazo-complementario-title"
            className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="mesa-rechazo-complementario-title" className="text-base font-semibold text-gray-900">
              Rechazar documento
            </h3>
            <p className="mt-1 text-sm text-gray-600">{rejectTarget.label}</p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {MESA_RECHAZO_MOTIVOS_SUGERIDOS.map((motivo) => (
                <button
                  key={motivo}
                  type="button"
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                    rejectMotivo === motivo
                      ? "border-red-400 bg-red-50 text-red-900"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                  }`}
                  onClick={() => {
                    setRejectMotivo(motivo);
                    if (!isMotivoOtro(motivo)) {
                      setRejectTexto(motivo);
                    } else {
                      setRejectTexto("");
                    }
                    setRejectError(null);
                  }}
                >
                  {motivo}
                </button>
              ))}
            </div>

            {isMotivoOtro(rejectMotivo) || rejectMotivo === "" ? (
              <textarea
                className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-300 focus:outline-none focus:ring-1 focus:ring-red-200"
                rows={3}
                placeholder="Describe el motivo del rechazo…"
                value={rejectTexto}
                onChange={(e) => {
                  setRejectTexto(e.target.value);
                  setRejectError(null);
                }}
              />
            ) : null}

            {rejectError ? (
              <p role="alert" className="mt-2 text-xs text-red-700">
                {rejectError}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeRejectModal} disabled={rejectSaving}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-red-200 text-red-800 hover:bg-red-50"
                disabled={rejectSaving || !comentarioRechazoFinal}
                onClick={() => {
                  const docId = rejectTarget.archivo?.id;
                  if (!docId || !comentarioRechazoFinal) {
                    setRejectError("Selecciona un motivo o escribe el detalle.");
                    return;
                  }
                  void onGuardarRechazo(
                    rejectTarget.tipo_documento,
                    docId,
                    comentarioRechazoFinal,
                  ).then((ok) => {
                    if (ok) closeRejectModal();
                    else setRejectError("No se pudo guardar el rechazo.");
                  });
                }}
              >
                {rejectSaving ? "Guardando…" : "Confirmar rechazo"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
