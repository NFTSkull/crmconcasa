"use client";

import { useEffect, useState } from "react";
import { AgendaFirmasSupabaseCard } from "@/components/asesor/AgendaFirmasSupabaseCard";
import {
  canShowAsesorFirmasSupabaseCard,
  useAgendaFirmasBookingRepo,
} from "@/domain/agenda-firmas";

export type AsesorAgendaFirmasSupabaseGateProps = Readonly<{
  expedienteId: string;
  submittedToMesa: boolean;
  etapaActual: number | null | undefined;
  fechaCita?: string | null;
  onUpdated: () => void;
}>;

/** Monta la card firmas solo cuando la etapa y el estado de booking lo permiten. */
export function AsesorAgendaFirmasSupabaseGate({
  expedienteId,
  submittedToMesa,
  etapaActual,
  fechaCita,
  onUpdated,
}: AsesorAgendaFirmasSupabaseGateProps) {
  const repo = useAgendaFirmasBookingRepo();
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
          canShowAsesorFirmasSupabaseCard({
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
    <AgendaFirmasSupabaseCard
      expedienteId={expedienteId}
      etapaActual={etapaActual}
      fechaCita={fechaCita}
      onUpdated={onUpdated}
    />
  );
}
