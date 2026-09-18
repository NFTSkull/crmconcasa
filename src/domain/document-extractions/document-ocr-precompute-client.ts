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
