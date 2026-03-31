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

  const { base, decimalSep, decimalDigits } = splitDecimalIfPresent(raw);
  // Si hay separador decimal, no permitimos que el mismo símbolo aparezca en la parte base
  // (evita ambigüedad miles/decimal como "1.250.50").
  if (decimalSep && base.includes(decimalSep)) return null;
  if (base === "") return null;

  // Parse de la parte entera (base) con o sin separadores de miles.
  let intValue: number | null = null;
  if (/^\d+$/.test(base)) {
    const n = Number(base);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
    intValue = n;
  } else {
    const hasComma = base.includes(",");
    const hasDot = base.includes(".");

    // Si hay separador decimal, el separador de miles (si existe) debe ser el otro símbolo.
    if (decimalSep) {
      const thousandSep = decimalSep === "." ? "," : ".";
      if (base.includes(thousandSep)) {
        intValue = parseThousandsSeparated(base, thousandSep);
      } else {
        // Ningún separador de miles válido en base.
        return null;
      }
    } else {
      // Sin parte decimal: permitimos miles con un solo tipo de separador.
      if (hasComma && hasDot) return null;
      if (hasComma) intValue = parseThousandsSeparated(base, ",");
      else if (hasDot) intValue = parseThousandsSeparated(base, ".");
      else return null;
    }
  }
  if (intValue === null) return null;

  if (!decimalDigits) return intValue;
  // decimalDigits es 1-2 dígitos por regex; construimos el número sin redondear.
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

