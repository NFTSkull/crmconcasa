"use client";

import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { Button } from "@/components/ui/Button";
import {
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
  type ExpedienteArchivoResumen,
  type IntegrationDocAsesorUploadTipo,
  type IntegrationDocChecklistItem,
} from "@/domain/expediente-archivos";
import { EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR } from "@/domain/expediente-archivos/upload-constraints";

type Props = {
  expedienteId: string;
  checklistObligatorios: IntegrationDocChecklistItem[];
  checklistOpcionales: IntegrationDocChecklistItem[];
  archivosResumen: ExpedienteArchivoResumen[] | null;
  puedeSubir: boolean;
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

function ChecklistUploadList({
  items,
  archivosResumen,
  puedeSubir,
  uploadingTipo,
  errorsByTipo,
  inputRefs,
  onPickFile,
  onFileChange,
}: {
  items: IntegrationDocChecklistItem[];
  archivosResumen: ExpedienteArchivoResumen[] | null;
  puedeSubir: boolean;
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
        const uploading = uploadingTipo === item.tipo_documento;
        const error = errorsByTipo[item.tipo_documento];
        const tieneArchivo = Boolean(nombre);
        const disabled = !puedeSubir || uploading;

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
                        ? "Resubido — pendiente validación Mesa"
                        : item.estatus_revision === "validado"
                          ? "Validado"
                          : item.estatus_revision === "rechazado"
                            ? "Rechazado — sube una corrección"
                            : item.estatus_revision}
                </p>
                {nombre ? (
                  <p className="mt-1 truncate text-gray-500" title={nombre}>
                    Archivo: {nombre}
                  </p>
                ) : null}
                {error ? (
                  <p role="alert" className="mt-1 text-red-700">
                    {error}
                  </p>
                ) : null}
                <div className="mt-2">
                  <input
                    ref={(el) => {
                      inputRefs.current[item.tipo_documento] = el;
                    }}
                    type="file"
                    accept={EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR}
                    className="sr-only"
                    disabled={disabled}
                    onChange={(e) => void onFileChange(item.tipo_documento, e.target.files)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => onPickFile(item.tipo_documento)}
                  >
                    {uploading
                      ? "Subiendo…"
                      : tieneArchivo
                        ? "Reemplazar"
                        : "Subir archivo"}
                  </Button>
                </div>
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
  puedeSubir,
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

  const handleFileChange = useCallback(
    async (tipo: IntegrationDocAsesorUploadTipo, fileList: FileList | null) => {
      const file = fileList?.[0];
      const input = inputRefs.current[tipo];
      if (input) input.value = "";
      if (!file) return;

      setUploadingTipo(tipo);
      setErrorsByTipo((prev) => {
        const next = { ...prev };
        delete next[tipo];
        return next;
      });

      try {
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
    [archivosResumen, expedienteId, onUploaded, repo],
  );

  const listProps = {
    archivosResumen,
    puedeSubir,
    uploadingTipo,
    errorsByTipo,
    inputRefs,
    onPickFile: handlePickFile,
    onFileChange: handleFileChange,
  };

  return (
    <div className="mt-3 space-y-4">
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
