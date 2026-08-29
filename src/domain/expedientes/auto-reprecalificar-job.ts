/**
 * Job auto-reprecalificar: scraper + auto_resolver_reprecalificacion.
 * No muta el intento si el scraper falla o el payload es ambiguo.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  decideAutoPrecalFromScraper,
  type AutoPrecalScraperPayload,
} from "@/domain/expedientes/auto-precalificar-decision";
import {
  SCRAPER_TIMEOUT_MS,
  type AutoPrecalJobResult,
} from "@/domain/expedientes/auto-precalificar-job";

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("SUPABASE_URL/SERVICE_ROLE no configurados");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Corre scraper + auto_resolver_reprecalificacion para un intento pendiente.
 * pending_error / scraper_failed → no llama RPC (intento sigue pendiente).
 */
export async function runAutoReprecalificarJob(input: {
  intentoId: string;
  nss: string;
  scraperUrl: string;
  scraperSecret: string;
  supabase?: SupabaseClient;
}): Promise<AutoPrecalJobResult> {
  const { intentoId, nss, scraperUrl, scraperSecret } = input;
  const supabase = input.supabase ?? serviceClient();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SCRAPER_TIMEOUT_MS);
    let upstream: Response;
    let payload: AutoPrecalScraperPayload;
    try {
      upstream = await fetch(`${scraperUrl.replace(/\/$/, "")}/precalificar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-scraper-secret": scraperSecret,
        },
        body: JSON.stringify({ nss, workerIndex: 0 }),
        signal: controller.signal,
      });
      payload = (await upstream.json()) as AutoPrecalScraperPayload;
    } finally {
      clearTimeout(timeoutId);
    }

    const decision = decideAutoPrecalFromScraper(payload, upstream.ok);

    if (decision.kind === "pending_error") {
      console.error(
        `[auto-reprecalificar] pending_error intento_id=${intentoId} nss=${nss} reason=${decision.reason}`,
        { status: upstream.status, payload },
      );
      return { resultado: "pending_error", razon: decision.reason };
    }

    if (decision.kind === "aprobado") {
      const { error: rpcErr } = await supabase.rpc(
        "auto_resolver_reprecalificacion",
        {
          p_intento_id: intentoId,
          p_decision: "aprobado",
          p_monto_aprobado: decision.monto,
          p_motivo: null,
          p_rfc: payload.rfc ?? null,
          p_registro_patronal: payload.registroPatronal ?? null,
          p_empresa: payload.empresa ?? null,
          p_advertencia_inscripcion: payload.advertenciaInscripcion ?? null,
        },
      );
      if (rpcErr) {
        console.error(
          `[auto-reprecalificar] RPC aprobado falló intento_id=${intentoId} nss=${nss}`,
          rpcErr.message,
        );
        return { resultado: "pending_error", razon: "rpc_failed" };
      }
      console.log(
        `[auto-reprecalificar] aprobado intento_id=${intentoId} nss=${nss} monto=${decision.monto}`,
      );
      return { resultado: "aprobado", razon: null };
    }

    const { error: rpcErr } = await supabase.rpc(
      "auto_resolver_reprecalificacion",
      {
        p_intento_id: intentoId,
        p_decision: "no_cumple",
        p_monto_aprobado: null,
        p_motivo: decision.motivo,
      },
    );
    if (rpcErr) {
      console.error(
        `[auto-reprecalificar] RPC no_cumple falló intento_id=${intentoId} nss=${nss}`,
        rpcErr.message,
      );
      return { resultado: "pending_error", razon: "rpc_failed" };
    }
    console.log(
      `[auto-reprecalificar] no_cumple intento_id=${intentoId} nss=${nss}`,
    );
    return { resultado: "no_cumple", razon: null };
  } catch (err) {
    console.error(
      `[auto-reprecalificar] job excepción intento_id=${intentoId} nss=${nss}`,
      err instanceof Error ? err.message : err,
    );
    return { resultado: "pending_error", razon: "scraper_failed" };
  }
}
