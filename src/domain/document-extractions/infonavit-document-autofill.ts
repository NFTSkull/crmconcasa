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
  expectedCurp?: string | null;
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
  // Evita aceptar basura OCR como "S." como apellido completo.
  if (!/[A-ZÁÉÍÓÚÜÑ]{2}/i.test(clean)) return false;
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
  const indexes = lines
    .map((line, index) => (/^NOMBRE(?:S)?\b/.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (indexes.length === 0) return {};

  let best:
    | {
        apellidoPaterno?: string;
        apellidoMaterno?: string;
        nombres?: string;
        score: number;
      }
    | null = null;

  for (const idx of indexes) {
    // Mantener posición de los renglones es más seguro que compactarlos:
    // si OCR lee ANZALDO como "DO", no desplazamos MARTINEZ a paterno.
    const slots: Array<string | null> = [];
    const inlineRaw = lines[idx]!.replace(/^NOMBRE(?:S)?\s*:?-?\s*/i, "");
    const inline = cleanPersonLine(inlineRaw);
    if (inlineRaw.trim()) {
      slots.push(isLikelyPersonLine(inline) ? inline : null);
    }

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
      slots.push(isLikelyPersonLine(clean) ? clean : null);
      if (slots.length >= 4) break;
    }

    if (slots.length < 3) continue;
    const nombres = slots
      .slice(2)
      .filter((value): value is string => Boolean(value))
      .join(" ");
    const candidate = {
      ...(slots[0] ? { apellidoPaterno: slots[0] } : {}),
      ...(slots[1] ? { apellidoMaterno: slots[1] } : {}),
      ...(nombres ? { nombres } : {}),
    };

    const values = [
      candidate.apellidoPaterno,
      candidate.apellidoMaterno,
      candidate.nombres,
    ].filter((value): value is string => Boolean(value));
    const score =
      values.length * 100 +
      values.reduce((sum, value) => sum + alnumComparable(value).length, 0);

    if (!best || score > best.score) {
      best = { ...candidate, score };
    }
  }

  if (!best) return {};
  return {
    ...(best.apellidoPaterno
      ? { apellidoPaterno: best.apellidoPaterno }
      : {}),
    ...(best.apellidoMaterno
      ? { apellidoMaterno: best.apellidoMaterno }
      : {}),
    ...(best.nombres ? { nombres: best.nombres } : {}),
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

  // Último año del bloque VIGENCIA (rango → año final; año único → ese).
  // VERSIÓN ANTERIOR: years.length >= 2 ? years[1] : years[0]
  const year = years.length > 0 ? years[years.length - 1] : null;
  return year ? String(year) : null;
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

function completeIneNameMatchesExpected(
  detected: string,
  expected: string,
): boolean {
  const detectedTokens = significantNameTokens(detected).sort();
  const expectedTokens = significantNameTokens(expected).sort();
  if (detectedTokens.length < 3 || expectedTokens.length < 2) return true;
  if (detectedTokens.length !== expectedTokens.length) return false;
  return detectedTokens.every((token, index) => token === expectedTokens[index]);
}

function normalizeCurpCandidate(raw: string | null | undefined): string {
  return upper(raw ?? "").replace(/[^A-Z0-9]/g, "");
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
      out.vigencia = String(year);
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
  expectedCurp?: string | null,
): Readonly<{
  cliente: InfonavitDocumentAutofillPatch["cliente"];
  frontNameMismatch: boolean;
  detectedFrontName: string | null;
  frontCurpRejected: boolean;
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
  let frontNameMismatch = false;
  let detectedFrontName: string | null = null;
  let frontCurpRejected = false;

  if (front.trim()) {
    // El nombre capturado en Datos Generales es la fuente operativa.
    // La INE solo se compara cuando las tres partes se leyeron completas;
    // nunca se usa para sobrescribir nombres/apellidos.
    const name = parseIneNameBlock(front);
    if (
      name.nombres &&
      name.apellidoPaterno &&
      name.apellidoMaterno &&
      significantNameTokens(name.nombres).length > 0 &&
      significantNameTokens(name.apellidoPaterno).length > 0 &&
      significantNameTokens(name.apellidoMaterno).length > 0
    ) {
      detectedFrontName = [
        name.nombres,
        name.apellidoPaterno,
        name.apellidoMaterno,
      ].join(" ");
      frontNameMismatch = Boolean(
        expectedName &&
          !completeIneNameMatchesExpected(detectedFrontName, expectedName),
      );
    }

    const curp = parseCurp(front);
    if (curp) {
      const expectedCurpNormalized = normalizeCurpCandidate(expectedCurp);
      const detectedCurpNormalized = normalizeCurpCandidate(curp);
      if (
        expectedCurpNormalized &&
        expectedCurpNormalized.length === 18 &&
        expectedCurpNormalized !== detectedCurpNormalized
      ) {
        frontCurpRejected = true;
      } else {
        out.curp = high(curp, "cliente_ine_frente", "ine_curp_regex");
      }
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
        "ine_vigencia_year",
      );
    }

    out.identificacionTipo = high(
      "INE",
      "cliente_ine_frente",
      "ine_document_type",
    );
  }

  const mrz = parseIneMrz(reverse);
  const identificationNumber = parseIneIdentificationNumber(reverse);
  const mrzValidityDate = parseIneMrzValidityDate(reverse);

  // El reverso es la fuente del número de identificación. El T7 es independiente
  // de que la fecha MRZ o el nombre también hayan sido leídos correctamente.
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

  if (!out.identificacionVigencia && mrzValidityDate) {
    const [year] = mrzValidityDate.split("-");
    out.identificacionVigencia = high(
      year,
      "cliente_ine_reverso",
      "ine_mrz_expiry_year",
    );
  }

  if (identificationNumber) {
    out.identificacionNumero = high(
      identificationNumber.value,
      "cliente_ine_reverso",
      identificationNumber.rule,
    );
  }

  return {
    cliente: out,
    frontNameMismatch,
    detectedFrontName,
    frontCurpRejected,
  };
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
  const joined = normalizedComparable(lines.slice(0, 60).join(" "));
  const hasServiceNumber = /\bNO\s+DE\s+SERVICIO\b/.test(joined);
  const hasRmu = /\bRMU\b/.test(joined);
  return (
    joined.includes("COMISION FEDERAL DE ELECTRICIDAD") ||
    /(^|\s)CFE(\s|$)/.test(joined) ||
    // El OCR puede perder el logotipo/nombre CFE, pero NO. DE SERVICIO + RMU
    // juntos identifican de forma fuerte el formato del recibo.
    (hasServiceNumber && hasRmu)
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


function municipalityFromCfeLocationLines(
  linesAfterStreet: readonly string[],
): string | undefined {
  // En CFE una calle puede llamarse GUADALUPE, MONTERREY, etc. No debemos
  // inferir municipio desde la calle. Buscamos desde el final las líneas de
  // ubicación (N.L./Nuevo León/CP), que corresponden al bloque territorial.
  for (let i = linesAfterStreet.length - 1; i >= 0; i--) {
    const line = linesAfterStreet[i]!;
    const anchored =
      /\bN\.?\s*L\.?\b|\bNUEVO\s+LE[OÓ]N\b|C\.?\s*P\.?\s*[:.\-]?\s*\d{4,5}\b/i.test(
        line,
      );
    if (!anchored) continue;
    const municipality = municipalityFromText(line);
    if (municipality) return municipality;
  }

  for (let i = linesAfterStreet.length - 1; i >= 0; i--) {
    const municipality = municipalityFromText(linesAfterStreet[i]!);
    if (municipality) return municipality;
  }
  return undefined;
}

function parseCfeStreetLine(
  raw: string,
): { calle: string; noExt: string } | null {
  const withoutCp = compactLine(
    raw
      .replace(
        /C\.?\s*P\.?\s*[:.\-]?\s*\d{4,5}\b.*$/i,
        "",
      )
      // OCR real de CFE puede dejar un fragmento incompleto como "CP.6"
      // al final del renglón. Un CP mexicano requiere 5 dígitos, así que ese
      // sufijo no puede ser el exterior ni parte de la calle.
      .replace(/\s+C\.?\s*P\.?\s*[:.\-]?\s*\d{0,3}\s*$/i, ""),
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
    !/[A-ZÁÉÍÓÚÜÑ]/i.test(candidate)
  ) {
    return null;
  }

  return { calle: candidate, noExt: last[1] };
}

function parseCfeResidentialColonia(
  lines: readonly string[],
): string | undefined {
  for (const raw of lines) {
    // Formato real CFE: "LOS FRESNOS FRACC.P.67515". En este layout
    // FRACC. cierra el nombre de colonia y P. introduce el código postal.
    const fraccBeforePostal = raw.match(
      /^(.+?)\s+FRACC(?:IONAMIENTO)?\.?\s*(?:C\.?\s*)?P\.?\s*[:.\-]?\s*\d{4,5}\b/i,
    );
    if (fraccBeforePostal?.[1]) {
      const candidate = compactLine(fraccBeforePostal[1]);
      if (candidate) return candidate;
    }

    const cleaned = compactLine(
      raw
        .replace(/C\.?\s*P\.?\s*[:.\-]?\s*\d{4,5}.*$/i, "")
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
      .replace(/C\.?\s*P\.?\s*[:.\-]?\s*\d{4,5}\b.*$/i, "")
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
    ) ||
    /^(?:GRAL|GENERAL|MPO|MUNICIPIO|N\.?\s*L\.?)\.?$/i.test(cleaned)
  ) {
    return false;
  }

  // CFE suele imprimir entrecalles como "PALMAS Y LAUREL" o
  // "M JARDIN Y M LAGO". Ese renglón no debe convertirse en colonia.
  if (/^(?:ENTRE\s+)?[A-ZÁÉÍÓÚÜÑ0-9 .'-]{1,32}\s+Y\s+[A-ZÁÉÍÓÚÜÑ0-9 .'-]{1,32}$/i.test(cleaned)) {
    return false;
  }

  const municipality = municipalityFromText(cleaned);
  if (
    municipality &&
    (alnumComparable(cleaned) === alnumComparable(municipality) ||
      (municipality === "GENERAL ESCOBEDO" &&
        alnumComparable(cleaned) === alnumComparable("ESCOBEDO")) ||
      (municipality === "GENERAL ZUAZUA" &&
        alnumComparable(cleaned) === alnumComparable("ZUAZUA")))
  ) {
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

function parseCfeColoniaBeforeExplicitCp(
  addressLinesAfterStreet: readonly string[],
): string | undefined {
  for (const raw of addressLinesAfterStreet) {
    const cpMatch = /C\.?\s*P\.?\s*[:.\-]?\s*(\d{5})\b/i.exec(raw);
    if (!cpMatch?.[1] || cpMatch[1] === "00000" || cpMatch.index == null) {
      continue;
    }

    const beforeCp = compactLine(raw.slice(0, cpMatch.index));
    if (!beforeCp) continue;

    // CFE suele juntar colonia + municipio + CP en una sola línea.
    // Si hay municipio, conservamos únicamente el prefijo de colonia.
    const beforeMunicipality = cfeColoniaPrefixBeforeMunicipality(beforeCp);
    if (beforeMunicipality) return beforeMunicipality;

    // Una línea puramente municipal, por ejemplo "MONTERREY C.P.64530" o
    // "PESQUERIA NL C.P.99999", nunca debe convertirse en colonia.
    const municipality = municipalityFromText(beforeCp);
    if (municipality) {
      const comparable = alnumComparable(beforeCp);
      const municipalityComparable = alnumComparable(municipality);
      const withoutState = comparable
        .replace(/NUEVOLEON/g, "")
        .replace(/NL/g, "");
      if (
        withoutState === municipalityComparable ||
        (municipality === "GENERAL ZUAZUA" &&
          /^(?:GRAL|GENERAL)?ZUAZUA$/.test(withoutState)) ||
        (municipality === "ZUAZUA" &&
          /^(?:GRAL|GENERAL)?ZUAZUA$/.test(withoutState))
      ) {
        continue;
      }
    }

    if (isLikelyCfeColoniaFallback(beforeCp)) {
      return cleanCfeLocationLine(beforeCp);
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
      /\bN\.?\s*L\.?\b|\bNUEVO\s+LE[OÓ]N\b|C\.?\s*P\.?\s*[:.\-]?\s*\d{4,5}\b/i.test(
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

  // El encabezado corporativo de CFE puede intercalarse en el orden OCR.
  // Tomamos una ventana algo más amplia; después filtramos explícitamente el
  // domicilio corporativo antes de buscar la calle del bloque del cliente.
  const rawBlock = lines.slice(Math.max(0, serviceIdx - 16), serviceIdx);
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
  const addressLinesAfterStreet = addressBlock.slice(1);
  const addressJoined = addressBlock.join(" ");

  const explicitCpCandidates: string[] = [];
  const fallbackCpCandidates: string[] = [];
  for (const line of addressBlock) {
    for (const match of line.matchAll(
      /C\.?\s*P\.?\s*[:.\-]?\s*(\d{5})\b/gi,
    )) {
      const cp = match[1];
      if (cp && cp !== "00000") explicitCpCandidates.push(cp);
    }
    for (const match of line.matchAll(/\b(\d{5})\b/g)) {
      const cp = match[1];
      if (cp && cp !== "00000") fallbackCpCandidates.push(cp);
    }
  }
  // Un RFC/RMU puede contener secuencias de 5 dígitos. Cuando CFE imprime
  // explícitamente C.P., esa etiqueta siempre tiene prioridad.
  const cp = explicitCpCandidates.at(-1) ?? fallbackCpCandidates.at(-1);

  const municipio =
    municipalityFromCfeLocationLines(addressLinesAfterStreet) ??
    municipalityFromText(addressJoined);
  const locationJoined = addressLinesAfterStreet.join(" ");
  const entidad =
    /\bNUEVO\s+LE[OÓ]N\b|\bN\.?\s*L\.?\b/i.test(locationJoined)
      ? "NUEVO LEÓN"
      : undefined;

  const col = addressJoined.match(
    /\b(?:COL(?:ONIA)?|FRACC(?:IONAMIENTO)?)\.?\s+([A-ZÁÉÍÓÚÜÑ0-9 .'-]{3,45}?)(?=\s+(?:C\.?P\.?|\d{5}\b|NUEVO\s+LE[OÓ]N|N\.?L\.?\b|MONTERREY|APODACA|GUADALUPE|GENERAL\s+ESCOBEDO|SAN\s+NICOL))/i,
  );
  const colonia = col?.[1]
    ? compactLine(col[1])
    : parseCfeResidentialColonia(addressBlock.slice(1)) ??
      parseCfeColoniaBeforeExplicitCp(addressBlock.slice(1)) ??
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

function parseLabeledServiceAddressCandidate(text: string): {
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
  const labelPattern =
    /\b(?:DIRECCI[OÓ]N|DOMICILIO)\s+(?:DE(?:L)?\s+)?(?:SERVICIO|SUMINISTRO)\b/i;
  const labelIndex = lines.findIndex((line) => labelPattern.test(line));
  if (labelIndex < 0) return null;

  const labelLine = lines[labelIndex]!;
  const inline = compactLine(labelLine.replace(labelPattern, ""));
  const addressLines: string[] = [];
  if (inline) addressLines.push(inline);

  for (let i = labelIndex + 1; i < Math.min(lines.length, labelIndex + 8); i++) {
    const line = lines[i]!;
    if (
      /\b(?:DATOS\s+FISCALES|CONTRATO|N\.?I\.?R\.?|SITIO|MEDIDOR|LECTURA|TARIFA|FACTURACI[OÓ]N|TOTAL|SALDO|PERIODO|FECHA\s+DE\s+CORTE)\b/i.test(
        line,
      )
    ) {
      break;
    }
    addressLines.push(line);
  }

  if (addressLines.length === 0) return null;

  let calle: string | undefined;
  let noExt: string | undefined;
  let streetIndex = -1;
  for (let i = 0; i < addressLines.length; i++) {
    const parsed = parseCfeStreetLine(addressLines[i]!);
    if (!parsed) continue;
    calle = parsed.calle;
    noExt = parsed.noExt;
    streetIndex = i;
    break;
  }
  if (!calle || !noExt || streetIndex < 0) return null;

  const scoped = addressLines.slice(streetIndex);
  const afterStreet = scoped.slice(1);
  const joined = scoped.join(" ");

  const explicitCp = [...joined.matchAll(/C\.?\s*P\.?\s*[:.\-]?\s*(\d{5})\b/gi)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value) && value !== "00000");
  const fallbackCp = [...joined.matchAll(/\b(\d{5})\b/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value) && value !== "00000");
  const cp = explicitCp.at(-1) ?? fallbackCp.at(-1);

  const municipio =
    municipalityFromCfeLocationLines(afterStreet) ??
    municipalityFromText(joined);
  const entidad =
    /\bNUEVO\s+LE[OÓ]N\b|\bN\.?\s*L\.?\b/i.test(joined)
      ? "NUEVO LEÓN"
      : undefined;

  const explicitColonia = joined.match(
    /\b(?:COL(?:ONIA)?|FRACC(?:IONAMIENTO)?)\.?\s+([A-ZÁÉÍÓÚÜÑ0-9 .'-]{3,60}?)(?=\s+(?:C\.?P\.?|\d{5}\b|NUEVO\s+LE[OÓ]N|N\.?L\.?\b|MONTERREY|APODACA|GUADALUPE|GENERAL\s+ESCOBEDO|SAN\s+NICOL|JU[ÁA]REZ|PESQUER[IÍ]A))/i,
  );

  let colonia = explicitColonia?.[1]
    ? compactLine(explicitColonia[1])
    : undefined;

  if (!colonia) {
    for (const raw of afterStreet) {
      const cleaned = cleanCfeLocationLine(raw);
      if (!cleaned) continue;
      const locationAnchor =
        municipalityFromText(raw) !== undefined ||
        /\bN\.?\s*L\.?\b|\bNUEVO\s+LE[OÓ]N\b|C\.?\s*P\.?\s*[:.\-]?\s*\d{5}\b/i.test(
          raw,
        );
      if (locationAnchor) break;
      if (isLikelyCfeColoniaFallback(cleaned)) {
        colonia = cleaned;
        break;
      }
    }
  }

  const noInt = joined.match(
    /\b(?:INT(?:ERIOR)?|DEPTO|DEP(?:ARTAMENTO)?)\.?\s*[:#-]?\s*([A-Z0-9-]{1,10})\b/i,
  )?.[1];
  const lote = joined.match(
    /\b(?:LOTE|LT)\.?\s*[:#-]?\s*([A-Z0-9-]+)\b/i,
  )?.[1];
  const manzana = joined.match(
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

/**
 * Compañía Mexicana de Gas imprime el domicilio del cliente en un bloque
 * "DATOS GENERALES" con etiquetas propias:
 *   Calle: HACIENDA ANAHUAC # 509
 *   Colonia: HACIENDAS DE ESCOBEDO
 *   Mpo/Edo: ESCOBEDO, C.P. 66057
 *
 * Este parser está deliberadamente limitado a ese proveedor para no alterar
 * CFE ni los comprobantes genéricos que ya funcionan.
 */
function parseMexicanaGasAddressCandidate(text: string): {
  direccionCompleta?: string;
  calle?: string;
  noExt?: string;
  colonia?: string;
  entidad?: string;
  municipio?: string;
  cp?: string;
} | null {
  const lines = normalizedLines(text);
  const head = normalizedComparable(lines.slice(0, 30).join(" "));
  if (!head.includes("MEXICANA DE GAS")) return null;

  const calleLine = lines.find((line) => /^CALLE\s*[:\-]/i.test(line));
  const coloniaLine = lines.find((line) => /^COLONIA\s*[:\-]/i.test(line));
  const locationLine = lines.find((line) =>
    /^MPO\s*\/\s*EDO\s*[:\-]/i.test(line),
  );

  if (!calleLine) return null;

  const calleRaw = compactLine(
    calleLine.replace(/^CALLE\s*[:\-]\s*/i, ""),
  );
  const streetMatch =
    calleRaw.match(/^(.{2,70}?)\s+#\s*([0-9]+[A-Z0-9-]*)\s*$/i) ??
    calleRaw.match(/^(.{2,70}?)\s+([0-9]+[A-Z0-9-]*)\s*$/i);
  if (!streetMatch?.[1] || !streetMatch?.[2]) return null;

  const calle = compactLine(streetMatch[1]).replace(/\s*#\s*$/, "");
  const noExt = streetMatch[2];
  if (!calle || !/[A-ZÁÉÍÓÚÜÑ]/i.test(calle)) return null;

  const colonia = coloniaLine
    ? compactLine(coloniaLine.replace(/^COLONIA\s*[:\-]\s*/i, ""))
    : undefined;

  const locationRaw = locationLine
    ? compactLine(locationLine.replace(/^MPO\s*\/\s*EDO\s*[:\-]\s*/i, ""))
    : "";
  const cp =
    locationRaw.match(/C\.?\s*P\.?\s*[:.\-]?\s*(\d{5})\b/i)?.[1] ??
    lines
      .map((line) => line.match(/C\.?\s*P\.?\s*[:.\-]?\s*(\d{5})\b/i)?.[1])
      .find((value): value is string => Boolean(value));
  const locationWithoutCp = compactLine(
    locationRaw
      .replace(/,?\s*C\.?\s*P\.?\s*[:.\-]?\s*\d{5}\b.*$/i, "")
      .replace(/[,;]+$/, ""),
  );
  const municipio = locationWithoutCp
    ? municipalityFromText(locationWithoutCp)
    : undefined;

  // Este formato usa "Mpo/Edo" pero en el ejemplo imprime solo el municipio.
  // Si el valor corresponde inequívocamente a nuestro catálogo de Nuevo León,
  // completamos la entidad sin adivinar desde números o encabezados fiscales.
  const entidad = municipio ? "NUEVO LEÓN" : undefined;

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

  const mexicanaGas = parseMexicanaGasAddressCandidate(text);
  if (mexicanaGas) return mexicanaGas;

  const cfe = parseCfeAddressCandidate(text);
  if (cfe) return cfe;

  const hasCfeServiceAnchor = lines.some((line) =>
    /\b(?:NO\.?\s*DE\s*SERVICIO|N[ÚU]MERO\s+DE\s+SERVICIO|RMU|RPU)\b/i.test(
      line,
    ),
  );
  if (isCfeDocument(lines) && hasCfeServiceAnchor) {
    // En un CFE real con ancla de servicio nunca caemos al parser genérico de
    // CP: el mismo recibo trae el domicilio corporativo y sería peor llenar
    // Paseo de la Reforma / 06600. Solo queda como respaldo un bloque
    // explícito DIRECCIÓN/DOMICILIO DE SERVICIO.
    return parseLabeledServiceAddressCandidate(text) ?? {};
  }

  const serviceAddress = parseLabeledServiceAddressCandidate(text);
  if (serviceAddress) return serviceAddress;

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
  const expectedCurp = options.expectedCurp ?? null;
  const ine = parseIne(front, reverse, expectedName, expectedCurp);
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
    ine.frontNameMismatch &&
    ine.detectedFrontName &&
    expectedName?.trim()
  ) {
    issues.push({
      source: "cliente_ine_frente",
      code: "subject_mismatch",
      message:
        `La INE parece mostrar “${ine.detectedFrontName}”, diferente al nombre de Datos Generales “${expectedName}”. No se modificó el nombre; revísalo manualmente si hace falta.`,
    });
  }
  if (ine.frontCurpRejected) {
    issues.push({
      source: "cliente_ine_frente",
      code: "low_confidence",
      message:
        "La CURP leída por OCR no coincide exactamente con Datos Generales; se conservó la CURP capturada para evitar sustituirla por una lectura dudosa.",
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
