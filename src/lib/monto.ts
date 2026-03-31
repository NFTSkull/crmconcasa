const SPACES_RE = /\s+/g;

function stripSpaces(input: string): string {
  return (input ?? "").trim().replace(SPACES_RE, "");
}

function parseThousandsSeparated(base: string, sep: "," | "."): number | null {
  const parts = base.split(sep);
  if (parts.length < 2) return null;
  if (parts.some((p) => p.length === 0)) return null;
  if (!/^\d+$/.test(parts[0])) return null;
  if (parts[0].length < 1 || parts[0].length > 3) return null;
  for (let i = 1; i < parts.length; i++) {
    const g = parts[i];
    if (!/^\d{3}$/.test(g)) return null;
  }
  const digits = parts.join("");
  if (!/^\d+$/.test(digits)) return null;
  const num = Number(digits);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) return null;
  return num;
}

function splitDecimalIfPresent(
  raw: string
): { base: string; decimalSep: "." | "," | null; hasDecimalPart: boolean } {
  // Si termina en sep + 2 dígitos, lo tratamos como parte decimal.
  // Si termina en sep + 3 dígitos (p.ej. "13,000"), lo tratamos como separador de miles.
  const m = raw.match(/([.,])(\d{2})$/);
  if (!m) return { base: raw, decimalSep: null, hasDecimalPart: false };
  const sep = m[1] as "." | ",";
  return { base: raw.slice(0, -3), decimalSep: sep, hasDecimalPart: true };
}

/**
 * Convierte un input de monto a un entero >= 0 (o null).
 *
 * Reglas:
 * - trim + quitar espacios
 * - "" -> null
 * - acepta enteros puros: "13000"
 * - acepta separadores de miles: "13,000", "13.000", "1,250,000", "1.250.000"
 * - acepta decimales solo si son exactos ".00" o ",00" (se descartan)
 * - rechaza cualquier otro decimal (".50", ",10", etc.)
 */
export function parseMontoAprobado(input: string): number | null {
  const raw = stripSpaces(input);
  if (raw === "") return null;

  const { base, decimalSep, hasDecimalPart } = splitDecimalIfPresent(raw);
  if (hasDecimalPart) {
    const dec = raw.slice(raw.length - 2);
    if (dec !== "00") return null;
    // Si el mismo separador decimal aparece antes (p.ej. "1.250.00"),
    // es ambiguo (miles y decimales con el mismo símbolo) → inválido.
    if (decimalSep && base.includes(decimalSep)) return null;
  }
  if (base === "") return null;

  // Solo dígitos (p.ej. "500000" o "500000.00" ya recortado)
  if (/^\d+$/.test(base)) {
    const num = Number(base);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) return null;
    return num;
  }

  const hasComma = base.includes(",");
  const hasDot = base.includes(".");
  if (hasComma && hasDot) {
    // Permitimos mezcla SOLO cuando había decimales .00 o ,00 (ya recortados),
    // y el separador usado como decimal es distinto al usado como miles.
    if (!hasDecimalPart || !decimalSep) return null;
    const thousandSep = decimalSep === "." ? "," : ".";
    return parseThousandsSeparated(base, thousandSep);
  }

  if (hasComma) return parseThousandsSeparated(base, ",");
  if (hasDot) return parseThousandsSeparated(base, ".");

  return null;
}

const mxnFormatter = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

export function formatMontoMX(value: number): string {
  return `$${mxnFormatter.format(value)}`;
}

