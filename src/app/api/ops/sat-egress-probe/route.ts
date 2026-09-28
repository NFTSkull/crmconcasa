import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SAT_URL = "https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/index.jsf";

export async function GET() {
  const startedAt = Date.now();
  try {
    const response = await fetch(SAT_URL, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15_000),
    });

    return NextResponse.json({
      ok: true,
      status: response.status,
      location: response.headers.get("location"),
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code:
          error instanceof DOMException && error.name === "TimeoutError"
            ? "TIMEOUT"
            : "FETCH_FAILED",
        message: error instanceof Error ? error.message : "unknown",
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 503 },
    );
  }
}
