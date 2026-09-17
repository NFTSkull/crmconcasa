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

/** Distancia máx. (chars) etiqueta→candidato para score alto (DETECTED). */
export const CLABE_CONTEXT_HIGH_MAX_DISTANCE = 40;

/** Distancia máx. para score medio (solo cuenta para AMBIGUOUS pool). */
export const CLABE_CONTEXT_MED_MAX_DISTANCE = 100;

/** Score mínimo para entrar al pool contextual (medio). */
export const CLABE_CONTEXT_MED_MIN_SCORE = 70;

/** Score mínimo para DETECTED (etiqueta CLABE claramente cercana). */
export const CLABE_CONTEXT_HIGH_MIN_SCORE = 100;

/**
 * 18 dígitos con espacios/guiones opcionales entre dígitos.
 * No acepta letras ni otros separadores (puntos, etc.).
 */
const CLABE_RAW_CANDIDATE_RE = /\d(?:[\s-]?\d){17}/g;

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
 * Extrae candidatos crudos (solo dígitos / espacio / guion) y normaliza con P1.
 * Descarta checksum inválido y normalizaciones nulas (letras, etc.).
 */
export function collectValidClabeCandidates(
  text: string,
): ScoredCandidate[] {
  const source = String(text ?? "");
  const byClabe = new Map<string, ScoredCandidate>();

  CLABE_RAW_CANDIDATE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLABE_RAW_CANDIDATE_RE.exec(source)) !== null) {
    const raw = match[0];
    const normalized = normalizeClabeMexico(raw);
    if (normalized === null || normalized.length !== 18) continue;
    if (!isValidClabeMexico(normalized)) continue;

    const score = scoreClabeContext(source, match.index);
    const prev = byClabe.get(normalized);
    if (!prev || score > prev.score) {
      byClabe.set(normalized, {
        clabe: normalized,
        score,
        index: match.index,
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
      // misma CLABE repetida con contexto → detected
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

  // Un solo medium sin high, o solo checksum sin etiqueta → no autoseleccionar
  return { status: "not_found" };
}

/** Mime no PDF → unsupported (UI). */
export function detectClabeUnsupportedForMime(mime: string): boolean {
  return mime.toLowerCase().trim() !== "application/pdf";
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
