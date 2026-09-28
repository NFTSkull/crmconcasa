import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 70;

const TOKEN_SHA256 = "96fffa3ad20b3c9014893748877892b51058f3f098b8fe49194ac350c3c97c99";

function allowed(request: Request): boolean {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const actual = createHash("sha256").update(token).digest();
  const expected = Buffer.from(TOKEN_SHA256, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!allowed(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const url = process.env.SAT_VALIDATOR_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.SAT_VALIDATOR_SECRET?.trim();
  if (!url || !secret) {
    return NextResponse.json(
      { ok: false, error: "SAT_WORKER_NOT_CONFIGURED" },
      { status: 500 },
    );
  }

  try {
    const response = await fetch(`${url}/diagnostics/sat`, {
      method: "GET",
      headers: { "x-concasa-worker-secret": secret },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const safe = {
      ok: body.ok === true,
      loadMs: body.loadMs ?? null,
      proxy: body.proxy ?? null,
      sessionsUsed: body.sessionsUsed ?? null,
      resourcesBlocked: body.resourcesBlocked ?? null,
      networkBytes: body.networkBytes ?? null,
      networkMb: body.networkMb ?? null,
      error: body.error ?? null,
    };
    console.log("[ops/sat-one-shot-bandwidth-probe]", safe);
    return NextResponse.json(safe, { status: response.ok ? 200 : 503 });
  } catch (error) {
    const safe = {
      ok: false,
      loadMs: null,
      proxy: null,
      sessionsUsed: null,
      resourcesBlocked: null,
      networkBytes: null,
      networkMb: null,
      error: error instanceof Error ? error.message : "FETCH_FAILED",
    };
    console.log("[ops/sat-one-shot-bandwidth-probe]", safe);
    return NextResponse.json(safe, { status: 503 });
  }
}
