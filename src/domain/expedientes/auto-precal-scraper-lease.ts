import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Una sola navegación Infonavit a la vez para todo el CRM.
 * El scraper de Railway usa un worker compartido y una llamada puede vivir 150s;
 * sin este lease los crons de cada minuto se solapan aunque cada run procese 1 caso.
 */
export const AUTO_PRECAL_SCRAPER_LEASE_SECONDS = 180;
export const AUTO_PRECAL_SCRAPER_BUSY_REASON = "scraper_busy";
/**
 * Tope duro de espera por el lease: route `maxDuration=180` − scraper 150s
 * deja margen para DB/RPC. No subir sin revisar esos dos límites.
 */
export const AUTO_PRECAL_SCRAPER_BUSY_MAX_WAIT_MS = 10_000;
export const AUTO_PRECAL_SCRAPER_BUSY_POLL_MS = 1_000;

type ScraperLeaseClaim = {
  claimed: boolean;
  ownerToken: string | null;
  /** true = el RPC falló (infra), no que el lease esté ocupado. */
  claimError: boolean;
};

export type ScraperLeaseWaitDeps = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function clampAutoPrecalScraperBusyWaitMs(
  waitMs: number | undefined,
): number {
  if (typeof waitMs !== "number" || !Number.isFinite(waitMs) || waitMs <= 0) {
    return 0;
  }
  return Math.min(waitMs, AUTO_PRECAL_SCRAPER_BUSY_MAX_WAIT_MS);
}

export async function tryClaimAutoPrecalScraperLease(
  supabase: SupabaseClient,
): Promise<ScraperLeaseClaim> {
  const ownerToken = randomUUID();
  const { data, error } = await supabase.rpc("auto_precal_scraper_try_claim", {
    p_owner_token: ownerToken,
    p_lease_seconds: AUTO_PRECAL_SCRAPER_LEASE_SECONDS,
  });

  if (error) {
    console.error(
      "[auto-precalificar] claim lease global del scraper falló",
      error.message,
    );
    return { claimed: false, ownerToken: null, claimError: true };
  }

  if (data !== true) {
    return { claimed: false, ownerToken: null, claimError: false };
  }

  return { claimed: true, ownerToken, claimError: false };
}

/**
 * Reintenta el claim (≈1/s) hasta `waitMs` mientras el lease esté ocupado.
 * Un error del RPC corta la espera de inmediato (`claimError: true`).
 * Solo devuelve owner token del claim exitoso: nunca hay dos leases propios.
 */
export async function waitForAutoPrecalScraperLease(
  supabase: SupabaseClient,
  waitMs: number,
  deps: ScraperLeaseWaitDeps = {},
): Promise<ScraperLeaseClaim & { waitedMs: number }> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const maxWaitMs = clampAutoPrecalScraperBusyWaitMs(waitMs);
  const startedAt = now();
  const deadline = startedAt + maxWaitMs;

  for (;;) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      return {
        claimed: false,
        ownerToken: null,
        claimError: false,
        waitedMs: now() - startedAt,
      };
    }
    await sleep(Math.min(AUTO_PRECAL_SCRAPER_BUSY_POLL_MS, remaining));
    const claim = await tryClaimAutoPrecalScraperLease(supabase);
    if (claim.claimed || claim.claimError) {
      return { ...claim, waitedMs: now() - startedAt };
    }
  }
}

export async function releaseAutoPrecalScraperLease(
  supabase: SupabaseClient,
  ownerToken: string | null,
): Promise<void> {
  if (!ownerToken) return;
  const { error } = await supabase.rpc("auto_precal_scraper_release", {
    p_owner_token: ownerToken,
  });
  if (error) {
    // Fail-safe: el lease expira solo a los 180s aunque falle el release.
    console.error(
      "[auto-precalificar] release lease global del scraper falló",
      error.message,
    );
  }
}
