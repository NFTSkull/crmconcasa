"use client";

import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { Button } from "@/components/ui/Button";
import {
  asesorDebeUsarCorreccionDocumento,
  asesorPuedeSubirOCorregirDocumento,
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
  type ExpedienteArchivoResumen,
  type IntegrationDocAsesorUploadTipo,
  type IntegrationDocChecklistItem,
} from "@/domain/expediente-archivos";
import {
  formatExpedienteDocumentoUploadRejection,
  getExpedienteDocumentoAcceptAttr,
  validateExpedienteDocumentoUploadFile,
} from "@/lib/fileUploadValidation";

type Props = {
  expedienteId: string;
  checklistObligatorios: IntegrationDocChecklistItem[];
  checklistOpcionales: IntegrationDocChecklistItem[];
  archivosResumen: ExpedienteArchivoResumen[] | null;
  puedeIntegrar: boolean;
  submittedToMesa: boolean;
  onUploaded: () => void;
};

function nombreArchivoPorTipo(
  archivos: ExpedienteArchivoResumen[] | null,
  tipo: IntegrationDocAsesorUploadTipo,
): string | null {
  if (!archivos) return null;
  const row = archivos.find((a) => a.tipo_documento === tipo);
  return row?.nombre_original ?? null;
}

function comentarioMesaPorTipo(
  archivos: ExpedienteArchivoResumen[] | null,
  tipo: IntegrationDocAsesorUploadTipo,
): string | null {
  if (!archivos) return null;
  const row = archivos.find((a) => a.tipo_documento === tipo);
  return row?.comentario_mesa ?? null;
}

function ChecklistUploadList({
  items,
  archivosResumen,
  puedeIntegrar,
  submittedToMesa,
  uploadingTipo,
  errorsByTipo,
  inputRefs,
  onPickFile,
  onFileChange,
}: {
  items: IntegrationDocChecklistItem[];
  archivosResumen: ExpedienteArchivoResumen[] | null;
  puedeIntegrar: boolean;
  submittedToMesa: boolean;
  uploadingTipo: IntegrationDocAsesorUploadTipo | null;
  errorsByTipo: Partial<Record<IntegrationDocAsesorUploadTipo, string>>;
  inputRefs: MutableRefObject<
    Partial<Record<IntegrationDocAsesorUploadTipo, HTMLInputElement | null>>
  >;
  onPickFile: (tipo: IntegrationDocAsesorUploadTipo) => void;
  onFileChange: (tipo: IntegrationDocAsesorUploadTipo, fileList: FileList | null) => void;
}) {
  return (
    <ul className="space-y-2 text-xs text-gray-800">
      {items.map((item) => {
        const nombre = nombreArchivoPorTipo(archivosResumen, item.tipo_documento);
        const comentarioMesa = comentarioMesaPorTipo(archivosResumen, item.tipo_documento);
        const uploading = uploadingTipo === item.tipo_documento;
        const error = errorsByTipo[item.tipo_documento];
        const tieneArchivo = Boolean(nombre);
        const esCorreccion = asesorDebeUsarCorreccionDocumento(
          submittedToMesa,
          item.estatus_revision,
        );
        const puedeSubirItem =
          puedeIntegrar &&
          asesorPuedeSubirOCorregirDocumento(submittedToMesa, item.estatus_revision);
        const disabled = !puedeSubirItem || uploading;

        return (
          <li
            key={item.tipo_documento}
            className="rounded-md border border-gray-100 bg-gray-50 px-2 py-2"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0" aria-hidden>
                {item.completo
                  ? "🟢"
                  : item.opcional && !tieneArchivo
                    ? "○"
                    : item.estatus_revision === "rechazado"
                      ? "🔴"
                      : "🟡"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">
                  {item.label}
                  {item.opcional ? (
                    <span className="ml-1 font-normal text-gray-500">(opcional)</span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-gray-600">
                  {item.estatus_revision === "faltante"
                    ? item.opcional
                      ? "Sin archivo — opcional"
                      : "Sin archivo"
                    : item.estatus_revision === "subido"
                      ? "Subido — pendiente validación Mesa"
                      : item.estatus_revision === "resubido"
                        ? "Corregido por asesor — pendiente validación Mesa"
                        : item.estatus_revision === "validado"
                          ? "Validado"
                          : item.estatus_revision === "rechazado"
                            ? "Rechazado por Mesa"
                            : item.estatus_revision}
                </p>
                {nombre ? (
                  <p className="mt-1 truncate text-gray-500" title={nombre}>
                    Archivo: {nombre}
                  </p>
                ) : null}
                {item.estatus_revision === "rechazado" && comentarioMesa ? (
                  <p className="mt-1 rounded border border-red-100 bg-red-50 px-2 py-1 text-red-900">
                    Motivo Mesa: {comentarioMesa}
                  </p>
                ) : null}
                {error ? (
                  <p role="alert" className="mt-1 text-red-700">
                    {error}
                  </p>
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
                          : tieneArchivo
                            ? "Reemplazar"
                            : "Subir archivo"}
                    </Button>
                  </div>
                ) : submittedToMesa && item.estatus_revision !== "rechazado" ? (
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
  onUploaded,
}: Props) {
  const repo = useExpedienteArchivosRepo();
  const inputRefs = useRef<
    Partial<Record<IntegrationDocAsesorUploadTipo, HTMLInputElement | null>>
  >({});
  const [uploadingTipo, setUploadingTipo] = useState<IntegrationDocAsesorUploadTipo | null>(
    null,
  );
  const [errorsByTipo, setErrorsByTipo] = useState<
    Partial<Record<IntegrationDocAsesorUploadTipo, string>>
  >({});

  const handlePickFile = useCallback((tipo: IntegrationDocAsesorUploadTipo) => {
    inputRefs.current[tipo]?.click();
  }, []);

  const docLabel = useCallback(
    (tipo: IntegrationDocAsesorUploadTipo) => {
      const item = [...checklistObligatorios, ...checklistOpcionales].find(
        (row) => row.tipo_documento === tipo,
      );
      return item?.label ?? "Documento";
    },
    [checklistObligatorios, checklistOpcionales],
  );

  const handleFileChange = useCallback(
    async (tipo: IntegrationDocAsesorUploadTipo, fileList: FileList | null) => {
      const file = fileList?.[0];
      const input = inputRefs.current[tipo];
      if (input) input.value = "";
      if (!file) return;

      const fileValidation = validateExpedienteDocumentoUploadFile(file, tipo);
      if (!fileValidation.ok) {
        setErrorsByTipo((prev) => ({
          ...prev,
          [tipo]: formatExpedienteDocumentoUploadRejection(docLabel(tipo), file, tipo),
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

        if (esCorreccion) {
          await repo.correctArchivoRechazado({ expedienteId, tipo_documento: tipo, file });
        } else {
          const tieneArchivo = Boolean(nombreArchivoPorTipo(archivosResumen, tipo));
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
    [archivosResumen, docLabel, expedienteId, onUploaded, repo, submittedToMesa],
  );

  const listProps = {
    archivosResumen,
    puedeIntegrar,
    submittedToMesa,
    uploadingTipo,
    errorsByTipo,
    inputRefs,
    onPickFile: handlePickFile,
    onFileChange: handleFileChange,
  };

  return (
    <div className="mt-3 space-y-4">
      {submittedToMesa ? (
        <p className="rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
          Expediente en Mesa de control. Solo puedes subir correcciones en documentos rechazados.
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
    </div>
  );
}
