import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { extractPdfEmbeddedText } from "@/domain/identidad-curp/pdf-extract-text";
import { validateCurpLocal } from "@/domain/identidad-curp/curp-local";
import {
  resolveFiscalRfc,
  selectEstadoCuentaRfc,
} from "@/domain/validacion-fiscal/rfc";

export const runtime = "nodejs";
export const maxDuration = 180;

const DOCUMENT_BUCKET = "expediente-documentos";
const ESTADO_CUENTA = "cliente_estado_cuenta";

type RouteParams = { params: Promise<{ id: string }> };

type FiscalWorkerBody = {
  ok?: boolean;
  semantic?: "pass" | "invalid" | "retry";
  code?: string;
  rfc?: { status?: "valid" | "invalid" | "unknown" };
  curp?: { status?: "valid" | "invalid" | "unknown" | "not_run" };
};

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value) return null;
  return /^Bearer\s+(.+)$/i.exec(value.trim())?.[1]?.trim() || null;
}

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) throw new Error("SUPABASE_NOT_CONFIGURED");
  return { url, anon };
}

async function authenticatedClient(
  request: Request,
): Promise<
  | { ok: true; client: SupabaseClient; userId: string; token: string }
  | { ok: false; response: NextResponse }
> {
  const token = bearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 }),
    };
  }
  let config: ReturnType<typeof supabaseConfig>;
  try {
    config = supabaseConfig();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, status: "retry", code: "SUPABASE_NOT_CONFIGURED" },
        { status: 503 },
      ),
    };
  }
  const authClient = createClient(config.url, config.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 }),
    };
  }
  const client = createClient(config.url, config.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { ok: true, client, userId: data.user.id, token };
}

function retry(code: string, status = 503): NextResponse {
  return NextResponse.json(
    { ok: false, status: "retry", code, submitted_to_mesa: false },
    { status },
  );
}

function invalid(code: string): NextResponse {
  return NextResponse.json(
    { ok: false, status: "invalid", code, submitted_to_mesa: false },
    { status: 422 },
  );
}

export function classifyFiscalWorkerForMesa(body: FiscalWorkerBody):
  | { kind: "pass" }
  | { kind: "invalid"; code: string }
  | { kind: "retry"; code: string } {
  if (
    body?.semantic === "pass" &&
    body?.rfc?.status === "valid" &&
    body?.curp?.status === "valid"
  ) {
    return { kind: "pass" };
  }
  if (body?.semantic === "invalid") {
    if (body?.rfc?.status === "invalid") {
      return { kind: "invalid", code: "RFC_INVALIDO_SAT" };
    }
    if (body?.curp?.status === "invalid") {
      return { kind: "invalid", code: "CURP_INVALIDA_SAT" };
    }
    return { kind: "invalid", code: "IDENTIDAD_FISCAL_INVALIDA_SAT" };
  }
  return { kind: "retry", code: body?.code || "SAT_RESULTADO_NO_CONCLUYENTE" };
}

async function requireLiveWorker(): Promise<
  | { ok: true; url: string; secret: string }
  | { ok: false; code: string }
