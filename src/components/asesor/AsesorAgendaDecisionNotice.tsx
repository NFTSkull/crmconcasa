"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatAgendaDecisionKindLabel,
  formatAgendaDecisionLabel,
  isCancelContinueDecision,
  listAgendaBookingDecisiones,
  type AgendaBookingDecision,
  type AgendaBookingDecisionKind,
} from "@/domain/agenda-booking-decisiones";
import { formatMesaAgendaSedeLabel } from "@/lib/mesaAgendaCitasUi";
import { formatPasoOperativoLabel } from "@/domain/expedientes/etapa-numeracion-ux";

export type AsesorAgendaDecisionNoticeProps = Readonly<{
  expedienteId: string;
  /** Filtra por kind(s) de la card actual. */
  kinds?: readonly AgendaBookingDecisionKind[];
}>;

function formatDecisionWhen(iso: string): string {
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso;
    return dt.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function buildNoticeBody(decision: AgendaBookingDecision): string {
  const parts: string[] = [formatAgendaDecisionLabel(decision.decision)];
  if (decision.motivo.trim()) {
    parts.push(`Motivo: ${decision.motivo.trim()}.`);
  }
  if (decision.decision === "reagendar" && decision.newBookingDate) {
    const time = decision.newBookingTime ? ` ${decision.newBookingTime}` : "";
    const sede = decision.newLocationId
      ? ` · ${formatMesaAgendaSedeLabel(decision.newLocationId)}`
      : "";
    parts.push(`Nueva cita: ${decision.newBookingDate}${time}${sede}.`);
  }
  if (decision.decision === "cancelar") {
    parts.push("Puedes volver a agendar.");
  }
  if (isCancelContinueDecision(decision.decision)) {
    if (decision.previousBookingDate) {
      const time = decision.previousBookingTime ? ` ${decision.previousBookingTime}` : "";
      const sede = decision.previousLocationId
        ? ` · ${formatMesaAgendaSedeLabel(decision.previousLocationId)}`
        : "";
      parts.push(`Cita cancelada: ${decision.previousBookingDate}${time}${sede}.`);
    }
    if (decision.etapaNueva != null) {
      parts.push(`Nuevo paso: ${formatPasoOperativoLabel(decision.etapaNueva)}.`);
    }
  }
  return parts.join(" ");
}

export function AsesorAgendaDecisionNotice({
  expedienteId,
  kinds,
}: AsesorAgendaDecisionNoticeProps) {
  const [decision, setDecision] = useState<AgendaBookingDecision | null>(null);
  const [loading, setLoading] = useState(false);

  const kindFilter = useMemo(() => new Set(kinds ?? []), [kinds]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const rows = await listAgendaBookingDecisiones(expedienteId);
        if (cancelled) return;
        const relevant = kindFilter.size
          ? rows.filter((row) => kindFilter.has(row.kind))
          : rows;
        setDecision(relevant[0] ?? null);
      } catch {
        if (!cancelled) setDecision(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expedienteId, kindFilter]);

  if (loading || !decision) return null;

  return (
    <div
      role="status"
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950"
    >
      <p className="font-semibold">
        Aviso Mesa · {formatAgendaDecisionKindLabel(decision.kind)}
      </p>
      <p className="mt-0.5">{buildNoticeBody(decision)}</p>
      <p className="mt-1 text-[10px] text-amber-800/90">
        {formatDecisionWhen(decision.decidedAt)}
        {decision.decidedByName ? ` · ${decision.decidedByName}` : ""}
      </p>
    </div>
  );
}
