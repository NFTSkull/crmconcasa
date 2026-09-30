"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";

import { AsesorReassignTeamExpedienteFloating } from "@/components/asesor/AsesorReassignTeamExpedienteFloating";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function AsesorExpedienteLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const expedienteId = String(params?.id ?? "").trim();
  const [accessResolved, setAccessResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!supabaseBrowser) {
      setAccessResolved(true);
      return;
    }

    void (async () => {
      const { data, error } = await supabaseBrowser.rpc(
        "asesor_precalificador_ligado_context",
      );
      if (cancelled) return;

      const linkedPrecalOnly =
        !error &&
        data != null &&
        typeof data === "object" &&
        (data as { enabled?: unknown }).enabled === true;

      if (linkedPrecalOnly) {
        router.replace("/asesor");
        return;
      }

      setAccessResolved(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!accessResolved) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }

  return (
    <>
      {children}
      {expedienteId ? (
        <AsesorReassignTeamExpedienteFloating expedienteId={expedienteId} />
      ) : null}
    </>
  );
}
