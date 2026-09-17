/**
 * Validación determinística de CLABE mexicana (dígito verificador).
 * Sin I/O ni proveedor externo — reutilizable por Mesa, OCR futuro y workers.
 */

const CLABE_WEIGHTS = [3, 7, 1] as const;
const CLABE_LEN = 18;

/** Solo dígitos, espacios y guiones (normalizables). */
const ALLOWED_RAW = /^[\d\s-]*$/;

/**
 * Normaliza una CLABE:
 * - vacío / solo whitespace → `""`
 * - espacios y guiones se eliminan
 * - cualquier otro carácter (letras, etc.) → `null` (no se “limpia” en silencio)
 *
 * No valida longitud ni checksum; eso lo hace `isValidClabeMexico`.
 */
export function normalizeClabeMexico(input: string): string | null {
  const raw = String(input ?? "");
  if (!raw.trim()) return "";
  if (!ALLOWED_RAW.test(raw)) return null;
  return raw.replace(/[\s-]/g, "");
}

/**
 * Dígito verificador esperado (0–9) para los primeros 17 dígitos.
 * `null` si `first17` no son exactamente 17 dígitos.
 */
export function calculateClabeCheckDigit(first17: string): number | null {
  const s = String(first17 ?? "");
  if (!/^\d{17}$/.test(s)) return null;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const digit = Number(s[i]);
    const weight = CLABE_WEIGHTS[i % 3]!;
    sum += (digit * weight) % 10;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * True solo si, tras normalizar, hay exactamente 18 dígitos y el checksum es correcto.
 * Vacío → false (la UI decide si vacío es permitido al generar).
 */
export function isValidClabeMexico(input: string): boolean {
  const digits = normalizeClabeMexico(input);
  if (digits === null || digits.length !== CLABE_LEN) return false;
  if (!/^\d{18}$/.test(digits)) return false;
  const expected = calculateClabeCheckDigit(digits.slice(0, 17));
  if (expected === null) return false;
  return expected === Number(digits[17]);
}
