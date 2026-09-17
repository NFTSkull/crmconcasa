/**
 * P4B — detección CLABE desde texto embebido de Estado de cuenta (shadow).
 * Sin OCR, sin provider externo, sin persistencia, sin autofill.
 * Reutiliza checksum P1 (`normalizeClabeMexico` / `isValidClabeMexico`).
 */

import {
  isValidClabeMexico,
  normalizeClabeMexico,
} from "@/domain/expediente-cliente-datos/clabe-mexico";
import { extractPdfEmbeddedText } from "@/domain/identidad-curp/pdf-extract-text";

export type ClabeBankStatementDetection =
  | {
      status: "detected";
      clabe: string;
      checksumValid: true;
      candidateCount: number;
      confidence: "high";
      reason: "clabe_label_nearby";
    }
  | {
      status: "ambiguous";
      candidates: string[];
      candidateCount: number;
    }
  | { status: "not_found" }
  | { status: "no_text_layer" }
  | { status: "unsupported" };

/** Blob privado ligado explícitamente al documento del que proviene. */
export type ActiveDocumentBlob = Readonly<{
  documentoId: string;
  blob: Blob;
}>;

/** Distancia máx. (chars) etiqueta→candidato para score alto (DETECTED). */
export const CLABE_CONTEXT_HIGH_MAX_DISTANCE = 40;

/** Distancia máx. para score medio (solo cuenta para AMBIGUOUS pool). */
export const CLABE_CONTEXT_MED_MAX_DISTANCE = 100;

/** Score mínimo para entrar al pool contextual (medio). */
export const CLABE_CONTEXT_MED_MIN_SCORE = 70;

/** Score mínimo para DETECTED (etiqueta CLABE claramente cercana). */
export const CLABE_CONTEXT_HIGH_MIN_SCORE = 100;

/**
 * Etiquetas (case-insensitive). Orden: más específicas primero.
 * No se almacenan snippets de texto del documento.
 */
const CLABE_LABEL_PATTERNS: readonly RegExp[] = [
  /clabe\s+interbancaria/gi,
  /clabe\s+para\s+transferencias/gi,
  /cuenta\s+clabe/gi,
  /transferencias?\s*(?:\/\s*)?interbancarias?/gi,
  /\bclabe\b/gi,
];

type ScoredCandidate = Readonly<{
  clabe: string;
  score: number;
  index: number;
}>;

function isDigitChar(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/**
 * Spans crudos con exactamente 18 dígitos lógicos (espacios/guiones opcionales).
 * Rechaza secuencias embebidas en 19+ dígitos (antes o después).
 */
export function findBoundedClabeRawSpans(
  text: string,
): ReadonlyArray<{ raw: string; index: number }> {
  const source = String(text ?? "");
  const out: { raw: string; index: number }[] = [];
  let i = 0;

  while (i < source.length) {
    if (!isDigitChar(source[i]!)) {
      i += 1;
      continue;
    }

    // No empezar si el char anterior es dígito (ya estaríamos dentro de un run)
    if (i > 0 && isDigitChar(source[i - 1]!)) {
      i += 1;
      continue;
    }

    const start = i;
    let digits = 0;
    let j = i;
    let lastDigitEnd = i;

    while (j < source.length) {
      const ch = source[j]!;
      if (isDigitChar(ch)) {
        digits += 1;
        lastDigitEnd = j + 1;
        j += 1;
        continue;
      }
      if ((ch === " " || ch === "-") && digits > 0 && digits < 18) {
        if (j + 1 < source.length && isDigitChar(source[j + 1]!)) {
          j += 1;
          continue;
        }
      }
      break;
    }

    // Si hay más dígitos pegados después del run parcial/completo, saltar el run entero
    if (lastDigitEnd < source.length && isDigitChar(source[lastDigitEnd]!)) {
      let k = lastDigitEnd;
      while (k < source.length) {
        const ch = source[k]!;
        if (isDigitChar(ch) || ch === " " || ch === "-") {
          k += 1;
          continue;
        }
        break;
      }
      i = Math.max(k, start + 1);
      continue;
    }

    if (digits === 18) {
      out.push({ raw: source.slice(start, lastDigitEnd), index: start });
      i = lastDigitEnd;
      continue;
    }

    i = Math.max(j, start + 1);
  }

  return out;
}

function scoreClabeContext(text: string, candidateIndex: number): number {
  const windowStart = Math.max(0, candidateIndex - 160);
  const before = text.slice(windowStart, candidateIndex);
  let best = 0;

  for (const pattern of CLABE_LABEL_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(before)) !== null) {
      const labelEnd = match.index + match[0].length;
      const distance = before.length - labelEnd;
      if (distance < 0) continue;
      if (distance <= CLABE_CONTEXT_HIGH_MAX_DISTANCE) {
        best = Math.max(best, 100);
      } else if (distance <= CLABE_CONTEXT_MED_MAX_DISTANCE) {
        best = Math.max(best, CLABE_CONTEXT_MED_MIN_SCORE);
      }
    }
  }
  return best;
}

