"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
  type ExpedienteArchivoResumen,
  type IntegrationDocAsesorEnvioTipo,
  type IntegrationDocChecklistItem,
} from "@/domain/expediente-archivos";
import { EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR } from "@/domain/expediente-archivos/upload-constraints";

type Props = {
  expedienteId: string;
  checklist: IntegrationDocChecklistItem[];
  archivosResumen: ExpedienteArchivoResumen[] | null;
  puedeSubir: boolean;
  onUploaded: () => void;
};

function nombreArchivoPorTipo(
  archivos: ExpedienteArchivoResumen[] | null,
  tipo: IntegrationDocAsesorEnvioTipo,
): string | null {
  if (!archivos) return null;
  const row = archivos.find((a) => a.tipo_documento === tipo);
  return row?.nombre_original ?? null;
}

export function AsesorIntegracionDocsUpload({
  expedienteId,
  checklist,
  archivosResumen,
  puedeSubir,
  onUploaded,
}: Props) {
  const repo = useExpedienteArchivosRepo();
  const inputRefs = useRef<Partial<Record<IntegrationDocAsesorEnvioTipo, HTMLInputElement | null>>>(
    {},
  );
  const [uploadingTipo, setUploadingTipo] = useState<IntegrationDocAsesorEnvioTipo | null>(null);
  const [errorsByTipo, setErrorsByTipo] = useState<Partial<Record<IntegrationDocAsesorEnvioTipo, string>>>(
    {},
  );

  const handlePickFile = useCallback((tipo: IntegrationDocAsesorEnvioTipo) => {
    inputRefs.current[tipo]?.click();
  }, []);

  const handleFileChange = useCallback(
    async (tipo: IntegrationDocAsesorEnvioTipo, fileList: FileList | null) => {
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

  return (
    <ul className="mt-3 space-y-2 text-xs text-gray-800">
      {checklist.map((item) => {
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
                {item.completo ? "🟢" : item.estatus_revision === "rechazado" ? "🔴" : "🟡"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">{item.label}</p>
                <p className="mt-0.5 text-gray-600">
                  {item.estatus_revision === "faltante"
                    ? "Sin archivo"
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
                    onChange={(e) => void handleFileChange(item.tipo_documento, e.target.files)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => handlePickFile(item.tipo_documento)}
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
