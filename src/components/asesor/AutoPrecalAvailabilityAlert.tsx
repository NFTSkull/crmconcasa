"use client";

import { useEffect, useState } from "react";

import { resolveBearerAccessToken } from "@/domain/expedientes/resolve-bearer-access-token";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const POLL_MS = 10_000;

type HealthPayload = {
  ok?: boolean;
  blocked_by_akamai?: boolean;
};

export function AutoPrecalAvailabilityAlert() {
  const [blocked, setBlocked] = useState(false);

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
          if (!cancelled) setBlocked(false);
          return;
        }

        const payload = (await res.json()) as HealthPayload;
        if (!cancelled) {
          setBlocked(payload.ok === true && payload.blocked_by_akamai === true);
        }
      } catch {
        // El monitor nunca debe bloquear captura ni mantener una falsa caída.
        if (!cancelled) setBlocked(false);
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

  if (!blocked) return null;

  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-900"
    >
      <p className="font-semibold">
        La página de Infonavit está temporalmente no disponible para la
        precalificación automática.
      </p>
      <p className="mt-1">
        El expediente se guardará como pendiente y se reintentará
        automáticamente. No es necesario volver a capturarlo.
      </p>
    </div>
  );
}
