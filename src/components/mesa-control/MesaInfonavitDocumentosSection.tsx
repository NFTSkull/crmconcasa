"use client";

import { useState } from "react";
import { MesaAccordionSection } from "@/components/mesa-control/MesaAccordionSection";
import { MesaInfonavitGenerarDocumentosForm } from "@/components/mesa-control/MesaInfonavitGenerarDocumentosForm";
import {
  InfonavitPdfDocumentosCards,
  useInfonavitPdfSection,
} from "@/components/mesa-control/infonavit-pdf-documentos-shared";
import { isProgramaMejoravit } from "@/domain/expedientes/map-programa";

export type MesaInfonavitDocumentosSectionProps = Readonly<{
  expedienteId: string;
  programa: string | null | undefined;
}>;

type InfonavitTab = "documentos" | "generar";

function MesaInfonavitDocumentosViewer({
  expedienteId,
  refreshKey,
}: Readonly<{ expedienteId: string; refreshKey: number }>) {
  // refreshKey fuerza un remount/refetch después de generar una nueva versión.
  void refreshKey;
  const s = useInfonavitPdfSection({
    expedienteId,
    enabled: true,
    allowWordDownload: true,
  });

  if (s.loading && !s.estado && !s.error) {
    return <p className="text-sm text-gray-600">Consultando documentos INFONAVIT…</p>;
  }

  if (s.error) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {s.error}
      </p>
    );
  }

  if (!s.visible || !s.estado) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Este expediente todavía no tiene una versión de documentos INFONAVIT. Usa la pestaña
        <span className="font-semibold"> Generar documentos</span> para crearla desde Datos Generales.
      </div>
    );
  }

  return (
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
  );
}

function TabButton({
  active,
  children,
  onClick,
}: Readonly<{
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "border-b-2 border-violet-600 px-3 py-2 text-sm font-semibold text-violet-700"
          : "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-800"
      }
    >
      {children}
    </button>
  );
}

export function MesaInfonavitDocumentosSection({
  expedienteId,
  programa,
}: MesaInfonavitDocumentosSectionProps) {
  const enabled = isProgramaMejoravit(String(programa ?? ""));
  const [tab, setTab] = useState<InfonavitTab>("documentos");
  const [refreshKey, setRefreshKey] = useState(0);

  if (!enabled) return null;

  return (
    <MesaAccordionSection
      id="mesa-infonavit-documentos"
      title="Documentos INFONAVIT"
      summary="Consulta o genera los 3 documentos"
      defaultOpen
    >
      <div className="border-b border-gray-200 px-4">
        <div className="flex gap-1">
          <TabButton active={tab === "documentos"} onClick={() => setTab("documentos")}>
            Documentos
          </TabButton>
          <TabButton active={tab === "generar"} onClick={() => setTab("generar")}>
            Generar documentos
          </TabButton>
        </div>
      </div>

      <div className="px-4 py-4 text-sm text-gray-800">
        {tab === "documentos" ? (
          <div>
            <p className="mb-3 text-xs text-gray-600">
              Los envíos a Mesa generan automáticamente Carta Bajo Protesta, Presupuesto de
              Mejoramiento y Solicitud de Inscripción. Cada generación manual conserva una nueva
              versión del expediente documental.
            </p>
            <MesaInfonavitDocumentosViewer
              key={`${expedienteId}:${refreshKey}`}
              expedienteId={expedienteId}
              refreshKey={refreshKey}
            />
          </div>
        ) : (
          <MesaInfonavitGenerarDocumentosForm
            expedienteId={expedienteId}
            onGenerated={() => {
              setRefreshKey((value) => value + 1);
              setTab("documentos");
            }}
          />
        )}
      </div>
    </MesaAccordionSection>
  );
}
