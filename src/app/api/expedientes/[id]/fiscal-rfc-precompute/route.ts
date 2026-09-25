import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { extractPdfEmbeddedText } from "@/domain/identidad-curp/pdf-extract-text";
import { validateCurpLocal } from "@/domain/identidad-curp/curp-local";
import {
  maskFiscalId,
  resolveEstadoCuentaFiscalRfc,
} from "@/domain/validacion-fiscal/rfc";

export const runtime = "nodejs";
export const maxDuration = 20;

const DOCUMENT_BUCKET = "expediente-documentos";
const ESTADO_CUENTA = "cliente_estado_cuenta";
const OCR_POLL_INTERVAL_MS = 400;
const OCR_POLL_BUDGET_MS = 8_000;

const IdSchema = z.string().uuid();

type RouteParams = { params: Promise<{ id: string }> };

type OcrCacheRow = {
  status?: string | null;
  ocr_text?: string | null;
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
  | { ok: true; client: SupabaseClient; userId: string }
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
        { ok: false, code: "SUPABASE_NOT_CONFIGURED" },
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
  return { ok: true, client, userId: data.user.id };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readOcrCache(
  admin: SupabaseClient,
  documentoId: string,
): Promise<OcrCacheRow | null> {
  const { data, error } = await admin
    .from("document_ocr_cache")
    .select("status, ocr_text")
    .eq("documento_id", documentoId)
    .maybeSingle();
  if (error || !data) return null;
  return data as OcrCacheRow;
}

async function waitForOcrCache(
  admin: SupabaseClient,
  documentoId: string,
): Promise<OcrCacheRow | null> {
  const deadline = Date.now() + OCR_POLL_BUDGET_MS;
  let latest = await readOcrCache(admin, documentoId);

  while (
    Date.now() < deadline &&
    latest?.status !== "done" &&
    latest?.status !== "failed"
  ) {
    await sleep(OCR_POLL_INTERVAL_MS);
    latest = await readOcrCache(admin, documentoId);
  }
  return latest;
}

async function persistFiscalCandidate(args: {
  admin: SupabaseClient;
  documentoId: string;
  status: "pending" | "ready" | "unknown";
  fiscalRfc?: string | null;
  reason: string;
  readSource?: "embedded_text" | "ocr_cache" | "ocr_live" | null;
  confidence?: "high" | "medium" | "none" | null;
}): Promise<boolean> {
  const payload = {
    fiscal_rfc: args.status === "ready" ? args.fiscalRfc ?? null : null,
    fiscal_rfc_status: args.status,
    fiscal_rfc_reason: args.reason.slice(0, 120),
    fiscal_rfc_read_source: args.readSource ?? null,
    fiscal_rfc_confidence: args.confidence ?? null,
    fiscal_rfc_resolved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error: updateError } = await args.admin
    .from("document_ocr_cache")
    .update(payload)
    .eq("documento_id", args.documentoId)
    .select("documento_id")
    .maybeSingle();

  if (updateError) return false;
  if (updated) return true;

  const { error: insertError } = await args.admin
    .from("document_ocr_cache")
    .insert({
      documento_id: args.documentoId,
      status: "pending",
      attempts: 0,
      ...payload,
    });

  return !insertError;
}

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await authenticatedClient(request);
  if (!auth.ok) return auth.response;

  const { id: rawId } = await params;
  const parsedId = IdSchema.safeParse(String(rawId ?? ""));
  if (!parsedId.success) {
    return NextResponse.json({ ok: false, code: "INVALID_ID" }, { status: 400 });
  }
  const expedienteId = parsedId.data;

  const admin = serviceRoleClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, code: "SERVICE_ROLE_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const { client } = auth;
  const [expedienteRes, clienteRes, editorRes, documentoRes] = await Promise.all([
    client
      .from("expedientes")
      .select("id, cliente_nombre")
      .eq("id", expedienteId)
      .is("deleted_at", null)
      .maybeSingle(),
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
      .select("id, storage_path, version, created_at")
      .eq("expediente_id", expedienteId)
      .eq("tipo_documento", ESTADO_CUENTA)
      .is("deleted_at", null)
      .order("version", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (expedienteRes.error || !expedienteRes.data) {
    return NextResponse.json({ ok: false, code: "EXPEDIENTE_READ_FAILED" }, { status: 404 });
  }
  if (clienteRes.error || !clienteRes.data?.datos) {
    return NextResponse.json({ ok: false, code: "CLIENTE_DATOS_READ_FAILED" }, { status: 409 });
  }
  if (editorRes.error) {
    return NextResponse.json({ ok: false, code: "EDITOR_DECISION_READ_FAILED" }, { status: 409 });
  }
  if (
    documentoRes.error ||
    !documentoRes.data?.id ||
    !documentoRes.data?.storage_path
  ) {
    return NextResponse.json({ ok: false, code: "ESTADO_CUENTA_FALTANTE" }, { status: 409 });
  }

  const datos = clienteRes.data.datos as Record<string, unknown>;
  const curp = String(datos.curp ?? "").trim().toUpperCase();
  const curpLocal = validateCurpLocal({ curp });
  if (curpLocal.status !== "VALIDA_LOCALMENTE") {
    return NextResponse.json(
      { ok: true, status: "unknown", code: "CURP_LOCAL_INVALIDA" },
      { status: 200 },
    );
  }

  const rfcDatosGenerales = String(datos.rfc ?? "").trim().toUpperCase();
  const rfcInfonavit = String(editorRes.data?.rfc_infonavit ?? "")
    .trim()
    .toUpperCase();
  const nombreCliente =
    String(datos.nombreCliente ?? "").trim() ||
    String(expedienteRes.data.cliente_nombre ?? "").trim();
  const documentoId = String(documentoRes.data.id);

  const { data: pdf, error: pdfError } = await client.storage
    .from(DOCUMENT_BUCKET)
    .download(String(documentoRes.data.storage_path));
  if (pdfError || !pdf) {
    return NextResponse.json(
      { ok: false, code: "ESTADO_CUENTA_DOWNLOAD_FAILED" },
      { status: 503 },
    );
  }

  const extracted = await extractPdfEmbeddedText(await pdf.arrayBuffer());

  let resolution = resolveEstadoCuentaFiscalRfc({
    embeddedText: extracted.ok ? extracted.text : "",
    ocrText: "",
    rfcInfonavit: rfcInfonavit || null,
    rfcDatosGenerales,
    curpValidadaLocalmente: curpLocal.normalized,
    clienteNombre: nombreCliente,
  });

  let cache: OcrCacheRow | null = null;
  if (resolution.status !== "ready_for_sat") {
    cache = await waitForOcrCache(admin, documentoId);
    if (cache?.status === "done" && typeof cache.ocr_text === "string") {
      resolution = resolveEstadoCuentaFiscalRfc({
        embeddedText: extracted.ok ? extracted.text : "",
        ocrText: cache.ocr_text,
        ocrReadSource: "ocr_cache",
        rfcInfonavit: rfcInfonavit || null,
        rfcDatosGenerales,
        curpValidadaLocalmente: curpLocal.normalized,
        clienteNombre: nombreCliente,
      });
    }
  }

  if (resolution.status === "ready_for_sat") {
    const persisted = await persistFiscalCandidate({
      admin,
      documentoId,
      status: "ready",
      fiscalRfc: resolution.fiscalRfc,
      reason: resolution.selectionReason,
      readSource: resolution.readSource,
      confidence: resolution.confidence,
    });
    if (!persisted) {
      return NextResponse.json(
        { ok: false, code: "FISCAL_RFC_CACHE_WRITE_FAILED" },
        { status: 503 },
      );
    }
    return NextResponse.json({
      ok: true,
      status: "ready",
      source: "estado_cuenta",
      readSource: resolution.readSource,
      confidence: resolution.confidence,
      rfcMasked: maskFiscalId(resolution.fiscalRfc),
      documentoId,
      documentVersion: Number(documentoRes.data.version ?? 0),
    });
  }

  const pending = cache?.status !== "done" && cache?.status !== "failed";
  const reason =
    resolution.ocrReason !== "no_text"
      ? resolution.ocrReason
      : resolution.embeddedReason;

  await persistFiscalCandidate({
    admin,
    documentoId,
    status: pending ? "pending" : "unknown",
    reason,
    confidence: "none",
  });

  return NextResponse.json({
    ok: true,
    status: pending ? "pending" : "unknown",
    source: "estado_cuenta",
    reason,
    documentoId,
    documentVersion: Number(documentoRes.data.version ?? 0),
  });
}
