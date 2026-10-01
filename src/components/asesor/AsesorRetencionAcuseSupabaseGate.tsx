"use client";

import { useEffect, useState } from "react";
import { RetencionAcuseAvisoSupabaseCard } from "@/components/asesor/RetencionAcuseAvisoSupabaseCard";
import { useAgendaBiometricosBookingRepo } from "@/domain/agenda-biometricos";
import { canShowAsesorRetencionSupabasePanel } from "@/domain/expediente-retencion";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos";

export type AsesorRetencionAcuseSupabaseGateProps = Readonly<{
  expedienteId: string;
  submittedToMesa: boolean;
  etapaActual: number | null | undefined;
  firmaAgendableDesde?: string | null;
  archivosResumen: ExpedienteArchivoResumen[] | null;
  onUpdated: () => void | Promise<void>;
}>;

/**
 * Habilita Acuse desde que existe cita biométrica activa.
 * Etapa >=8 conserva el flujo histórico y no depende de la cita.
 */
export function AsesorRetencionAcuseSupabaseGate({
  expedienteId,
  submittedToMesa,
  etapaActual,
  firmaAgendableDesde = null,
  archivosResumen,
  onUpdated,
}: AsesorRetencionAcuseSupabaseGateProps) {
  const repo = useAgendaBiometricosBookingRepo();
  const [visible, setVisible] = useState(false);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    const etapa = typeof etapaActual === "number" ? etapaActual : null;

    if (!submittedToMesa || etapa == null || etapa < 3) {
      setVisible(false);
      setResolved(true);
      return;
    }

    if (etapa >= 8) {
      setVisible(
        canShowAsesorRetencionSupabasePanel({
          dataModeSupabase: true,
          etapaActual: etapa,
          submittedToMesa,
          hasActiveBiometricosBooking: false,
        }),
      );
      setResolved(true);
      return;
    }

    if (!repo) {
      setVisible(false);
      setResolved(true);
      return;
    }

    let cancelled = false;
    setResolved(false);

    void repo
      .getActiveBooking(expedienteId)
      .then((active) => {
        if (cancelled) return;
        setVisible(
          canShowAsesorRetencionSupabasePanel({
            dataModeSupabase: true,
            etapaActual: etapa,
            submittedToMesa,
            hasActiveBiometricosBooking: active != null,
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setVisible(false);
      })
      .finally(() => {
        if (!cancelled) setResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, [etapaActual, expedienteId, repo, submittedToMesa]);

  if (!resolved || !visible) return null;

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
