/**
 * Distribución multilínea determinista — sin partir grafemas / acentos.
 * No trunca en silencio: overflow → INFONAVIT_TEXT_OVERFLOW (meta sin PII).
 */

import { InfonavitPdfError } from "./errors.ts";
import type { InfonavitDocumentType } from "./types.ts";

export interface SplitLinesArgs {
  text: string;
  maxLines: number;
  maxCharsPerLine: number;
  documentType: InfonavitDocumentType;
  semanticField: string;
}

function assertCapacity(args: {
  documentType: InfonavitDocumentType;
  semanticField: string;
  maxLines: number;
  maxCharsPerLine: number;
}): void {
  if (args.maxLines < 1 || args.maxCharsPerLine < 1) {
    throw new InfonavitPdfError(
      "INFONAVIT_TEXT_OVERFLOW",
      "capacidad de línea inválida",
      {
        documentType: args.documentType,
        semanticField: args.semanticField,
        maxLines: args.maxLines,
        reason: "bad_capacity",
      },
    );
  }
}

/**
 * Parte por palabras. Si una palabra sola excede maxCharsPerLine → FAIL
 * (no cortar a mitad salvo que el caller pida hardWrapExtreme — no usado en v1).
 */
export function splitTextToLines(args: SplitLinesArgs): string[] {
  assertCapacity(args);
  const raw = (args.text ?? "").trim().replace(/\s+/g, " ");
  if (raw.length === 0) {
    return Array.from({ length: args.maxLines }, () => "");
  }

  const words = raw.split(" ");
  const lines: string[] = [];
  let current = "";

  const pushLine = (line: string) => {
    lines.push(line);
  };

  for (const word of words) {
    if (word.length > args.maxCharsPerLine) {
      throw new InfonavitPdfError(
        "INFONAVIT_TEXT_OVERFLOW",
        "palabra excede capacidad de línea",
        {
          documentType: args.documentType,
          semanticField: args.semanticField,
          maxLines: args.maxLines,
          reason: "word_too_long",
          maxCharsPerLine: args.maxCharsPerLine,
          wordLength: word.length,
        },
      );
    }
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= args.maxCharsPerLine) {
      current = candidate;
      continue;
    }
    pushLine(current);
    current = word;
    if (lines.length >= args.maxLines) {
      throw new InfonavitPdfError(
        "INFONAVIT_TEXT_OVERFLOW",
        "texto excede máximo de líneas",
        {
          documentType: args.documentType,
          semanticField: args.semanticField,
          maxLines: args.maxLines,
          reason: "too_many_lines",
        },
      );
    }
  }

  if (current.length > 0) {
    if (lines.length >= args.maxLines) {
      throw new InfonavitPdfError(
        "INFONAVIT_TEXT_OVERFLOW",
        "texto excede máximo de líneas",
        {
          documentType: args.documentType,
          semanticField: args.semanticField,
          maxLines: args.maxLines,
          reason: "too_many_lines_tail",
        },
      );
    }
    pushLine(current);
  }

  while (lines.length < args.maxLines) lines.push("");
  return lines;
}

/**
 * Nombre presupuesto: línea principal (T0, angosta) + overflow (T11, ancha).
 * Prioriza corte por palabras. No trunca.
 */
export function splitNombrePresupuesto(args: {
  fullName: string;
  maxCharsLine0: number;
  maxCharsLine11: number;
}): { line0: string; line11: string } {
  const documentType = "presupuesto_mejoramiento" as const;
  const semanticField = "cliente.nombreCompleto";
  const raw = (args.fullName ?? "").trim().replace(/\s+/g, " ");
  if (raw.length === 0) return { line0: "", line11: "" };

  if (raw.length <= args.maxCharsLine0) {
    return { line0: raw, line11: "" };
  }

  const words = raw.split(" ");
  let line0 = "";
  let consumed = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w.length > args.maxCharsLine0 && line0.length === 0) {
      // Primera palabra no cabe en T0: intentar T11 completo si cabe.
      if (raw.length <= args.maxCharsLine11) {
        return { line0: "", line11: raw };
      }
      throw new InfonavitPdfError(
        "INFONAVIT_TEXT_OVERFLOW",
        "nombre no cabe en líneas de presupuesto",
        {
          documentType,
          semanticField,
          maxLines: 2,
          reason: "word_too_long_for_line0",
          maxCharsPerLine: args.maxCharsLine0,
          wordLength: w.length,
        },
      );
    }
    const candidate = line0.length === 0 ? w : `${line0} ${w}`;
    if (candidate.length <= args.maxCharsLine0) {
      line0 = candidate;
      consumed = i + 1;
    } else {
      break;
    }
  }

  const rest = words.slice(consumed).join(" ");
  if (rest.length === 0) return { line0, line11: "" };
  if (rest.length > args.maxCharsLine11) {
    throw new InfonavitPdfError(
      "INFONAVIT_TEXT_OVERFLOW",
      "nombre overflow excede línea 11",
      {
        documentType,
        semanticField,
        maxLines: 2,
        reason: "overflow_line11",
        maxCharsPerLine: args.maxCharsLine11,
        overflowLength: rest.length,
      },
    );
  }
  return { line0, line11: rest };
}
