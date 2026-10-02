"use client";

import { RetencionAcuseAvisoSupabaseCard } from "@/components/asesor/RetencionAcuseAvisoSupabaseCard";
import { canShowAsesorRetencionSupabasePanel } from "@/domain/expediente-retencion";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos";

export type AsesorRetencionAcuseSupabaseGateProps = Readonly<{
  expedienteId: string;
  submittedToMesa: boolean;
  etapaActual: number | null | undefined;
  fechaCita?: string | null;
  firmaAgendableDesde?: string | null;
  archivosResumen: ExpedienteArchivoResumen[] | null;
  onUpdated: () => void | Promise<void>;
}>;

/**
 * El Acuse se captura en su etapa canónica (8).
 * Etapas anteriores no muestran este panel para evitar saltos 3–7 → 9.
 * Etapa >=8 conserva reemplazo/consulta histórica.
 */
export function AsesorRetencionAcuseSupabaseGate({
  expedienteId,
  submittedToMesa,
  etapaActual,
  firmaAgendableDesde = null,
  archivosResumen,
  onUpdated,
}: AsesorRetencionAcuseSupabaseGateProps) {
  const visible = canShowAsesorRetencionSupabasePanel({
    dataModeSupabase: true,
    etapaActual,
    submittedToMesa,
  });

  if (!visible) return null;

  return (
    <RetencionAcuseAvisoSupabaseCard
      expedienteId={expedienteId}
      archivosResumen={archivosResumen}
      etapaActual={etapaActual}
      firmaAgendableDesde={firmaAgendableDesde}
      onUpdated={onUpdated}
    />
  );
}
