"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  MESA_RECHAZO_MOTIVOS_SUGERIDOS,
  buildComentarioRechazoDocumento,
  isMotivoOtro,
  type ExpedienteArchivoResumen,
} from "@/domain/expediente-archivos";
import {
  RETENCION_ETAPA_OPERATIVA_ID,
  labelRetencionOpcion,
  type RetencionFaltanteItem,
  type RetencionTipoDocumento,
} from "@/domain/expediente-archivos/retencion-acuse-aviso";
import {
  mesaRetencionDocEstatusLabel,
  type MesaRetencionDocView,
} from "@/domain/expediente-retencion/mesa-retencion-docs";
import {
  retencionDocPuedeRechazarMesa,
  type RetencionEnvioMesaUiEstado,
} from "@/domain/expediente-retencion/retencion-envio-mesa";
import { MESA_SOLICITAR_CORRECCION_LABEL } from "@/domain/expedientes/mesa-decision-ux";
import type { RetencionOpcion } from "@/domain/expediente-retencion/types";

function docRowAccentClass(estatus: MesaRetencionDocView["estatus_revision"]): string {
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

function estatusBadgeClass(estatus: MesaRetencionDocView["estatus_revision"]): string {
  if (estatus === "validado") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (estatus === "rechazado") return "bg-red-50 text-red-800 ring-red-200";
  if (estatus === "resubido") return "bg-orange-50 text-orange-900 ring-orange-200";
  if (estatus === "subido") return "bg-sky-50 text-sky-800 ring-sky-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

type Props = {
  opcionMesa: RetencionOpcion | null;
  envioUiEstado: RetencionEnvioMesaUiEstado;
  fechaEnvioMesa?: string | null;
  documentos: MesaRetencionDocView[];
  faltantes: readonly RetencionFaltanteItem[];
  bloqueosAvance: readonly string[];
  puedeRevisar: boolean;
  formatDateTime: (iso: string) => string;
  archivoLoadingTipo: RetencionTipoDocumento | null;
  revisionSavingTipo: RetencionTipoDocumento | null;
  archivoErrorByTipo: Partial<Record<RetencionTipoDocumento, string>>;
  revisionErrorByTipo: Partial<Record<RetencionTipoDocumento, string>>;
  onVer: (tipo: RetencionTipoDocumento, archivo: ExpedienteArchivoResumen) => void;
  onDescargar: (tipo: RetencionTipoDocumento, archivo: ExpedienteArchivoResumen) => void;
  onValidar: (tipo: RetencionTipoDocumento, documentoId: string) => void;
  onGuardarRechazo: (
    tipo: RetencionTipoDocumento,
    documentoId: string,
    comentario: string,
  ) => Promise<boolean>;
};

export function MesaRetencionAcuseAvisoSection({
  opcionMesa,
  envioUiEstado,
  fechaEnvioMesa,
  documentos,
  faltantes,
  bloqueosAvance,
  puedeRevisar,
  formatDateTime,
  archivoLoadingTipo,
  revisionSavingTipo,
  archivoErrorByTipo,
  revisionErrorByTipo,
  onVer,
  onDescargar,
  onValidar,
  onGuardarRechazo,
}: Props) {
  const puedeRevisarDocs = puedeRevisar && envioUiEstado !== "no_enviado";

  const [rejectTarget, setRejectTarget] = useState<MesaRetencionDocView | null>(null);
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

  const openRejectModal = useCallback((item: MesaRetencionDocView) => {
    setRejectTarget(item);
    setRejectMotivo("");
    setRejectTexto(
      item.estatus_revision === "rechazado" ? (item.comentario_mesa ?? "") : "",
    );
    setRejectError(null);
  }, []);

  const envioStatusClass = useMemo(() => {
    if (envioUiEstado === "enviado") return "border-violet-300 bg-violet-50 text-violet-950";
    if (envioUiEstado === "correccion_requerida") {
      return "border-amber-300 bg-amber-50 text-amber-950";
    }
    return "border-gray-200 bg-gray-50 text-gray-800";
  }, [envioUiEstado]);

  return (
    <section className="rounded-xl border border-violet-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">Acuse / Aviso de retención</h2>
      <p className="mt-1 text-xs text-gray-600">
        Etapa {RETENCION_ETAPA_OPERATIVA_ID}: revisa los documentos según la opción elegida por el
        asesor. Valida o rechaza cada documento; el rechazo solicita corrección al asesor.
      </p>

      <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Opción elegida</p>
        <p className="mt-1 font-medium text-gray-900">
          {opcionMesa
            ? labelRetencionOpcion(opcionMesa)
            : "Sin opción — el asesor debe elegir Opción A o B y enviar a Mesa"}
        </p>
      </div>

      <div role="status" className={`mt-3 rounded-lg border px-3 py-2 text-xs ${envioStatusClass}`}>
        <p className="font-semibold">Envío Acuse/Aviso desde asesor</p>
        {envioUiEstado === "no_enviado" ? (
          <p className="mt-1">
            Pendiente: el asesor aún no envía este bloque a Mesa Control para revisión.
          </p>
        ) : null}
        {envioUiEstado === "enviado" ? (
          <p className="mt-1">
            Enviado a Mesa Control para revisión
            {fechaEnvioMesa ? ` (${formatDateTime(fechaEnvioMesa)})` : ""}.
          </p>
        ) : null}
        {envioUiEstado === "correccion_requerida" ? (
          <p className="mt-1">
            Corrección solicitada: hay documentos rechazados. El asesor debe corregir y reenviar el
            bloque.
          </p>
        ) : null}
      </div>

      {faltantes.length > 0 ? (
        <div
          role="status"
          className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950"
        >
          <p className="font-semibold">Pendientes del bloque</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {faltantes.map((f) => (
              <li key={f.kind === "opcion" ? "opcion" : f.tipo_documento}>{f.label}</li>
            ))}
          </ul>
        </div>
      ) : opcionMesa ? (
        <p
          role="status"
          className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900"
        >
          Archivos subidos para la opción elegida. Valida cada documento en la lista.
        </p>
      ) : null}

      {opcionMesa && bloqueosAvance.length > 0 && envioUiEstado !== "enviado" ? (
        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800">
          <p className="font-semibold">Pendientes para avanzar a etapa 9</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {bloqueosAvance.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {opcionMesa && documentos.length > 0 ? (
        <ul className="mt-3 space-y-2" aria-label="Documentos retención">
          {documentos.map((item) => {
            const tipo = item.tipo_documento;
            const archivo = item.archivo;
            const busy = revisionSavingTipo === tipo;
            const loadingArchivo = archivoLoadingTipo === tipo;
            const puedeRechazar = retencionDocPuedeRechazarMesa(item.estatus_revision);

            return (
              <li
                key={tipo}
                className={`overflow-hidden rounded-lg border border-gray-200 border-l-4 bg-white ${docRowAccentClass(item.estatus_revision)}`}
              >
                <div className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                      <span
                        className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${estatusBadgeClass(item.estatus_revision)}`}
                      >
                        {mesaRetencionDocEstatusLabel(item.estatus_revision)}
                      </span>
                      {archivo?.nombre_original ? (
                        <p className="mt-1 truncate text-xs text-gray-700">
                          {archivo.nombre_original}
                        </p>
                      ) : null}
                      {item.estatus_revision === "rechazado" && item.comentario_mesa ? (
                        <p className="mt-1 text-[11px] text-red-900">
                          Nota de rechazo: {item.comentario_mesa}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {item.puedeAbrir && archivo ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 px-2.5 py-0 text-xs"
                            disabled={loadingArchivo || busy}
                            onClick={() => onVer(tipo, archivo)}
                          >
                            {loadingArchivo ? "…" : "Ver"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 px-2.5 py-0 text-xs"
                            disabled={loadingArchivo || busy}
                            onClick={() => onDescargar(tipo, archivo)}
                          >
                            Descargar
                          </Button>
                        </>
                      ) : null}
                      {puedeRevisarDocs && archivo?.id ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 border-emerald-200 px-2.5 py-0 text-xs text-emerald-800 hover:bg-emerald-50"
                            disabled={busy || item.estatus_revision === "validado"}
                            onClick={() => onValidar(tipo, archivo.id!)}
                          >
                            {busy ? "…" : "Validar"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 border-red-200 px-2.5 py-0 text-xs text-red-800 hover:bg-red-50"
                            disabled={busy || !puedeRechazar}
                            onClick={() => openRejectModal(item)}
                          >
                            {MESA_SOLICITAR_CORRECCION_LABEL}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {archivoErrorByTipo[tipo] || revisionErrorByTipo[tipo] ? (
                    <p
                      role="alert"
                      className="mt-2 text-[11px] text-red-700"
                    >
                      {revisionErrorByTipo[tipo] ?? archivoErrorByTipo[tipo]}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : opcionMesa ? (
        <p className="mt-3 text-xs text-gray-500">
          Cuando el asesor suba los documentos de la opción, aparecerán aquí para revisión.
        </p>
      ) : null}

      {rejectTarget?.archivo?.id ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mesa-retencion-rechazo-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeRejectModal}
        >
          <div
            className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="mesa-retencion-rechazo-title" className="text-sm font-semibold text-gray-900">
              Solicitar corrección — {rejectTarget.label}
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              El comentario es obligatorio. El asesor verá la nota y deberá corregir el documento.
            </p>
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-medium text-gray-700">
                Motivo
                <select
                  className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs"
                  value={rejectMotivo}
                  onChange={(e) => setRejectMotivo(e.target.value)}
                >
                  <option value="">Seleccionar…</option>
                  {MESA_RECHAZO_MOTIVOS_SUGERIDOS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              {isMotivoOtro(rejectMotivo) || !rejectMotivo ? (
                <label className="block text-xs font-medium text-gray-700">
                  Comentario
                  <textarea
                    className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs"
                    rows={3}
                    value={rejectTexto}
                    onChange={(e) => setRejectTexto(e.target.value)}
                  />
                </label>
              ) : null}
            </div>
            {rejectError ? (
              <p role="alert" className="mt-2 text-xs text-red-700">
                {rejectError}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeRejectModal}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!comentarioRechazoFinal || rejectSaving}
                onClick={() => {
                  const comentario = comentarioRechazoFinal;
                  const docId = rejectTarget.archivo?.id;
                  if (!comentario || !docId) {
                    setRejectError("Indica un motivo o comentario de rechazo.");
                    return;
                  }
                  void onGuardarRechazo(rejectTarget.tipo_documento, docId, comentario).then(
                    (ok) => {
                      if (ok) closeRejectModal();
                      else setRejectError("No se pudo guardar el rechazo.");
                    },
                  );
                }}
              >
                {rejectSaving ? "Guardando…" : "Guardar rechazo"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
