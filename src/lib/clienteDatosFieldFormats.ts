/** Helpers de formato para Datos Generales (P133). No mutan filas históricas. */

export const MSJ_PERSON_NAME_INVALID =
  "Este campo solo admite letras, espacios, guiones y apóstrofes.";

export const MSJ_DIGITS_ONLY = "Este campo solo admite números.";

/** Letras Unicode + combining marks + espacio + guion + apóstrofe ' / ’ */
const PERSON_NAME_CHAR_RE = /[\p{L}\p{M}\s'\u2019-]/u;
const PERSON_NAME_FULL_RE = /^[\p{L}\p{M}\s'\u2019-]*$/u;

/** trim + colapsar espacios internos; NO quitar acentos; NO forzar mayúsculas */
export function normalizePersonName(input: string): string {
  return String(input ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * vacío = true (required se valida aparte).
 * Rechaza dígitos, emojis y símbolos no permitidos.
 */
export function isValidPersonName(input: string): boolean {
  const raw = String(input ?? "");
  if (!raw.trim()) return true;
  return PERSON_NAME_FULL_RE.test(raw);
}

/**
 * Al tipear/pegar: conserva solo chars válidos.
 * Colapsa dobles espacios; no aplica trim completo de bordes.
 */
export function filterPersonNameInput(input: string): string {
  const raw = String(input ?? "");
  let out = "";
  for (const ch of raw) {
    if (PERSON_NAME_CHAR_RE.test(ch)) out += ch;
  }
  return out.replace(/ {2,}/g, " ");
}

/** Solo 0-9; conserva ceros iniciales (string). */
export function normalizeDigitsOnly(input: string): string {
  return String(input ?? "").replace(/\D/g, "");
}

/** Al tipear/pegar: solo dígitos, opcionalmente truncado. */
export function filterDigitsInput(input: string, maxLen?: number): string {
  let digits = normalizeDigitsOnly(input);
  if (maxLen != null && maxLen >= 0) {
    digits = digits.slice(0, maxLen);
  }
  return digits;
}
