"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos";
import { findRowPorTipoDocumento } from "@/domain/expediente-archivos/types";
import { EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR } from "@/domain/expediente-archivos/upload-constraints";
import {
  formatPdfUploadRejectionForField,
  validatePdfFile,
} from "@/lib/fileUploadValidation";
import {
  RETENCION_ETAPA_OPERATIVA_ID,
  labelRetencionOpcion,
  type RetencionTipoDocumento,
} from "@/domain/expediente-archivos/retencion-acuse-aviso";
import {
  ExpedienteRetencionSupabaseError,
  deriveAsesorRetencionPanelView,
  retencionDocEstatusLabelAsesor,
  retencionDocPuedeReemplazarAsesor,
  useExpedienteRetencionSupabaseRepo,
  type ExpedienteRetencionEnvioMesa,
  type ExpedienteRetencionOpcion,
  type RetencionOpcion,
} from "@/domain/expediente-retencion";

export interface RetencionAcuseAvisoSupabaseCardProps {
  expedienteId: string;
  archivosResumen: ExpedienteArchivoResumen[] | null;
  onUpdated: () => void;
}

function formatFechaEnvio(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function RetencionAcuseAvisoSupabaseCard({
  expedienteId,
  archivosResumen,
  onUpdated,
}: RetencionAcuseAvisoSupabaseCardProps) {
  const repo = useExpedienteRetencionSupabaseRepo();
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [opcionDraft, setOpcionDraft] = useState<RetencionOpcion | null>(null);
  const [opcionRecord, setOpcionRecord] = useState<ExpedienteRetencionOpcion | null>(null);
  const [envio, setEnvio] = useState<ExpedienteRetencionEnvioMesa | null>(null);
  const [uploadingTipo, setUploadingTipo] = useState<RetencionTipoDocumento | null>(null);
  const [uploadErrors, setUploadErrors] = useState<
    Partial<Record<RetencionTipoDocumento, string>>
  >({});
  const [enviando, setEnviando] = useState(false);
  const [envioError, setEnvioError] = useState<string | null>(null);
  const inputRefs = useRef<Partial<Record<RetencionTipoDocumento, HTMLInputElement | null>>>({});

  const archivos = useMemo(() => archivosResumen ?? [], [archivosResumen]);

  const loadMeta = useCallback(async () => {
    if (!repo || !expedienteId) return;
    setLoadingMeta(true);
    setMetaError(null);
    try {
      const [opcion, envioRow] = await Promise.all([
        repo.getOpcionByExpedienteId(expedienteId),
        repo.getEnvioByExpedienteId(expedienteId),
      ]);
      setOpcionRecord(opcion);
      setOpcionDraft((prev) => opcion?.retencion_opcion ?? prev);
      setEnvio(envioRow);
    } catch (err) {
      setMetaError(
        err instanceof ExpedienteRetencionSupabaseError
          ? err.message
          : "No se pudo cargar el estado de retención.",
      );
    } finally {
      setLoadingMeta(false);
    }
  }, [repo, expedienteId]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const panel = useMemo(
    () =>
      deriveAsesorRetencionPanelView({
        opcionDraft,
        opcionPersistida: opcionRecord,
        envio,
        archivos,
      }),
    [opcionDraft, opcionRecord, envio, archivos],
  );

  const handlePickFile = (tipo: RetencionTipoDocumento) => {
    inputRefs.current[tipo]?.click();
  };

  const retencionDocLabelByTipo = useMemo(() => {
    const map: Partial<Record<RetencionTipoDocumento, string>> = {};
    for (const row of panel.uploads) {
      map[row.tipo] = row.label;
    }
    return map;
  }, [panel.uploads]);

  const handleFileChange = async (
    tipo: RetencionTipoDocumento,
    fileList: FileList | null,
  ) => {
    if (!repo || !fileList?.[0]) return;
    const file = fileList[0];
    const input = inputRefs.current[tipo];
    if (input) input.value = "";

    const pdfValidation = validatePdfFile(file);
    if (!pdfValidation.ok) {
      const label = retencionDocLabelByTipo[tipo] ?? "Documento";
      setUploadErrors((prev) => ({
        ...prev,
        [tipo]: formatPdfUploadRejectionForField(label, file),
      }));
      return;
    }

    setUploadErrors((prev) => ({ ...prev, [tipo]: undefined }));
    setUploadingTipo(tipo);
    try {
      await repo.uploadRetencionDocumento({
        expedienteId,
        tipo_documento: tipo,
        file,
      });
      onUpdated();
    } catch (err) {
      setUploadErrors((prev) => ({
        ...prev,
        [tipo]:
          err instanceof ExpedienteRetencionSupabaseError
            ? err.message
            : "No se pudo subir el documento.",
      }));
    } finally {
      setUploadingTipo(null);
      const input = inputRefs.current[tipo];
      if (input) input.value = "";
    }
  };

  const handleEnviarAMesa = async () => {
    if (!repo || !panel.opcionPanel) return;
    setEnvioError(null);
    setEnviando(true);
    try {
      const saved = await repo.enviarRetencionAMesa({
        expedienteId,
        retencion_opcion: panel.opcionPanel,
      });
      setEnvio(saved);
      setOpcionRecord({
        expedienteId,
        retencion_opcion: saved.opcion,
        updatedAt: saved.fechaEnvioMesa,
      });
      setOpcionDraft(saved.opcion);
      onUpdated();
    } catch (err) {
      setEnvioError(
        err instanceof ExpedienteRetencionSupabaseError
          ? err.message
          : "No se pudo enviar retención a Mesa.",
      );
    } finally {
      setEnviando(false);
    }
  };

  if (!repo) return null;

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-4 text-sm text-gray-700">
      <p className="text-sm font-semibold text-gray-900">Acuse / Aviso de retención</p>
      <p className="mt-1 text-xs text-gray-600">
        Etapa {RETENCION_ETAPA_OPERATIVA_ID}: elige la opción A o B, sube los documentos
        requeridos y envía el bloque a Mesa Control. Mesa revisará los documentos después del
        envío; el avance a etapa 9 queda pendiente de esa validación.
      </p>

      {loadingMeta ? (
        <p className="mt-2 text-xs text-gray-500">Cargando estado de retención…</p>
      ) : null}

      {metaError ? (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {metaError}
        </p>
      ) : null}

      {!loadingMeta && !metaError ? (
        <>
          <p
            role="status"
            className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800"
          >
            Estado del bloque:{" "}
            <span className="font-semibold">{panel.bloqueEstadoLabel}</span>
            {envio?.fechaEnvioMesa ? (
              <span className="mt-0.5 block text-gray-600">
                Último envío: {formatFechaEnvio(envio.fechaEnvioMesa)}
              </span>
            ) : null}
          </p>

          <fieldset className="mt-3 space-y-1.5" disabled={!panel.opcionEditable}>
            <legend className="sr-only">Opción de retención</legend>
            <label
              className={`flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs ${
                panel.opcionEditable ? "cursor-pointer" : "cursor-not-allowed opacity-80"
              }`}
            >
              <input
                type="radio"
                name={`retencion_opcion_${expedienteId}`}
                className="mt-0.5"
                checked={panel.opcionPanel === "con_sello"}
                disabled={!panel.opcionEditable}
                onChange={() => setOpcionDraft("con_sello")}
              />
              <span>
                <span className="font-semibold text-gray-900">Opción A — Tiene sello</span>
                <span className="mt-0.5 block text-gray-600">
                  Acuse con sello, aviso de retención e INE frente/reverso específicos.
                </span>
              </span>
            </label>
            <label
              className={`flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs ${
                panel.opcionEditable ? "cursor-pointer" : "cursor-not-allowed opacity-80"
              }`}
            >
              <input
                type="radio"
                name={`retencion_opcion_${expedienteId}`}
                className="mt-0.5"
                checked={panel.opcionPanel === "sin_sello"}
                disabled={!panel.opcionEditable}
                onChange={() => setOpcionDraft("sin_sello")}
              />
              <span>
                <span className="font-semibold text-gray-900">Opción B — No tiene sello</span>
                <span className="mt-0.5 block text-gray-600">
                  Carta de motivo, aviso de retención e INE frente/reverso específicos.
                </span>
              </span>
            </label>
          </fieldset>

          {!panel.opcionEditable && envio?.opcion ? (
            <p
              role="status"
              className="mt-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800"
            >
              Opción enviada a Mesa:{" "}
              <span className="font-semibold">{labelRetencionOpcion(envio.opcion)}</span>. Para
              cambiar la opción, Mesa debe solicitar corrección o debes reenviar tras corregir
              documentos rechazados.
            </p>
          ) : null}

          {panel.opcionPanel ? (
            <div className="mt-3 flex flex-col gap-2">
              {panel.uploads.map(({ tipo, label }) => {
                const item = findRowPorTipoDocumento(archivos, tipo);
                const hasFile = Boolean(item?.id);
                const estatus = item?.estatus_revision ?? "faltante";
                const rechazado = estatus === "rechazado";
                const puedeReemplazar = retencionDocPuedeReemplazarAsesor(estatus, hasFile);
                const uploading = uploadingTipo === tipo;
                const uploadError = uploadErrors[tipo];

                return (
                  <div
                    key={tipo}
                    className={`rounded-lg border p-2 ${
                      rechazado ? "border-red-200 bg-red-50/50" : "border-gray-100 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          {label}
                        </p>
                        <p className="mt-1 text-xs text-gray-800">
                          <span className="font-medium">
                            {retencionDocEstatusLabelAsesor(estatus)}
                          </span>
                        </p>
                        {item?.nombre_original ? (
                          <p className="mt-0.5 truncate text-sm font-medium text-gray-900">
                            {item.nombre_original}
                          </p>
                        ) : null}
                        {rechazado && item?.comentario_mesa ? (
                          <p className="mt-1 text-[11px] text-red-900">
                            Nota de Mesa: {item.comentario_mesa}
                          </p>
                        ) : null}
                        {estatus === "validado" ? (
                          <p className="mt-1 text-[11px] text-green-800">
                            Aceptado por Mesa — no requiere cambios.
                          </p>
                        ) : null}
                        {!puedeReemplazar && hasFile && estatus !== "validado" ? (
                          <p className="mt-1 text-[10px] text-gray-500">
                            En revisión por Mesa; espera validación o rechazo.
                          </p>
                        ) : null}
                        {uploadError ? (
                          <p role="alert" className="mt-1 text-[11px] text-red-800">
                            {uploadError}
                          </p>
                        ) : null}
                      </div>
                      <div className="shrink-0">
                        <input
                          ref={(el) => {
                            inputRefs.current[tipo] = el;
                          }}
                          type="file"
                          accept={EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR}
                          className="sr-only"
                          onChange={(e) => void handleFileChange(tipo, e.target.files)}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          className="text-xs"
                          disabled={!puedeReemplazar || uploading}
                          onClick={() => handlePickFile(tipo)}
                        >
                          {uploading ? "Subiendo…" : hasFile ? "Reemplazar" : "Subir"}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-xs text-amber-900">
              Selecciona la opción A o B para ver los documentos requeridos.
            </p>
          )}

          {panel.faltantes.length > 0 && panel.opcionPanel ? (
            <p className="mt-2 text-xs text-gray-600">
              Pendiente:{" "}
              {panel.faltantes.map((f) => (f.kind === "opcion" ? f.label : f.label)).join(", ")}
            </p>
          ) : null}

          {panel.uiEstado === "correccion_requerida" ? (
            <p
              role="status"
              className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
            >
              Mesa solicitó corrección en uno o más documentos. Reemplaza los rechazados y
              reenvía el bloque cuando estén listos.
            </p>
          ) : null}

          {envioError ? (
            <p
              role="alert"
              className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              {envioError}
            </p>
          ) : null}

          {panel.puedeEnviarAMesa ? (
            <div className="mt-3">
              <Button
                type="button"
                variant="primary"
                disabled={enviando}
                onClick={() => void handleEnviarAMesa()}
              >
                {enviando
                  ? "Enviando a Mesa…"
                  : panel.uiEstado === "correccion_requerida"
                    ? "Reenviar a Mesa"
                    : "Enviar a Mesa"}
              </Button>
              <p className="mt-1 text-[10px] text-gray-500">
                Al enviar, Mesa revisará los documentos. Esto no avanza el expediente a etapa 9.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
