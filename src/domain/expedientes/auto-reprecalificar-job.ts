/**
 * Job auto-reprecalificar: scraper + auto_resolver_reprecalificacion + registro.
 * pending_error / scraper fallido → no llama RPC (intento sigue pendiente).
 * Siempre inserta en auto_reprecal_intentos (cualquier desenlace).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  decideAutoPrecalFromScraper,
  type AutoPrecalScraperPayload,
} from "@/domain/expedientes/auto-precalificar-decision";
import {
  SCRAPER_TIMEOUT_MS,
  type AutoPrecalIntentoResultado,
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

async function recordIntento(
  supabase: SupabaseClient,
  intentoId: string,
  resultado: AutoPrecalIntentoResultado,
  razon: string | null,
): Promise<void> {
  const { error } = await supabase.from("auto_reprecal_intentos").insert({
    intento_id: intentoId,
    resultado,
    razon,
  });
  if (error) {
    console.error(
      `[auto-reprecalificar] insert intento falló intento_id=${intentoId}`,
      error.message,
    );
  }
}

/**
 * Corre scraper + auto_resolver_reprecalificacion para un intento pendiente.
 * Siempre intenta insertar en `auto_reprecal_intentos`.
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

  let resultado: AutoPrecalIntentoResultado = "pending_error";
  let razon: string | null = "scraper_failed";

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
      resultado = "pending_error";
      razon = decision.reason;
      console.error(
        `[auto-reprecalificar] pending_error intento_id=${intentoId} nss=${nss} reason=${decision.reason}`,
        { status: upstream.status, payload },
      );
      return { resultado, razon };
    }

    if (decision.kind === "aprobado") {
      resultado = "aprobado";
      razon = null;
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
        resultado = "pending_error";
        razon = "rpc_failed";
        return { resultado, razon };
      }
      console.log(
        `[auto-reprecalificar] aprobado intento_id=${intentoId} nss=${nss} monto=${decision.monto}`,
      );
      return { resultado, razon };
    }

    resultado = "no_cumple";
    razon = null;
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
      resultado = "pending_error";
      razon = "rpc_failed";
      return { resultado, razon };
    }
    console.log(
      `[auto-reprecalificar] no_cumple intento_id=${intentoId} nss=${nss}`,
    );
    return { resultado, razon };
  } catch (err) {
    resultado = "pending_error";
    razon = "scraper_failed";
    console.error(
      `[auto-reprecalificar] job excepción intento_id=${intentoId} nss=${nss}`,
      err instanceof Error ? err.message : err,
    );
    return { resultado, razon };
  } finally {
    await recordIntento(supabase, intentoId, resultado, razon);
  }
}
