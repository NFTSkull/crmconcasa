import {
  detectClabeFromBankStatementText,
  type ClabeBankStatementDetection,
} from "@/domain/document-extractions/clabe-bank-statement";
import {
  parseIneMrzT7Number,
  parseIneMrzValidityDate,
} from "@/domain/document-extractions/ine-validity";

export type AutofillFieldSource =
  | "cliente_ine_frente"
  | "cliente_ine_reverso"
  | "cliente_comprobante_domicilio"
  | "cliente_estado_cuenta";

export type AutofillConfidence = "high" | "medium";

export type AutofillValue<T = string> = Readonly<{
  value: T;
  source: AutofillFieldSource;
  confidence: AutofillConfidence;
  rule: string;
}>;

export type AutofillDocumentIssue = Readonly<{
  source: AutofillFieldSource;
  code: "subject_mismatch" | "low_confidence";
  message: string;
}>;

export type InfonavitDocumentAutofillPatch = Readonly<{
  cliente: Readonly<{
    nombres?: AutofillValue;
    apellidoPaterno?: AutofillValue;
    apellidoMaterno?: AutofillValue;
    curp?: AutofillValue;
    genero?: AutofillValue<"M" | "F">;
    identificacionTipo?: AutofillValue;
    identificacionNumero?: AutofillValue;
    identificacionVigencia?: AutofillValue;
  }>;
  vivienda: Readonly<{
    direccionCompleta?: AutofillValue;
    calle?: AutofillValue;
    noExt?: AutofillValue;
    noInt?: AutofillValue;
    lote?: AutofillValue;
    manzana?: AutofillValue;
    colonia?: AutofillValue;
    entidad?: AutofillValue;
    municipio?: AutofillValue;
    cp?: AutofillValue;
  }>;
  clabeDerechohabiente?: AutofillValue;
  clabeDetection?: ClabeBankStatementDetection;
  issues?: ReadonlyArray<AutofillDocumentIssue>;
}>;

export type InfonavitDocumentAutofillOptions = Readonly<{
  expectedClienteNombre?: string | null;
}>;

export type InfonavitDocumentTexts = Readonly<{
  ineFrente?: string | null;
  ineReverso?: string | null;
  comprobanteDomicilio?: string | null;
  estadoCuenta?: string | null;
}>;

function upper(raw: string): string {
  return String(raw ?? "")
    .replace(/\r/g, "\n")
    .toLocaleUpperCase("es-MX");
}