/**
 * Extrae candidatos crudos delimitados y normaliza con P1.
 * Descarta checksum inválido y normalizaciones nulas (letras, etc.).
 */
export function collectValidClabeCandidates(
  text: string,
): ScoredCandidate[] {
  const source = String(text ?? "");
  const byClabe = new Map<string, ScoredCandidate>();

  for (const span of findBoundedClabeRawSpans(source)) {
    const normalized = normalizeClabeMexico(span.raw);
    if (normalized === null || normalized.length !== 18) continue;
    if (!isValidClabeMexico(normalized)) continue;

    const score = scoreClabeContext(source, span.index);
    const prev = byClabe.get(normalized);
    if (!prev || score > prev.score) {
      byClabe.set(normalized, {
        clabe: normalized,
        score,
        index: span.index,
      });
    }
  }

  return [...byClabe.values()].sort((a, b) => b.score - a.score);
}

/**
 * Decide detección a partir de texto ya extraído (sin raw text en el resultado).
 */
export function detectClabeFromBankStatementText(
  text: string,
): ClabeBankStatementDetection {
  const trimmed = String(text ?? "");
  if (trimmed.replace(/\s+/g, "").length < 40) {
    return { status: "no_text_layer" };
  }

  const valid = collectValidClabeCandidates(trimmed);
  const contextual = valid.filter(
    (c) => c.score >= CLABE_CONTEXT_MED_MIN_SCORE,
  );
  const high = contextual.filter(
    (c) => c.score >= CLABE_CONTEXT_HIGH_MIN_SCORE,
  );

  if (high.length === 1 && contextual.length === 1) {
    return {
      status: "detected",
      clabe: high[0]!.clabe,
      checksumValid: true,
      candidateCount: 1,
      confidence: "high",
      reason: "clabe_label_nearby",
    };
  }

  if (contextual.length >= 2) {
    const unique = [...new Set(contextual.map((c) => c.clabe))];
    if (unique.length === 1 && high.length >= 1) {
      return {
        status: "detected",
        clabe: unique[0]!,
        checksumValid: true,
        candidateCount: 1,
        confidence: "high",
        reason: "clabe_label_nearby",
      };
    }
    if (unique.length >= 2) {
      return {
        status: "ambiguous",
        candidates: unique,
        candidateCount: unique.length,
      };
    }
  }

  return { status: "not_found" };
}

/** Normaliza MIME (quita parámetros tipo `; charset=binary`). */
export function normalizeMimeType(mime: string): string {
  return String(mime ?? "").toLowerCase().trim().split(";")[0]!.trim();
}

export function isPdfMimeType(mime: string): boolean {
  return normalizeMimeType(mime) === "application/pdf";
}

/** Mime no PDF → unsupported (UI). */
export function detectClabeUnsupportedForMime(mime: string): boolean {
  return !isPdfMimeType(mime);
}

/**
 * Guard puro: ¿se puede lanzar análisis CLABE con este par documento↔blob?
 * Evita parsear blob A con docId B.
 */
export function canRunClabeDetection(input: {
  context: string;
  kind: string | null | undefined;
  activeDocumentId: string | null | undefined;
  blobDocumentId: string | null | undefined;
  mime: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!shouldRunClabeShadowDetection(input.context)) {
    return { ok: false, reason: "wrong_context" };
  }
  if (input.kind !== "cliente_estado_cuenta") {
    return { ok: false, reason: "wrong_kind" };
  }
  if (!input.activeDocumentId) {
    return { ok: false, reason: "no_document" };
  }
  if (!input.blobDocumentId) {
    return { ok: false, reason: "no_blob" };
  }
  if (input.blobDocumentId !== input.activeDocumentId) {
    return { ok: false, reason: "blob_mismatch" };
  }
  if (!String(input.mime ?? "").trim()) {
    return { ok: false, reason: "no_mime" };
  }
  if (detectClabeUnsupportedForMime(input.mime)) {
    return { ok: false, reason: "unsupported_mime" };
  }
  return { ok: true };
}

/**
 * Pipeline PDF: texto embebido (pdfjs vía extractPdfEmbeddedText) → detección.
 * El texto NO se retorna ni se debe loguear.
 */
export async function detectClabeFromBankStatementPdfBytes(
  data: ArrayBuffer | Uint8Array,
): Promise<ClabeBankStatementDetection> {
  const extracted = await extractPdfEmbeddedText(data);
  if (!extracted.ok) {
    return { status: "no_text_layer" };
  }
  return detectClabeFromBankStatementText(extracted.text);
}

/** True solo en contexto captura CLABE (P4B). RFC/identidad/vivienda = false. */
export function shouldRunClabeShadowDetection(
  context: string,
): boolean {
  return context === "clabe";
}
