"use client";

import { useEffect, useState } from "react";

import { resolveBearerAccessToken } from "@/domain/expedientes/resolve-bearer-access-token";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const POLL_MS = 10_000;

type HealthPayload = {
  ok?: boolean;
  blocked_by_akamai?: boolean;
  portal_unavailable?: boolean;
};

export function AutoPrecalAvailabilityAlert() {
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const client = supabaseBrowser;
    if (!client) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      try {
        const accessToken = await resolveBearerAccessToken(
          client.auth,
          "auto-precal-health",
        );
        if (!accessToken || cancelled) return;

        const res = await fetch("/api/precalificaciones/auto-precal-health", {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (!res.ok || cancelled) {
          if (!cancelled) setUnavailable(false);
          return;
        }

        const payload = (await res.json()) as HealthPayload;
        if (!cancelled) {
          setUnavailable(
            payload.ok === true &&
              (payload.portal_unavailable === true ||
                payload.blocked_by_akamai === true),
          );
        }
      } catch {
        // El monitor nunca debe bloquear captura ni mantener una falsa caída.
        if (!cancelled) setUnavailable(false);
      } finally {
        if (!cancelled) {
          timer = setTimeout(check, POLL_MS);
        }
      }
    };

    void check();

    const onFocus = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      void check();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!unavailable) return null;

  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950"
    >
      <p className="text-base font-semibold">
        La página de Bansefi / Infonavit está temporalmente caída.
      </p>
      <p className="mt-1">
        Puedes seguir enviando precalificaciones. Las solicitudes se guardarán
        como pendientes y el sistema las reintentará automáticamente en cuanto
        el servicio vuelva a responder.
      </p>
      <p className="mt-2 text-xs font-medium">
        Este aviso desaparecerá automáticamente cuando Bansefi vuelva a
        funcionar.
      </p>
    </div>
  );
}
