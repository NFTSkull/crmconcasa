import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type DocumentType =
  | "cliente_ine_frente"
  | "cliente_ine_reverso"
  | "cliente_comprobante_domicilio"
  | "cliente_estado_cuenta";

type PrepareResult = {
  ok?: boolean;
  found?: boolean;
  documentoId?: string;
  expedienteId?: string;
  documentType?: DocumentType;
  documentVersion?: number;
  storagePath?: string;
  filename?: string;
  mimeType?: string;
  cacheStatus?: string;
};

const ALLOWED = new Set<DocumentType>([
  "cliente_ine_frente",
  "cliente_ine_reverso",
  "cliente_comprobante_domicilio",
  "cliente_estado_cuenta",
]);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function envJsonKey(name: string): string | null {
  try {
    const raw = Deno.env.get(name);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed.default;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function publishableKey(): string {
  return (
    envJsonKey("SUPABASE_PUBLISHABLE_KEYS") ||
    Deno.env.get("SUPABASE_ANON_KEY") ||
    ""
  );
}

function secretKey(): string {
  return (
    envJsonKey("SUPABASE_SECRET_KEYS") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    ""
  );
}

function ocrBaseUrl(): string {
  return (
    Deno.env.get("DOCUMENT_OCR_URL") ||
    "https://concasa-document-ocr-production.up.railway.app"
  ).replace(/\/+$/, "");
}

function safeErrorCode(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  const compact = raw.toLowerCase();
  if (compact.includes("download")) return "storage_download_failed";
  if (compact.includes("401") || compact.includes("403")) return "ocr_auth_failed";
  if (compact.includes("413")) return "ocr_file_too_large";
  if (compact.includes("415")) return "ocr_unsupported_mime";
  if (compact.includes("422")) return "ocr_unreadable";
  if (compact.includes("timeout")) return "ocr_timeout";
  return "ocr_failed";
}

async function processDocument(
  meta: Required<
    Pick<
      PrepareResult,
      | "documentoId"
      | "documentType"
      | "storagePath"
      | "filename"
      | "mimeType"
    >
  >,
  authorization: string,
): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = secretKey();
  if (!url || !key) return;

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: claimed, error: claimError } = await admin
      .from("document_ocr_cache")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        processed_at: null,
        error_code: null,
        updated_at: new Date().toISOString(),
      })
      .eq("documento_id", meta.documentoId)
      .in("status", ["pending", "failed"])
      .select("documento_id")
      .maybeSingle();

    if (claimError) throw new Error("cache_claim_failed");
    if (!claimed) return;

    await admin
      .from("document_ocr_cache")
      .update({ attempts: 1 })
      .eq("documento_id", meta.documentoId)
      .eq("status", "processing");

    const { data: fileBlob, error: downloadError } = await admin.storage
      .from("expediente-documentos")
      .download(meta.storagePath);
    if (downloadError || !fileBlob) throw new Error("storage_download_failed");

    const form = new FormData();
    form.append(
      "file",
      fileBlob,
      meta.filename || `${meta.documentType}.pdf`,
    );
    form.append("document_type", meta.documentType);

    const response = await fetch(`${ocrBaseUrl()}/v1/extract`, {
      method: "POST",
      headers: { Authorization: authorization },
      body: form,
    });

    const body = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          text?: unknown;
          engine?: unknown;
          pages?: unknown;
          durationMs?: unknown;
          detail?: unknown;
        }
      | null;

    if (!response.ok || body?.ok !== true) {
      throw new Error(
        typeof body?.detail === "string"
          ? `ocr_${response.status}_${body.detail}`
          : `ocr_${response.status}`,
      );
    }

    const text = typeof body.text === "string" ? body.text.slice(0, 30000) : "";
    const engine = typeof body.engine === "string" ? body.engine.slice(0, 80) : null;
    const pages = Number.isFinite(Number(body.pages)) ? Number(body.pages) : null;
    const durationMs = Number.isFinite(Number(body.durationMs))
      ? Math.max(0, Math.round(Number(body.durationMs)))
      : null;

    const { error: completeError } = await admin
      .from("document_ocr_cache")
      .update({
        status: "done",
        engine,
        pages,
        duration_ms: durationMs,
        ocr_text: text,
        error_code: null,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("documento_id", meta.documentoId)
      .eq("status", "processing");

    if (completeError) throw new Error("cache_complete_failed");
  } catch (error) {
    await admin
      .from("document_ocr_cache")
      .update({
        status: "failed",
        error_code: safeErrorCode(error),
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("documento_id", meta.documentoId)
      .eq("status", "processing");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return json({ ok: false, error: "auth_required" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const publicKey = publishableKey();
  if (!url || !publicKey) {
    return json({ ok: false, error: "supabase_unconfigured" }, 503);
  }

  const body = (await req.json().catch(() => null)) as
    | { expedienteId?: unknown; documentType?: unknown }
    | null;
  const expedienteId =
    typeof body?.expedienteId === "string" ? body.expedienteId.trim() : "";
  const documentType =
    typeof body?.documentType === "string"
      ? (body.documentType.trim() as DocumentType)
      : ("" as DocumentType);

  if (!expedienteId || !ALLOWED.has(documentType)) {
    return json({ ok: false, error: "invalid_args" }, 400);
  }

  const user = createClient(url, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await user.rpc("document_ocr_prepare_current", {
    p_expediente_id: expedienteId,
    p_document_type: documentType,
  });

  if (error) {
    return json({ ok: false, error: "prepare_denied" }, 403);
  }

  const meta = (data ?? {}) as PrepareResult;
  if (meta.found !== true) {
    return json({ ok: true, queued: false, reason: "document_not_found" });
  }
  if (meta.cacheStatus === "done") {
    return json({
      ok: true,
      queued: false,
      cached: true,
      documentoId: meta.documentoId ?? null,
    });
  }
  if (meta.cacheStatus === "processing") {
    return json({
      ok: true,
      queued: false,
      processing: true,
      documentoId: meta.documentoId ?? null,
    });
  }

  if (
    !meta.documentoId ||
    !meta.documentType ||
    !meta.storagePath ||
    !meta.filename ||
    !meta.mimeType
  ) {
    return json({ ok: false, error: "invalid_prepare_result" }, 500);
  }

  EdgeRuntime.waitUntil(
    processDocument(
      {
        documentoId: meta.documentoId,
        documentType: meta.documentType,
        storagePath: meta.storagePath,
        filename: meta.filename,
        mimeType: meta.mimeType,
      },
      authorization,
    ),
  );

  return json(
    {
      ok: true,
      queued: true,
      documentoId: meta.documentoId,
      documentType: meta.documentType,
    },
    202,
  );
});
