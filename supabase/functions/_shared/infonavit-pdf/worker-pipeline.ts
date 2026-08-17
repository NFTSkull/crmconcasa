/**
 * Pipeline por outbox: adapt → template → generate → validate.
 * Sin fs/Deno/Storage aquí. El worker inyecta I/O.
 */

import { InfonavitPdfError } from "./errors.ts";
import { generateInfonavitPdf } from "./generate-infonavit-pdf.ts";
import { mapDbDocumentTypeToB1 } from "./document-type-map.ts";
import { adaptB3SnapshotToB1, InfonavitSnapshotAdapterError } from "./snapshot-adapter.ts";
import { getContract } from "./template-contract.ts";
import { sha256Hex } from "./sha256.ts";
import {
  validateGeneratedInfonavitPdf,
  InfonavitPdfValidationError,
} from "./pdf-output-validation.ts";
import {
  isRetryableWorkerCode,
  sanitizeWorkerErrorCode,
  type InfonavitWorkerErrorCode,
} from "./worker-codes.ts";
import type { InfonavitDocumentType } from "./types.ts";

export type ClaimedOutboxMeta = {
  outbox_id: string;
  snapshot_id: string;
  expediente_id: string;
  organization_id: string;
  document_type: string;
  submission_version: number;
  template_version: string;
  template_sha256: string;
  snapshot_hash: string;
  attempts: number;
  max_attempts: number;
  processing_started_at: string;
};

export type LoadedJob = ClaimedOutboxMeta & {
  payload: unknown;
  expected_storage_path: string;
  display_filename: string;
  b1_document_type: InfonavitDocumentType;
};

export type WorkerLogFields = {
  outbox_id: string;
  document_type: string;
  submission_version: number;
  attempt: number;
  error_code?: string;
};

export type GeneratedPdfResult = {
  bytes: Uint8Array;
  storagePath: string;
  mimeType: "application/pdf";
  sizeBytes: number;
  displayFilename: string;
  documentType: string;
  b1DocumentType: InfonavitDocumentType;
};

export function operationalLog(fields: WorkerLogFields): void {
  const line: Record<string, string | number> = {
    outbox_id: fields.outbox_id,
    document_type: fields.document_type,
    submission_version: fields.submission_version,
    attempt: fields.attempt,
  };
  if (fields.error_code) line.error_code = fields.error_code;
  console.log(JSON.stringify(line));
}

export function classifyWorkerError(err: unknown): {
  code: InfonavitWorkerErrorCode;
  retryable: boolean;
} {
  if (err instanceof InfonavitSnapshotAdapterError) {
    return { code: "SNAPSHOT_CONTRACT_INVALID", retryable: false };
  }
  if (err instanceof InfonavitPdfValidationError) {
    return { code: "PDF_VALIDATION_FAILED", retryable: false };
  }
  if (err instanceof InfonavitPdfError) {
    if (err.code === "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH") {
      return { code: "TEMPLATE_CONTRACT_MISMATCH", retryable: false };
    }
    if (
      err.code === "INFONAVIT_INVALID_DATE" ||
      err.code === "INFONAVIT_INVALID_AMOUNT" ||
      err.code === "INFONAVIT_UNSUPPORTED_DOCUMENT"
    ) {
      return { code: "SNAPSHOT_CONTRACT_INVALID", retryable: false };
    }
    return { code: "PDF_GENERATION_FAILED", retryable: false };
  }
  if (err && typeof err === "object" && "code" in err) {
    const mapped = sanitizeWorkerErrorCode(String((err as { code: unknown }).code));
    return { code: mapped, retryable: isRetryableWorkerCode(mapped) };
  }
  return { code: "PDF_GENERATION_FAILED", retryable: true };
}

export function classifyRpcError(message: string): InfonavitWorkerErrorCode {
  const msg = message.toUpperCase();
  if (msg.includes("SNAPSHOT_HASH_MISMATCH")) return "SNAPSHOT_HASH_MISMATCH";
  if (msg.includes("TEMPLATE_CONTRACT_MISMATCH")) {
    return "TEMPLATE_CONTRACT_MISMATCH";
  }
  if (msg.includes("SNAPSHOT_CONTRACT_INVALID")) {
    return "SNAPSHOT_CONTRACT_INVALID";
  }
  if (msg.includes("SNAPSHOT_NOT_FOUND")) return "SNAPSHOT_NOT_FOUND";
  if (msg.includes("OUTBOX_NOT_FOUND")) return "OUTBOX_NOT_FOUND";
  if (msg.includes("INFONAVIT_STORAGE_PATH_INVALID")) {
    return "DOCUMENT_REGISTER_FAILED";
  }
  return "DOCUMENT_REGISTER_FAILED";
}

export async function generatePdfForLoadedJob(args: {
  job: LoadedJob;
  templateBytes: Uint8Array;
}): Promise<GeneratedPdfResult> {
  const { job, templateBytes } = args;
  const b1Type = mapDbDocumentTypeToB1(job.document_type);
  if (b1Type !== job.b1_document_type) {
    throw new InfonavitSnapshotAdapterError("b1_document_type_mismatch");
  }

  if (job.template_version !== "v1") {
    throw new InfonavitPdfError(
      "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH",
      "template_version no es v1",
      { reason: "template_version" },
    );
  }

  const contract = getContract(b1Type);
  if (job.template_sha256 !== contract.expectedSha256) {
    throw new InfonavitPdfError(
      "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH",
      "SHA plantilla outbox no coincide",
      { reason: "outbox_sha_mismatch" },
    );
  }

  const actualSha = await sha256Hex(templateBytes);
  if (actualSha !== contract.expectedSha256) {
    throw new InfonavitPdfError(
      "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH",
      "SHA plantilla bytes no coincide",
      { reason: "bytes_sha_mismatch" },
    );
  }

  const snapshot = adaptB3SnapshotToB1(job.payload);
  const bytes = await generateInfonavitPdf({
    documentType: b1Type,
    templateBytes,
    snapshot,
  });
  const validated = await validateGeneratedInfonavitPdf({
    documentType: b1Type,
    bytes,
  });

  return {
    bytes,
    storagePath: job.expected_storage_path,
    mimeType: "application/pdf",
    sizeBytes: validated.sizeBytes,
    displayFilename: job.display_filename,
    documentType: job.document_type,
    b1DocumentType: b1Type,
  };
}
