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

  // Solo son reintentables los pendientes que todavía pueden ser modificados por
  // auto_upsert_editor_decision. Los ya enviados a Mesa o fuera de ciclo activo
  // no pueden aceptar la decisión automática y antes desperdiciaban turnos del scraper.
  const { data: pendingRows, error: pendingErr } = await supabase
    .from("editor_decisions")
    .select(
      "expediente_id, created_at, expedientes!inner(id, nss, programa, deleted_at, asesor_id, ciclo_estado, submitted_to_mesa)",
    )
    .eq("decision", "pendiente")
    .is("expedientes.deleted_at", null)
    .eq("expedientes.ciclo_estado", "activo")
    .eq("expedientes.submitted_to_mesa", false);

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
          ciclo_estado: string | null;
          submitted_to_mesa: boolean | null;
        }
      | {
          id: string;
          nss: string | null;
          programa: string | null;
          deleted_at: string | null;
          asesor_id: string | null;
          ciclo_estado: string | null;
          submitted_to_mesa: boolean | null;
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

  // Intentos recientes de pendientes (paginado: evita truncar a ~1000 y
  // tratar prioritarios como “cero intentos”).
  const INTENTOS_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
  const INTENTOS_PAGE = 1000;
  const sinceIso = new Date(Date.now() - INTENTOS_LOOKBACK_MS).toISOString();
  const intentos: AutoPrecalIntentoRow[] = [];
  for (let from = 0; ; from += INTENTOS_PAGE) {
    const to = from + INTENTOS_PAGE - 1;
    const { data: intentoRows, error: intentosErr } = await supabase
      .from("auto_precal_intentos")
      .select("expediente_id, intentado_en, resultado, razon")
      .in("expediente_id", pendingIds)
      .gte("intentado_en", sinceIso)
      .order("intentado_en", { ascending: false })
      .range(from, to);

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

    const chunk = (intentoRows ?? []) as AutoPrecalIntentoRow[];
    intentos.push(...chunk);
    if (chunk.length < INTENTOS_PAGE) break;
  }

  // Señal global de recuperación del scraper: si después del último
  // scraper_failed de un expediente ya hubo cualquier resultado válido real de
  // Infonavit (aprobado/no_cumple), no conservamos el backoff largo de la caída
  // anterior. Se agrega únicamente una fila sintética EN MEMORIA con la misma
  // ancla temporal para que ese caso vuelva al cooldown base de 5 min. No se
  // modifica ni borra historial en Supabase.
  let lastScraperRecoveryMs = 0;
  const { data: recoveryRows, error: recoveryErr } = await supabase
    .from("auto_precal_intentos")
    .select("intentado_en")
    .in("resultado", ["aprobado", "no_cumple"])
    .order("intentado_en", { ascending: false })
    .limit(1);
  if (recoveryErr) {
    console.error(
      "[cron/reintentar-pendientes] recovery query",
      recoveryErr.message,
    );
  } else {
    const recoveryRaw = String(
      (recoveryRows?.[0] as { intentado_en?: string } | undefined)?.intentado_en ?? "",
    );
    const parsed = Date.parse(recoveryRaw);
    if (Number.isFinite(parsed)) lastScraperRecoveryMs = parsed;
  }

  const latestAttemptByExp = new Map<string, AutoPrecalIntentoRow>();
  for (const row of intentos) {
    const current = latestAttemptByExp.get(row.expediente_id);
    if (
      !current ||
      Date.parse(row.intentado_en) > Date.parse(current.intentado_en)
    ) {
      latestAttemptByExp.set(row.expediente_id, row);
    }
  }

  const intentosForSelection = [...intentos];
  let recoveredFailuresReset = 0;
  if (lastScraperRecoveryMs > 0) {
    for (const [expedienteId, lastRow] of latestAttemptByExp) {
      const lastMs = Date.parse(lastRow.intentado_en);
      if (
        lastRow.resultado === "pending_error" &&
        lastRow.razon === "scraper_failed" &&
        Number.isFinite(lastMs) &&
        lastScraperRecoveryMs > lastMs
      ) {
        intentosForSelection.push({
          expediente_id: expedienteId,
          intentado_en: new Date(lastMs + 1).toISOString(),
          resultado: "pending_error",
          razon: "scraper_busy",
        });
        recoveredFailuresReset += 1;
      }
    }
  }

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
    intentos: intentosForSelection,
    pendingSinceById,
    priorityExpedienteIds,
    limit: AUTO_PRECAL_RETRY_LIMIT,
  });

  console.log(
    `[cron/reintentar-pendientes] candidates=${candidateIds.length} pending=${pendingIds.length} priority=${priorityExpedienteIds.length} recovered_reset=${recoveredFailuresReset}`,
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
