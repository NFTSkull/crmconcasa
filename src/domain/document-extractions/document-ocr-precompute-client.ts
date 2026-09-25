"use client";

import { supabaseBrowser } from "@/lib/supabaseBrowser";
import type { OcrDocumentType } from "./document-ocr-client";

export type CachedDocumentOcrEntry = Readonly<{
  documentoId: string;
  documentVersion: number;
  status: "missing" | "pending" | "processing" | "done" | "failed" | string;
  text: string;
  engine: string | null;
  pages: number | null;
  durationMs: number | null;
  processedAt: string | null;
}>;

export type MesaInfonavitOcrCache = Partial<
  Record<OcrDocumentType, CachedDocumentOcrEntry>
>;

const ALLOWED_TYPES = new Set<OcrDocumentType>([
  "cliente_ine_frente",
  "cliente_ine_reverso",
  "cliente_comprobante_domicilio",
  "cliente_estado_cuenta",
]);

export function isOcrPrecomputeDocumentType(
  value: string,
): value is OcrDocumentType {
  return ALLOWED_TYPES.has(value as OcrDocumentType);
}

export async function requestDocumentOcrPrecompute(input: {
  expedienteId: string;
  documentType: OcrDocumentType;
}): Promise<void> {
  if (!supabaseBrowser) return;
  const expedienteId = input.expedienteId.trim();
  if (!expedienteId) return;

  const { error } = await supabaseBrowser.functions.invoke(
    "document-ocr-precompute",
    {
      body: {
        expedienteId,
        documentType: input.documentType,
      },
    },
  );

  if (error) {
    throw new Error("No se pudo iniciar el precalentado OCR.");
  }
}

export type FiscalRfcPrecomputeResult = Readonly<{
  status: "ready" | "pending" | "unknown";
  rfcMasked?: string;
  readSource?: "embedded_text" | "ocr_cache" | "ocr_live";
  confidence?: "high" | "medium" | "none";
  reason?: string;
}>;

export async function requestEstadoCuentaFiscalRfcPrecompute(input: {
  expedienteId: string;
}): Promise<FiscalRfcPrecomputeResult> {
  if (!supabaseBrowser) {
    return { status: "unknown", reason: "supabase_unavailable" };
  }

  const expedienteId = input.expedienteId.trim();
  if (!expedienteId) {
    return { status: "unknown", reason: "invalid_expediente" };
  }

  const {
    data: { session },
    error,
  } = await supabaseBrowser.auth.getSession();
  if (error || !session?.access_token) {
    throw new Error("Sesión expirada. Inicia sesión de nuevo.");
  }

  const response = await fetch(
    `/api/expedientes/${encodeURIComponent(expedienteId)}/fiscal-rfc-precompute`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: "no-store",
    },
  );

  const body = (await response.json().catch(() => null)) as
    | {
        ok?: boolean;
        status?: unknown;
        rfcMasked?: unknown;
        readSource?: unknown;
        confidence?: unknown;
        reason?: unknown;
        code?: unknown;
      }
    | null;

  if (!response.ok || body?.ok !== true) {
    throw new Error(
      typeof body?.code === "string"
        ? `No se pudo preparar el RFC fiscal (${body.code}).`
        : "No se pudo preparar el RFC fiscal.",
    );
  }

  const status =
    body.status === "ready" || body.status === "pending" || body.status === "unknown"
      ? body.status
      : "unknown";

  return {
    status,
    rfcMasked: typeof body.rfcMasked === "string" ? body.rfcMasked : undefined,
    readSource:
      body.readSource === "embedded_text" ||
      body.readSource === "ocr_cache" ||
      body.readSource === "ocr_live"
        ? body.readSource
        : undefined,
    confidence:
      body.confidence === "high" ||
      body.confidence === "medium" ||
      body.confidence === "none"
        ? body.confidence
        : undefined,
    reason: typeof body.reason === "string" ? body.reason : undefined,
  };
}

function parseEntry(value: unknown): CachedDocumentOcrEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const documentoId =
    typeof row.documentoId === "string" ? row.documentoId.trim() : "";
  if (!documentoId) return null;

  return {
    documentoId,
    documentVersion: Number.isFinite(Number(row.documentVersion))
      ? Number(row.documentVersion)
      : 0,
    status: typeof row.status === "string" ? row.status : "missing",
    text: typeof row.text === "string" ? row.text : "",
    engine: typeof row.engine === "string" ? row.engine : null,
    pages: Number.isFinite(Number(row.pages)) ? Number(row.pages) : null,
    durationMs: Number.isFinite(Number(row.durationMs))
      ? Number(row.durationMs)
      : null,
    processedAt:
      typeof row.processedAt === "string" ? row.processedAt : null,
  };
}

export async function getMesaInfonavitOcrCache(
  expedienteId: string,
): Promise<MesaInfonavitOcrCache> {
  if (!supabaseBrowser) return {};
  const id = expedienteId.trim();
  if (!id) return {};

  const { data, error } = await supabaseBrowser.rpc(
    "mesa_get_infonavit_ocr_cache",
    { p_expediente_id: id },
  );
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }

  const raw = data as Record<string, unknown>;
  const out: MesaInfonavitOcrCache = {};
  for (const type of ALLOWED_TYPES) {
    const parsed = parseEntry(raw[type]);
    if (parsed) out[type] = parsed;
  }
  return out;
}
