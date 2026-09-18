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
  const range = t.match(
    /\bVIGENCIA\s*[:\-]?\s*(\d{4})\s*(?:-|A|AL)\s*(\d{4})\b/,
  );
  const single = t.match(/\bVIGENCIA\s*[:\-]?\s*(20\d{2})\b/);
  const year = Number(range?.[2] ?? single?.[1] ?? 0);
  if (!Number.isInteger(year) || year < 2020 || year > 2050) return null;
  return ${31/12/${year}};
}

function parseIneOcrNumber(text: string): string | null {
  const t = upper(text).replace(/[O]/g, "0");
  const explicit = t.match(/\bOCR\b[^0-9]{0,20}(\d{12,13})\b/);
  return explicit?.[1] ?? null;
}

function high(
  value: string,
  source: AutofillFieldSource,
  rule: string,
): AutofillValue {
  return { value: compactLine(value), source, confidence: "high", rule };
}

function parseIne(
  front: string,
  reverse: string,
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

  const ocr = parseIneOcrNumber(reverse);
  if (ocr) {
    out.identificacionNumero = high(
      ocr,
      "cliente_ine_reverso",
      "ine_ocr_explicit",
    );
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
        ${comprobante_${key}},
      );
    }
  }
  return out;
}

export function buildInfonavitDocumentAutofillPatch(
  texts: InfonavitDocumentTexts,
): InfonavitDocumentAutofillPatch {
  const front = texts.ineFrente ?? "";
  const reverse = texts.ineReverso ?? "";
  const comprobante = texts.comprobanteDomicilio ?? "";
  const estado = texts.estadoCuenta ?? "";

  const cliente = parseIne(front, reverse);
  const vivienda = parseComprobante(comprobante);
  const clabeDetection = estado.trim()
    ? detectClabeFromBankStatementText(estado)
    : undefined;

  const clabeDerechohabiente =
    clabeDetection?.status === "detected"
      ? high(
          clabeDetection.clabe,
          "cliente_estado_cuenta",
          "estado_cuenta_clabe_checksum_label",
        )
      : undefined;

  return {
    cliente,
    vivienda,
    clabeDerechohabiente,
    clabeDetection,
  };
}

export function comparableAutofillValue(raw: string | null | undefined): string {
  return alnumComparable(raw ?? "");
}
