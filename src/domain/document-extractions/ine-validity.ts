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

/**
 * La Credencial para Votar expresa su vigencia por año. Cuando aparece un rango
 * (p. ej. "VIGENCIA 2016-2026") el segundo año es el de expiración.
 */
export function parseExplicitIneValidityYear(frontText: string): number | null {
  const text = upper(frontText);
  const range = text.match(
    /\bVIGENCIA\b[^0-9]{0,16}(20\d{2})[^0-9]{1,8}(20\d{2})\b/,
  );
  const single = text.match(/\bVIGENCIA\b[^0-9]{0,16}(20\d{2})\b/);
  return plausibleYear(range?.[2] ?? single?.[1] ?? null);
}

/**
 * Respaldo de lectura. El MRZ puede contener una fecha técnica, pero para la
 * vigencia operativa usamos únicamente su año y lo llevamos a 31/12, igual que
 * la vigencia visible de la credencial. Nunca auto-rechaza por sí solo.
 */
export function parseIneMrzValidityYear(reverseText: string): number | null {
  const lines = upper(reverseText)
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/[«‹]/g, "<")
        .replace(/\s+/g, "")
        .replace(/[^A-Z0-9<]/g, ""),
    )
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(
      /\d{6}[0-9A-Z]?[MHF](\d{2})(\d{2})(\d{2})[0-9A-Z]?/,
    );
    if (!match) continue;
    const year = plausibleYear(2000 + Number(match[1]));
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (
      year !== null &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return year;
    }
  }

  return null;
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

  const mrzYear = parseIneMrzValidityYear(input.reverseText ?? "");
  if (mrzYear !== null) {
    return assessmentForYear(mrzYear, now, "reverse_mrz");
  }

  return {
    status: "unknown",
    source: null,
    expirationYear: null,
    displayVigencia: null,
    canAutoReject: false,
  };
}
