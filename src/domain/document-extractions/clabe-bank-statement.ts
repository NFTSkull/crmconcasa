/**
 * P4B — detección CLABE desde texto embebido de Estado de cuenta (shadow).
 * Sin OCR, sin provider externo, sin persistencia, sin autofill.
 * Reutiliza checksum P1 (`normalizeClabeMexico` / `isValidClabeMexico`).
 */

import {
  isValidClabeMexico,
  normalizeClabeMexico,
} from "@/domain/expediente-cliente-datos/clabe-mexico";

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


const BANK_CODE_HINTS: ReadonlyArray<Readonly<{ pattern: RegExp; code: string }>> = [
  { pattern: /\bBANORTE\b|BANCO\s+MERCANTIL\s+DEL\s+NORTE/i, code: "072" },
  { pattern: /\bBANREGIO\b|BANCO\s+REGIONAL/i, code: "058" },
  { pattern: /\bBBVA\b|BBVA\s+MEXICO|BBVA\s+BANCOMER/i, code: "012" },
  { pattern: /\bSANTANDER\b/i, code: "014" },
  { pattern: /\bHSBC\b/i, code: "021" },
  { pattern: /\bSCOTIABANK\b|SCOTIABANK\s+INVERLAT/i, code: "044" },
  { pattern: /\bBANAMEX\b|\bCITIBANAMEX\b/i, code: "002" },
  { pattern: /\bBAJIO\b|BANCO\s+DEL\s+BAJIO/i, code: "030" },
  { pattern: /\bINBURSA\b/i, code: "036" },
  { pattern: /\bMIFEL\b/i, code: "042" },
  { pattern: /\bAFIRME\b/i, code: "062" },
  { pattern: /\bAZTECA\b/i, code: "127" },
  { pattern: /\bCOMPARTAMOS\b/i, code: "130" },
  { pattern: /\bMULTIVA\b/i, code: "132" },
  { pattern: /\bACTINVER\b/i, code: "133" },
  { pattern: /\bINTERCAM\b/i, code: "136" },
  { pattern: /\bBANCOPPEL\b|BANCO\s+COPPEL/i, code: "137" },
  { pattern: /\bBBASE\b|BANCO\s+BASE/i, code: "145" },
  { pattern: /\bBANCREA\b/i, code: "152" },
  { pattern: /\bINVEX\b/i, code: "059" },
  { pattern: /\bBANSI\b/i, code: "060" },
];

function normalizedBankText(raw: string): string {
  return String(raw ?? "")
    .toLocaleUpperCase("es-MX")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectBankCodeHints(text: string): string[] {
  // El banco emisor normalmente aparece al inicio. Limitar la ventana evita
  // inferir el banco a partir de movimientos/beneficiarios de otras entidades.
  const head = normalizedBankText(text).slice(0, 2800);
  const codes = new Set<string>();
  for (const hint of BANK_CODE_HINTS) {
    if (hint.pattern.test(head)) codes.add(hint.code);
  }
  return [...codes];
}

function validClabesInFragment(fragment: string): string[] {
  const source = String(fragment ?? "");
  const out = new Set<string>();
  // En tablas puede haber otro campo numérico antes de la CLABE en la misma
  // fila (p. ej. No. de Cuenta). Buscamos un bloque de exactamente 18 dígitos
  // sin permitir que absorba números de columnas vecinas.
  const pattern = /(?<!\d)(?:\d[\s.\-:/]*){17}\d(?![\s.\-:/]*\d)/g;
  for (const match of source.matchAll(pattern)) {
    const normalized = normalizeClabeMexico(match[0]);
    if (!normalized || normalized.length !== 18) continue;
    if (!isValidClabeMexico(normalized)) continue;
    out.add(normalized);
  }
  return [...out];
}

/**
 * Extrae primero candidatos realmente asociados a una fila/etiqueta CLABE.
 * Soporta:
 *   "CLABE 072 580 ..."
 *   "No. de Cuenta   CLABE" + siguiente fila con cuenta + CLABE
 *   "CLABE 012 700" + resto en el siguiente renglón OCR
 */
export function collectStrictLabeledClabeCandidates(text: string): string[] {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const out = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const label = /\bCLABE\b/i.exec(line);
    if (!label) continue;

    const afterLabel = line.slice(label.index + label[0].length).trim();
    for (const value of validClabesInFragment(afterLabel)) out.add(value);

    // Primero preferimos una CLABE completa en la misma línea.
    const direct = validClabesInFragment(afterLabel);
    if (direct.length > 0) {
      for (const value of direct) out.add(value);
      continue;
    }

    // Algunos PDF/OCR conservan las columnas fuera de orden: la etiqueta CLABE
    // puede quedar separada 1–3 renglones del valor visible. Ampliamos solo ese
    // vecindario corto, deteniéndonos en el primer nivel que entregue una CLABE
    // válida de 18 dígitos + checksum. Así no barremos todo el estado de cuenta.
    const neighborhood: string[] = [afterLabel];
    for (let offset = 1; offset <= 3; offset++) {
      const nearby = lines[i + offset];
      if (!nearby) break;
      neighborhood.push(nearby);
      const values = validClabesInFragment(neighborhood.join(" "));
      if (values.length === 0) continue;
      for (const value of values) out.add(value);
      break;
    }
  }

  return [...out];
}

