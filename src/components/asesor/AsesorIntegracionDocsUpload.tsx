"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Button } from "@/components/ui/Button";
import {
  MesaArchivoPreviewDialog,
  openBlobUrlInNewTab,
  type MesaArchivoPreviewState,
} from "@/components/mesa-control/MesaArchivoPreviewDialog";
import {
  asesorDebeUsarCorreccionDocumento,
  asesorPuedeReemplazarDocumentoExistentePostMesa,
  asesorPuedeSubirDocumentoNuevoReingreso,
  asesorPuedeSubirOCorregirDocumento,
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
} from "@/lib/fileUploadValidation";

type Props = {
  expedienteId: string;
  checklistObligatorios: IntegrationDocChecklistItem[];
  checklistOpcionales: IntegrationDocChecklistItem[];
  archivosResumen: ExpedienteArchivoResumen[] | null;
  puedeIntegrar: boolean;
  submittedToMesa: boolean;
  esReingresoEtapa6?: boolean;
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
): { label: string; className: string } {
  if (item.estatus_revision === "rechazado") {
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
  esReingresoEtapa6,
  uploadingTipo,
  archivoLoadingTipo,
  errorsByTipo,
  inputRefs,
  onPickFile,
  onFileChange,
  onVerArchivo,
  onDescargarArchivo,
}: {
  items: IntegrationDocChecklistItem[];
  archivosResumen: ExpedienteArchivoResumen[] | null;
  puedeIntegrar: boolean;
  submittedToMesa: boolean;
  esReingresoEtapa6: boolean;
  uploadingTipo: IntegrationDocAsesorUploadTipo | null;
  archivoLoadingTipo: IntegrationDocAsesorUploadTipo | null;
  errorsByTipo: Partial<Record<IntegrationDocAsesorUploadTipo, string>>;
  inputRefs: MutableRefObject<
    Partial<Record<IntegrationDocAsesorUploadTipo, HTMLInputElement | null>>
  >;
  onPickFile: (tipo: IntegrationDocAsesorUploadTipo) => void;
  onFileChange: (tipo: IntegrationDocAsesorUploadTipo, fileList: FileList | null) => void;
  onVerArchivo: (tipo: IntegrationDocAsesorUploadTipo, archivo: ExpedienteArchivoResumen) => void;
  onDescargarArchivo: (
    tipo: IntegrationDocAsesorUploadTipo,
    archivo: ExpedienteArchivoResumen,
  ) => void;
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
        const badge = estatusBadge(item, submittedToMesa);
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
            esReingresoEtapa6,
          );
        const esReemplazoPostMesa = asesorPuedeReemplazarDocumentoExistentePostMesa(
          submittedToMesa,
          item.estatus_revision,
        );
        const puedeSubirItem =
          (puedeIntegrar || esDocumentoNuevoReingreso) &&
          asesorPuedeSubirOCorregirDocumento(
            submittedToMesa,
            item.estatus_revision,
            item.tipo_documento,
            esReingresoEtapa6,
          );
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
                  <p className="mt-1 rounded border border-red-100 bg-red-50 px-2 py-1 text-red-900">
                    Motivo Mesa: {comentarioMesa}
                  </p>
                ) : null}
                {esOpcionalPendientePostMesa ? (
                  <p className="mt-1 rounded border border-sky-100 bg-sky-50 px-2 py-1 text-sky-900">
                    Documento opcional no enviado. Puedes subirlo para que Mesa lo vea.
                  </p>
                ) : null}
                {esReemplazoPostMesa && tieneArchivo ? (
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
                  <div className="mt-2">
                    <input
                      ref={(el) => {
                        inputRefs.current[item.tipo_documento] = el;
                      }}
                      type="file"
                      accept={getExpedienteDocumentoAcceptAttr(item.tipo_documento)}
                      className="sr-only"
                      disabled={disabled}
                      onChange={(e) => void onFileChange(item.tipo_documento, e.target.files)}
                    />
                    <Button
                      type="button"
                      variant={esCorreccion ? "outline" : "secondary"}
                      className={esCorreccion ? "border-red-200 text-red-900" : undefined}
                      disabled={disabled}
                      onClick={() => onPickFile(item.tipo_documento)}
                    >
                      {uploading
                        ? "Subiendo…"
                        : esCorreccion
                          ? "Subir corrección"
                          : esReemplazoPostMesa && tieneArchivo
                            ? "Reemplazar archivo"
                            : tieneArchivo
                              ? "Reemplazar"
                              : "Subir archivo"}
                    </Button>
                  </div>
                ) : submittedToMesa &&
                  item.estatus_revision !== "rechazado" &&
                  !esOpcionalPendientePostMesa &&
                  !esReemplazoPostMesa &&
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
  esReingresoEtapa6 = false,
  onUploaded,
}: Props) {
  const repo = useExpedienteArchivosRepo();
  const inputRefs = useRef<
    Partial<Record<IntegrationDocAsesorUploadTipo, HTMLInputElement | null>>
  >({});
  const [uploadingTipo, setUploadingTipo] = useState<IntegrationDocAsesorUploadTipo | null>(
    null,
  );
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

  const handlePickFile = useCallback((tipo: IntegrationDocAsesorUploadTipo) => {
    inputRefs.current[tipo]?.click();
  }, []);

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
    async (tipo: IntegrationDocAsesorUploadTipo, fileList: FileList | null) => {
      const file = fileList?.[0];
      const input = inputRefs.current[tipo];
      if (input) input.value = "";
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
      setErrorsByTipo((prev) => {
        const next = { ...prev };
        delete next[tipo];
        return next;
      });

      try {
        const estatus =
          archivosResumen?.find((a) => a.tipo_documento === tipo)?.estatus_revision ?? "faltante";
        const esCorreccion = asesorDebeUsarCorreccionDocumento(submittedToMesa, estatus);
        const esOpcionalPostMesa = asesorPuedeSubirOpcionalFaltantePostMesa(
          submittedToMesa,
          estatus,
          tipo,
        );

        if (esCorreccion) {
          await repo.correctArchivoRechazado({ expedienteId, tipo_documento: tipo, file });
        } else if (esOpcionalPostMesa) {
          await repo.uploadArchivo({
            expedienteId,
            tipo_documento: tipo,
            file,
            uploaded_by_role: "asesor",
            uploaded_by_email: "",
          });
        } else {
          const tieneArchivo = Boolean(archivoPorTipo(archivosResumen, tipo));
          const params = {
            expedienteId,
            tipo_documento: tipo,
            file,
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
    esReingresoEtapa6,
    uploadingTipo,
    archivoLoadingTipo,
    errorsByTipo,
    inputRefs,
    onPickFile: handlePickFile,
    onFileChange: handleFileChange,
    onVerArchivo: handleVerArchivo,
    onDescargarArchivo: handleDescargarArchivo,
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

      {submittedToMesa ? (
        <p className="rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
          Expediente en Mesa de control. Puedes reemplazar documentos ya enviados, corregir
          rechazados y subir opcionales que no enviaste antes.
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