> {
  const url = process.env.SAT_VALIDATOR_URL?.trim()?.replace(/\/+$/, "");
  const secret = process.env.SAT_VALIDATOR_SECRET?.trim();
  if (!url || !secret) return { ok: false, code: "SAT_WORKER_NOT_CONFIGURED" };

  try {
    const health = await fetch(`${url}/health`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!health.ok) return { ok: false, code: "SAT_WORKER_HEALTH_FAILED" };
    const body = (await health.json()) as { ok?: boolean; mode?: string };
    // Fail closed: fixtures can NEVER authorize a real Mesa submission.
    if (body?.ok !== true || body?.mode !== "live") {
      return { ok: false, code: "SAT_WORKER_NOT_LIVE" };
    }
    return { ok: true, url, secret };
  } catch {
    return { ok: false, code: "SAT_WORKER_UNREACHABLE" };
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await authenticatedClient(request);
  if (!auth.ok) return auth.response;

  const { id: expedienteId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(String(expedienteId ?? ""))) {
    return NextResponse.json({ ok: false, code: "INVALID_ID" }, { status: 400 });
  }

  try {
    const { client } = auth;

    const { data: expediente, error: expedienteError } = await client
      .from("expedientes")
      .select("id, cliente_nombre, submitted_to_mesa")
      .eq("id", expedienteId)
      .is("deleted_at", null)
      .maybeSingle();

    if (expedienteError) return retry("EXPEDIENTE_READ_FAILED");
    if (!expediente) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    if (expediente.submitted_to_mesa) {
      return NextResponse.json(
        { ok: true, status: "already_sent", submitted_to_mesa: true },
        { status: 200 },
      );
    }

    const [clienteRes, editorRes, documentoRes] = await Promise.all([
      client
        .from("cliente_datos")
        .select("datos, estado")
        .eq("expediente_id", expedienteId)
        .maybeSingle(),
      client
        .from("editor_decisions")
        .select("rfc_infonavit")
        .eq("expediente_id", expedienteId)
        .maybeSingle(),
      client
        .from("expediente_documentos")
        .select("storage_path, created_at, version")
        .eq("expediente_id", expedienteId)
        .eq("tipo_documento", ESTADO_CUENTA)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (clienteRes.error || !clienteRes.data?.datos) return retry("CLIENTE_DATOS_READ_FAILED");
    if (editorRes.error) return retry("EDITOR_DECISION_READ_FAILED");
    if (documentoRes.error) return retry("ESTADO_CUENTA_READ_FAILED");
    if (!documentoRes.data?.storage_path) {
      return retry("ESTADO_CUENTA_FALTANTE", 409);
    }

    const datos = clienteRes.data.datos as Record<string, unknown>;
    const curp = String(datos.curp ?? "").trim().toUpperCase();
    const rfcDatosGenerales = String(datos.rfc ?? "").trim().toUpperCase();
    const nombreCliente =
      String(datos.nombreCliente ?? "").trim() ||
      String(expediente.cliente_nombre ?? "").trim();

    const curpLocal = validateCurpLocal({ curp });
    if (curpLocal.status !== "VALIDA_LOCALMENTE") {
      return invalid("CURP_LOCAL_INVALIDA");
    }

    const { data: pdf, error: pdfError } = await client.storage
      .from(DOCUMENT_BUCKET)
      .download(String(documentoRes.data.storage_path));

    if (pdfError || !pdf) return retry("ESTADO_CUENTA_DOWNLOAD_FAILED");

    const extracted = await extractPdfEmbeddedText(await pdf.arrayBuffer());
    if (!extracted.ok) return retry(extracted.reason, 409);

    const selection = selectEstadoCuentaRfc({
      text: extracted.text,
      rfcInfonavit: editorRes.data?.rfc_infonavit ?? null,
      rfcDatosGenerales,
      curpValidadaLocalmente: curp,
      clienteNombre: nombreCliente,
    });
    const resolution = resolveFiscalRfc({
      rfcInfonavit: editorRes.data?.rfc_infonavit ?? null,
      rfcDatosGenerales,
      estadoCuenta: selection,
    });

    if (resolution.status !== "ready_for_sat" || !resolution.fiscalRfc) {
      return retry(`RFC_NO_RESUELTO_${selection.reason.toUpperCase()}`, 409);
    }

    const worker = await requireLiveWorker();
    if (!worker.ok) return retry(worker.code);

    let workerBody: FiscalWorkerBody;
    try {
      const workerResponse = await fetch(`${worker.url}/validate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-concasa-worker-secret": worker.secret,
        },
        body: JSON.stringify({
          rfc: resolution.fiscalRfc,
          curp: curpLocal.normalized,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(150_000),
      });
      workerBody = (await workerResponse.json()) as FiscalWorkerBody;
      if (!workerResponse.ok && workerBody?.semantic !== "invalid") {
        return retry(workerBody?.code || "SAT_WORKER_FAILED");
      }
    } catch {
      return retry("SAT_WORKER_EXCEPTION");
    }

    const decision = classifyFiscalWorkerForMesa(workerBody);
    if (decision.kind === "invalid") return invalid(decision.code);
    if (decision.kind === "retry") return retry(decision.code);

    // ÚNICA escritura del flujo: solo después de PASS RFC + CURP en worker LIVE.
    const { data: sent, error: sendError } = await client.rpc("enviar_a_mesa", {
      p_expediente_id: expedienteId,
    });
    if (sendError) {
      return NextResponse.json(
        {
          ok: false,
          status: "send_failed_after_fiscal_pass",
          code: sendError.code || "ENVIAR_A_MESA_FAILED",
          message: sendError.message || null,
          details: sendError.details || null,
          submitted_to_mesa: false,
        },
        { status: 409 },
      );
    }
    if (!sent || typeof sent !== "object") return retry("ENVIAR_A_MESA_EMPTY_RESPONSE");

    return NextResponse.json({
      ok: true,
      status: "sent",
      fiscal: "pass",
      submitted_to_mesa: true,
    });
  } catch (error) {
    console.error(
      `[enviar-mesa-fiscal] fallo expediente_id=${expedienteId} user=${auth.userId}`,
      error instanceof Error ? error.message : "unknown",
    );
    return retry("UNEXPECTED_EXCEPTION");
  }
}
