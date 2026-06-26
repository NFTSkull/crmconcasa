"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  MESA_RECHAZO_MOTIVOS_SUGERIDOS,
  buildComentarioRechazoDocumento,
  isMotivoOtro,
  mesaPuedeAbrirArchivo,
  type IntegrationDocAsesorUploadTipo,
  type IntegrationDocChecklistItem,
  type MesaIntegrationDocView,
} from "@/domain/expediente-archivos";
import { MESA_SOLICITAR_CORRECCION_LABEL } from "@/domain/expedientes/mesa-decision-ux";

function estatusRevisionLabel(estatus: IntegrationDocChecklistItem["estatus_revision"]): string {
  if (estatus === "faltante") return "Faltante";
  if (estatus === "subido") return "Pendiente revisión";
  if (estatus === "resubido") return "Corregido por asesor";
  if (estatus === "validado") return "Validado";
  if (estatus === "rechazado") return "Rechazado";
  return estatus;
}

function estatusRevisionBadgeClass(
  estatus: IntegrationDocChecklistItem["estatus_revision"],
): string {
  if (estatus === "validado") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (estatus === "rechazado") return "bg-red-50 text-red-800 ring-red-200";
  if (estatus === "resubido") return "bg-orange-50 text-orange-900 ring-orange-200";
  if (estatus === "subido") return "bg-sky-50 text-sky-800 ring-sky-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function docRowAccentClass(estatus: IntegrationDocChecklistItem["estatus_revision"]): string {
  switch (estatus) {
    case "resubido":
      return "border-l-orange-400";
    case "subido":
      return "border-l-sky-400";
    case "validado":
      return "border-l-emerald-500";
    case "rechazado":
      return "border-l-red-500";
    default:
      return "border-l-slate-300";
  }
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

type ResumenRevision = {
  totalObligatorios: number;
  obligatoriosSubidos: number;
  validados: number;
  pendientesRevision: number;
  rechazados: number;
  faltantes: number;
};

function computeResumen(items: MesaIntegrationDocView[]): ResumenRevision {
  const obligatorios = items.filter((i) => !i.opcional);
  let validados = 0;
  let pendientesRevision = 0;
  let rechazados = 0;
  let faltantes = 0;
  let obligatoriosSubidos = 0;

  for (const item of items) {
    const e = item.estatus_revision;
    if (e === "validado") validados += 1;
    else if (e === "rechazado") rechazados += 1;
    else if (e === "subido" || e === "resubido") pendientesRevision += 1;
    else if (e === "faltante") faltantes += 1;
    if (!item.opcional && e !== "faltante") obligatoriosSubidos += 1;
  }

  return {
    totalObligatorios: obligatorios.length,
    obligatoriosSubidos,
    validados,
    pendientesRevision,
    rechazados,
    faltantes,
  };
}

function ResumenChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "sky" | "emerald" | "red" | "amber";
}) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700",
    sky: "bg-sky-50 text-sky-800 ring-1 ring-sky-100",
    emerald: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100",
    red: "bg-red-50 text-red-800 ring-1 ring-red-100",
    amber: "bg-amber-50 text-amber-900 ring-1 ring-amber-100",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${tones[tone]}`}>
      <span className="tabular-nums font-semibold">{value}</span>
      <span className="text-[10px] font-normal opacity-90">{label}</span>
    </span>
  );
}

type DocumentoRowProps = {
  item: MesaIntegrationDocView;
  loading: boolean;
  revisionSaving: boolean;
  puedeRevisar: boolean;
  archivoError: string | null;
  revisionError: string | null;
  onVer: () => void;
  onDescargar: () => void;
  onValidar: () => void;
  onAbrirRechazo: () => void;
};

function DocumentoRow({
  item,
  loading,
  revisionSaving,
  puedeRevisar,
  archivoError,
  revisionError,
  onVer,
  onDescargar,
  onValidar,
  onAbrirRechazo,
}: DocumentoRowProps) {
  const puedeAbrir = mesaPuedeAbrirArchivo(item.archivo);
  const tieneArchivo = Boolean(item.archivo?.id);
  const nombre = item.archivo?.nombre_original ?? null;
  const kind = fileKindLabel(item.archivo?.mime_type, nombre);
  const busy = loading || revisionSaving;

  return (
    <article
      className={`overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm border-l-4 ${docRowAccentClass(item.estatus_revision)}`}
    >
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
              {item.opcional ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                  Opcional
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-500">
              {nombre ?? (item.opcional ? "Sin archivo — no bloquea el envío" : "Sin archivo subido")}
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

      {item.estatus_revision === "validado" ? (
        <p className="mx-4 mb-3 text-[11px] text-emerald-800">
          Documento validado. Si detectas un error, usa «Corregir» para solicitar reemplazo al asesor.
        </p>
      ) : null}

      {puedeAbrir || (puedeRevisar && tieneArchivo) ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 bg-slate-50/80 px-4 py-2.5">
          {puedeAbrir ? (
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
                {loading ? "Abriendo…" : "Ver"}
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
            </div>
          ) : (
            <span />
          )}

          {puedeRevisar && tieneArchivo ? (
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
                {MESA_SOLICITAR_CORRECCION_LABEL}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {archivoError || revisionError ? (
        <p role="alert" className="border-t border-red-100 bg-red-50/50 px-4 py-2 text-[11px] text-red-700">
          {revisionError ?? archivoError}
        </p>
      ) : null}
    </article>
  );
}

function DocumentoGroup({
  title,
  subtitle,
  items,
  ...rowProps
}: {
  title: string;
  subtitle: string;
  items: MesaIntegrationDocView[];
  archivoLoadingTipo: IntegrationDocAsesorUploadTipo | null;
  revisionSavingTipo: IntegrationDocAsesorUploadTipo | null;
  puedeRevisar: boolean;
  archivoErrorByTipo: Record<string, string>;
  revisionErrorByTipo: Record<string, string>;
  onVer: (tipo: IntegrationDocAsesorUploadTipo) => void;
  onDescargar: (tipo: IntegrationDocAsesorUploadTipo) => void;
  onValidar: (tipo: IntegrationDocAsesorUploadTipo) => void;
  onAbrirRechazo: (item: MesaIntegrationDocView) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
        <p className="text-[11px] text-gray-400">{subtitle}</p>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <DocumentoRow
            key={item.tipo_documento}
            item={item}
            loading={rowProps.archivoLoadingTipo === item.tipo_documento}
            revisionSaving={rowProps.revisionSavingTipo === item.tipo_documento}
            puedeRevisar={rowProps.puedeRevisar}
            archivoError={rowProps.archivoErrorByTipo[item.tipo_documento] ?? null}
            revisionError={rowProps.revisionErrorByTipo[item.tipo_documento] ?? null}
            onVer={() => rowProps.onVer(item.tipo_documento)}
            onDescargar={() => rowProps.onDescargar(item.tipo_documento)}
            onValidar={() => rowProps.onValidar(item.tipo_documento)}
            onAbrirRechazo={() => rowProps.onAbrirRechazo(item)}
          />
        ))}
      </div>
    </div>
  );
}

type Props = {
  documentos: MesaIntegrationDocView[];
  puedeRevisar: boolean;
  archivoLoadingTipo: IntegrationDocAsesorUploadTipo | null;
  revisionSavingTipo: IntegrationDocAsesorUploadTipo | null;
  archivoErrorByTipo: Record<string, string>;
  revisionErrorByTipo: Record<string, string>;
  onVer: (tipo: IntegrationDocAsesorUploadTipo, archivo: NonNullable<MesaIntegrationDocView["archivo"]>) => void;
  onDescargar: (tipo: IntegrationDocAsesorUploadTipo, archivo: NonNullable<MesaIntegrationDocView["archivo"]>) => void;
  onValidar: (tipo: IntegrationDocAsesorUploadTipo, documentoId: string) => void;
  onGuardarRechazo: (
    tipo: IntegrationDocAsesorUploadTipo,
    documentoId: string,
    comentario: string,
  ) => Promise<boolean>;
};

export function MesaDocumentosAsesorSection({
  documentos,
  puedeRevisar,
  archivoLoadingTipo,
  revisionSavingTipo,
  archivoErrorByTipo,
  revisionErrorByTipo,
  onVer,
  onDescargar,
  onValidar,
  onGuardarRechazo,
}: Props) {
  const resumen = useMemo(() => computeResumen(documentos), [documentos]);

  const [rejectTarget, setRejectTarget] = useState<MesaIntegrationDocView | null>(null);
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

  const openRejectModal = useCallback((item: MesaIntegrationDocView) => {
    setRejectTarget(item);
    setRejectMotivo("");
    setRejectTexto(item.estatus_revision === "rechazado" ? (item.comentario_mesa ?? "") : "");
    setRejectError(null);
  }, []);

  const resolveArchivo = useCallback(
    (tipo: IntegrationDocAsesorUploadTipo) => {
      const item = documentos.find((d) => d.tipo_documento === tipo);
      return item?.archivo ?? null;
    },
    [documentos],
  );

  if (documentos.length === 0) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
        No hay documentos registrados en el checklist de integración.
      </section>
    );
  }

  return (
    <>
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-gradient-to-b from-slate-50 to-white shadow-sm">
        <header className="border-b border-gray-200 bg-white px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Documentos del asesor</h2>
              <p className="mt-1 max-w-xl text-xs text-gray-500">
                {puedeRevisar
                  ? "Revisa cada archivo, valida si cumple o rechaza con motivo para que el asesor corrija solo ese documento."
                  : "Checklist de integración enviado por el asesor (solo lectura)."}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                <span className="font-semibold tabular-nums">
                  {resumen.obligatoriosSubidos}/{resumen.totalObligatorios}
                </span>
                <span className="ml-1.5 text-[10px] font-normal text-slate-500">obligatorios</span>
              </span>
              <ResumenChip label="pendientes" value={resumen.pendientesRevision} tone="sky" />
              <ResumenChip label="validados" value={resumen.validados} tone="emerald" />
              {resumen.rechazados > 0 ? (
                <ResumenChip label="rechazados" value={resumen.rechazados} tone="red" />
              ) : null}
            </div>
          </div>
        </header>

        <div className="space-y-5 p-4">
          <DocumentoGroup
            title="Checklist de integración"
            subtitle={`${resumen.obligatoriosSubidos} de ${resumen.totalObligatorios} con archivo`}
            items={documentos}
            archivoLoadingTipo={archivoLoadingTipo}
            revisionSavingTipo={revisionSavingTipo}
            puedeRevisar={puedeRevisar}
            archivoErrorByTipo={archivoErrorByTipo}
            revisionErrorByTipo={revisionErrorByTipo}
            onVer={(tipo) => {
              const archivo = resolveArchivo(tipo);
              if (archivo) onVer(tipo, archivo);
            }}
            onDescargar={(tipo) => {
              const archivo = resolveArchivo(tipo);
              if (archivo) onDescargar(tipo, archivo);
            }}
            onValidar={(tipo) => {
              const archivo = resolveArchivo(tipo);
              if (archivo?.id) onValidar(tipo, archivo.id);
            }}
            onAbrirRechazo={openRejectModal}
          />
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
            aria-label="Solicitar corrección de documento"
            className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-900">Solicitar corrección</h3>
            <p className="mt-1 text-xs text-gray-600">
              <span className="font-medium text-gray-800">{rejectTarget.label}</span>
              {rejectTarget.archivo?.nombre_original ? (
                <span className="text-gray-500"> · {rejectTarget.archivo.nombre_original}</span>
              ) : null}
            </p>
            <p className="mt-2 text-[11px] text-gray-500">
              El asesor verá este motivo y podrá subir un reemplazo solo para este documento.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
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

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" className="text-xs" onClick={closeRejectModal}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                className="bg-red-600 text-xs hover:bg-red-700"
                disabled={rejectSaving || !comentarioRechazoFinal}
                onClick={() => {
                  if (!rejectTarget.archivo?.id || !comentarioRechazoFinal) {
                    setRejectError("Selecciona un motivo o escribe el detalle.");
                    return;
                  }
                  void onGuardarRechazo(
                    rejectTarget.tipo_documento,
                    rejectTarget.archivo.id,
                    comentarioRechazoFinal,
                  ).then((ok) => {
                    if (ok) closeRejectModal();
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
