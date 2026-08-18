"use client";

import { MesaAccordionSection } from "@/components/mesa-control/MesaAccordionSection";
import {
  InfonavitPdfDocumentosCards,
  useInfonavitPdfSection,
} from "@/components/mesa-control/infonavit-pdf-documentos-shared";
import { isProgramaMejoravit } from "@/domain/expedientes/map-programa";

export type MesaInfonavitDocumentosSectionProps = Readonly<{
  expedienteId: string;
  programa: string | null | undefined;
}>;

export function MesaInfonavitDocumentosSection({
  expedienteId,
  programa,
}: MesaInfonavitDocumentosSectionProps) {
  const enabled = isProgramaMejoravit(String(programa ?? ""));
  const s = useInfonavitPdfSection({
    expedienteId,
    enabled,
    allowWordDownload: true,
  });

  if (!enabled) return null;
  if (s.loading && !s.estado && !s.error) return null;
  if (!s.error && !s.visible) return null;

  return (
    <MesaAccordionSection
      id="mesa-infonavit-documentos"
      title="Documentos INFONAVIT"
      summary="Generados automáticamente"
      defaultOpen
    >
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
              allowWordDownload
              onDescargarWord={(tipo) => void s.handleDescargarWord(tipo)}
            />
          </div>
        ) : null}
      </div>
    </MesaAccordionSection>
  );
}
