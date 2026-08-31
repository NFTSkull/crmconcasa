import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  AUTO_REPRECAL_RETRY_LIMIT,
  selectAutoReprecalRetryCandidates,
  type AutoReprecalIntentoRow,
} from "@/domain/expedientes/auto-reprecal-retry";
import { resolveProgramaParaMonto } from "@/domain/expedientes/auto-precalificar-decision";
import { runAutoReprecalificarJob } from "@/domain/expedientes/auto-reprecalificar-job";

export const runtime = "nodejs";
/** Hasta 2 jobs × SCRAPER_TIMEOUT_MS(150s) = 300s; cabe en maxDuration default. */
export const maxDuration = 300;

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

/**
 * Auth estilo worker Sheets + Vercel Cron:
 * - Header `x-cron-secret: <CRON_SECRET>`
 * - o `Authorization: Bearer <CRON_SECRET>` (convención Vercel Cron)
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const headerSecret = request.headers.get("x-cron-secret")?.trim() ?? "";
  if (headerSecret && headerSecret === secret) return true;

  const auth = request.headers.get("authorization")?.trim() ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const bearer = m?.[1]?.trim() ?? "";
  return Boolean(bearer) && bearer === secret;
}

async function handleRetryPendientesReprecal(
  request: Request,
): Promise<NextResponse> {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scraperUrl = process.env.SCRAPER_SERVICE_URL?.trim();
  const scraperSecret = process.env.SCRAPER_SECRET?.trim();
  if (!scraperUrl || !scraperSecret) {
    return NextResponse.json(
      { ok: false, error: "scraper_not_configured" },
      { status: 503 },
    );
  }

  const supabase = serviceClient();

  const { data: pendingRows, error: pendingErr } = await supabase
    .from("expediente_precalificacion_intentos")
    .select("id, nss, programa, programa_solicitado")
    .eq("decision", "pendiente");

  if (pendingErr) {
    console.error(
      "[cron/reintentar-pendientes-reprecal] pending query",
      pendingErr.message,
    );
    return NextResponse.json(
      { ok: false, error: "pending_query_failed" },
      { status: 500 },
    );
  }

  type PendingRow = {
    id: string;
    nss: string | null;
    programa: string | null;
    programa_solicitado: string | null;
  };
  const pendingList = (pendingRows ?? []) as PendingRow[];
  const pendingIds: string[] = [];
  const nssById = new Map<string, string>();
  const programaById = new Map<string, string>();

  for (const row of pendingList) {
    if (!row?.id || !row.nss) continue;
    const nss = String(row.nss).trim();
    if (!nss) continue;
    pendingIds.push(row.id);
    nssById.set(row.id, nss);
    const programa = resolveProgramaParaMonto({
      programa: row.programa,
      programaSolicitado: row.programa_solicitado,
    });
    if (programa) programaById.set(row.id, programa);
  }

  if (pendingIds.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      candidates: 0,
      results: [],
    });
  }

  const { data: intentoRows, error: intentosErr } = await supabase
    .from("auto_reprecal_intentos")
    .select("intento_id, intentado_en, resultado, razon")
    .in("intento_id", pendingIds);

  if (intentosErr) {
    console.error(
      "[cron/reintentar-pendientes-reprecal] intentos query",
      intentosErr.message,
    );
    return NextResponse.json(
      { ok: false, error: "intentos_query_failed" },
      { status: 500 },
    );
  }

  const intentos = (intentoRows ?? []) as AutoReprecalIntentoRow[];
  const candidateIds = selectAutoReprecalRetryCandidates({
    pendingIntentoIds: pendingIds,
    intentos,
    limit: AUTO_REPRECAL_RETRY_LIMIT,
  });

  console.log(
    `[cron/reintentar-pendientes-reprecal] candidates=${candidateIds.length} pending=${pendingIds.length}`,
  );

  const results: {
    intento_id: string;
    resultado: string;
    razon: string | null;
  }[] = [];

  // SECUENCIAL: nunca Promise.all (cada job ~30–45s / hasta timeout scraper).
  for (const intentoId of candidateIds) {
    const nss = nssById.get(intentoId);
    if (!nss) continue;
    const outcome = await runAutoReprecalificarJob({
      intentoId,
      nss,
      programa: programaById.get(intentoId),
      scraperUrl,
      scraperSecret,
      supabase,
    });
    results.push({
      intento_id: intentoId,
      resultado: outcome.resultado,
      razon: outcome.razon,
    });
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    candidates: candidateIds.length,
    results,
  });
}

/** Vercel Cron invoca GET. */
export async function GET(request: Request) {
  return handleRetryPendientesReprecal(request);
}

/** Permite disparo manual con el mismo secreto. */
export async function POST(request: Request) {
  return handleRetryPendientesReprecal(request);
}