function chooseByBankHint(
  candidates: readonly string[],
  bankCodes: readonly string[],
): string[] {
  if (bankCodes.length !== 1) return [...candidates];
  return candidates.filter((candidate) => candidate.startsWith(bankCodes[0]!));
}

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
 * Rechaza secuencias embebidas en 19+ dígitos (antes o después), incluso si el
 * dígito extra viene tras espacio o guion (`…719 9`, `…719-9`).
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
      // Separadores internos solo mientras aún no completamos 18 dígitos.
      // OCR/PDF puede partir la CLABE con espacios, tabs o saltos de línea.
      if ((/\s/.test(ch) || ch === "-") && digits > 0 && digits < 18) {
        let next = j + 1;
        while (
          next < source.length &&
          (/\s/.test(source[next]!) || source[next] === "-")
        ) {
          next += 1;
        }
        if (next < source.length && isDigitChar(source[next]!)) {
          j = next;
          continue;
        }
      }
      break;
    }

    // ¿Hay más dígitos del mismo run lógico después (contiguos o vía espacio/guion)?
    let probe = lastDigitEnd;
    while (
      probe < source.length &&
      (/\s/.test(source[probe]!) || source[probe] === "-")
    ) {
      probe += 1;
    }
    const hasExtraDigits =
      (lastDigitEnd < source.length && isDigitChar(source[lastDigitEnd]!)) ||
      (probe > lastDigitEnd &&
        probe < source.length &&
        isDigitChar(source[probe]!));

    if (digits !== 18 || hasExtraDigits) {
      let skip = Math.max(probe, lastDigitEnd, j);
      while (skip < source.length) {
        const ch = source[skip]!;
        if (isDigitChar(ch) || /\s/.test(ch) || ch === "-") {
          skip += 1;
          continue;
        }
        break;
      }
      i = Math.max(skip, start + 1);
      continue;
    }

    out.push({ raw: source.slice(start, lastDigitEnd), index: start });
    i = lastDigitEnd;
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

  const bankCodes = detectBankCodeHints(trimmed);
  const strict = collectStrictLabeledClabeCandidates(trimmed);
  const strictFiltered = chooseByBankHint(strict, bankCodes);

  if (strictFiltered.length === 1) {
    return {
      status: "detected",
      clabe: strictFiltered[0]!,
      checksumValid: true,
      candidateCount: 1,
      confidence: "high",
      reason: "clabe_label_nearby",
    };
  }

  if (strictFiltered.length >= 2) {
    return {
      status: "ambiguous",
      candidates: [...new Set(strictFiltered)],
      candidateCount: [...new Set(strictFiltered)].length,
    };
  }

  // Si reconocimos claramente el banco y la única CLABE de la fila pertenece
  // a otro código bancario, no la aceptamos aunque su checksum sea válido.
  if (bankCodes.length === 1 && strict.length > 0 && strictFiltered.length === 0) {
    return { status: "not_found" };
  }

  const valid = collectValidClabeCandidates(trimmed);
  let contextual = valid.filter(
    (candidate) => candidate.score >= CLABE_CONTEXT_MED_MIN_SCORE,
  );

  if (bankCodes.length === 1) {
    contextual = contextual.filter((candidate) =>
      candidate.clabe.startsWith(bankCodes[0]!),
    );
  }

  const high = contextual.filter(
    (candidate) => candidate.score >= CLABE_CONTEXT_HIGH_MIN_SCORE,
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
    const unique = [...new Set(contextual.map((candidate) => candidate.clabe))];
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
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      useSystemFonts: true,
    });
    const doc = await loadingTask.promise;
    const pageCount = Math.min(doc.numPages, 3);
    let text = "";

    for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const rows: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];

      for (const item of content.items) {
        if (!("str" in item)) continue;
        const value = String(item.str ?? "").trim();
        if (!value) continue;
        const transform =
          "transform" in item && Array.isArray(item.transform)
            ? item.transform
            : null;
        const x = Number(transform?.[4] ?? 0);
        const y = Number(transform?.[5] ?? 0);

        let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
        if (!row) {
          row = { y, items: [] };
          rows.push(row);
        }
        row.items.push({ x, text: value });
      }

      rows.sort((a, b) => b.y - a.y);
      const pageText = rows
        .map((row) =>
          row.items
            .sort((a, b) => a.x - b.x)
            .map((item) => item.text)
            .join(" "),
        )
        .join("\n");
      text += `${pageText}\n`;

      // La CLABE suele estar en la primera o segunda página. Si ya tenemos una
      // detección estructural confiable, no parseamos el resto del PDF.
      const partial = detectClabeFromBankStatementText(text);
      if (partial.status === "detected") return partial;
    }

    if (text.replace(/\s+/g, "").length < 40) {
      return { status: "no_text_layer" };
    }
    return detectClabeFromBankStatementText(text);
  } catch {
    return { status: "no_text_layer" };
  }
}

/** True solo en contexto captura CLABE (P4B). RFC/identidad/vivienda = false. */
export function shouldRunClabeShadowDetection(
  context: string,
): boolean {
  return context === "clabe";
}

/** Resultado de detección ligado al documento que lo produjo. */
export type ClabeDetectionForDocument = Readonly<{
  documentoId: string;
  result: ClabeBankStatementDetection;
}>;

/**
 * Solo muestra detección si pertenece al documento activo.
 * Al cambiar A→B, el resultado de A deja de ser visible de inmediato.
 */
export function resolveVisibleClabeDetection(input: {
  activeDocumentId: string | null | undefined;
  detection: ClabeDetectionForDocument | null | undefined;
}): ClabeBankStatementDetection | null {
  const activeId = input.activeDocumentId ?? null;
  const detection = input.detection ?? null;
  if (!activeId || !detection) return null;
  if (detection.documentoId !== activeId) return null;
  return detection.result;
}
