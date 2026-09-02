"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DocumentDropzone } from "@/components/documents/DocumentDropzone";
import {
  MesaArchivoPreviewDialog,
  openBlobUrlInNewTab,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import {
  asesorDebeUsarCorreccionDocumento,
  asesorPuedeActualizarDocReingreso,
  asesorPuedeMostrarUploadDocumento,
  asesorPuedeReemplazarDocumentoExistentePostMesa,
  asesorPuedeSubirDocumentoNuevoReingreso,
  asesorPuedeSubirOpcionalFaltantePostMesa,
  ExpedienteArchivosSupabaseError,
  mesaPuedeAbrirArchivo,
  useExpedienteArchivosRepo,
  validateExpedienteDocumentoFile,
  type ExpedienteArchivoResumen,
  type IntegrationDocAsesorUploadTipo,
  type IntegrationDocChecklistItem,
} from "@/domain/expediente-archivos";
import {
  getExpedienteDocumentoAcceptAttr,
  isClienteNotificacionApodacaTipo,
  isIneImageDocumentTipo,
  NOTIFICACION_APODACA_UPLOAD_HINT,
} from "@/lib/fileUploadValidation";
import {
  INE_IMAGE_CONVERTING_STATUS,
  INE_IMAGE_TO_PDF_HINT,
  INE_IMAGE_UPLOADING_STATUS,
  isConvertibleIneImage,
  isIneImageToPdfError,
  prepareIneFileForUpload,
} from "@/lib/ineImageToPdf";

type Props = {
  expedienteId: string;
  checklistObligatorios: IntegrationDocChecklistItem[];
  checklistOpcionales: IntegrationDocChecklistItem[];
  archivosResumen: ExpedienteArchivoResumen[] | null;
  puedeIntegrar: boolean;
  submittedToMesa: boolean;
  /** P072 etapa 6 o reingreso manual: domicilio + estado de cuenta editables. */
  esReingresoActivo?: boolean;
  /** @deprecated Usar esReingresoActivo */
  esReingresoEtapa6?: boolean;
  /** Tipos opcionales visibles solo en histórico RO (sin dropzone). */
  readOnlyOpcionalTipos?: readonly string[];
  esperaRevisionMesa?: boolean;
  onUploaded: () => void;
};

function archivoPorTipo(
  archivos: ExpedienteArchivoResumen[] | null,
  tipo: IntegrationDocAsesorUploadTipo,
): ExpedienteArchivoResumen | null {
  if (!archivos) return null;
  const row = archivos.find((a) => a.tipo_documento === tipo);
  if (!row || !mesaPuedeAbrirArchivo(row)) return null;
  return row;
}

function formatUploadDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return null;
  }
}

