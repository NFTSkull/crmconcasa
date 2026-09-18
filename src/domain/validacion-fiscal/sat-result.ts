export type SatSemanticResult = "valid" | "invalid" | "unknown";

const RFC_VALID_TEXT = "RFC VÁLIDO, Y SUSCEPTIBLE DE RECIBIR FACTURAS";
const CURP_VALID_TEXT = "REGISTRADO EN EL PADRÓN DE CONTRIBUYENTES";

const RFC_INVALID_PATTERNS: readonly RegExp[] = [
  /RFC NO REGISTRADO EN EL PADRON DE CONTRIBUYENTES/,
  /NO REGISTRADO EN EL PADRON DE CONTRIBUYENTES/,
  /RFC VALIDO NO SUSCEPTIBLE DE RECIBIR FACTURAS/,
  /ESTRUCTURA DEL RFC INCORRECTA/,
];

const CURP_INVALID_PATTERNS: readonly RegExp[] = [
  /NO REGISTRADO EN EL PADRON DE CONTRIBUYENTES/,
  /CURP NO REGISTRADA EN EL PADRON DE CONTRIBUYENTES/,
];

function fold(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(normalized: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(normalized);
  });
}

export function classifySatRfcText(
  text: string,
  knownInvalidPatterns: readonly RegExp[] = RFC_INVALID_PATTERNS,
): SatSemanticResult {
  const normalized = fold(text);
  if (matchesAny(normalized, knownInvalidPatterns)) return "invalid";
  if (normalized.includes(fold(RFC_VALID_TEXT))) return "valid";
  return "unknown";
}

export function classifySatCurpText(
  text: string,
  knownInvalidPatterns: readonly RegExp[] = CURP_INVALID_PATTERNS,
): SatSemanticResult {
  const normalized = fold(text);
  // "NO REGISTRADO..." contiene "REGISTRADO...": negativos primero.
  if (matchesAny(normalized, knownInvalidPatterns)) return "invalid";
  if (normalized.includes(fold(CURP_VALID_TEXT))) return "valid";
  return "unknown";
}
