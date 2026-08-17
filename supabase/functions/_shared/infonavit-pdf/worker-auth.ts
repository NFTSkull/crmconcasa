/**
 * Auth interno del worker P189. Secret propio, no agenda / P188.
 */

export const INFONAVIT_PDF_WORKER_SECRET_ENV = "INFONAVIT_PDF_WORKER_SECRET";
export const INFONAVIT_PDF_WORKER_SECRET_HEADER = "x-concasa-worker-secret";

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < ba.length; i++) out |= ba[i]! ^ bb[i]!;
  return out === 0;
}

export function workerSecretIsValid(
  expected: string,
  provided: string,
): boolean {
  const secret = expected.trim();
  const hdr = provided.trim();
  if (!secret || !hdr) return false;
  return timingSafeEqual(secret, hdr);
}
