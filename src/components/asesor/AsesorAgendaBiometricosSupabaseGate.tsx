"use client";

import { useEffect, useState } from "react";
import { AgendaBiometricosSupabaseCard } from "@/components/asesor/AgendaBiometricosSupabaseCard";
import {
  canShowAsesorBiometricosSupabaseCard,
  useAgendaBiometricosBookingRepo,
} from "@/domain/agenda-biometricos";

export type AsesorAgendaBiometricosSupabaseGateProps = Readonly<{
  expedienteId: string;
  submittedToMesa: boolean;
  etapaActual: number | null | undefined;
  fechaCita?: string | null;
  onUpdated: () => void;
}>;

/** Monta la card biométricos solo cuando la etapa y el estado de booking lo permiten. */
export function AsesorAgendaBiometricosSupabaseGate({
  expedienteId,
  submittedToMesa,
  etapaActual,
  fechaCita,
  onUpdated,
}: AsesorAgendaBiometricosSupabaseGateProps) {
  const repo = useAgendaBiometricosBookingRepo();
  const [visible, setVisible] = useState(false);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (!repo || !submittedToMesa) {
      setVisible(false);
      setResolved(true);
      return;
    }

    let cancelled = false;
    setResolved(false);

    void (async () => {
      try {
        const [active, lastCancelled] = await Promise.all([
          repo.getActiveBooking(expedienteId),
          repo.getLastCancelledBooking(expedienteId),
        ]);
        if (cancelled) return;
        setVisible(
          canShowAsesorBiometricosSupabaseCard({
            submittedToMesa,
            etapaActual,
            hasActiveBooking: active != null,
            hasLastCancelledBooking: lastCancelled != null,
          }),
        );
      } catch {
        if (!cancelled) setVisible(false);
      } finally {
        if (!cancelled) setResolved(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [etapaActual, expedienteId, repo, submittedToMesa]);

  if (!resolved || !visible) return null;

  return (
    <AgendaBiometricosSupabaseCard
      expedienteId={expedienteId}
      etapaActual={etapaActual}
      fechaCita={fechaCita}
      onUpdated={onUpdated}
    />
  );
}
