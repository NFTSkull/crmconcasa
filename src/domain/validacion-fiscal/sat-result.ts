export type SatSemanticResult = "valid" | "invalid" | "unknown";

const RFC_VALID_TEXT = "RFC VÁLIDO, Y SUSCEPTIBLE DE RECIBIR FACTURAS";
const CURP_VALID_TEXT = "REGISTRADO EN EL PADRÓN DE CONTRIBUYENTES";

function fold(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function classifySatRfcText(
  text: string,
  knownInvalidPatterns: readonly RegExp[] = [],
): SatSemanticResult {
  const normalized = fold(text);
  if (normalized.includes(fold(RFC_VALID_TEXT))) return "valid";
  if (knownInvalidPatterns.some((re) => re.test(normalized))) return "invalid";
  return "unknown";
}

export function classifySatCurpText(
  text: string,
  knownInvalidPatterns: readonly RegExp[] = [],
): SatSemanticResult {
  const normalized = fold(text);
  if (normalized.includes(fold(CURP_VALID_TEXT))) return "valid";
  if (knownInvalidPatterns.some((re) => re.test(normalized))) return "invalid";
  return "unknown";
}
