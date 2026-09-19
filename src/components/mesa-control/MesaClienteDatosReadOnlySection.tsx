"use client";

import { useState, type ComponentProps } from "react";
import { MesaClienteDatosReadOnlySection as MesaClienteDatosReadOnlySectionImpl } from "@/components/mesa-control/MesaClienteDatosReadOnlySection.impl";
import { MesaInfonavitGenerarDocumentosForm } from "@/components/mesa-control/MesaInfonavitGenerarDocumentosForm";
import {
  InfonavitPdfDocumentosCards,
  useInfonavitPdfSection,
} from "@/components/mesa-control/infonavit-pdf-documentos-shared";

type Props = ComponentProps<typeof MesaClienteDatosReadOnlySectionImpl>;
type Tab = "asesor" | "infonavit";

export const MESA_INFONAVIT_DOCUMENTS_GENERATED_EVENT =
  "concasa:mesa-infonavit-documents-generated";

function MesaInfonavitInlineDownloads({ expedienteId }: { expedienteId: string }) {
  const s = useInfonavitPdfSection({
    expedienteId,
    enabled: true,
    allowWordDownload: true,
  });

  if (s.loading && !s.estado && !s.error) {
    return (
      <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-900">
        Consultando el estado de los documentos…
      </div>
    );
  }

  if (s.error) {
    return (
      <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
        {s.error}
      </div>
    );
  }

  if (!s.visible || !s.estado) {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
        Al generar los 3 documentos, su estado y los botones de descarga aparecerán aquí mismo.
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-gray-900">Documentos INFONAVIT generados</h4>
        <p className="mt-1 text-xs text-gray-600">
          Si alguno sigue en proceso, esta sección se actualiza automáticamente hasta quedar listo.
        </p>
      </div>
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
  );
}

export function MesaClienteDatosReadOnlySection(props: Props) {
  return (
    <MesaClienteDatosReadOnlySectionByExpediente
      key={props.expedienteId}
      {...props}
    />
  );
}

function MesaClienteDatosReadOnlySectionByExpediente(props: Props) {
  const [tab, setTab] = useState<Tab>("asesor");
  const [generationRefreshKey, setGenerationRefreshKey] = useState(0);

  return (
    <div className={props.embedded ? "bg-white" : "space-y-3"}>
      <div className="mx-4 mt-3 flex flex-wrap gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1.5">
        <button
          type="button"
          onClick={() => setTab("asesor")}
          className={`rounded-md px-3 py-2 text-xs font-semibold transition ${
            tab === "asesor"
              ? "bg-white text-gray-950 shadow-sm ring-1 ring-gray-200"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Datos capturados por asesor
        </button>
        <button
          type="button"
          onClick={() => setTab("infonavit")}
          className={`rounded-md px-3 py-2 text-xs font-semibold transition ${
            tab === "infonavit"
              ? "bg-violet-600 text-white shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Datos para archivos INFONAVIT
        </button>
      </div>

      {tab === "asesor" ? (
        <MesaClienteDatosReadOnlySectionImpl {...props} />
      ) : (
        <div className="px-4 pb-4 pt-2">
          <MesaInfonavitGenerarDocumentosForm
            expedienteId={props.expedienteId}
            onGenerated={(submissionVersion) => {
              setGenerationRefreshKey((current) => current + 1);
              window.dispatchEvent(
                new CustomEvent(MESA_INFONAVIT_DOCUMENTS_GENERATED_EVENT, {
                  detail: {
                    expedienteId: props.expedienteId,
                    submissionVersion,
                  },
                }),
              );
            }}
          />
          <MesaInfonavitInlineDownloads
            key={`${props.expedienteId}:${generationRefreshKey}`}
            expedienteId={props.expedienteId}
          />
        </div>
      )}
    </div>
  );
}