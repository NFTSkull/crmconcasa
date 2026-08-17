"use client";

import {
  InfonavitPdfDocumentosCards,
  useInfonavitPdfSection,
} from "@/components/mesa-control/infonavit-pdf-documentos-shared";
import { isProgramaMejoravit } from "@/domain/expedientes/map-programa";

export type AsesorInfonavitDocumentosSectionProps = Readonly<{
  expedienteId: string;
  programa: string | null | undefined;
  submittedToMesa: boolean;
}>;

export function AsesorInfonavitDocumentosSection({
  expedienteId,
  programa,
  submittedToMesa,
}: AsesorInfonavitDocumentosSectionProps) {
  const enabled =
    isProgramaMejoravit(String(programa ?? "")) && submittedToMesa;
  const s = useInfonavitPdfSection({ expedienteId, enabled });

  if (!enabled) return null;
  if (s.loading && !s.estado && !s.error) return null;
  if (!s.error && !s.visible) return null;

  return (
    <section
      aria-label="Documentos INFONAVIT"
      className="rounded-lg border border-gray-200 bg-white"
    >
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">
          Documentos INFONAVIT
        </h3>
        <p className="mt-0.5 text-xs text-gray-500">Solo lectura</p>
      </div>
      <div className="px-4 py-3 text-sm text-gray-800">
        <p className="text-xs text-gray-600">
          Generados automáticamente al enviar a Mesa. Solo consulta y descarga.
        </p>
        {s.error ? (
          <p role="alert" className="mt-2 text-xs text-red-700">
            {s.error}
          </p>
        ) : null}
        {s.visible && s.estado ? (
          <div className="mt-3">
            <InfonavitPdfDocumentosCards
              estado={s.estado}
              busyId={s.archivoBusyId}
              archivoError={s.archivoError}
              preview={s.preview}
              onVer={(meta, tipo) => void s.handleVer(meta, tipo)}
              onDescargar={(meta, tipo) => void s.handleDescargar(meta, tipo)}
              onClosePreview={s.closePreview}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
