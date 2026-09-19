export type IneValidityStatus = "valid" | "expired" | "unknown";

export type IneValiditySource = "front_explicit" | "reverse_mrz";

export type IneValidityAssessment = Readonly<{
  status: IneValidityStatus;
  source: IneValiditySource | null;
  expirationYear: number | null;
  displayVigencia: string | null;
  canAutoReject: boolean;
}>;

function upper(raw: string): string {
  return String(raw ?? "")
    .replace(/\r/g, "\n")
    .toLocaleUpperCase("es-MX");
}

function plausibleYear(value: unknown): number | null {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2020 && year <= 2050 ? year : null;
}

function normalizedMrzLines(raw: string): string[] {
  return upper(raw)
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/[«‹»›>]/g, "<")
        .replace(/\s+/g, "")
        .replace(/[^A-Z0-9<]/g, ""),
    )
    .filter(Boolean);
}

function normalizedMrzText(raw: string): string {
  return normalizedMrzLines(raw).join("");
}

function normalizeNumericOcr(raw: string): string {
  return raw
    .replace(/[OQ]/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8");
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseIneMrzT7Number(reverseText: string): string | null {
  const compact = normalizedMrzText(reverseText);
  if (!compact) return null;

  const numeric = "[0-9OQILZSBG]";
  const idIndex = compact.indexOf("IDMEX");
  if (idIndex >= 0) {
    const anchoredWindow = compact.slice(idIndex, idIndex + 96);
    const anchored = anchoredWindow.match(
      new RegExp(`<{2,}(${numeric}{13})(?:<|$)`),
    );
    if (anchored?.[1]) {
      const digits = normalizeNumericOcr(anchored[1]).replace(/\D/g, "");
      if (/^\d{13}$/.test(digits)) return digits;
    }
  }

  // Algunos OCR pierden una letra de IDMEX o parten la primera línea del MRZ.
  // En ese caso aceptamos el T7 solo si conserva señales inequívocas de MRZ:
  // MEX + separador doble + exactamente 13 caracteres numéricos OCR.
  if (!compact.includes("MEX") || !compact.includes("<<")) return null;
  const fallback = compact.match(
    new RegExp(`<{2,}(${numeric}{13})(?:<|$)`),
  );
  if (!fallback?.[1]) return null;
  const digits = normalizeNumericOcr(fallback[1]).replace(/\D/g, "");
  return /^\d{13}$/.test(digits) ? digits : null;
}

export function parseIneMrzValidityDate(reverseText: string): string | null {
  const compact = normalizedMrzText(reverseText);
  if (!compact) return null;

  const numeric = "[0-9OQILZSBG]";
  const matches = compact.matchAll(
    new RegExp(
      `(${numeric}{6})[0-9A-Z]?([MHF])(${numeric}{6})[0-9A-Z]?(?:MEX|<)`,
      "g",
    ),
  );

  for (const match of matches) {
    if (!match?.[3]) continue;
    const expiry = normalizeNumericOcr(match[3]);
    if (!/^\d{6}$/.test(expiry)) continue;

    const yy = Number(expiry.slice(0, 2));
    const mm = Number(expiry.slice(2, 4));
    const dd = Number(expiry.slice(4, 6));
    const year = plausibleYear(2000 + yy);
    if (
      year === null ||
      mm < 1 ||
      mm > 12 ||
      dd < 1 ||
      dd > 31 ||
      !isRealDate(year, mm, dd)
    ) {
      continue;
    }
    return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  return null;
}

/**
 * La Credencial para Votar expresa su vigencia por año. Cuando aparece un rango
 * (p. ej. "VIGENCIA 2016-2026") el segundo año es el de expiración.
 */
export function parseExplicitIneValidityYear(frontText: string): number | null {
  const text = upper(frontText);
  const labelIndex = text.indexOf("VIGENCIA");
  if (labelIndex < 0) return null;

  // Acotamos la corrección O→0 al bloque de VIGENCIA; no alteramos nombres,
  // CURP u otros campos del OCR.
  const validityBlock = text
    .slice(labelIndex, labelIndex + 80)
    .replace(/O/g, "0");
  const range = validityBlock.match(
    /\bVIGENCIA\b[^0-9]{0,16}(20\d{2})[^0-9]{1,8}(20\d{2})\b/,
  );
  const single = validityBlock.match(
    /\bVIGENCIA\b[^0-9]{0,16}(20\d{2})\b/,
  );
  return plausibleYear(range?.[2] ?? single?.[1] ?? null);
}

/**
 * Respaldo de lectura. El MRZ puede contener una fecha técnica, pero para la
 * vigencia operativa usamos únicamente su año y lo llevamos a 31/12, igual que
 * la vigencia visible de la credencial. Nunca auto-rechaza por sí solo.
 */
export function parseIneMrzValidityYear(reverseText: string): number | null {
  const date = parseIneMrzValidityDate(reverseText);
  if (!date) return null;
  return plausibleYear(date.slice(0, 4));
}

function assessmentForYear(
  year: number,
  now: Date,
  source: IneValiditySource,
): IneValidityAssessment {
  const currentYear = now.getFullYear();
  const expired = year < currentYear;
  return {
    status: expired ? "expired" : "valid",
    source,
    expirationYear: year,
    displayVigencia: `31/12/${year}`,
    canAutoReject: expired && source === "front_explicit",
  };
}

function assessmentForMrzDate(
  isoDate: string,
  now: Date,
  reverseText: string,
): IneValidityAssessment {
  const [yearRaw, monthRaw, dayRaw] = isoDate.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const expiryUtc = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  const nowUtc = Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    12,
    0,
    0,
    0,
  );
  const expired = expiryUtc < nowUtc;
  const t7 = parseIneMrzT7Number(reverseText);

  return {
    status: expired ? "expired" : "valid",
    source: "reverse_mrz",
    expirationYear: year,
    displayVigencia: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`,
    // Auto-rechazo por reverso solo cuando hay dos señales MRZ independientes:
    // fecha estructurada + T7 de 13 dígitos después de <<.
    canAutoReject: expired && t7 !== null,
  };
}

export function evaluateIneValidity(input: Readonly<{
  frontText?: string | null;
  reverseText?: string | null;
  now?: Date;
}>): IneValidityAssessment {
  const now = input.now ?? new Date();
  const explicitYear = parseExplicitIneValidityYear(input.frontText ?? "");
  if (explicitYear !== null) {
    return assessmentForYear(explicitYear, now, "front_explicit");
  }

  const reverseText = input.reverseText ?? "";
  const mrzDate = parseIneMrzValidityDate(reverseText);
  if (mrzDate !== null) {
    return assessmentForMrzDate(mrzDate, now, reverseText);
  }

  return {
    status: "unknown",
    source: null,
    expirationYear: null,
    displayVigencia: null,
    canAutoReject: false,
  };
}
