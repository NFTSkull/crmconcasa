import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

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

const IdSchema = z.string().uuid();

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

function serviceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

function revisionManual(code: string, status = 503): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      status: "revision_manual",
      code,
      submitted_to_mesa: false,
      cta: "reintentar_validacion",
    },
    { status },
  );
}

function invalid(code: string): NextResponse {
  return NextResponse.json(
    { ok: false, status: "invalid", code, submitted_to_mesa: false },
    { status: 422 },
  );
}

async function registerRevisionManual(args: {
  expedienteId: string;
  fiscalRfc: string;
  edcDocumentoId: string;
  edcVersion: number;
  code: string;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const admin = serviceRoleClient();
  if (!admin) return { ok: false, code: "SERVICE_ROLE_NOT_CONFIGURED" };
  const { error } = await admin.rpc("server_registrar_validacion_fiscal_sat", {
    p_expediente_id: args.expedienteId,
    p_estado: "RFC_VALIDACION_SAT_REVISION_MANUAL",
    p_resultado_resumido: {
      source: "sat_worker",
      code: args.code,
      semantic: "retry",
    },
    p_fiscal_rfc: args.fiscalRfc,
    p_edc_documento_id: args.edcDocumentoId,
    p_edc_version: args.edcVersion,
  });
  if (error) {
    return { ok: false, code: error.code || "FISCAL_REVISION_REGISTER_FAILED" };
  }
  return { ok: true };
}

async function failWithRevisionManual(args: {
  expedienteId: string;
  fiscalRfc: string;
  edcDocumentoId: string;
  edcVersion: number;
  code: string;
  httpStatus?: number;
}): Promise<NextResponse> {
  const registered = await registerRevisionManual(args);
  if (!registered.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: "retry",
        code: registered.code,
        submitted_to_mesa: false,
      },
      { status: 503 },
    );
  }
  return revisionManual(args.code, args.httpStatus ?? 503);
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

/**
 * Fail-open SOLO si la mig. 228 no está aplicada (RPC gate ausente).
 * Postgres `42883` / PostgREST `PGRST202`. Cualquier otro error → fail-closed.
 */
