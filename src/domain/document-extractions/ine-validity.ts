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
  const rawUpper = upper(reverseText);

  // El servicio OCR marca explícitamente cuándo dos lecturas independientes
  // coinciden. Esa señal manda sobre cualquier texto ruidoso adicional.
  const verified = rawUpper.match(/\bINE_T7_VERIFIED\s*[:\-]?\s*(\d{13})\b/);
  if (verified?.[1]) return verified[1];

  // Si las lecturas discrepan, fallamos cerrado: es preferible dejar el campo
  // vacío para revisión manual que autollenar un dígito equivocado.
  if (/\bINE_T7_UNVERIFIED\b/.test(rawUpper)) return null;

  const lines = normalizedMrzLines(reverseText);
  const compact = lines.join("");
  if (!compact) return null;

  const numeric = "[0-9OQILZSBG]";
  const candidates = new Set<string>();
  const addCandidate = (raw: string | undefined) => {
    if (!raw) return;
    const digits = normalizeNumericOcr(raw).replace(/\D/g, "");
    if (/^\d{13}$/.test(digits)) candidates.add(digits);
  };

  // Primero conservar el final de línea como frontera. La cámara/OCR puede
  // convertir uno de los dos signos << en un dígito, así que en una línea
  // anclada a DMEX toleramos un solo "<".
  for (const line of lines) {
    const anchoredLine = line.match(
      new RegExp(
        `(?:[I1T]?DMEX)${numeric}{9,12}<+(${numeric}{13})(?:<|$)`,
      ),
    );
    addCandidate(anchoredLine?.[1]);

    if (line.includes("<<")) {
      const sameLine = line.match(
        new RegExp(`<{2,}(${numeric}{13})(?:<|$)`),
      );
      addCandidate(sameLine?.[1]);
    }
  }

  const dmexIndex = compact.search(/(?:[I1T]?DMEX)/);
  if (dmexIndex >= 0) {
    const anchoredWindow = compact.slice(dmexIndex, dmexIndex + 96);
    const anchored = anchoredWindow.match(
      new RegExp(
        `(?:[I1T]?DMEX)${numeric}{9,12}<+(${numeric}{13})`,
      ),
    );
    addCandidate(anchored?.[1]);
  }

  // Si Tesseract partió IDMEX y el separador en dos líneas, mantenemos un
  // fallback muy acotado.
  if (compact.includes("MEX") || compact.includes("DMEX")) {
    for (const line of lines) {
      const splitLine = line.match(
        new RegExp(`^${numeric}{1,4}<{1,}(${numeric}{13})(?:<|$)`),
      );
      addCandidate(splitLine?.[1]);

      const fallback = line.match(
        new RegExp(`<{2,}(${numeric}{13})(?:<|$)`),
      );
      addCandidate(fallback?.[1]);
    }
  }

  // Sin marcador de consenso (p. ej. texto embebido de PDF), solo aceptamos
  // cuando todas las apariciones estructurales apuntan al mismo T7.
  return candidates.size === 1 ? [...candidates][0]! : null;
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

function parseExplicitIneValidityYears(frontText: string): number[] {
  const text = upper(frontText);
  const labelIndex = text.indexOf("VIGENCIA");
  if (labelIndex < 0) return [];

  // El OCR de INE puede desordenar columnas y dejar "2025 2035" varias líneas
  // después de la etiqueta VIGENCIA. 80 caracteres era demasiado corto y podía
  // capturar solo el primer año del rango (inicio) como si fuera expiración.
  // El bloque sigue acotado y solo admite años plausibles 2020–2050.
  const validityBlock = text
    .slice(labelIndex, labelIndex + 260)
    .replace(/O/g, "0");
  return [...validityBlock.matchAll(/\b(20\d{2})\b/g)]
    .map((match) => Number(match[1]))
    .filter((year) => plausibleYear(year) !== null);
}

/**
 * La Credencial para Votar expresa su vigencia por año. Cuando aparece un rango
 * (p. ej. "VIGENCIA 2016-2026" / "2024 - 2034" / "2024/2034") el ÚLTIMO año
 * del bloque anclado a VIGENCIA es el de expiración.
 */
export function parseExplicitIneValidityYear(frontText: string): number | null {
  const years = parseExplicitIneValidityYears(frontText);
  if (years.length === 0) return null;
  return plausibleYear(years[years.length - 1] ?? null);
}

/**
 * Respaldo de lectura. El MRZ puede contener una fecha técnica, pero para la
 * vigencia mostrada/capturada usamos únicamente su año, igual que la vigencia
 * visible de la credencial.
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
    displayVigencia: String(year),
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
    displayVigencia: String(year),
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
  const frontText = input.frontText ?? "";
  const explicitYears = parseExplicitIneValidityYears(frontText);
  const explicitYear =
    explicitYears.length > 0
      ? plausibleYear(explicitYears[explicitYears.length - 1] ?? null)
      : null;
  if (explicitYear !== null) {
    const assessment = assessmentForYear(explicitYear, now, "front_explicit");
    return {
      ...assessment,
      // Fail-safe: un único año OCR puede ser el inicio de un rango cuyo año
      // final quedó fuera de lectura. Solo permitimos rechazo automático cuando
      // el frente aportó al menos dos años plausibles dentro de VIGENCIA.
      canAutoReject:
        assessment.status === "expired" && explicitYears.length >= 2,
    };
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
