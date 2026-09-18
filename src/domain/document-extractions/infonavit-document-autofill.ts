import {
  detectClabeFromBankStatementText,
  type ClabeBankStatementDetection,
} from "@/domain/document-extractions/clabe-bank-statement";

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
  code: "subject_mismatch";
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
  issues: ReadonlyArray<AutofillDocumentIssue>;
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
  // OCR de credenciales fotografiadas puede convertir el guion en comillas,
  // espacios o ruido. Exigimos la etiqueta VIGENCIA y dos años plausibles,
  // pero toleramos hasta 6 caracteres no numéricos entre ambos.
  const range = t.match(
    /\bVIGENCIA\b[^0-9]{0,16}(20\d{2})[^0-9]{1,6}(20\d{2})\b/,
  );
  const single = t.match(/\bVIGENCIA\b[^0-9]{0,16}(20\d{2})\b/);
  const year = Number(range?.[2] ?? single?.[1] ?? 0);
  if (!Number.isInteger(year) || year < 2020 || year > 2050) return null;
  return `31/12/${year}`;
}

function parseIneOcrNumber(text: string): string | null {
  const t = upper(text);
  const explicit = t.match(
    /\b(?:OCR|0CR)\b[^0-9O]{0,20}([0-9O]{12,13})\b/,
  );
  return explicit?.[1]?.replace(/O/g, "0") ?? null;
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
): InfonavitDocumentAutofillPatch["cliente"] {
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

  if (front.trim()) {
    const name = parseIneNameBlock(front);
    if (name.nombres && name.apellidoPaterno && name.apellidoMaterno) {
      out.nombres = high(name.nombres, "cliente_ine_frente", "ine_nombre_block");
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

    const ocr = parseIneOcrNumber(reverse);
    if (ocr) {
      out.identificacionNumero = high(
        ocr,
        "cliente_ine_reverso",
        "ine_ocr_explicit",
      );
    }
  }

  return out;
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

  const cpIndexes = lines
    .map((line, index) => ({
      index,
      match: line.match(/(?:\bC\.?\s*P\.?\s*[:\-]?\s*)?(\d{5})\b/i),
    }))
    .filter((row) => row.match != null);

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
      /\b(?:C\.?P\.?\s*)?\d{5}\b/i.test(line) ||
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
  expectedName?: string | null,
): InfonavitDocumentAutofillPatch["vivienda"] {
  if (!documentMatchesExpectedName(text, expectedName)) return {};
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
  const cliente = parseIne(front, reverse, expectedName);
  const comprobanteMatches =
    !comprobante.trim() || documentMatchesExpectedName(comprobante, expectedName);
  const vivienda = parseComprobante(comprobante, expectedName);
  const clabeDetection = estado.trim()
    ? detectClabeFromBankStatementText(estado)
    : undefined;
  const estadoMatches =
    !estado.trim() || documentMatchesExpectedName(estado, expectedName);

  const clabeDerechohabiente =
    estadoMatches && clabeDetection?.status === "detected"
      ? high(
          clabeDetection.clabe,
          "cliente_estado_cuenta",
          "estado_cuenta_clabe_checksum_label",
        )
      : undefined;

  const issues: AutofillDocumentIssue[] = [];
  if (comprobante.trim() && !comprobanteMatches) {
    issues.push({
      source: "cliente_comprobante_domicilio",
      code: "subject_mismatch",
      message:
        "El comprobante de domicilio no coincide suficientemente con el nombre del derechohabiente; no se usó para autollenar la vivienda.",
    });
  }
  if (estado.trim() && !estadoMatches) {
    issues.push({
      source: "cliente_estado_cuenta",
      code: "subject_mismatch",
      message:
        "El estado de cuenta no coincide suficientemente con el nombre del derechohabiente; no se usó para autollenar la CLABE.",
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
