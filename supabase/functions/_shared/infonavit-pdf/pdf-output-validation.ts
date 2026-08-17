/**
 * Validación del PDF generado ANTES de Storage.
 * Renderer B1 sigue puro; esto vive en el worker.
 */

import { PDFDocument } from "pdf-lib";
import { getContract } from "./template-contract.ts";
import type { InfonavitDocumentType } from "./types.ts";

export const INFONAVIT_PDF_MAX_BYTES = 15 * 1024 * 1024;

export class InfonavitPdfValidationError extends Error {
  readonly code = "PDF_VALIDATION_FAILED" as const;
  readonly reason: string;

  constructor(reason: string) {
    super("pdf validation failed");
    this.name = "InfonavitPdfValidationError";
    this.reason = reason;
  }
}

export async function validateGeneratedInfonavitPdf(args: {
  documentType: InfonavitDocumentType;
  bytes: Uint8Array;
}): Promise<{ pageCount: number; sizeBytes: number }> {
  const { documentType, bytes } = args;
  if (!bytes || bytes.byteLength <= 0) {
    throw new InfonavitPdfValidationError("empty_bytes");
  }
  if (bytes.byteLength > INFONAVIT_PDF_MAX_BYTES) {
    throw new InfonavitPdfValidationError("size_limit");
  }
  const head = String.fromCharCode(
    bytes[0] ?? 0,
    bytes[1] ?? 0,
    bytes[2] ?? 0,
    bytes[3] ?? 0,
  );
  if (head !== "%PDF") {
    throw new InfonavitPdfValidationError("not_pdf");
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  } catch {
    throw new InfonavitPdfValidationError("unparseable");
  }

  const contract = getContract(documentType);
  const pageCount = doc.getPageCount();
  if (pageCount !== contract.expectedPageCount) {
    throw new InfonavitPdfValidationError("page_count");
  }

  const fields = doc.getForm().getFields();
  if (fields.length !== 0) {
    throw new InfonavitPdfValidationError("acroform_not_flat");
  }

  return { pageCount, sizeBytes: bytes.byteLength };
}
