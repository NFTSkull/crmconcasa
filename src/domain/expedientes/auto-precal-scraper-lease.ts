import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Una sola navegación Infonavit a la vez para todo el CRM.
 * El scraper de Railway usa un worker compartido y una llamada puede vivir 150s;
 * sin este lease los crons de cada minuto se solapan aunque cada run procese 1 caso.
 */
export const AUTO_PRECAL_SCRAPER_LEASE_SECONDS = 180;
export const AUTO_PRECAL_SCRAPER_BUSY_REASON = "scraper_busy";

type ScraperLeaseClaim = {
  claimed: boolean;
  ownerToken: string | null;
};

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
    return { claimed: false, ownerToken: null };
  }

  if (data !== true) {
    return { claimed: false, ownerToken: null };
  }

  return { claimed: true, ownerToken };
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
