"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import { AsesorReassignTeamExpedienteFloating } from "@/components/asesor/AsesorReassignTeamExpedienteFloating";

export default function AsesorExpedienteLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const params = useParams<{ id: string }>();
  const expedienteId = String(params?.id ?? "").trim();

  return (
    <>
      {children}
      {expedienteId ? (
        <AsesorReassignTeamExpedienteFloating expedienteId={expedienteId} />
      ) : null}
    </>
  );
}
