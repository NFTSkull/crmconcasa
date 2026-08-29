import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { NextResponse } from "next/server";

import { runAutoReprecalificarJob } from "@/domain/expedientes/auto-reprecalificar-job";

export const runtime = "nodejs";
export const maxDuration = 180;

type RouteParams = { params: Promise<{ intentoId: string }> };

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
export function autoReprecalAcceptedResponse(intentoId: string): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      status: "accepted",
      intento_id: intentoId,
    },
    { status: 202 },
  );
}

export { runAutoReprecalificarJob } from "@/domain/expedientes/auto-reprecalificar-job";

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return auth.response;

  const { intentoId } = await params;
  if (!intentoId || !/^[0-9a-f-]{36}$/i.test(intentoId)) {
    return NextResponse.json(
      { ok: false, status: "invalid_id" },
      { status: 400 },
    );
  }

  try {
    const supabase = serviceClient();
    const { data: intento, error: readErr } = await supabase
      .from("expediente_precalificacion_intentos")
      .select("id, nss, decision")
      .eq("id", intentoId)
      .maybeSingle();

    if (readErr) throw new Error(readErr.message);
    if (!intento?.nss) {
      console.error(
        `[auto-reprecalificar] intento/nss no encontrado intento_id=${intentoId} user=${auth.userId}`,
      );
      return NextResponse.json({
        ok: true,
        status: "pending_error",
        reason: "intento_or_nss_not_found",
      });
    }
    if (String(intento.decision) !== "pendiente") {
      console.error(
        `[auto-reprecalificar] intento no pendiente intento_id=${intentoId} decision=${intento.decision}`,
      );
      return NextResponse.json({
        ok: true,
        status: "pending_error",
        reason: "intento_not_pending",
      });
    }
    const nss = String(intento.nss).trim();

    const scraperUrl = process.env.SCRAPER_SERVICE_URL?.trim();
    const scraperSecret = process.env.SCRAPER_SECRET?.trim();
    if (!scraperUrl || !scraperSecret) {
      console.error(
        `[auto-reprecalificar] scraper no configurado intento_id=${intentoId} nss=${nss}`,
      );
      return NextResponse.json({
        ok: true,
        status: "pending_error",
        reason: "scraper_not_configured",
      });
    }

    after(() =>
      runAutoReprecalificarJob({
        intentoId,
        nss,
        scraperUrl,
        scraperSecret,
      }).catch((err) => {
        console.error(
          `[auto-reprecalificar] job falló intento_id=${intentoId} nss=${nss}`,
          err instanceof Error ? err.message : err,
        );
      }),
    );

    console.log(
      `[auto-reprecalificar] accepted 202 intento_id=${intentoId} nss=${nss} user=${auth.userId}`,
    );
    return autoReprecalAcceptedResponse(intentoId);
  } catch (err) {
    console.error(
      `[auto-reprecalificar] fallo pre-ack intento_id=${intentoId}`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({
      ok: true,
      status: "pending_error",
      reason: "exception",
    });
  }
}
