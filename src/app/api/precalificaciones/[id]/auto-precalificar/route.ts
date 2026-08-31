import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { NextResponse } from "next/server";

import { runAutoPrecalificarJob } from "@/domain/expedientes/auto-precalificar-job";

export const runtime = "nodejs";
export const maxDuration = 180;

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

/** Re-export para callers/tests que importaban el job desde la route. */
export { runAutoPrecalificarJob } from "@/domain/expedientes/auto-precalificar-job";

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
      .select("id, nss, programa")
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
    const programa = String(
      (exp as { programa?: string }).programa ?? "",
    ).trim();

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
        programa,
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
