"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { MesaClienteDatosReadOnlySection as MesaClienteDatosReadOnlySectionImpl } from "@/components/mesa-control/MesaClienteDatosReadOnlySection.impl";
import { MesaInfonavitGenerarDocumentosForm } from "@/components/mesa-control/MesaInfonavitGenerarDocumentosForm";

type Props = ComponentProps<typeof MesaClienteDatosReadOnlySectionImpl>;
type Tab = "asesor" | "infonavit";

export const MESA_INFONAVIT_DOCUMENTS_GENERATED_EVENT =
  "concasa:mesa-infonavit-documents-generated";

export function MesaClienteDatosReadOnlySection(props: Props) {
  const [tab, setTab] = useState<Tab>("asesor");

  useEffect(() => {
    setTab("asesor");
  }, [props.expedienteId]);

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
        </div>
      )}
    </div>
  );
}
