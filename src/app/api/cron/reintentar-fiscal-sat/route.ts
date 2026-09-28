import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { validateCurpLocal } from "@/domain/identidad-curp/curp-local";
import {
  buildValidadoResumen,
  curpRfcBase10,
  normalizeRfc,
  rfcShape,
} from "@/domain/validacion-fiscal/rfc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ESTADO_CUENTA = "cliente_estado_cuenta";
const FIRST_RETRY_COOLDOWN_MS = 2 * 60 * 1000;
const AUTO_RETRY_COOLDOWN_MS = 15 * 60 * 1000;
const SAT_WORKER_TIMEOUT_MS = 50_000;

const TECHNICAL_RETRY_CODES = new Set([
  "TECHNICAL_FAILURE",
  "SAT_WORKER_EXCEPTION",
  "SAT_WORKER_HEALTH_FAILED",
  "SAT_WORKER_UNREACHABLE",
  "SAT_WORKER_FAILED",
  "SAT_WORKER_NOT_LIVE",
  "SAT_WORKER_NOT_CONFIGURED",
  "SAT_RESULTADO_NO_CONCLUYENTE",
  "FISCAL_BUDGET_EXCEEDED",
  "FISCAL_BUDGET_EXCEEDED_FOR_CORROBORATED_BACKUP",
  "AUTO_RETRY_IN_PROGRESS",
]);

type WorkerBody = {
  ok?: boolean;
  semantic?: "pass" | "invalid" | "retry";
  code?: string;
  rfc?: { status?: "valid" | "invalid" | "unknown" };
  curp?: { status?: "valid" | "invalid" | "unknown" | "not_run" };
};

type FiscalSource =
  | {
      rfc: string;
      source: "estado_cuenta";
      edcReadSource?: "embedded_text" | "ocr_cache" | "ocr_live";
    }
  | {
      rfc: string;
      source: "respaldo_capturado";
      backupField: "rfc_infonavit" | "rfc_datos_generales";
      backupReason: string;
    };

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("SUPABASE_URL/SERVICE_ROLE no configurados");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const direct = request.headers.get("x-cron-secret")?.trim() ?? "";
  if (direct && direct === secret) return true;

  const auth = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return Boolean(match?.[1]?.trim()) && match?.[1]?.trim() === secret;
}

export function isTechnicalRetryCode(value: unknown): boolean {
  const code = String(value ?? "").trim().toUpperCase();
  if (TECHNICAL_RETRY_CODES.has(code)) return true;

  // Errores HTTP transitorios del worker/SAT también deben volver a la cola.
  // Nunca incluye 4xx semánticos de RFC/CURP inválido.
  return code === "408" || code === "429" || /^5\d\d$/.test(code);
}

export function fiscalRetryCooldownMs(
  resultado: Record<string, unknown> | null | undefined,
): number {
  const autoRetry = resultado?.auto_retry === true || resultado?.auto_retry === "true";
  return autoRetry ? AUTO_RETRY_COOLDOWN_MS : FIRST_RETRY_COOLDOWN_MS;
}

export function fiscalRetryReady(
  createdAt: string,
  resultado: Record<string, unknown> | null | undefined,
  nowMs = Date.now(),
): boolean {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return false;
  return nowMs - createdMs >= fiscalRetryCooldownMs(resultado);
}

async function requireLiveWorker(): Promise<
  | { ok: true; url: string; secret: string }
  | { ok: false; code: string }
> {
  const url = process.env.SAT_VALIDATOR_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.SAT_VALIDATOR_SECRET?.trim();
  if (!url || !secret) return { ok: false, code: "SAT_WORKER_NOT_CONFIGURED" };

  try {
    const response = await fetch(`${url}/health`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, code: "SAT_WORKER_HEALTH_FAILED" };
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; mode?: string }
      | null;
    if (body?.ok !== true || body.mode !== "live") {
      return { ok: false, code: "SAT_WORKER_NOT_LIVE" };
    }
    return { ok: true, url, secret };
  } catch {
    return { ok: false, code: "SAT_WORKER_UNREACHABLE" };
  }
}

