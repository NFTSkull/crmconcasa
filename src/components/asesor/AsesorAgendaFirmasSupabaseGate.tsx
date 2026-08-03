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
  firmaAgendableDesde?: string | null;
  acusePendienteSubir?: boolean;
  onUpdated: () => void;
}>;

/**
 * Monta la card firmas cuando la etapa lo permite.
 * Etapa 9: montaje síncrono (no depende de bookings).
 * Etapa 10: consulta booking activo / última cancelación.
 * Error al cargar bookings en etapa 10: muestra aviso, no oculta en silencio si hay duda.
 */
export function AsesorAgendaFirmasSupabaseGate({
  expedienteId,
  submittedToMesa,
  etapaActual,
  fechaCita,
  firmaAgendableDesde = null,
  acusePendienteSubir = false,
  onUpdated,
}: AsesorAgendaFirmasSupabaseGateProps) {
  const repo = useAgendaFirmasBookingRepo();
  const [visible, setVisible] = useState(() =>
    canShowAsesorFirmasSupabaseCard({
      submittedToMesa,
      etapaActual,
    }),
  );
  const [resolved, setResolved] = useState(() => etapaActual !== 10);
  const [bookingProbeError, setBookingProbeError] = useState<string | null>(null);

  useEffect(() => {
    setBookingProbeError(null);

    if (!submittedToMesa) {
      setVisible(false);
      setResolved(true);
      return;
    }

    // Etapa 9 (y otras no-10): gate síncrono — no ocultar por fallo de bookings.
    if (etapaActual !== 10) {
      setVisible(
        canShowAsesorFirmasSupabaseCard({
          submittedToMesa,
          etapaActual,
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
        if (cancelled) return;
        // No ocultar en silencio: mostrar card para que el usuario vea el error interno.
        setBookingProbeError(
          "No se pudo verificar la cita de firmas. Intenta recargar.",
        );
        setVisible(true);
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
    <>
      {bookingProbeError ? (
        <p
          role="alert"
          className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
        >
          {bookingProbeError}
        </p>
      ) : null}
      <AgendaFirmasSupabaseCard
        expedienteId={expedienteId}
        etapaActual={etapaActual}
        fechaCita={fechaCita}
        firmaAgendableDesde={firmaAgendableDesde}
        acusePendienteSubir={acusePendienteSubir}
        onUpdated={onUpdated}
      />
    </>
  );
}
