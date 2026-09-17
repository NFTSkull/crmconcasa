/**
 * Auth del worker document-extraction (secret propio, no Sheets/P189).
 */

import {
  DOCUMENT_EXTRACTION_WORKER_SECRET_ENV,
  DOCUMENT_EXTRACTION_WORKER_SECRET_HEADER,
} from "./codes.ts";

export {
  DOCUMENT_EXTRACTION_WORKER_SECRET_ENV,
  DOCUMENT_EXTRACTION_WORKER_SECRET_HEADER,
};

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < ba.length; i++) out |= ba[i]! ^ bb[i]!;
  return out === 0;
}

export function documentExtractionWorkerSecretIsValid(
  expected: string,
  provided: string,
): boolean {
  const secret = expected.trim();
  const hdr = provided.trim();
  if (!secret || !hdr) return false;
  return timingSafeEqual(secret, hdr);
}