async function callSatWorker(args: {
  url: string;
  secret: string;
  rfc: string;
  curp: string;
}): Promise<
  | { kind: "body"; httpOk: boolean; body: WorkerBody }
  | { kind: "exception"; code: string }
> {
  try {
    const response = await fetch(`${args.url}/validate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-concasa-worker-secret": args.secret,
      },
      body: JSON.stringify({ rfc: args.rfc, curp: args.curp }),
      cache: "no-store",
      signal: AbortSignal.timeout(SAT_WORKER_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as WorkerBody;
    return { kind: "body", httpOk: response.ok, body };
  } catch {
    return { kind: "exception", code: "SAT_WORKER_EXCEPTION" };
  }
}

function classifyWorker(body: WorkerBody):
  | { kind: "pass" }
  | { kind: "invalid"; code: string }
  | { kind: "retry"; code: string } {
  if (
    body.semantic === "pass" &&
    body.rfc?.status === "valid" &&
    body.curp?.status === "valid"
  ) {
    return { kind: "pass" };
  }

  if (body.semantic === "invalid") {
    if (body.rfc?.status === "invalid") {
      return { kind: "invalid", code: "RFC_INVALIDO_SAT" };
    }
    if (body.curp?.status === "invalid") {
      return { kind: "invalid", code: "CURP_INVALIDA_SAT" };
    }
    return { kind: "invalid", code: "IDENTIDAD_FISCAL_INVALIDA_SAT" };
  }

  return {
    kind: "retry",
    code: body.code || "SAT_RESULTADO_NO_CONCLUYENTE",
  };
}

async function registerFiscal(args: {
  admin: SupabaseClient;
  expedienteId: string;
  estado:
    | "RFC_VALIDACION_SAT_REVISION_MANUAL"
    | "RFC_VALIDACION_SAT_VALIDADO"
    | "RFC_VALIDACION_SAT_INVALIDO";
  resultado: Record<string, unknown>;
  fiscalRfc: string;
  edcId: string;
  edcVersion: number;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const { error } = await args.admin.rpc("server_registrar_validacion_fiscal_sat", {
    p_expediente_id: args.expedienteId,
    p_estado: args.estado,
    p_resultado_resumido: args.resultado,
    p_fiscal_rfc: args.fiscalRfc,
    p_edc_documento_id: args.edcId,
    p_edc_version: args.edcVersion,
  });

  if (error) return { ok: false, code: error.code || "FISCAL_REGISTER_FAILED" };
  return { ok: true };
}

async function sendToMesa(args: {
  admin: SupabaseClient;
  expedienteId: string;
  asesorId: string;
}): Promise<{ ok: true } | { ok: false; code: string; message?: string }> {
  const { data, error } = await args.admin.rpc("enviar_a_mesa_core", {
    p_expediente_id: args.expedienteId,
    p_actor_id: args.asesorId,
    p_actor_role: "asesor",
  });

  if (error) {
    return {
      ok: false,
      code: error.code || "ENVIAR_A_MESA_FAILED",
      message: error.message || undefined,
    };
  }

  if (!data || typeof data !== "object") {
    return { ok: false, code: "ENVIAR_A_MESA_EMPTY_RESPONSE" };
  }

  return { ok: true };
}

function resolveFiscalSource(args: {
  curp: string;
  rfcDatos: string;
  rfcInfonavit: string;
  ocr:
    | {
        status?: string | null;
        fiscal_rfc?: string | null;
        fiscal_rfc_status?: string | null;
        fiscal_rfc_reason?: string | null;
        fiscal_rfc_read_source?: string | null;
      }
    | null;
}): FiscalSource | null {
  const curpBase = curpRfcBase10(args.curp);
  if (!curpBase) return null;

  const ocrRfc = normalizeRfc(args.ocr?.fiscal_rfc);
  if (
    args.ocr?.status === "done" &&
    args.ocr?.fiscal_rfc_status === "ready" &&
    rfcShape(ocrRfc) === "full13" &&
    ocrRfc.slice(0, 10) === curpBase
  ) {
    const readSource =
      args.ocr?.fiscal_rfc_read_source === "embedded_text" ||
      args.ocr?.fiscal_rfc_read_source === "ocr_live"
        ? args.ocr.fiscal_rfc_read_source
        : "ocr_cache";
    return {
      rfc: ocrRfc,
      source: "estado_cuenta",
      edcReadSource: readSource,
    };
  }

  const datos = normalizeRfc(args.rfcDatos);
  const infonavit = normalizeRfc(args.rfcInfonavit);
  if (
    rfcShape(datos) === "full13" &&
    rfcShape(infonavit) === "full13" &&
    datos === infonavit &&
    datos.slice(0, 10) === curpBase
  ) {
    return {
      rfc: datos,
      source: "respaldo_capturado",
      backupField: "rfc_infonavit",
      backupReason: `pdf_${String(
        args.ocr?.fiscal_rfc_reason || "estado_cuenta_unknown",
      )}`,
    };
  }

  return null;
}

async function inputsStillMatch(args: {
  admin: SupabaseClient;
  expedienteId: string;
  curp: string;
  rfcDatos: string;
  rfcInfonavit: string;
  edcId: string;
  edcVersion: number;
}): Promise<boolean> {
  const [clienteRes, editorRes, documentoRes] = await Promise.all([
    args.admin
      .from("cliente_datos")
      .select("datos")
      .eq("expediente_id", args.expedienteId)
      .maybeSingle(),
    args.admin
      .from("editor_decisions")
      .select("rfc_infonavit")
      .eq("expediente_id", args.expedienteId)
      .maybeSingle(),
    args.admin
      .from("expediente_documentos")
      .select("id, version")
      .eq("expediente_id", args.expedienteId)
      .eq("tipo_documento", ESTADO_CUENTA)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("version", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (
    clienteRes.error ||
    editorRes.error ||
    documentoRes.error ||
    !clienteRes.data?.datos ||
    !documentoRes.data?.id
  ) {
    return false;
  }

  const datos = clienteRes.data.datos as Record<string, unknown>;
  return (
    String(datos.curp ?? "").trim().toUpperCase() === args.curp &&
    String(datos.rfc ?? "").trim().toUpperCase() === args.rfcDatos &&
    String(editorRes.data?.rfc_infonavit ?? "").trim().toUpperCase() ===
      args.rfcInfonavit &&
    String(documentoRes.data.id) === args.edcId &&
    Number(documentoRes.data.version ?? 0) === args.edcVersion
  );
}

async function processExpediente(
  admin: SupabaseClient,
  expedienteId: string,
): Promise<Record<string, unknown>> {
  const { data: expediente, error: expedienteError } = await admin
    .from("expedientes")
    .select("id, cliente_nombre, asesor_id, ciclo_estado, submitted_to_mesa")
    .eq("id", expedienteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (expedienteError || !expediente) {
    return { expediente_id: expedienteId, ok: false, status: "read_failed" };
  }
  if (expediente.submitted_to_mesa) {
    return { expediente_id: expedienteId, ok: true, status: "already_sent" };
  }
  if (expediente.ciclo_estado !== "activo" || !expediente.asesor_id) {
    return { expediente_id: expedienteId, ok: false, status: "not_active" };
  }

  const { data: asesor, error: asesorError } = await admin
    .from("profiles")
    .select("id, app_role, active")
    .eq("id", expediente.asesor_id)
    .maybeSingle();
  if (
    asesorError ||
    !asesor ||
    asesor.active !== true ||
    asesor.app_role !== "asesor"
  ) {
    return { expediente_id: expedienteId, ok: false, status: "asesor_not_active" };
  }

  const { data: gateApplies, error: gateError } = await admin.rpc(
    "fiscal_sat_gate_applies_to_expediente",
    { p_expediente_id: expedienteId },
  );
  if (gateError || gateApplies !== true) {
    return {
      expediente_id: expedienteId,
      ok: false,
      status: gateError ? "gate_check_failed" : "gate_not_applies",
    };
  }

  const { data: alreadyAllowed, error: allowsError } = await admin.rpc(
    "fiscal_sat_gate_allows_envio",
    { p_expediente_id: expedienteId },
  );
  if (allowsError) {
    return { expediente_id: expedienteId, ok: false, status: "allows_check_failed" };
  }
  if (alreadyAllowed === true) {
    const sent = await sendToMesa({
      admin,
      expedienteId,
      asesorId: String(expediente.asesor_id),
    });
    return {
      expediente_id: expedienteId,
      ok: sent.ok,
      status: sent.ok ? "sent_existing_validation" : "send_failed",
      code: sent.ok ? undefined : sent.code,
    };
  }

  const [clienteRes, editorRes, documentoRes] = await Promise.all([
    admin
      .from("cliente_datos")
      .select("datos, estado")
      .eq("expediente_id", expedienteId)
      .maybeSingle(),
    admin
      .from("editor_decisions")
      .select("rfc_infonavit")
      .eq("expediente_id", expedienteId)
      .maybeSingle(),
    admin
      .from("expediente_documentos")
      .select("id, version, created_at")
      .eq("expediente_id", expedienteId)
      .eq("tipo_documento", ESTADO_CUENTA)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("version", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (
    clienteRes.error ||
    editorRes.error ||
    documentoRes.error ||
    !clienteRes.data?.datos ||
    !documentoRes.data?.id
  ) {
    return { expediente_id: expedienteId, ok: false, status: "inputs_incomplete" };
  }

  const datos = clienteRes.data.datos as Record<string, unknown>;
  const curp = String(datos.curp ?? "").trim().toUpperCase();
  const rfcDatos = String(datos.rfc ?? "").trim().toUpperCase();
  const rfcInfonavit = String(editorRes.data?.rfc_infonavit ?? "")
    .trim()
    .toUpperCase();
  const edcId = String(documentoRes.data.id);
  const edcVersion = Number(documentoRes.data.version ?? 0);

  const curpLocal = validateCurpLocal({ curp });
  if (curpLocal.status !== "VALIDA_LOCALMENTE") {
    return { expediente_id: expedienteId, ok: false, status: "curp_local_invalid" };
  }

  const { data: ocr, error: ocrError } = await admin
    .from("document_ocr_cache")
    .select(
      "status, fiscal_rfc, fiscal_rfc_status, fiscal_rfc_reason, fiscal_rfc_read_source",
    )
    .eq("documento_id", edcId)
    .maybeSingle();

  if (ocrError) {
    return { expediente_id: expedienteId, ok: false, status: "ocr_read_failed" };
  }

  const fiscal = resolveFiscalSource({
    curp: curpLocal.normalized,
    rfcDatos,
    rfcInfonavit,
    ocr,
  });
  if (!fiscal) {
    return {
      expediente_id: expedienteId,
      ok: false,
      status: "fiscal_source_unresolved",
    };
  }

  // Lease lógico: el registro vigente cambia a IN_PROGRESS. Otro cron no lo
  // volverá a tomar hasta que venza el cooldown.
  const leased = await registerFiscal({
    admin,
    expedienteId,
    estado: "RFC_VALIDACION_SAT_REVISION_MANUAL",
    resultado: {
      source: "sat_worker",
      semantic: "retry",
      code: "AUTO_RETRY_IN_PROGRESS",
      auto_retry: true,
    },
    fiscalRfc: fiscal.rfc,
    edcId,
    edcVersion,
  });
  if (!leased.ok) {
    return {
      expediente_id: expedienteId,
      ok: false,
      status: "lease_failed",
      code: leased.code,
    };
  }

  const worker = await requireLiveWorker();
  if (!worker.ok) {
    await registerFiscal({
      admin,
      expedienteId,
      estado: "RFC_VALIDACION_SAT_REVISION_MANUAL",
      resultado: {
        source: "sat_worker",
        semantic: "retry",
        code: worker.code,
        auto_retry: true,
      },
      fiscalRfc: fiscal.rfc,
      edcId,
      edcVersion,
    });
    return {
      expediente_id: expedienteId,
      ok: false,
      status: "retry",
      code: worker.code,
    };
  }

  const sat = await callSatWorker({
    url: worker.url,
    secret: worker.secret,
    rfc: fiscal.rfc,
    curp: curpLocal.normalized,
  });

  if (sat.kind === "exception") {
    await registerFiscal({
      admin,
      expedienteId,
      estado: "RFC_VALIDACION_SAT_REVISION_MANUAL",
      resultado: {
        source: "sat_worker",
        semantic: "retry",
        code: sat.code,
        auto_retry: true,
      },
      fiscalRfc: fiscal.rfc,
      edcId,
      edcVersion,
    });
    return {
      expediente_id: expedienteId,
      ok: false,
      status: "retry",
      code: sat.code,
    };
  }

  if (!sat.httpOk && sat.body.semantic !== "invalid") {
    const code = sat.body.code || "SAT_WORKER_FAILED";
    await registerFiscal({
      admin,
      expedienteId,
      estado: "RFC_VALIDACION_SAT_REVISION_MANUAL",
      resultado: {
        source: "sat_worker",
        semantic: "retry",
        code,
        auto_retry: true,
      },
      fiscalRfc: fiscal.rfc,
      edcId,
      edcVersion,
    });
    return { expediente_id: expedienteId, ok: false, status: "retry", code };
  }

  const decision = classifyWorker(sat.body);

  if (decision.kind === "retry") {
    await registerFiscal({
      admin,
      expedienteId,
      estado: "RFC_VALIDACION_SAT_REVISION_MANUAL",
      resultado: {
        source: "sat_worker",
        semantic: "retry",
        code: decision.code,
        auto_retry: true,
      },
      fiscalRfc: fiscal.rfc,
      edcId,
      edcVersion,
    });
    return {
      expediente_id: expedienteId,
      ok: false,
      status: "retry",
      code: decision.code,
    };
  }

  if (decision.kind === "invalid") {
    const registered = await registerFiscal({
      admin,
      expedienteId,
      estado: "RFC_VALIDACION_SAT_INVALIDO",
      resultado: {
        source: "sat_worker",
        semantic: "invalid",
        code: decision.code,
        rfc_source: fiscal.source,
        auto_retry: true,
      },
      fiscalRfc: fiscal.rfc,
      edcId,
      edcVersion,
    });
    return {
      expediente_id: expedienteId,
      ok: false,
      status: registered.ok ? "invalid" : "invalid_register_failed",
      code: registered.ok ? decision.code : registered.code,
    };
  }

  const stable = await inputsStillMatch({
    admin,
    expedienteId,
    curp: curpLocal.normalized,
    rfcDatos,
    rfcInfonavit,
    edcId,
    edcVersion,
  });
  if (!stable) {
    return {
      expediente_id: expedienteId,
      ok: false,
      status: "inputs_changed_after_sat",
    };
  }

  const resumen =
    fiscal.source === "estado_cuenta"
      ? buildValidadoResumen({
          fiscalRfc: fiscal.rfc,
          rfcSource: "estado_cuenta",
          edcReadSource: fiscal.edcReadSource,
        })
      : buildValidadoResumen({
          fiscalRfc: fiscal.rfc,
          rfcSource: "respaldo_capturado",
          backupReason: fiscal.backupReason,
          backupField: fiscal.backupField,
          pdfRfc: null,
        });

  const registered = await registerFiscal({
    admin,
    expedienteId,
    estado: "RFC_VALIDACION_SAT_VALIDADO",
    resultado: { ...resumen, auto_retry: true },
    fiscalRfc: fiscal.rfc,
    edcId,
    edcVersion,
  });
  if (!registered.ok) {
    return {
      expediente_id: expedienteId,
      ok: false,
      status: "valid_register_failed",
      code: registered.code,
    };
  }

  const sent = await sendToMesa({
    admin,
    expedienteId,
    asesorId: String(expediente.asesor_id),
  });
  return {
    expediente_id: expedienteId,
    ok: sent.ok,
    status: sent.ok ? "sent" : "send_failed_after_sat_pass",
    code: sent.ok ? undefined : sent.code,
  };
}

async function handle(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = serviceClient();
  const cutoff = new Date(Date.now() - FIRST_RETRY_COOLDOWN_MS).toISOString();

  const pageSize = 100;
  let candidate:
    | {
        expediente_id: string;
        created_at: string;
        resultado_resumido: Record<string, unknown> | null;
      }
    | undefined;

  // Hay validaciones históricas vigentes de expedientes que ya entraron a Mesa.
  // Se filtran ANTES de elegir candidato para que nunca consuman el único slot
  // de reintento de la corrida.
  for (let from = 0; from < 1000 && !candidate; from += pageSize) {
    const { data: rows, error } = await admin
      .from("cliente_validaciones_identidad")
      .select("expediente_id, created_at, resultado_resumido")
      .eq("tipo", "rfc_validacion_sat")
      .eq("vigente", true)
      .eq("estado", "RFC_VALIDACION_SAT_REVISION_MANUAL")
      .lte("created_at", cutoff)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("[cron/reintentar-fiscal-sat] candidate query", error.message);
      return NextResponse.json(
        { ok: false, error: "candidate_query_failed" },
        { status: 500 },
      );
    }

    const technicalRows = (rows ?? []).filter((row) => {
      const resumen = (row.resultado_resumido ?? {}) as Record<string, unknown>;
      return (
        isTechnicalRetryCode(resumen.code) &&
        fiscalRetryReady(String(row.created_at), resumen)
      );
    });

    const ids = [
      ...new Set(
        technicalRows
          .map((row) => String(row.expediente_id ?? "").trim())
          .filter(Boolean),
      ),
    ];

    if (ids.length > 0) {
      const { data: pendingRows, error: pendingError } = await admin
        .from("expedientes")
        .select("id")
        .in("id", ids)
        .eq("submitted_to_mesa", false)
        .eq("ciclo_estado", "activo")
        .is("deleted_at", null);

      if (pendingError) {
        console.error(
          "[cron/reintentar-fiscal-sat] pending expedientes query",
          pendingError.message,
        );
        return NextResponse.json(
          { ok: false, error: "pending_expedientes_query_failed" },
          { status: 500 },
        );
      }

      const pendingIds = new Set(
        (pendingRows ?? []).map((row) => String(row.id)),
      );
      candidate = technicalRows.find((row) =>
        pendingIds.has(String(row.expediente_id)),
      ) as typeof candidate;
    }

    if ((rows ?? []).length < pageSize) break;
  }

  if (!candidate?.expediente_id) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      candidates: 0,
      results: [],
    });
  }

  const result = await processExpediente(admin, String(candidate.expediente_id));
  console.log("[cron/reintentar-fiscal-sat]", {
    expediente_id: candidate.expediente_id,
    status: result.status,
    code: result.code ?? null,
  });

  return NextResponse.json({
    ok: result.ok === true,
    processed: 1,
    candidates: 1,
    results: [result],
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
