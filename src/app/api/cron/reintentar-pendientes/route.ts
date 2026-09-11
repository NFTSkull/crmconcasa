import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  AUTO_PRECAL_RETRY_LIMIT,
  AUTO_PRECAL_RETRY_PRIORITY_CAPABILITY,
  selectAutoPrecalRetryCandidates,
  type AutoPrecalIntentoRow,
} from "@/domain/expedientes/auto-precal-retry";
import { runAutoPrecalificarJob } from "@/domain/expedientes/auto-precalificar-job";

export const runtime = "nodejs";
/** 1 job × SCRAPER_TIMEOUT_MS(150s) ≤ maxDuration 300; secuencial. */
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
 * - Header `x-cron-secret: <CRON_SECRET>` (mismo espíritu que `x-concasa-worker-secret`)
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

async function handleRetryPendientes(request: Request): Promise<NextResponse> {
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
    .from("editor_decisions")
    .select(
      "expediente_id, created_at, expedientes!inner(id, nss, programa, deleted_at, asesor_id)",
    )
    .eq("decision", "pendiente")
    .is("expedientes.deleted_at", null);

  if (pendingErr) {
    console.error("[cron/reintentar-pendientes] pending query", pendingErr.message);
    return NextResponse.json(
      { ok: false, error: "pending_query_failed" },
      { status: 500 },
    );
  }

  type PendingJoin = {
    expediente_id: string;
    created_at: string;
    expedientes:
      | {
          id: string;
          nss: string | null;
          programa: string | null;
          deleted_at: string | null;
          asesor_id: string | null;
        }
      | {
          id: string;
          nss: string | null;
          programa: string | null;
          deleted_at: string | null;
          asesor_id: string | null;
        }[]
      | null;
  };

  const pendingList = (pendingRows ?? []) as PendingJoin[];
  const pendingIds: string[] = [];
  const pendingSinceById: Record<string, string> = {};
  const nssById = new Map<string, string>();
  const programaById = new Map<string, string>();
  const asesorIdByExp = new Map<string, string>();

  for (const row of pendingList) {
    const exp = Array.isArray(row.expedientes)
      ? row.expedientes[0]
      : row.expedientes;
    if (!exp?.id || !exp.nss) continue;
    pendingIds.push(exp.id);
    if (row.created_at) pendingSinceById[exp.id] = String(row.created_at);
    nssById.set(exp.id, String(exp.nss).trim());
    const programa = String(exp.programa ?? "").trim();
    if (programa) programaById.set(exp.id, programa);
    const asesorId = String(exp.asesor_id ?? "").trim();
    if (asesorId) asesorIdByExp.set(exp.id, asesorId);
  }

  if (pendingIds.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      candidates: 0,
      results: [],
    });
  }

  // Solo intentos de expedientes pendientes (no backlog masivo).
  const { data: intentoRows, error: intentosErr } = await supabase
    .from("auto_precal_intentos")
    .select("expediente_id, intentado_en, resultado, razon")
    .in("expediente_id", pendingIds);

  if (intentosErr) {
    console.error(
      "[cron/reintentar-pendientes] intentos query",
      intentosErr.message,
    );
    return NextResponse.json(
      { ok: false, error: "intentos_query_failed" },
      { status: 500 },
    );
  }

  const intentos = (intentoRows ?? []) as AutoPrecalIntentoRow[];

  const asesorIds = [...new Set(asesorIdByExp.values())];
  const priorityAsesorIds = new Set<string>();
  if (asesorIds.length > 0) {
    const { data: capRows, error: capErr } = await supabase
      .from("profile_capabilities")
      .select("profile_id")
      .eq("capability", AUTO_PRECAL_RETRY_PRIORITY_CAPABILITY)
      .eq("active", true)
      .in("profile_id", asesorIds);
    if (capErr) {
      console.error(
        "[cron/reintentar-pendientes] priority capability query",
        capErr.message,
      );
      // Fail-open: sin prioridad, el cron sigue con orden por antigüedad.
    } else {
      for (const row of capRows ?? []) {
        const pid = String(
          (row as { profile_id?: string }).profile_id ?? "",
        ).trim();
        if (pid) priorityAsesorIds.add(pid);
      }
    }
  }

  const priorityExpedienteIds = pendingIds.filter((id) => {
    const asesorId = asesorIdByExp.get(id);
    return Boolean(asesorId && priorityAsesorIds.has(asesorId));
  });

  const candidateIds = selectAutoPrecalRetryCandidates({
    pendingExpedienteIds: pendingIds,
    intentos,
    pendingSinceById,
    priorityExpedienteIds,
    limit: AUTO_PRECAL_RETRY_LIMIT,
  });

  console.log(
    `[cron/reintentar-pendientes] candidates=${candidateIds.length} pending=${pendingIds.length} priority=${priorityExpedienteIds.length}`,
  );

  const results: {
    expediente_id: string;
    resultado: string;
    razon: string | null;
  }[] = [];

  // SECUENCIAL: nunca Promise.all (cada job ~30–45s / hasta timeout scraper).
  for (const expedienteId of candidateIds) {
    const nss = nssById.get(expedienteId);
    if (!nss) continue;
    const outcome = await runAutoPrecalificarJob({
      expedienteId,
      nss,
      programa: programaById.get(expedienteId),
      scraperUrl,
      scraperSecret,
      supabase,
    });
    results.push({
      expediente_id: expedienteId,
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
  return handleRetryPendientes(request);
}

/** Permite disparo manual con el mismo secreto. */
export async function POST(request: Request) {
  return handleRetryPendientes(request);
}
