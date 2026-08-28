import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { NextResponse } from "next/server";

import {
  decideAutoPrecalFromScraper,
  type AutoPrecalScraperPayload,
} from "@/domain/expedientes/auto-precalificar-decision";

export const runtime = "nodejs";
export const maxDuration = 180;

const SCRAPER_TIMEOUT_MS = 150_000;

type RouteParams = { params: Promise<{ id: string }> };

function bearerToken(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

async function requireAuthenticatedUser(
  request: Request,
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const token = bearerToken(request);
  if (!url || !anon || !token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, userId: data.user.id };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("SUPABASE_URL/SERVICE_ROLE no configurados");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Respuesta inmediata: el scraper corre en `after()`. */
export function autoPrecalAcceptedResponse(expedienteId: string): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      status: "accepted",
      expediente_id: expedienteId,
    },
    { status: 202 },
  );
}

export async function runAutoPrecalificarJob(input: {
  expedienteId: string;
  nss: string;
  scraperUrl: string;
  scraperSecret: string;
}): Promise<void> {
  const { expedienteId, nss, scraperUrl, scraperSecret } = input;
  const supabase = serviceClient();

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
      `[auto-precalificar] pending_error expediente_id=${expedienteId} nss=${nss} reason=${decision.reason}`,
      { status: upstream.status, payload },
    );
    return;
  }

  if (decision.kind === "aprobado") {
    const { error: rpcErr } = await supabase.rpc("auto_upsert_editor_decision", {
      p_expediente_id: expedienteId,
      p_decision: "aprobado",
      p_monto_aprobado: decision.monto,
      p_motivo: null,
    });
    if (rpcErr) {
      console.error(
        `[auto-precalificar] RPC aprobado falló expediente_id=${expedienteId} nss=${nss}`,
        rpcErr.message,
      );
      return;
    }
    console.log(
      `[auto-precalificar] aprobado expediente_id=${expedienteId} nss=${nss} monto=${decision.monto}`,
    );
    return;
  }

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
    return;
  }
  console.log(
    `[auto-precalificar] no_cumple expediente_id=${expedienteId} nss=${nss}`,
  );
}

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return auth.response;

  const { id: expedienteId } = await params;
  if (!expedienteId || !/^[0-9a-f-]{36}$/i.test(expedienteId)) {
    return NextResponse.json(
      { ok: false, status: "invalid_id" },
      { status: 400 },
    );
  }

  try {
    const supabase = serviceClient();
    const { data: exp, error: readErr } = await supabase
      .from("expedientes")
      .select("id, nss")
      .eq("id", expedienteId)
      .is("deleted_at", null)
      .maybeSingle();

    if (readErr) throw new Error(readErr.message);
    if (!exp?.nss) {
      console.error(
        `[auto-precalificar] expediente/nss no encontrado expediente_id=${expedienteId} user=${auth.userId}`,
      );
      return NextResponse.json({
        ok: true,
        status: "pending_error",
        reason: "expediente_or_nss_not_found",
      });
    }
    const nss = String(exp.nss).trim();

    const scraperUrl = process.env.SCRAPER_SERVICE_URL?.trim();
    const scraperSecret = process.env.SCRAPER_SECRET?.trim();
    if (!scraperUrl || !scraperSecret) {
      console.error(
        `[auto-precalificar] scraper no configurado expediente_id=${expedienteId} nss=${nss}`,
      );
      return NextResponse.json({
        ok: true,
        status: "pending_error",
        reason: "scraper_not_configured",
      });
    }

    after(() =>
      runAutoPrecalificarJob({
        expedienteId,
        nss,
        scraperUrl,
        scraperSecret,
      }).catch((err) => {
        console.error(
          `[auto-precalificar] job falló expediente_id=${expedienteId} nss=${nss}`,
          err instanceof Error ? err.message : err,
        );
      }),
    );

    console.log(
      `[auto-precalificar] accepted 202 expediente_id=${expedienteId} nss=${nss} user=${auth.userId}`,
    );
    return autoPrecalAcceptedResponse(expedienteId);
  } catch (err) {
    console.error(
      `[auto-precalificar] fallo pre-ack expediente_id=${expedienteId}`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({
      ok: true,
      status: "pending_error",
      reason: "exception",
    });
  }
}