function estatusBadge(
  item: IntegrationDocChecklistItem,
  submittedToMesa: boolean,
  esperaRevisionMesa: boolean,
): { label: string; className: string } {
  if (item.estatus_revision === "rechazado") {
    if (esperaRevisionMesa) {
      return {
        label: "Rechazo enviado — espera Mesa",
        className: "bg-sky-50 text-sky-800 ring-sky-200",
      };
    }
    return {
      label: "Corrección requerida",
      className: "bg-red-50 text-red-800 ring-red-200",
    };
  }
  if (item.estatus_revision === "validado") {
    return { label: "Validado", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" };
  }
  if (item.estatus_revision === "faltante") {
    if (item.opcional) {
      return { label: "Opcional", className: "bg-slate-100 text-slate-600 ring-slate-200" };
    }
    return { label: "Faltante", className: "bg-amber-50 text-amber-900 ring-amber-200" };
  }
  if (submittedToMesa) {
    return {
      label: "Enviado a Mesa",
      className: "bg-violet-50 text-violet-800 ring-violet-200",
    };
  }
  if (item.estatus_revision === "resubido") {
    return {
      label: "Corregido",
      className: "bg-orange-50 text-orange-900 ring-orange-200",
    };
  }
  return { label: "Subido", className: "bg-sky-50 text-sky-800 ring-sky-200" };
}

function estatusDetalleLabel(estatus: IntegrationDocChecklistItem["estatus_revision"]): string {
  if (estatus === "subido") return "Pendiente validación Mesa";
  if (estatus === "resubido") return "Corregido — pendiente validación Mesa";
  if (estatus === "validado") return "Validado por Mesa";
  if (estatus === "rechazado") return "Rechazado por Mesa";
  return "";
}

function ChecklistUploadList({
  items,
  archivosResumen,
  puedeIntegrar,
  submittedToMesa,
  esReingresoActivo,
  readOnlyTipos,
  uploadingTipo,
  uploadStatusLabel,
  archivoLoadingTipo,
  errorsByTipo,
  onFileChange,
  onVerArchivo,
  onDescargarArchivo,
  esperaRevisionMesa,
}: {
  items: IntegrationDocChecklistItem[];
  archivosResumen: ExpedienteArchivoResumen[] | null;
  puedeIntegrar: boolean;
  submittedToMesa: boolean;
  esReingresoActivo: boolean;
  readOnlyTipos: ReadonlySet<string>;
  uploadingTipo: IntegrationDocAsesorUploadTipo | null;
  uploadStatusLabel: string | null;
  archivoLoadingTipo: IntegrationDocAsesorUploadTipo | null;
  errorsByTipo: Partial<Record<IntegrationDocAsesorUploadTipo, string>>;
  onFileChange: (tipo: IntegrationDocAsesorUploadTipo, files: File[]) => void;
  onVerArchivo: (tipo: IntegrationDocAsesorUploadTipo, archivo: ExpedienteArchivoResumen) => void;
  onDescargarArchivo: (
    tipo: IntegrationDocAsesorUploadTipo,
    archivo: ExpedienteArchivoResumen,
  ) => void;
  esperaRevisionMesa: boolean;
}) {
  return (
    <ul className="space-y-2 text-xs text-gray-800">
      {items.map((item) => {
        const archivo = archivoPorTipo(archivosResumen, item.tipo_documento);
        const nombre = archivo?.nombre_original ?? null;
        const comentarioMesa = archivo?.comentario_mesa ?? null;
        const uploading = uploadingTipo === item.tipo_documento;
        const archivoLoading = archivoLoadingTipo === item.tipo_documento;
        const error = errorsByTipo[item.tipo_documento];
        const tieneArchivo = Boolean(nombre);
        const forceReadOnly = readOnlyTipos.has(item.tipo_documento);
        const badge = estatusBadge(item, submittedToMesa, esperaRevisionMesa);
        const esCorreccion = asesorDebeUsarCorreccionDocumento(
          submittedToMesa,
          item.estatus_revision,
        );
        const esOpcionalPendientePostMesa = asesorPuedeSubirOpcionalFaltantePostMesa(
          submittedToMesa,
          item.estatus_revision,
          item.tipo_documento,
        );
        const esDocumentoNuevoReingreso =
          asesorPuedeSubirDocumentoNuevoReingreso(
            submittedToMesa,
            item.estatus_revision,
            item.tipo_documento,
            esReingresoActivo,
          );
        const esDocReingresoActualizable = asesorPuedeActualizarDocReingreso(
          submittedToMesa,
          item.tipo_documento,
          esReingresoActivo,
        );
        const esReemplazoPostMesa = asesorPuedeReemplazarDocumentoExistentePostMesa(
          submittedToMesa,
          item.estatus_revision,
        );
        const puedeSubirItem = asesorPuedeMostrarUploadDocumento({
          puedeIntegrar,
          submittedToMesa,
          estatusRevision: item.estatus_revision,
          tipoDocumento: item.tipo_documento,
          esReingresoActivo,
          forceReadOnly,
        });
        const disabled = !puedeSubirItem || uploading;
        const fechaSubida = formatUploadDate(archivo?.created_at);
        const detalle = estatusDetalleLabel(item.estatus_revision);

        return (
          <li
            key={item.tipo_documento}
            className="rounded-md border border-gray-100 bg-gray-50 px-2 py-2"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-gray-900">{item.label}</p>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </div>
                {detalle ? <p className="mt-0.5 text-gray-600">{detalle}</p> : null}
                {nombre ? (
                  <p className="mt-1 truncate text-gray-500" title={nombre}>
                    Archivo: {nombre}
                  </p>
                ) : item.opcional ? (
                  <p className="mt-1 text-gray-500">Sin archivo</p>
                ) : (
                  <p className="mt-1 text-gray-500">Sin archivo — obligatorio</p>
                )}
                {fechaSubida ? (
                  <p className="mt-0.5 text-[11px] text-gray-500">Subido: {fechaSubida}</p>
                ) : null}
                {item.estatus_revision === "rechazado" && comentarioMesa ? (
                  <p
                    className={`mt-1 rounded border px-2 py-1 ${
                      esperaRevisionMesa
                        ? "border-slate-200 bg-slate-50 text-slate-800"
                        : "border-red-100 bg-red-50 text-red-900"
                    }`}
                  >
                    {esperaRevisionMesa ? "Motivo Mesa (ya respondido): " : "Motivo Mesa: "}
                    {comentarioMesa}
                  </p>
                ) : null}
                {esOpcionalPendientePostMesa ? (
                  <p className="mt-1 rounded border border-sky-100 bg-sky-50 px-2 py-1 text-sky-900">
                    Documento opcional no enviado. Puedes subirlo para que Mesa lo vea.
                  </p>
                ) : null}
                {esDocReingresoActualizable ? (
                  <p className="mt-1 rounded border border-amber-100 bg-amber-50 px-2 py-1 text-amber-950">
                    Reingreso: puedes{" "}
                    {tieneArchivo ? "reemplazar" : "subir"} este documento; Mesa verá la versión
                    vigente de este expediente.
                  </p>
                ) : null}
                {esReemplazoPostMesa && tieneArchivo && !esDocReingresoActualizable ? (
                  <p className="mt-1 rounded border border-violet-100 bg-violet-50 px-2 py-1 text-violet-900">
                    Este documento ya fue enviado a Mesa. Puedes reemplazarlo; Mesa verá la
                    versión actualizada.
                  </p>
                ) : null}
                {error ? (
                  <p role="alert" className="mt-1 text-red-700">
                    {error}
                  </p>
                ) : null}
                {archivo ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="px-2 py-1 text-[11px]"
                      disabled={archivoLoading}
                      onClick={() => onVerArchivo(item.tipo_documento, archivo)}
                    >
                      {archivoLoading ? "Abriendo…" : "Ver documento"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="px-2 py-1 text-[11px]"
                      disabled={archivoLoading}
                      onClick={() => onDescargarArchivo(item.tipo_documento, archivo)}
                    >
                      Descargar
                    </Button>
                  </div>
                ) : null}
                {puedeSubirItem ? (
                  <div className="mt-2 max-w-sm">
                    <DocumentDropzone
                      compact
                      accept={getExpedienteDocumentoAcceptAttr(item.tipo_documento)}
                      busy={uploading}
                      busyLabel={uploading ? uploadStatusLabel : null}
                      disabled={disabled}
                      selectedFileName={nombre}
                      hint={
                        isClienteNotificacionApodacaTipo(item.tipo_documento)
                          ? NOTIFICACION_APODACA_UPLOAD_HINT
                          : isIneImageDocumentTipo(item.tipo_documento)
                            ? INE_IMAGE_TO_PDF_HINT
                            : undefined
                      }
                      aria-label={
                        esCorreccion
                          ? `Subir corrección de ${item.label}`
                          : tieneArchivo
                            ? `Reemplazar ${item.label}`
                            : `Subir ${item.label}`
                      }
                      onFiles={(files) => void onFileChange(item.tipo_documento, files)}
                    />
                  </div>
                ) : forceReadOnly ? (
                  <p className="mt-2 text-[11px] text-gray-500">
                    Solo lectura — la carga editable aplica en retención (etapa 8) para esta sede.
                  </p>
                ) : submittedToMesa &&
                  item.estatus_revision !== "rechazado" &&
                  !esOpcionalPendientePostMesa &&
                  !esReemplazoPostMesa &&
                  !esDocReingresoActualizable &&
                  !esDocumentoNuevoReingreso ? (
                  <p className="mt-2 text-[11px] text-gray-500">
                    Enviado a Mesa — no editable salvo rechazo documental.
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function AsesorIntegracionDocsUpload({
  expedienteId,
  checklistObligatorios,
  checklistOpcionales,
  archivosResumen,
  puedeIntegrar,
  submittedToMesa,
  esReingresoActivo,
  esReingresoEtapa6 = false,
  readOnlyOpcionalTipos = [],
  esperaRevisionMesa = false,
  onUploaded,
}: Props) {
  const reingresoActivo = Boolean(esReingresoActivo ?? esReingresoEtapa6);
  const readOnlyTipos = useMemo(
    () => new Set(readOnlyOpcionalTipos),
    [readOnlyOpcionalTipos],
  );
  const repo = useExpedienteArchivosRepo();
  const [uploadingTipo, setUploadingTipo] = useState<IntegrationDocAsesorUploadTipo | null>(
    null,
  );
  const [uploadStatusLabel, setUploadStatusLabel] = useState<string | null>(null);
  const [archivoLoadingTipo, setArchivoLoadingTipo] =
    useState<IntegrationDocAsesorUploadTipo | null>(null);
  const [preview, setPreview] = useState<MesaArchivoPreviewState | null>(null);
  const [errorsByTipo, setErrorsByTipo] = useState<
    Partial<Record<IntegrationDocAsesorUploadTipo, string>>
  >({});

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  const mapArchivoError = useCallback((err: unknown): string => {
    if (err instanceof ExpedienteArchivosSupabaseError) return err.message;
    return "No se pudo abrir el archivo. Intenta de nuevo.";
  }, []);

  const fetchArchivoBlob = useCallback(
    async (archivo: ExpedienteArchivoResumen) => {
      if (!archivo.id) {
        throw new ExpedienteArchivosSupabaseError(
          "No tienes acceso a este documento o no existe.",
        );
      }
      return repo.getArchivoBlob(archivo.id);
    },
    [repo],
  );

  const handleVerArchivo = useCallback(
    async (tipo: IntegrationDocAsesorUploadTipo, archivo: ExpedienteArchivoResumen) => {
      if (!archivo.id || !archivo.mime_type) return;
      setArchivoLoadingTipo(tipo);
      setErrorsByTipo((prev) => {
        const next = { ...prev };
        delete next[tipo];
        return next;
      });
      try {
        const blob = await fetchArchivoBlob(archivo);
        const url = URL.createObjectURL(blob);
        setPreview((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return {
            url,
            mime_type: archivo.mime_type as string,
            nombre_original: archivo.nombre_original ?? "archivo",
          };
        });
      } catch (err) {
        setErrorsByTipo((prev) => ({ ...prev, [tipo]: mapArchivoError(err) }));
      } finally {
        setArchivoLoadingTipo(null);
      }
    },
    [fetchArchivoBlob, mapArchivoError],
  );

  const handleDescargarArchivo = useCallback(
    async (tipo: IntegrationDocAsesorUploadTipo, archivo: ExpedienteArchivoResumen) => {
      if (!archivo.id || !archivo.nombre_original) return;
      setArchivoLoadingTipo(tipo);
      setErrorsByTipo((prev) => {
        const next = { ...prev };
        delete next[tipo];
        return next;
      });
      try {
        const blob = await fetchArchivoBlob(archivo);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = archivo.nombre_original;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (err) {
        setErrorsByTipo((prev) => ({ ...prev, [tipo]: mapArchivoError(err) }));
      } finally {
        setArchivoLoadingTipo(null);
      }
    },
    [fetchArchivoBlob, mapArchivoError],
  );

  const handleFileChange = useCallback(
    async (tipo: IntegrationDocAsesorUploadTipo, files: File[]) => {
      const file = files[0];
      if (!file) return;

      const fileValidation = validateExpedienteDocumentoFile(file, tipo);
      if (!fileValidation.ok) {
        setErrorsByTipo((prev) => ({
          ...prev,
          [tipo]: fileValidation.message,
        }));
        return;
      }

      setUploadingTipo(tipo);
      setUploadStatusLabel(
        isIneImageDocumentTipo(tipo) && isConvertibleIneImage(file)
          ? INE_IMAGE_CONVERTING_STATUS
          : "Subiendo…",
      );
      setErrorsByTipo((prev) => {
        const next = { ...prev };
        delete next[tipo];
        return next;
      });

      try {
        let uploadFile = file;
        if (isIneImageDocumentTipo(tipo) && isConvertibleIneImage(file)) {
          try {
            const prepared = await prepareIneFileForUpload(file, tipo);
            uploadFile = prepared.file;
            if (prepared.converted) {
              setUploadStatusLabel(INE_IMAGE_UPLOADING_STATUS);
            }
          } catch (convErr) {
            const message = isIneImageToPdfError(convErr)
              ? convErr.message
              : "No pudimos convertir esta imagen a PDF. Intenta con otra imagen o sube un PDF.";
            setErrorsByTipo((prev) => ({ ...prev, [tipo]: message }));
            return;
          }
        }

        const estatus =
          archivosResumen?.find((a) => a.tipo_documento === tipo)?.estatus_revision ?? "faltante";
        const esCorreccion = asesorDebeUsarCorreccionDocumento(submittedToMesa, estatus);
        const esOpcionalPostMesa = asesorPuedeSubirOpcionalFaltantePostMesa(
          submittedToMesa,
          estatus,
          tipo,
        );

        if (esCorreccion) {
          await repo.correctArchivoRechazado({
            expedienteId,
            tipo_documento: tipo,
            file: uploadFile,
          });
        } else if (esOpcionalPostMesa) {
          await repo.uploadArchivo({
            expedienteId,
            tipo_documento: tipo,
            file: uploadFile,
            uploaded_by_role: "asesor",
            uploaded_by_email: "",
          });
        } else {
          const tieneArchivo = Boolean(archivoPorTipo(archivosResumen, tipo));
          const params = {
            expedienteId,
            tipo_documento: tipo,
            file: uploadFile,
            uploaded_by_role: "asesor",
            uploaded_by_email: "",
          };
          if (tieneArchivo) {
            await repo.replaceArchivo(params);
          } else {
            await repo.uploadArchivo(params);
          }
        }
        onUploaded();
      } catch (err) {
        const message =
          err instanceof ExpedienteArchivosSupabaseError
            ? err.message
            : "No se pudo subir el documento. Intenta de nuevo.";
        setErrorsByTipo((prev) => ({ ...prev, [tipo]: message }));
      } finally {
        setUploadingTipo(null);
        setUploadStatusLabel(null);
      }
    },
    [archivosResumen, expedienteId, onUploaded, repo, submittedToMesa],
  );

  const allItems = [...checklistObligatorios, ...checklistOpcionales];
  const enviadosCount = allItems.filter((item) => item.completo).length;
  const opcionalesSubidos = checklistOpcionales.filter((item) => item.completo).length;

  const listProps = {
    archivosResumen,
    puedeIntegrar,
    submittedToMesa,
    esReingresoActivo: reingresoActivo,
    readOnlyTipos,
    uploadingTipo,
    uploadStatusLabel,
    archivoLoadingTipo,
    errorsByTipo,
    onFileChange: handleFileChange,
    onVerArchivo: handleVerArchivo,
    onDescargarArchivo: handleDescargarArchivo,
    esperaRevisionMesa,
  };

  return (
    <div className="mt-3 space-y-4">
      <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
        <p className="text-sm font-semibold text-gray-900">
          {submittedToMesa
            ? "Documentos enviados a Mesa"
            : "Documentos que se enviarán a Mesa"}
        </p>
        <p className="mt-1 text-[11px] text-gray-600">
          {submittedToMesa
            ? "Documentos registrados en el expediente. Mesa los revisa desde su bandeja."
            : "Incluye los 4 obligatorios y los opcionales que subas antes del envío."}
        </p>
        <p className="mt-2 text-[11px] text-gray-500">
          {submittedToMesa
            ? `${enviadosCount} documento(s) registrado(s)${
                opcionalesSubidos > 0 ? ` (${opcionalesSubidos} opcional(es))` : ""
              }.`
            : `${enviadosCount} de ${allItems.length} con archivo listo para envío.`}
        </p>
      </div>

      {submittedToMesa && !esperaRevisionMesa ? (
        <p className="rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
          Expediente en Mesa de control. Puedes reemplazar documentos ya enviados, corregir
          rechazados y subir opcionales que no enviaste antes.
        </p>
      ) : null}
      {submittedToMesa && esperaRevisionMesa ? (
        <p className="rounded-md border border-sky-100 bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
          Corrección enviada. Mesa está revisando los documentos. El estatus rojo anterior es
          historial técnico, no una tarea nueva.
        </p>
      ) : null}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Documentos obligatorios
        </p>
        <ChecklistUploadList items={checklistObligatorios} {...listProps} />
      </div>
      {checklistOpcionales.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Documentos opcionales
          </p>
          <ChecklistUploadList items={checklistOpcionales} {...listProps} />
        </div>
      ) : null}

      {preview ? (
        <MesaArchivoPreviewDialog
          preview={preview}
          onClose={() => {
            setPreview((prev) => {
              if (prev?.url) URL.revokeObjectURL(prev.url);
              return null;
            });
          }}
          onOpenInNewTab={openBlobUrlInNewTab}
        />
      ) : null}
    </div>
  );
}
