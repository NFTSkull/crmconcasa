/**
 * Job auto-precalificar (scraper + RPC + registro de intento).
 * Reutilizable desde la route HTTP y desde el cron de reintentos.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  decideAutoPrecalFromScraper,
  type AutoPrecalScraperPayload,
} from "@/domain/expedientes/auto-precalificar-decision";

export const SCRAPER_TIMEOUT_MS = 150_000;

export type AutoPrecalIntentoResultado =
  | "aprobado"
  | "no_cumple"
  | "pending_error";

export type AutoPrecalJobResult = {
  resultado: AutoPrecalIntentoResultado;
  razon: string | null;
};

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
  expedienteId: string,
  resultado: AutoPrecalIntentoResultado,
  razon: string | null,
): Promise<void> {
  const { error } = await supabase.from("auto_precal_intentos").insert({
    expediente_id: expedienteId,
    resultado,
    razon,
  });
  if (error) {
    console.error(
      `[auto-precalificar] insert intento falló expediente_id=${expedienteId}`,
      error.message,
    );
  }
}

/**
 * Corre scraper + upsert decisión. Siempre intenta insertar en
 * `auto_precal_intentos` (aprobado | no_cumple | pending_error).
 */
export async function runAutoPrecalificarJob(input: {
  expedienteId: string;
  nss: string;
  scraperUrl: string;
  scraperSecret: string;
  /** Si se omite, se crea service role client. */
  supabase?: SupabaseClient;
}): Promise<AutoPrecalJobResult> {
  const { expedienteId, nss, scraperUrl, scraperSecret } = input;
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
        `[auto-precalificar] pending_error expediente_id=${expedienteId} nss=${nss} reason=${decision.reason}`,
        { status: upstream.status, payload },
      );
      return { resultado, razon };
    }

    if (decision.kind === "aprobado") {
      resultado = "aprobado";
      razon = null;
      const { error: rpcErr } = await supabase.rpc(
        "auto_upsert_editor_decision",
        {
          p_expediente_id: expedienteId,
          p_decision: "aprobado",
          p_monto_aprobado: decision.monto,
          p_motivo: null,
        },
      );
      if (rpcErr) {
        console.error(
          `[auto-precalificar] RPC aprobado falló expediente_id=${expedienteId} nss=${nss}`,
          rpcErr.message,
        );
        return { resultado, razon };
      }
      console.log(
        `[auto-precalificar] aprobado expediente_id=${expedienteId} nss=${nss} monto=${decision.monto}`,
      );
      return { resultado, razon };
    }

    resultado = "no_cumple";
    razon = null;
    const { error: rpcErr } = await supabase.rpc("auto_upsert_editor_decision", {
      p_expediente_id: expedienteId,
      p_decision: "no_cumple",
      p_monto_aprobado: null,
      p_motivo: decision.motivo,
    });
    if (rpcErr) {
      console.error(
        `[auto-precalificar] RPC no_cumple falló expediente_id=${expedienteId} nss=${nss}`,
        rpcErr.message,
      );
      return { resultado, razon };
    }
    console.log(
      `[auto-precalificar] no_cumple expediente_id=${expedienteId} nss=${nss}`,
    );
    return { resultado, razon };
  } catch (err) {
    resultado = "pending_error";
    razon = "scraper_failed";
    console.error(
      `[auto-precalificar] job excepción expediente_id=${expedienteId} nss=${nss}`,
      err instanceof Error ? err.message : err,
    );
    return { resultado, razon };
  } finally {
    await recordIntento(supabase, expedienteId, resultado, razon);
  }
}
