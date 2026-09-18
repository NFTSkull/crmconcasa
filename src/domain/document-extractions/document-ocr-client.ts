"use client";

import { supabaseBrowser } from "@/lib/supabaseBrowser";

export type OcrDocumentType =
  | "cliente_ine_frente"
  | "cliente_ine_reverso"
  | "cliente_comprobante_domicilio"
  | "cliente_estado_cuenta";

export type DocumentOcrResult = Readonly<{
  text: string;
  engine: "embedded_text" | "tesseract" | string;
  pages: number;
  durationMs: number;
}>;

export const DEFAULT_DOCUMENT_OCR_URL =
  "https://concasa-document-ocr-production.up.railway.app";

function endpoint(): string {
  return (
    process.env.NEXT_PUBLIC_DOCUMENT_OCR_URL?.trim() ||
    DEFAULT_DOCUMENT_OCR_URL
  ).replace(/\/+$/, "");
}

export async function extractDocumentTextViaOcr(input: {
  blob: Blob;
  documentType: OcrDocumentType;
  filename?: string | null;
  signal?: AbortSignal;
}): Promise<DocumentOcrResult> {
  if (!supabaseBrowser) {
    throw new Error("Supabase no está configurado.");
  }

  const {
    data: { session },
    error,
  } = await supabaseBrowser.auth.getSession();
  if (error || !session?.access_token) {
    throw new Error("Sesión expirada. Inicia sesión de nuevo.");
  }

  const form = new FormData();
  form.append(
    "file",
    input.blob,
    input.filename?.trim() || ${input.documentType}.pdf,
  );
  form.append("document_type", input.documentType);

  const response = await fetch(${endpoint()}/v1/extract, {
    method: "POST",
    headers: {
      Authorization: ${Bearer ${session.access_token}},
    },
    body: form,
    signal: input.signal,
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

  if (!response.ok || !body?.ok) {
    const reason =
      typeof body?.detail === "string" ? body.detail : "ocr_unavailable";
    throw new Error(${No se pudo leer el documento (${reason}).});
  }

  return {
    text: typeof body.text === "string" ? body.text : "",
    engine: typeof body.engine === "string" ? body.engine : "unknown",
    pages: Number.isFinite(Number(body.pages)) ? Number(body.pages) : 0,
    durationMs: Number.isFinite(Number(body.durationMs))
      ? Number(body.durationMs)
      : 0,
  };
}
