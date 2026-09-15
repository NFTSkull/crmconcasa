"use client";

import { useEffect, useState, type ReactNode } from "react";

import { isAnetteNssOnlyEmail } from "@/domain/expedientes/anette-nss-only";
import { useSessionRepo } from "@/domain/session";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { AnetteNssOnlyPrecalPage } from "./anette-nss-only-page";

export default function NuevaPrecalificacionLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { currentUser } = useSessionRepo();
  const [nssOnlyEnabled, setNssOnlyEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (currentUser === undefined) {
      setNssOnlyEnabled(null);
      return;
    }

    if (!currentUser || currentUser.role !== "asesor") {
      setNssOnlyEnabled(false);
      return;
    }

    // Mantiene a Anette disponible incluso en mock/dev y evita regresión si la
    // consulta de elegibilidad tarda. Silvia/equipo se resuelve desde Cloud.
    if (isAnetteNssOnlyEmail(currentUser.email)) {
      setNssOnlyEnabled(true);
      return;
    }

    if (!supabaseBrowser) {
      setNssOnlyEnabled(false);
      return;
    }

    let cancelled = false;
    setNssOnlyEnabled(null);

    void (async () => {
      const { data, error } = await supabaseBrowser.rpc(
        "asesor_precal_nss_only_habilitado",
      );
      if (cancelled) return;

      if (error) {
        console.error("[nueva] elegibilidad NSS-only:", error.message);
        setNssOnlyEnabled(false);
        return;
      }

      setNssOnlyEnabled(data === true);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.email, currentUser?.role]);

  if (
    currentUser === undefined ||
    (currentUser?.role === "asesor" && nssOnlyEnabled === null)
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }

  if (currentUser?.role === "asesor" && nssOnlyEnabled) {
    return <AnetteNssOnlyPrecalPage />;
  }

  return <>{children}</>;
}
