/** Helpers de formato para Datos Generales (P133). No mutan filas históricas. */

export const MSJ_PERSON_NAME_INVALID =
  "Este campo solo admite letras sin acentos, Ñ, espacios, guiones y apóstrofes.";

export const MSJ_DIGITS_ONLY = "Este campo solo admite números.";

/**
 * Nombres canónicos CRM:
 * - sin diacríticos/acentos (ÁÉÍÓÚÜ → AEIOUU, etc.);
 * - conserva Ñ;
 * - mayúsculas en español.
 */
export function stripPersonNameDiacriticsPreserveEnye(input: string): string {
  const sentinel = "\uE000";
  return String(input ?? "")
    .replace(/[Ññ]/g, sentinel)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replaceAll(sentinel, "Ñ");
}

/** A-Z/a-z + Ñ/ñ + espacio + guion + apóstrofe ' / ’ */
const PERSON_NAME_CHAR_RE = /[A-Za-zÑñ\s'\u2019-]/;
const PERSON_NAME_FULL_RE = /^[A-Za-zÑñ\s'\u2019-]*$/;

/** trim + colapsar espacios internos; elimina acentos y normaliza a MAYÚSCULAS. */
export function normalizePersonName(input: string): string {
  return stripPersonNameDiacriticsPreserveEnye(input)
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("es-MX");
}

/**
 * vacío = true (required se valida aparte).
 * Rechaza acentos, dígitos, emojis y símbolos no permitidos. Ñ sí es válida.
 */
export function isValidPersonName(input: string): boolean {
  const raw = String(input ?? "");
  if (!raw.trim()) return true;
  return PERSON_NAME_FULL_RE.test(raw);
}

/**
 * Al tipear/pegar: primero elimina acentos preservando Ñ y después conserva
 * únicamente caracteres válidos. Colapsa dobles espacios; no aplica trim
 * completo de bordes. Todo nombre capturado queda visualmente en MAYÚSCULAS.
 */
export function filterPersonNameInput(input: string): string {
  const raw = stripPersonNameDiacriticsPreserveEnye(input);
  let out = "";
  for (const ch of raw) {
    if (PERSON_NAME_CHAR_RE.test(ch)) out += ch;
  }
  return out.replace(/ {2,}/g, " ").toLocaleUpperCase("es-MX");
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
