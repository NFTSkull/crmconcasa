"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { MesaClienteDatosReadOnlySection as MesaClienteDatosReadOnlySectionImpl } from "@/components/mesa-control/MesaClienteDatosReadOnlySection.impl";
import { MesaInfonavitGenerarDocumentosForm } from "@/components/mesa-control/MesaInfonavitGenerarDocumentosForm";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

type Props = ComponentProps<typeof MesaClienteDatosReadOnlySectionImpl>;
type Tab = "asesor" | "infonavit";

export function MesaClienteDatosReadOnlySection(props: Props) {
  const [tab, setTab] = useState<Tab>("asesor");
  const [infonavitAvailable, setInfonavitAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setInfonavitAvailable(false);
    setTab("asesor");

    if (!props.expedienteId || !isSupabaseConfigured() || !supabaseBrowser) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const { data, error } = await supabaseBrowser.rpc(
          "mesa_get_infonavit_document_draft",
          { p_expediente_id: props.expedienteId },
        );
        if (!cancelled) setInfonavitAvailable(!error && Boolean(data));
      } catch {
        if (!cancelled) setInfonavitAvailable(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.expedienteId]);

  if (!infonavitAvailable) {
    return <MesaClienteDatosReadOnlySectionImpl {...props} />;
  }

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
          <MesaInfonavitGenerarDocumentosForm expedienteId={props.expedienteId} />
        </div>
      )}
    </div>
  );
}