function compactLine(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function normalizedLines(raw: string): string[] {
  return upper(raw)
    .split(/\n+/)
    .map(compactLine)
    .filter(Boolean);
}

function alnumComparable(raw: string): string {
  return upper(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function cleanPersonLine(raw: string): string {
  return compactLine(raw)
    .replace(/[^A-ZÁÉÍÓÚÜÑ' .-]/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyPersonLine(raw: string): boolean {
  const clean = cleanPersonLine(raw);
  if (!clean || /\d/.test(clean)) return false;
  if (clean.length < 2 || clean.length > 45) return false;
  return !/(INSTITUTO|NACIONAL|ELECTORAL|CREDENCIAL|VOTAR|DOMICILIO|CURP|SEXO|VIGENCIA|CLAVE|ELECTOR|SECCI[OÓ]N|EMISI[OÓ]N|LOCALIDAD|M[ÉE]XICO)/i.test(
    clean,
  );
}

function parseIneNameBlock(text: string): {
  apellidoPaterno?: string;
  apellidoMaterno?: string;
  nombres?: string;
} {
  const lines = normalizedLines(text);
  const idx = lines.findIndex((line) => /^NOMBRE(?:S)?\b/.test(line));
  if (idx < 0) return {};

  const values: string[] = [];
  const inline = cleanPersonLine(
    lines[idx]!.replace(/^NOMBRE(?:S)?\s*:?-?\s*/i, ""),
  );
  if (isLikelyPersonLine(inline)) values.push(inline);

  for (let i = idx + 1; i < Math.min(lines.length, idx + 7); i++) {
    const line = lines[i]!;
    if (
      /^(DOMICILIO|CURP|SEXO|CLAVE\s+DE\s+ELECTOR|VIGENCIA|SECCI[OÓ]N|FECHA\s+DE\s+NACIMIENTO)/i.test(
        line,
      )
    ) {
      break;
    }
    const clean = cleanPersonLine(line);
    if (isLikelyPersonLine(clean)) values.push(clean);
    if (values.length >= 4) break;
  }

  if (values.length < 3) return {};
  return {
    apellidoPaterno: values[0],
    apellidoMaterno: values[1],
    nombres: values.slice(2).join(" "),
  };
}

function parseCurp(text: string): string | null {
  const t = upper(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const match = t.match(
    /\b([A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d)\b/,
  );
  return match?.[1] ?? null;
}

function parseIneGender(text: string): "M" | "F" | null {
  const t = upper(text);
  const match = t.match(/\bSEXO\s*[:\-]?\s*([HM])\b/);
  if (!match) return null;
  return match[1] === "H" ? "M" : "F";
}

function parseIneValidity(text: string): string | null {
  const t = upper(text);
  const labelIndex = t.search(/\bVIGENCIA\b/);
  if (labelIndex < 0) return null;

  // Limitar la corrección O/0 e I/1 a la ventana numérica posterior a VIGENCIA
  // evita alterar nombres/CURP y tolera OCR como "2O25 - 2O35".
  const window = t
    .slice(labelIndex, labelIndex + 96)
    .replace(/[OQ]/g, "0")
    .replace(/[I|L]/g, "1");
  const years = [...window.matchAll(/\b(20\d{2})\b/g)]
    .map((match) => Number(match[1]))
    .filter((year) => Number.isInteger(year) && year >= 2020 && year <= 2050);

  const year = years.length >= 2 ? years[1] : years[0];
  return year ? `31/12/${year}` : null;
}

function parseIneIdentificationNumber(
  text: string,
): { value: string; rule: string } | null {
  const t = upper(text);
  const labelIndex = t.search(/\b(?:OCR|0CR)\b/);
  if (labelIndex >= 0) {
    const window = t.slice(labelIndex, labelIndex + 96);
    const explicit = window.match(
      /\b(?:OCR|0CR)\b[^0-9OQ]{0,20}((?:[0-9OQ][\s.\-:]*){12,13})/,
    );
    if (explicit?.[1]) {
      const digits = explicit[1].replace(/[OQ]/g, "0").replace(/\D/g, "");
      if (/^\d{12,13}$/.test(digits)) {
        return { value: digits, rule: "ine_ocr_explicit" };
      }
    }
  }

  const t7 = parseIneMrzT7Number(text);
  return t7 ? { value: t7, rule: "ine_mrz_t7" } : null;
}

function high(
  value: string,
  source: AutofillFieldSource,
  rule: string,
): AutofillValue {
  return { value: compactLine(value), source, confidence: "high", rule };
}

const NAME_STOPWORDS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "Y"]);

function significantNameTokens(raw: string): string[] {
  return upper(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^A-Z]+/)
    .filter((token) => token.length >= 3 && !NAME_STOPWORDS.has(token));
}

function documentMatchesExpectedName(
  text: string,
  expectedName: string | null | undefined,
): boolean {
  const tokens = significantNameTokens(expectedName ?? "");
  if (tokens.length < 2) return true;
  const haystack = alnumComparable(text);
  const matches = tokens.filter((token) => haystack.includes(token)).length;
  return matches >= Math.min(2, tokens.length);
}

function parseIneMrz(text: string): {
  nombres?: string;
  apellidoPaterno?: string;
  apellidoMaterno?: string;
  genero?: "M" | "F";
  vigencia?: string;
} {
  const lines = upper(text)
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/[«‹]/g, "<")
        .replace(/\s+/g, "")
        .replace(/[^A-Z0-9<]/g, ""),
    )
    .filter(Boolean);

  const out: {
    nombres?: string;
    apellidoPaterno?: string;
    apellidoMaterno?: string;
    genero?: "M" | "F";
    vigencia?: string;
  } = {};

  const dataLine = lines.find((line) =>
    /\d{6}[0-9A-Z]?[HM]\d{6}[0-9A-Z]?/.test(line),
  );
  const data = dataLine?.match(
    /\d{6}[0-9A-Z]?([HM])(\d{2})(\d{2})(\d{2})[0-9A-Z]?/,
  );
  if (data) {
    out.genero = data[1] === "H" ? "M" : "F";
    const yy = Number(data[2]);
    const mm = Number(data[3]);
    const dd = Number(data[4]);
    const year = 2000 + yy;
    if (
      year >= 2020 &&
      year <= 2050 &&
      mm >= 1 &&
      mm <= 12 &&
      dd >= 1 &&
      dd <= 31
    ) {
      out.vigencia = `${String(dd).padStart(2, "0")}/${String(mm).padStart(
        2,
        "0",
      )}/${year}`;
    }
  }

  const nameLine = lines.find(
    (line) =>
      line.includes("<<") &&
      !/\d/.test(line) &&
      /^[A-Z<]{8,}$/.test(line),
  );
  if (nameLine) {
    const [surnamesRaw, namesRaw = ""] = nameLine.split("<<", 2);
    const surnames = surnamesRaw.split("<").filter(Boolean);
    const nombres = namesRaw.split("<").filter(Boolean).join(" ");
    if (surnames[0]) out.apellidoPaterno = surnames[0];
    if (surnames[1]) out.apellidoMaterno = surnames[1];
    if (nombres) out.nombres = nombres;
  }

  return out;
}

function parseIne(
  front: string,
  reverse: string,
  expectedName?: string | null,
): Readonly<{
  cliente: InfonavitDocumentAutofillPatch["cliente"];
  frontNameRejected: boolean;
}> {
  const out: {
    nombres?: AutofillValue;
    apellidoPaterno?: AutofillValue;
    apellidoMaterno?: AutofillValue;
    curp?: AutofillValue;
    genero?: AutofillValue<"M" | "F">;
    identificacionTipo?: AutofillValue;
    identificacionNumero?: AutofillValue;
    identificacionVigencia?: AutofillValue;
  } = {};
  let frontNameRejected = false;

  if (front.trim()) {
    const name = parseIneNameBlock(front);
    if (name.nombres && name.apellidoPaterno && name.apellidoMaterno) {
      const parsedFullName = [
        name.nombres,
        name.apellidoPaterno,
        name.apellidoMaterno,
      ].join(" ");
      const nameMatchesExpected =
        !expectedName ||
        documentMatchesExpectedName(parsedFullName, expectedName);

      if (nameMatchesExpected) {
        out.nombres = high(
          name.nombres,
          "cliente_ine_frente",
          "ine_nombre_block",
        );
        out.apellidoPaterno = high(
          name.apellidoPaterno,
          "cliente_ine_frente",
          "ine_nombre_block",
        );
        out.apellidoMaterno = high(
          name.apellidoMaterno,
          "cliente_ine_frente",
          "ine_nombre_block",
        );
      } else {
        // Nunca sustituir un nombre correcto de Generales con ruido OCR del INE.
        // El reverso/MRZ todavía puede aportar identidad si sí coincide.
        frontNameRejected = true;
      }
    }

    const curp = parseCurp(front);
    if (curp) {
      out.curp = high(curp, "cliente_ine_frente", "ine_curp_regex");
    }

    const genero = parseIneGender(front);
    if (genero) {
      out.genero = {
        value: genero,
        source: "cliente_ine_frente",
        confidence: "high",
        rule: "ine_sexo_explicit",
      };
    }

    const vigencia = parseIneValidity(front);
    if (vigencia) {
      out.identificacionVigencia = high(
        vigencia,
        "cliente_ine_frente",
        "ine_vigencia_year_to_dec31",
      );
    }

    out.identificacionTipo = high(
      "INE",
      "cliente_ine_frente",
      "ine_document_type",
    );
  }

  const mrz = parseIneMrz(reverse);
  const mrzName = [
    mrz.nombres,
    mrz.apellidoPaterno,
    mrz.apellidoMaterno,
  ]
    .filter(Boolean)
    .join(" ");
  const reverseMatches =
    !expectedName ||
    (mrzName
      ? documentMatchesExpectedName(mrzName, expectedName)
      : documentMatchesExpectedName(reverse, expectedName));
  const identificationNumber = parseIneIdentificationNumber(reverse);
  const mrzValidityDate = parseIneMrzValidityDate(reverse);
  const hasStructuredReverseIdentity =
    identificationNumber !== null && mrzValidityDate !== null;
  // El OCR del reverso puede leer perfectamente MRZ/T7 y perder la línea de
  // nombre. No descartamos esos dos campos estructurados solo por esa pérdida,
  // siempre que el frente no haya demostrado pertenecer a otra persona.
  const structuredReverseTrusted =
    reverseMatches || (!frontNameRejected && hasStructuredReverseIdentity);

  if (reverseMatches) {
    if (!out.nombres && mrz.nombres) {
      out.nombres = high(
        mrz.nombres,
        "cliente_ine_reverso",
        "ine_mrz_name",
      );
    }
    if (!out.apellidoPaterno && mrz.apellidoPaterno) {
      out.apellidoPaterno = high(
        mrz.apellidoPaterno,
        "cliente_ine_reverso",
        "ine_mrz_name",
      );
    }
    if (!out.apellidoMaterno && mrz.apellidoMaterno) {
      out.apellidoMaterno = high(
        mrz.apellidoMaterno,
        "cliente_ine_reverso",
        "ine_mrz_name",
      );
    }
    if (!out.genero && mrz.genero) {
      out.genero = {
        value: mrz.genero,
        source: "cliente_ine_reverso",
        confidence: "high",
        rule: "ine_mrz_gender",
      };
    }
    if (!out.identificacionVigencia && mrz.vigencia) {
      out.identificacionVigencia = high(
        mrz.vigencia,
        "cliente_ine_reverso",
        "ine_mrz_expiry",
      );
    }
  }

  if (structuredReverseTrusted) {
    if (!out.identificacionVigencia && mrzValidityDate) {
      const [year, month, day] = mrzValidityDate.split("-");
      out.identificacionVigencia = high(
        `${day}/${month}/${year}`,
        "cliente_ine_reverso",
        "ine_mrz_expiry",
      );
    }
    if (identificationNumber) {
      out.identificacionNumero = high(
        identificationNumber.value,
        "cliente_ine_reverso",
        identificationNumber.rule,
      );
    }
  }

  return { cliente: out, frontNameRejected };
}

const NL_MUNICIPALITIES = [
  "MONTERREY",
  "APODACA",
  "GUADALUPE",
  "GENERAL ESCOBEDO",
  "ESCOBEDO",
  "SAN NICOLAS DE LOS GARZA",
  "SAN NICOLÁS DE LOS GARZA",
  "SANTA CATARINA",
  "GARCIA",
  "GARCÍA",
  "JUAREZ",
  "JUÁREZ",
  "CADEREYTA JIMENEZ",
  "CADEREYTA JIMÉNEZ",
  "PESQUERIA",
  "PESQUERÍA",
  "SALINAS VICTORIA",
  "SANTIAGO",
  "MONTEMORELOS",
  "LINARES",
  "CIENEGA DE FLORES",
  "CIÉNEGA DE FLORES",
  "EL CARMEN",
  "GENERAL ZUAZUA",
  "ZUAZUA",
] as const;

function normalizedComparable(raw: string): string {
  return upper(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCfeDocument(lines: readonly string[]): boolean {
  const joined = normalizedComparable(lines.slice(0, 40).join(" "));
  return (
    joined.includes("COMISION FEDERAL DE ELECTRICIDAD") ||
    /(^|\s)CFE(\s|$)/.test(joined)
  );
}

function isCfeCorporateLine(line: string): boolean {
  const normalized = normalizedComparable(line);
  return (
    normalized.includes("COMISION FEDERAL DE ELECTRICIDAD") ||
    normalized.includes("PASEO DE LA REFORMA") ||
    normalized.includes("ALCALDIA CUAUHTEMOC") ||
    normalized.includes("CIUDAD DE MEXICO") ||
    normalized.includes("RFC CFE") ||
    normalized.includes("BASICA") ||
    normalized.includes("CORPORATIVO")
  );
}

function municipalityFromText(raw: string): string | undefined {
  const normalized = normalizedComparable(raw);
  // CFE suele abreviar "SAN NICOLAS DE LOS G., N.L." y el OCR puede perder
  // "ARZA". Esa forma sigue siendo inequívoca dentro de Nuevo León.
  if (/\bSAN\s+NICOLAS\s+DE\s+LOS\s+G(?:\b|\s|,|\.)/.test(normalized)) {
    return "SAN NICOLÁS DE LOS GARZA";
  }

  const comparable = alnumComparable(raw);
  for (const municipality of NL_MUNICIPALITIES) {
    if (comparable.includes(alnumComparable(municipality))) {
      return municipality === "ESCOBEDO"
        ? "GENERAL ESCOBEDO"
        : municipality.toLocaleUpperCase("es-MX");
    }
  }
  return undefined;
}

function parseCfeStreetLine(
  raw: string,
): { calle: string; noExt: string } | null {
  const withoutCp = compactLine(
    raw.replace(
      /\bC\.?\s*P\.?\s*[:.\-]?\s*\d{4,5}\b.*$/i,
      "",
    ),
  );
  if (!withoutCp) return null;

  if (
    /\b(?:TOTAL|PAGO|PAGAR|LIMITE|CORTE|PERIODO|TARIFA|CUENTA|RMU|RPU|SERVICIO|FACTURADO|LECTURA)\b/i.test(
      withoutCp,
    )
  ) {
    return null;
  }

  const explicit = withoutCp.match(
    /^(.{2,70}?)\s+(?:#|NO\.?|NUM\.?|N[ÚU]MERO)\s*[:#-]?\s*([0-9]+[A-Z0-9-]*)\s*$/i,
  );
  if (explicit?.[1] && explicit?.[2]) {
    return {
      calle: compactLine(explicit[1]),
      noExt: explicit[2],
    };
  }

  const numbers = [
    ...withoutCp.matchAll(/\b([0-9]+[A-Z0-9-]*)\b/g),
  ];
  const last = numbers.at(-1);
  if (!last || last.index == null) return null;

  // En "CALLE 9 52" el 9 forma parte del nombre de la calle y 52 es exterior.
  // Tomar siempre el último bloque numérico evita cortar "CALLE 9" como "CALLE".
  const candidate = compactLine(withoutCp.slice(0, last.index));
  if (
    candidate.length < 2 ||
    !/[A-ZÁÉÍÓÚÜÑ]/i.test(candidate) ||
    /^(MONTERREY|APODACA|GUADALUPE|JUAREZ|JUÁREZ)$/i.test(candidate)
  ) {
    return null;
  }

  return { calle: candidate, noExt: last[1] };
}

function parseCfeResidentialColonia(
  lines: readonly string[],
): string | undefined {
  for (const raw of lines) {
    const cleaned = compactLine(
      raw
        .replace(/\bC\.?\s*P\.?\s*[:.\-]?\s*\d{4,5}.*$/i, "")
        .replace(/\b\d{5}\b.*$/i, ""),
    );
    if (!cleaned) continue;
    if (
      /\b(?:COL(?:ONIA)?|FRACC(?:IONAMIENTO)?|RESID(?:ENCIAL)?|RDCIAL)\b/i.test(
        cleaned,
      )
    ) {
      const explicit = cleaned.match(
        /\b(?:COL(?:ONIA)?|FRACC(?:IONAMIENTO)?)\.?\s+(.+)$/i,
      );
      return compactLine(explicit?.[1] ?? cleaned);
    }
  }
  return undefined;
}

function cleanCfeLocationLine(raw: string): string {
  return compactLine(
    raw
      .replace(/\bC\.?\s*P\.?\s*[:.\-]?\s*\d{4,5}\b.*$/i, "")
      .replace(/\bN\.?\s*L\.?\s*(?:,\s*N\.?\s*L\.?)?\s*$/i, ""),
  );
}

function isLikelyCfeColoniaFallback(raw: string): boolean {
  const cleaned = cleanCfeLocationLine(raw);
  if (
    cleaned.length < 3 ||
    cleaned.length > 70 ||
    !/[A-ZÁÉÍÓÚÜÑ]/i.test(cleaned) ||
    /\b(?:DIRECCI[OÓ]N|SERVICIO|DATOS|FISCALES|NOMBRE|CONTRATO|SITIO|MEDIDOR|LECTURA|TARIFA|FACTURACI[OÓ]N|TOTAL|PAGO|PAGAR|RMU|RPU)\b/i.test(
      cleaned,
    )
  ) {
    return false;
  }

  // CFE suele imprimir entrecalles como "PALMAS Y LAUREL" o
  // "M JARDIN Y M LAGO". Ese renglón no debe convertirse en colonia.
  if (/^(?:ENTRE\s+)?[A-ZÁÉÍÓÚÜÑ0-9 .'-]{1,32}\s+Y\s+[A-ZÁÉÍÓÚÜÑ0-9 .'-]{1,32}$/i.test(cleaned)) {
    return false;
  }
  return true;
}

function cfeColoniaPrefixBeforeMunicipality(raw: string): string | undefined {
  const cleaned = cleanCfeLocationLine(raw);
  if (!cleaned) return undefined;

  const originalTokens = cleaned.split(/\s+/).filter(Boolean);
  const normalizedTokens = originalTokens.map((token) => normalizedComparable(token));
  const aliases = [...NL_MUNICIPALITIES].sort(
    (a, b) => normalizedComparable(b).split(" ").length - normalizedComparable(a).split(" ").length,
  );

  for (const municipality of aliases) {
    const municipalityTokens = normalizedComparable(municipality).split(" ");
    for (
      let start = 0;
      start <= normalizedTokens.length - municipalityTokens.length;
      start++
    ) {
      const matches = municipalityTokens.every(
        (token, offset) => normalizedTokens[start + offset] === token,
      );
      if (!matches || start === 0) continue;
      const candidate = compactLine(originalTokens.slice(0, start).join(" "));
      if (isLikelyCfeColoniaFallback(candidate)) return candidate;
    }
  }
  return undefined;
}

function parseCfeStructuralColonia(
  addressLinesAfterStreet: readonly string[],
): string | undefined {
  for (let i = 0; i < addressLinesAfterStreet.length; i++) {
    const line = addressLinesAfterStreet[i]!;
    const prefix = cfeColoniaPrefixBeforeMunicipality(line);
    if (prefix) return prefix;

    const hasLocationAnchor =
      municipalityFromText(line) !== undefined ||
      /\bN\.?\s*L\.?\b|\bNUEVO\s+LE[OÓ]N\b|\bC\.?\s*P\.?\s*[:.\-]?\s*\d{4,5}\b/i.test(
        line,
      );
    if (!hasLocationAnchor || i === 0) continue;

    const previous = addressLinesAfterStreet[i - 1]!;
    if (isLikelyCfeColoniaFallback(previous)) {
      return cleanCfeLocationLine(previous);
    }
  }
  return undefined;
}

/**
 * CFE imprime también su domicilio corporativo (p. ej. Paseo de la Reforma 164,
 * CP 06600). Para vivienda solo es autoridad el bloque del cliente que está
 * inmediatamente antes de NO. DE SERVICIO / RMU.
 */
function parseCfeAddressCandidate(text: string): {
  direccionCompleta?: string;
  calle?: string;
  noExt?: string;
  noInt?: string;
  lote?: string;
  manzana?: string;
  colonia?: string;
  entidad?: string;
  municipio?: string;
  cp?: string;
} | null {
  const lines = normalizedLines(text);
  if (!isCfeDocument(lines)) return null;

  const serviceIdx = lines.findIndex((line) =>
    /\b(?:NO\.?\s*DE\s*SERVICIO|N[ÚU]MERO\s+DE\s+SERVICIO|RMU|RPU)\b/i.test(
      line,
    ),
  );
  if (serviceIdx < 0) return null;

  const rawBlock = lines.slice(Math.max(0, serviceIdx - 10), serviceIdx);
  const block = rawBlock.filter(
    (line) =>
      !isCfeCorporateLine(line) &&
      !/\bTOTAL\s+A\s+PAGAR\b|\bPAGAR\b|\$\s*\d/i.test(line),
  );
  if (block.length === 0) return null;

  let calle: string | undefined;
  let noExt: string | undefined;
  let streetIndex = -1;

  for (let i = 0; i < block.length; i++) {
    const parsed = parseCfeStreetLine(block[i]!);
    if (!parsed) continue;
    calle = parsed.calle;
    noExt = parsed.noExt;
    streetIndex = i;
    break;
  }

  if (!calle || !noExt) return null;

  const addressBlock = block.slice(streetIndex);
  const addressJoined = addressBlock.join(" ");

  const cpCandidates: string[] = [];
  for (const line of addressBlock) {
    const matches = [...line.matchAll(/(?:\bC\.?\s*P\.?\s*[:\-]?\s*)?(\d{5})\b/gi)];
    for (const match of matches) {
      const cp = match[1];
      if (cp && cp !== "00000") cpCandidates.push(cp);
    }
  }
  const cp = cpCandidates.at(-1);

  const municipio = municipalityFromText(addressJoined);
  const entidad =
    /\bNUEVO\s+LE[OÓ]N\b|\bN\.?\s*L\.?\b/i.test(addressJoined)
      ? "NUEVO LEÓN"
      : undefined;

  const col = addressJoined.match(
    /\b(?:COL(?:ONIA)?|FRACC(?:IONAMIENTO)?)\.?\s+([A-ZÁÉÍÓÚÜÑ0-9 .'-]{3,45}?)(?=\s+(?:C\.?P\.?|\d{5}\b|NUEVO\s+LE[OÓ]N|N\.?L\.?\b|MONTERREY|APODACA|GUADALUPE|GENERAL\s+ESCOBEDO|SAN\s+NICOL))/i,
  );
  const colonia = col?.[1]
    ? compactLine(col[1])
    : parseCfeResidentialColonia(addressBlock.slice(1)) ??
      parseCfeStructuralColonia(addressBlock.slice(1));

  const noInt = addressJoined.match(
    /\b(?:INT(?:ERIOR)?|DEPTO|DEP(?:ARTAMENTO)?)\.?\s*[:#-]?\s*([A-Z0-9-]{1,10})\b/i,
  )?.[1];
  const lote = addressJoined.match(
    /\b(?:LOTE|LT)\.?\s*[:#-]?\s*([A-Z0-9-]+)\b/i,
  )?.[1];
  const manzana = addressJoined.match(
    /\b(?:MANZANA|MZA?|MZ)\.?\s*[:#-]?\s*([A-Z0-9-]+)\b/i,
  )?.[1];

  const direccionCompleta = [
    [calle, noExt].filter(Boolean).join(" "),
    colonia ? `COL. ${colonia}` : "",
    municipio ?? "",
    entidad ?? "",
    cp ? `CP ${cp}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return {
    ...(direccionCompleta ? { direccionCompleta } : {}),
    calle,
    noExt,
    ...(noInt ? { noInt } : {}),
    ...(lote ? { lote } : {}),
    ...(manzana ? { manzana } : {}),
    ...(colonia ? { colonia } : {}),
    ...(entidad ? { entidad } : {}),
    ...(municipio ? { municipio } : {}),
    ...(cp ? { cp } : {}),
  };
}

function parseAddressCandidate(text: string): {
  direccionCompleta?: string;
  calle?: string;
  noExt?: string;
  noInt?: string;
  lote?: string;
  manzana?: string;
  colonia?: string;
  entidad?: string;
  municipio?: string;
  cp?: string;
} {
  const lines = normalizedLines(text);
  if (lines.length === 0) return {};

  const cfe = parseCfeAddressCandidate(text);
  if (cfe) return cfe;

  const cpIndexes = lines
    .map((line, index) => ({
      index,
      match: line.match(/(?:\bC\.?\s*P\.?\s*[:\-]?\s*)?(\d{5})\b/i),
    }))
    .filter((row) => row.match != null && row.match?.[1] !== "00000");

  if (cpIndexes.length === 0) return {};

  const picked =
    cpIndexes.find((row) => row.index <= Math.ceil(lines.length * 0.55)) ??
    cpIndexes[0]!;
  const start = Math.max(0, picked.index - 4);
  const end = Math.min(lines.length, picked.index + 4);
  const block = lines.slice(start, end);
  const joined = block.join(" ");

  const out: {
    direccionCompleta?: string;
    calle?: string;
    noExt?: string;
    noInt?: string;
    lote?: string;
    manzana?: string;
    colonia?: string;
    entidad?: string;
    municipio?: string;
    cp?: string;
  } = {
    cp: picked.match?.[1],
    direccionCompleta: block.join(", "),
  };

  if (/\bNUEVO\s+LE[OÓ]N\b|\bN\.?\s*L\.?\b/i.test(joined)) {
    out.entidad = "NUEVO LEÓN";
  }

  for (const municipality of NL_MUNICIPALITIES) {
    if (alnumComparable(joined).includes(alnumComparable(municipality))) {
      out.municipio =
        municipality === "ESCOBEDO"
          ? "GENERAL ESCOBEDO"
          : municipality.toLocaleUpperCase("es-MX");
      break;
    }
  }

  const col = joined.match(
    /\b(?:COL(?:ONIA)?|FRACC(?:IONAMIENTO)?)\.?\s+([A-ZÁÉÍÓÚÜÑ0-9 .'-]{3,45}?)(?=\s+(?:C\.?P\.?|\d{5}\b|NUEVO\s+LE[OÓ]N|N\.?L\.?\b|MONTERREY|APODACA|GUADALUPE|GENERAL\s+ESCOBEDO|SAN\s+NICOL))/i,
  );
  if (col?.[1]) out.colonia = compactLine(col[1]);

  const noInt = joined.match(
    /\b(?:INT(?:ERIOR)?|DEPTO|DEP(?:ARTAMENTO)?)\.?\s*[:#-]?\s*([A-Z0-9-]{1,10})\b/i,
  );
  if (noInt?.[1]) out.noInt = noInt[1];

  const lote = joined.match(/\b(?:LOTE|LT)\.?\s*[:#-]?\s*([A-Z0-9-]+)\b/i);
  if (lote?.[1]) out.lote = lote[1];

  const mz = joined.match(
    /\b(?:MANZANA|MZA?|MZ)\.?\s*[:#-]?\s*([A-Z0-9-]+)\b/i,
  );
  if (mz?.[1]) out.manzana = mz[1];

  for (const line of block) {
    if (
      /CFE|SUMINISTRO|SERVICIO|TARIFA|MEDIDOR|TOTAL|PAGAR|CUENTA|RPU/i.test(
        line,
      )
    ) {
      continue;
    }
    const street = line.match(
      /^(.{3,55}?)\s+(?:#|NO\.?|NUM\.?|N[ÚU]MERO\s*)?([0-9]+[A-Z0-9-]*)\b/i,
    );
    if (street?.[1] && street?.[2]) {
      const candidate = compactLine(street[1]);
      if (/[A-ZÁÉÍÓÚÜÑ]/i.test(candidate)) {
        out.calle = candidate;
        out.noExt = street[2];
        break;
      }
    }
  }

  return out;
}

function parseComprobante(
  text: string,
): InfonavitDocumentAutofillPatch["vivienda"] {
  const parsed = parseAddressCandidate(text);
  const out: {
    direccionCompleta?: AutofillValue;
    calle?: AutofillValue;
    noExt?: AutofillValue;
    noInt?: AutofillValue;
    lote?: AutofillValue;
    manzana?: AutofillValue;
    colonia?: AutofillValue;
    entidad?: AutofillValue;
    municipio?: AutofillValue;
    cp?: AutofillValue;
  } = {};

  for (const key of [
    "direccionCompleta",
    "calle",
    "noExt",
    "noInt",
    "lote",
    "manzana",
    "colonia",
    "entidad",
    "municipio",
    "cp",
  ] as const) {
    const value = parsed[key];
    if (value) {
      out[key] = high(
        value,
        "cliente_comprobante_domicilio",
        `comprobante_${key}`,
      );
    }
  }
  return out;
}

export function buildInfonavitDocumentAutofillPatch(
  texts: InfonavitDocumentTexts,
  options: InfonavitDocumentAutofillOptions = {},
): InfonavitDocumentAutofillPatch {
  const front = texts.ineFrente ?? "";
  const reverse = texts.ineReverso ?? "";
  const comprobante = texts.comprobanteDomicilio ?? "";
  const estado = texts.estadoCuenta ?? "";

  const expectedName = options.expectedClienteNombre ?? null;
  const ine = parseIne(front, reverse, expectedName);
  const cliente = ine.cliente;
  const comprobanteMatches =
    !comprobante.trim() || documentMatchesExpectedName(comprobante, expectedName);
  const vivienda = parseComprobante(comprobante);
  const clabeDetection = estado.trim()
    ? detectClabeFromBankStatementText(estado)
    : undefined;
  const estadoMatches =
    !estado.trim() || documentMatchesExpectedName(estado, expectedName);

  const clabeDerechohabiente =
    clabeDetection?.status === "detected"
      ? high(
          clabeDetection.clabe,
          "cliente_estado_cuenta",
          "estado_cuenta_clabe_checksum_label",
        )
      : undefined;

  const issues: AutofillDocumentIssue[] = [];
  if (
    ine.frontNameRejected &&
    !(cliente.nombres && cliente.apellidoPaterno && cliente.apellidoMaterno)
  ) {
    issues.push({
      source: "cliente_ine_frente",
      code: "low_confidence",
      message:
        "La INE no permitió leer el nombre con suficiente confianza; se conservaron los datos correctos de Datos Generales para no reemplazarlos con ruido OCR.",
    });
  }
  if (comprobante.trim() && !comprobanteMatches) {
    issues.push({
      source: "cliente_comprobante_domicilio",
      code: "subject_mismatch",
      message:
        "El titular del comprobante no coincide con Datos Generales; se usó de todos modos como fuente de la dirección cargada en el expediente.",
    });
  }
  if (estado.trim() && !estadoMatches) {
    issues.push({
      source: "cliente_estado_cuenta",
      code: "subject_mismatch",
      message:
        "El titular del estado de cuenta no coincide con Datos Generales; si la CLABE fue detectada con etiqueta y checksum válidos, se usó como fuente del documento cargado.",
    });
  }

  return {
    cliente,
    vivienda,
    clabeDerechohabiente,
    clabeDetection,
    issues,
  };
}

export function comparableAutofillValue(raw: string | null | undefined): string {
  return alnumComparable(raw ?? "");
}
