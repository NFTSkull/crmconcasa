import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  resolveAutoPrecalHealth,
  type AutoPrecalHealthEvent,
} from "@/domain/expedientes/auto-precal-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

async function requireAuthenticatedUser(request: Request): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const token = bearerToken(request);
  if (!url || !anon || !token) return false;

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  return !error && Boolean(data.user);
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

export async function GET(request: Request) {
  if (!(await requireAuthenticatedUser(request))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const supabase = serviceClient();
    const [precal, reprecal] = await Promise.all([
      supabase
        .from("auto_precal_intentos")
        .select("intentado_en, resultado, razon")
        .order("intentado_en", { ascending: false })
        .limit(20),
      supabase
        .from("auto_reprecal_intentos")
        .select("intentado_en, resultado, razon")
        .order("intentado_en", { ascending: false })
        .limit(20),
    ]);

    if (precal.error) throw new Error(precal.error.message);
    if (reprecal.error) throw new Error(reprecal.error.message);

    const events = [
      ...((precal.data ?? []) as AutoPrecalHealthEvent[]),
      ...((reprecal.data ?? []) as AutoPrecalHealthEvent[]),
    ];
    const state = resolveAutoPrecalHealth(events);

    return NextResponse.json(
      {
        ok: true,
        blocked_by_akamai: state.blockedByAkamai,
        detected_at: state.detectedAt,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    console.error(
      "[auto-precal-health] status falló",
      err instanceof Error ? err.message : err,
    );
    // Falla silenciosa: nunca mostrar una falsa alerta por un error del status.
    return NextResponse.json(
      { ok: false, blocked_by_akamai: false, detected_at: null },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