export function isMissingFiscalGateRpcError(
  error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const code = String(error.code ?? "").trim().toUpperCase();
  if (code === "42883" || code === "PGRST202") return true;

  const blob = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  // Defensa extra: algunos clientes omiten code pero dejan el mensaje canónico.
  if (
    blob.includes("fiscal_sat_gate_applies_to_expediente") &&
    (blob.includes("does not exist") ||
      blob.includes("could not find the function") ||
      blob.includes("schema cache"))
  ) {
    return true;
  }
  return false;
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

async function callEnviarAMesa(
  client: SupabaseClient,
  expedienteId: string,
): Promise<NextResponse> {
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
    fiscal: "pass_or_skipped",
    submitted_to_mesa: true,
  });
}

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await authenticatedClient(request);
  if (!auth.ok) return auth.response;

  const { id: rawId } = await params;
  const idParsed = IdSchema.safeParse(String(rawId ?? ""));
  if (!idParsed.success) {
    return NextResponse.json({ ok: false, code: "INVALID_ID" }, { status: 400 });
  }
  const expedienteId = idParsed.data;

  try {
    const { client } = auth;

    const { data: expediente, error: expedienteError } = await client
      .from("expedientes")
      .select("id, cliente_nombre, submitted_to_mesa, asesor_id")
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

    // Gate: solo worker SAT si flag global O asesor dueño en piloto.
    // Orden de deploy: CRM puede llegar antes que mig 228 → fail-open solo si RPC ausente.
    const { data: gateApplies, error: gateError } = await client.rpc(
      "fiscal_sat_gate_applies_to_expediente",
      { p_expediente_id: expedienteId },
    );
    if (gateError) {
      if (isMissingFiscalGateRpcError(gateError)) {
        console.warn(
          "[enviar-mesa-fiscal] mig 228 ausente (fiscal_sat_gate_applies_to_expediente); fallback enviar_a_mesa",
          { code: gateError.code, message: gateError.message, expedienteId },
        );
        return callEnviarAMesa(client, expedienteId);
      }
      return retry("FISCAL_GATE_CHECK_FAILED");
    }

    if (!gateApplies) {
      return callEnviarAMesa(client, expedienteId);
    }

    // Ya hay VALIDADO/APROBADO_ADMIN con binding vigente → no gastar CapSolver.
    const { data: alreadyOk, error: allowsError } = await client.rpc(
      "fiscal_sat_gate_allows_envio",
      { p_expediente_id: expedienteId },
    );
    if (allowsError) {
      // Si applies existió, allows debería existir; cualquier error aquí es fail-closed.
      return retry("FISCAL_ALLOWS_CHECK_FAILED");
    }
    if (alreadyOk) {
      return callEnviarAMesa(client, expedienteId);
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
        .select("id, storage_path, created_at, version")
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
    if (!documentoRes.data?.storage_path || !documentoRes.data?.id) {
      return retry("ESTADO_CUENTA_FALTANTE", 409);
    }

    const datos = clienteRes.data.datos as Record<string, unknown>;
    const curp = String(datos.curp ?? "").trim().toUpperCase();
    const rfcDatosGenerales = String(datos.rfc ?? "").trim().toUpperCase();
    const rfcInfonavit = String(editorRes.data?.rfc_infonavit ?? "")
      .trim()
      .toUpperCase();
    const estadoCuentaStoragePath = String(documentoRes.data.storage_path);
    const edcDocumentoId = String(documentoRes.data.id);
    const edcVersion = Number(documentoRes.data.version ?? 0);
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
      rfcInfonavit: rfcInfonavit || null,
      rfcDatosGenerales,
      curpValidadaLocalmente: curp,
      clienteNombre: nombreCliente,
    });
    const resolution = resolveFiscalRfc({
      rfcInfonavit: rfcInfonavit || null,
      rfcDatosGenerales,
      estadoCuenta: selection,
    });

    if (resolution.status !== "ready_for_sat" || !resolution.fiscalRfc) {
      return retry(`RFC_NO_RESUELTO_${selection.reason.toUpperCase()}`, 409);
    }

    const worker = await requireLiveWorker();
    if (!worker.ok) {
      return failWithRevisionManual({
        expedienteId,
        fiscalRfc: resolution.fiscalRfc,
        edcDocumentoId,
        edcVersion,
        code: worker.code,
      });
    }

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
        return failWithRevisionManual({
          expedienteId,
          fiscalRfc: resolution.fiscalRfc,
          edcDocumentoId,
          edcVersion,
          code: workerBody?.code || "SAT_WORKER_FAILED",
        });
      }
    } catch {
      return failWithRevisionManual({
        expedienteId,
        fiscalRfc: resolution.fiscalRfc,
        edcDocumentoId,
        edcVersion,
        code: "SAT_WORKER_EXCEPTION",
      });
    }

    const decision = classifyFiscalWorkerForMesa(workerBody);
    if (decision.kind === "invalid") {
      const admin = serviceRoleClient();
      if (admin) {
        await admin.rpc("server_registrar_validacion_fiscal_sat", {
          p_expediente_id: expedienteId,
          p_estado: "RFC_VALIDACION_SAT_INVALIDO",
          p_resultado_resumido: { code: decision.code, source: "sat_worker" },
          p_fiscal_rfc: resolution.fiscalRfc,
          p_edc_documento_id: edcDocumentoId,
          p_edc_version: edcVersion,
        });
      }
      return invalid(decision.code);
    }
    if (decision.kind === "retry") {
      return failWithRevisionManual({
        expedienteId,
        fiscalRfc: resolution.fiscalRfc,
        edcDocumentoId,
        edcVersion,
        code: decision.code,
      });
    }

    // TOCTOU guard: el PASS solo sirve para los mismos insumos que se validaron.
    const [currentClienteRes, currentEditorRes, currentDocumentoRes] = await Promise.all([
      client
        .from("cliente_datos")
        .select("datos")
        .eq("expediente_id", expedienteId)
        .maybeSingle(),
      client
        .from("editor_decisions")
        .select("rfc_infonavit")
        .eq("expediente_id", expedienteId)
        .maybeSingle(),
      client
        .from("expediente_documentos")
        .select("id, storage_path, created_at, version")
        .eq("expediente_id", expedienteId)
        .eq("tipo_documento", ESTADO_CUENTA)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (
      currentClienteRes.error ||
      currentEditorRes.error ||
      currentDocumentoRes.error ||
      !currentClienteRes.data?.datos ||
      !currentDocumentoRes.data?.storage_path ||
      !currentDocumentoRes.data?.id
    ) {
      return retry("FISCAL_INPUT_RECHECK_FAILED");
    }

    const currentDatos = currentClienteRes.data.datos as Record<string, unknown>;
    const currentCurp = String(currentDatos.curp ?? "").trim().toUpperCase();
    const currentRfcDatos = String(currentDatos.rfc ?? "").trim().toUpperCase();
    const currentRfcInfonavit = String(currentEditorRes.data?.rfc_infonavit ?? "")
      .trim()
      .toUpperCase();
    const currentNombre =
      String(currentDatos.nombreCliente ?? "").trim() ||
      String(expediente.cliente_nombre ?? "").trim();
    const currentEstadoCuentaPath = String(currentDocumentoRes.data.storage_path);
    const currentEdcId = String(currentDocumentoRes.data.id);
    const currentEdcVersion = Number(currentDocumentoRes.data.version ?? 0);

    if (
      currentCurp !== curpLocal.normalized ||
      currentRfcDatos !== rfcDatosGenerales ||
      currentRfcInfonavit !== rfcInfonavit ||
      currentNombre !== nombreCliente ||
      currentEstadoCuentaPath !== estadoCuentaStoragePath ||
      currentEdcId !== edcDocumentoId ||
      currentEdcVersion !== edcVersion
    ) {
      return retry("FISCAL_INPUT_CHANGED", 409);
    }

    const admin = serviceRoleClient();
    if (!admin) return retry("SERVICE_ROLE_NOT_CONFIGURED");

    const { error: regError } = await admin.rpc("server_registrar_validacion_fiscal_sat", {
      p_expediente_id: expedienteId,
      p_estado: "RFC_VALIDACION_SAT_VALIDADO",
      p_resultado_resumido: { source: "sat_worker", semantic: "pass" },
      p_fiscal_rfc: resolution.fiscalRfc,
      p_edc_documento_id: edcDocumentoId,
      p_edc_version: edcVersion,
    });
    if (regError) {
      return retry(regError.code || "FISCAL_REGISTER_FAILED", 409);
    }

    return callEnviarAMesa(client, expedienteId);
  } catch (error) {
    console.error(
      `[enviar-mesa-fiscal] fallo expediente_id=${expedienteId} user=${auth.userId}`,
      error instanceof Error ? error.message : "unknown",
    );
    return retry("UNEXPECTED_EXCEPTION");
  }
}
