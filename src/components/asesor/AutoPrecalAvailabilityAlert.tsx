"use client";

import { useEffect, useState } from "react";

import { resolveBearerAccessToken } from "@/domain/expedientes/resolve-bearer-access-token";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

const POLL_MS = 10_000;

/**
 * Aviso operativo temporal solicitado por Mesa/operación.
 * No bloquea la captura ni el envío de precalificaciones.
 * Cambiar a false cuando se confirme que Bansefi/Infonavit volvió estable.
 */
const FORCE_BANSEFI_TEMPORARY_OUTAGE_NOTICE = false;

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

  const visible =
    FORCE_BANSEFI_TEMPORARY_OUTAGE_NOTICE || unavailable;

  if (!visible) return null;

  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-200 text-base"
        >
          ⚠
        </span>
        <div>
          <p className="text-base font-bold">
            Bansefi / Infonavit presenta una caída temporal.
          </p>
          <p className="mt-1 font-medium">
            Sí puedes seguir precalificando normalmente.
          </p>
          <p className="mt-1">
            Si Bansefi no responde en ese momento, la solicitud quedará
            pendiente y el sistema seguirá intentando procesarla cuando el
            servicio vuelva a responder.
          </p>
          <p className="mt-2 text-xs font-semibold">
            No es necesario volver a capturar el NSS. Este aviso es temporal y
            se retirará en cuanto se confirme que el portal volvió a funcionar
            de forma estable.
          </p>
        </div>
      </div>
    </div>
  );
}
