import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 70;

export async function GET() {
  const url = process.env.SAT_VALIDATOR_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.SAT_VALIDATOR_SECRET?.trim();

  if (!url || !secret) {
    return NextResponse.json(
      { ok: false, error: "SAT_WORKER_NOT_CONFIGURED" },
      { status: 500 },
    );
  }

  try {
    const response = await fetch(`${url}/diagnostics/proxy`, {
      method: "GET",
      headers: {
        "x-concasa-worker-secret": secret,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(
      {
        ok: body.ok === true,
        loadMs: body.loadMs ?? null,
        error: body.error ?? null,
        proxy: body.proxy ?? null,
        sessionsUsed: body.sessionsUsed ?? null,
        resourcesBlocked: body.resourcesBlocked ?? null,
      },
      { status: response.ok ? 200 : 503 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "FETCH_FAILED",
      },
      { status: 503 },
    );
  }
}
