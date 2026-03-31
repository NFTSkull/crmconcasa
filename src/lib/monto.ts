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
): { base: string; decimalSep: "." | "," | null; decimalDigits: string | null } {
  // Parte decimal opcional de 1 o 2 dígitos al final.
  const m = raw.match(/([.,])(\d{1,2})$/);
  if (!m) return { base: raw, decimalSep: null, decimalDigits: null };
  const sep = m[1] as "." | ",";
  return { base: raw.slice(0, -(m[0].length)), decimalSep: sep, decimalDigits: m[2] };
}

/**
 * Convierte un input de monto a un entero >= 0 (o null).
 *
 * Reglas:
 * - trim + quitar espacios
 * - "" -> null
 * - acepta enteros puros: "13000"
 * - acepta separadores de miles: "13,000", "13.000", "1,250,000", "1.250.000"
 * - acepta decimales con 1 o 2 dígitos (p.ej. "105605.50", "45000.75", "13000,5")
 * - rechaza más de 2 decimales
 */
export function parseMontoAprobado(input: string): number | null {
  const raw = stripSpaces(input);
  if (raw === "") return null;

  // Permitimos solo dígitos y separadores comunes.
  if (!/^[\d.,]+$/.test(raw)) return null;
  if (raw.startsWith(".") || raw.startsWith(",") || raw.endsWith(".") || raw.endsWith(",")) return null;

  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  const hasDot = lastDot !== -1;
  const hasComma = lastComma !== -1;

  const decimalSep: "." | "," | null =
    hasDot && hasComma ? (lastDot > lastComma ? "." : ",") : hasDot ? "." : hasComma ? "," : null;

  // Separa parte entera y decimal (si aplica). Si hay 1-2 dígitos al final tras el separador,
  // lo tratamos como decimal; si hay 3 dígitos, lo tratamos como miles (p.ej. "105.832").
  let base = raw;
  let decimalDigits: string | null = null;
  if (decimalSep) {
    const idx = raw.lastIndexOf(decimalSep);
    const tail = raw.slice(idx + 1);
    if (/^\d{1,2}$/.test(tail)) {
      base = raw.slice(0, idx);
      decimalDigits = tail;
    } else if (/^\d{3}$/.test(tail)) {
      // Se interpreta como separador de miles, no como decimal.
      base = raw;
      decimalDigits = null;
    } else {
      // Más de 2 decimales u otro formato inválido.
      return null;
    }
  }

  if (base === "") return null;

  // Determina separador de miles permitido en base.
  // Si hay decimalSep real, el separador de miles (si existe) debe ser el otro símbolo.
  const thousandSep: "," | "." | null =
    decimalDigits && decimalSep ? (decimalSep === "." ? "," : ".") : null;

  let intValue: number | null = null;
  if (/^\d+$/.test(base)) {
    const n = Number(base);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
    intValue = n;
  } else {
    const baseHasComma = base.includes(",");
    const baseHasDot2 = base.includes(".");

    if (thousandSep) {
      // Hay decimal: miles solo pueden usar el separador opuesto.
      if ((thousandSep === "," && !baseHasComma) || (thousandSep === "." && !baseHasDot2)) return null;
      // Además, no permitimos el mismo separador decimal en base (ambiguo).
      if (decimalSep && base.includes(decimalSep)) return null;
      intValue = parseThousandsSeparated(base, thousandSep);
    } else {
      // Sin decimal: permitir miles con un solo separador ("," o ".") y grupos de 3.
      if (baseHasComma && baseHasDot2) return null;
      if (baseHasComma) intValue = parseThousandsSeparated(base, ",");
      else if (baseHasDot2) intValue = parseThousandsSeparated(base, ".");
      else return null;
    }
  }
  if (intValue === null) return null;

  if (!decimalDigits) return intValue;
  // No redondeamos: construimos exactamente con 1-2 decimales.
  const frac = Number(decimalDigits) / (decimalDigits.length === 1 ? 10 : 100);
  const out = intValue + frac;
  if (!Number.isFinite(out) || out < 0) return null;
  return out;
}

export function formatMontoMX(value: number): string {
  const hasDecimals = Math.abs(value % 1) > 0;
  const fmt = hasDecimals
    ? new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : new Intl.NumberFormat("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `$${fmt.format(value)}`;
}

