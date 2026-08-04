import { deriveIdentityFromCurp, normalizeCurp } from "./curp-local";
import type {
  CampoComparacion,
  ConstanciaExtractedIdentity,
  ConstanciaStatus,
} from "./types";

export const CONSTANCIA_PARSER_VERSION = "p156.2" as const;

/** Normaliza texto para búsqueda de leyendas (sin persistir). */
export function normalizePdfSearchText(raw: string): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/Ñ/g, "N")
    .replace(/[^\w\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CURP_RE =
  /\b([A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9]\d)\b/;

const CERT_REGISTRO_CIVIL_RE =
  /CURP\s+CERTIFICADA\s*:?\s*VERIFICADA\s+CON\s+EL\s+REGISTRO\s+CIVIL/;

/** Certificación explícita distinta (no Registro Civil). */
const CERT_OTRA_RE =
  /CURP\s+CERTIFICADA\s*:?\s*VERIFICADA\s+CON\s+(?!EL\s+REGISTRO\s+CIVIL)[A-Z0-9 ]{3,80}/;

const STOP_LABEL =
  /\b(CURP|CLAVE|NOMBRE|NOMBRES|PRIMER|SEGUNDO|APELLIDO|SEXO|FECHA|NACIONALIDAD|ENTIDAD|DOCUMENTO|ANIO|NUMERO|MUNICIPIO|FOLIO|CERTIFICADA|VERIFICADA)\b/;

function valueAfterLabel(norm: string, labels: string[]): string | null {
  for (const label of labels) {
    const L = normalizePdfSearchText(label);
    const idx = norm.indexOf(L);
    if (idx < 0) continue;
    let after = norm.slice(idx + L.length).trim();
    after = after.replace(/^[:\-\s]+/, "").trim();
    if (!after) continue;
    const stop = after.search(STOP_LABEL);
    const chunk = (stop > 0 ? after.slice(0, stop) : after.slice(0, 80)).trim();
    if (chunk) return chunk;
  }
  return null;
}

function splitNombreCompleto(full: string | null): {
  nombre: string | null;
  primerApellido: string | null;
  segundoApellido: string | null;
} {
  if (!full) return { nombre: null, primerApellido: null, segundoApellido: null };
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { nombre: parts[0]!, primerApellido: null, segundoApellido: null };
  }
  if (parts.length === 2) {
    return {
      primerApellido: parts[0]!,
      segundoApellido: null,
      nombre: parts[1]!,
    };
  }
  return {
    primerApellido: parts[0]!,
    segundoApellido: parts[1]!,
    nombre: parts.slice(2).join(" "),
  };
}

function classifyDocumentoProbatorio(raw: string | null): string | null {
  if (!raw) return null;
  const n = normalizePdfSearchText(raw);
  if (/\bACTA\b/.test(n) && /\bNACIMIENTO\b/.test(n)) return "acta_nacimiento";
  if (/\bACTA\b/.test(n)) return "acta";
  if (n.length > 0) return "otro";
  return null;
}

function normalizeSexo(raw: string | null): string | null {
  if (!raw) return null;
  const n = normalizePdfSearchText(raw);
  if (/^(H|HOMBRE|MASCULINO|MASC)\b/.test(n)) return "H";
  if (/^(M|MUJER|FEMENINO|FEM)\b/.test(n)) return "M";
  if (/^(X|NO\s+BINARIO)\b/.test(n)) return "X";
  const first = n.split(/\s+/)[0] ?? "";
  if (first === "H" || first === "M" || first === "X") return first;
  return n.slice(0, 20) || null;
}

function normalizeFecha(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  const m = t.match(/(\d{2})[\/\-.\s]+(\d{2})[\/\-.\s]+(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

export type ParseConstanciaResult = Readonly<{
  status: ConstanciaStatus;
  extracted: ConstanciaExtractedIdentity;
  message: string;
}>;

/**
 * Analiza texto embebido de la constancia CURP.
 * No recibe ni persiste el PDF; el caller no debe loguear `text`.
 */
export function parseConstanciaCurpText(text: string): ParseConstanciaResult {
  const raw = String(text ?? "");
  const compact = raw.replace(/\s+/g, "");
  if (compact.length < 40) {
    return {
      status: "PDF_NO_LEGIBLE",
      extracted: emptyExtracted(),
      message: "El PDF no contiene texto legible. No se usó OCR.",
    };
  }

  const norm = normalizePdfSearchText(raw);
  const curpMatch = norm.match(CURP_RE);
  const curp = curpMatch ? normalizeCurp(curpMatch[1]!) : null;

  // Certificaciones mutuamente excluyentes (A/B/C)
  const certificadaRegistroCivil = CERT_REGISTRO_CIVIL_RE.test(norm);
  const certificacionOtraAutoridad = certificadaRegistroCivil
    ? false
    : CERT_OTRA_RE.test(norm);

  const nombreFromLabels = valueAfterLabel(norm, ["NOMBRE(S)", "NOMBRES", "NOMBRE"]);
  const primerApellidoLabel = valueAfterLabel(norm, ["PRIMER APELLIDO"]);
  const segundoApellidoLabel = valueAfterLabel(norm, ["SEGUNDO APELLIDO"]);
  const split = splitNombreCompleto(
    primerApellidoLabel || segundoApellidoLabel ? null : nombreFromLabels,
  );

  const nombreCompleto =
    nombreFromLabels ??
    ([split.primerApellido, split.segundoApellido, split.nombre]
      .filter(Boolean)
      .join(" ") ||
      null);

  let sexo = normalizeSexo(valueAfterLabel(norm, ["SEXO"]));
  let fechaNacimiento = normalizeFecha(
    valueAfterLabel(norm, ["FECHA DE NACIMIENTO"]),
  );
  let entidadNacimiento = valueAfterLabel(norm, ["ENTIDAD DE NACIMIENTO"]);

  // Compactas (p.ej. gob.mx) suelen omitir etiquetas: derivar de CURP
  if (curp) {
    const derived = deriveIdentityFromCurp(curp);
    if (!fechaNacimiento && derived.fechaNacimiento) {
      fechaNacimiento = derived.fechaNacimiento;
    }
    if (!sexo && derived.sexo) sexo = derived.sexo;
    if (!entidadNacimiento && derived.entidadNacimiento) {
      entidadNacimiento = derived.entidadNacimiento;
    }
  }

  const docProbRaw = valueAfterLabel(norm, [
    "DOCUMENTO PROBATORIO",
    "DOC PROBATORIO",
  ]);

  const extracted: ConstanciaExtractedIdentity = {
    curp,
    nombre:
      primerApellidoLabel || segundoApellidoLabel
        ? nombreFromLabels
        : split.nombre,
    primerApellido: primerApellidoLabel ?? split.primerApellido,
    segundoApellido: segundoApellidoLabel ?? split.segundoApellido,
    nombreCompleto,
    sexo,
    fechaNacimiento,
    nacionalidad: valueAfterLabel(norm, ["NACIONALIDAD"]),
    entidadNacimiento,
    documentoProbatorio: classifyDocumentoProbatorio(docProbRaw),
    anioRegistro: valueAfterLabel(norm, [
      "ANIO DE REGISTRO",
      "AÑO DE REGISTRO",
      "ANO DE REGISTRO",
    ]),
    numeroActa: valueAfterLabel(norm, ["NUMERO DE ACTA", "NÚMERO DE ACTA"]),
    entidadRegistro: valueAfterLabel(norm, ["ENTIDAD DE REGISTRO"]),
    municipioRegistro: valueAfterLabel(norm, ["MUNICIPIO DE REGISTRO"]),
    certificadaRegistroCivil,
    certificacionOtraAutoridad,
  };

  if (certificadaRegistroCivil) {
    return {
      status: "CURP_CERTIFICADA_REGISTRO_CIVIL",
      extracted,
      message: "CURP certificada por el Registro Civil",
    };
  }
  if (certificacionOtraAutoridad) {
    return {
      status: "CERTIFICACION_OTRA_AUTORIDAD",
      extracted,
      message: "Certificación detectada de otra autoridad",
    };
  }
  return {
    status: "CURP_NO_CERTIFICADA",
    extracted,
    message: "Constancia legible sin certificación del Registro Civil",
  };
}

function emptyExtracted(): ConstanciaExtractedIdentity {
  return {
    curp: null,
    nombre: null,
    primerApellido: null,
    segundoApellido: null,
    nombreCompleto: null,
    sexo: null,
    fechaNacimiento: null,
    nacionalidad: null,
    entidadNacimiento: null,
    documentoProbatorio: null,
    anioRegistro: null,
    numeroActa: null,
    entidadRegistro: null,
    municipioRegistro: null,
    certificadaRegistroCivil: false,
    certificacionOtraAutoridad: false,
  };
}

const CAMPO_KEYS = [
  "curp",
  "nombre",
  "apellido_paterno",
  "apellido_materno",
  "fecha_nacimiento",
  "sexo",
  "entidad_nacimiento",
] as const;

type CampoKey = (typeof CAMPO_KEYS)[number];

function mapCampoComparacionToKey(campo: string): CampoKey | null {
  switch (campo) {
    case "CURP":
      return "curp";
    case "Nombre":
      return "nombre";
    case "Primer apellido":
      return "apellido_paterno";
    case "Segundo apellido":
      return "apellido_materno";
    case "Fecha de nacimiento":
      return "fecha_nacimiento";
    case "Sexo":
      return "sexo";
    case "Entidad de nacimiento":
      return "entidad_nacimiento";
    default:
      return null;
  }
}

/**
 * Resumen seguro para persistir: flags / coincidencias, sin PII completa.
 * Los valores extraídos quedan solo en memoria del navegador.
 */
export function buildConstanciaResultadoResumido(
  parsed: ParseConstanciaResult,
  comparacion: readonly CampoComparacion[] = [],
): Record<string, unknown> {
  const e = parsed.extracted;
  const campos_coinciden: Record<string, boolean | null> = {};
  const campos_con_diferencia: string[] = [];
  const campos_no_disponibles: string[] = [];

  for (const key of CAMPO_KEYS) {
    campos_coinciden[key] = null;
  }

  for (const c of comparacion) {
    const key = mapCampoComparacionToKey(c.campo);
    if (!key) continue;
    if (c.resultado === "coincide") {
      campos_coinciden[key] = true;
    } else if (c.resultado === "no_coincide") {
      campos_coinciden[key] = false;
      campos_con_diferencia.push(key);
    } else {
      campos_coinciden[key] = null;
      if (!campos_no_disponibles.includes(key)) campos_no_disponibles.push(key);
    }
  }

  const presentFlags: Record<string, boolean> = {
    curp: Boolean(e.curp),
    nombre: Boolean(e.nombre || e.nombreCompleto),
    apellido_paterno: Boolean(e.primerApellido),
    apellido_materno: Boolean(e.segundoApellido),
    fecha_nacimiento: Boolean(e.fechaNacimiento),
    sexo: Boolean(e.sexo),
    entidad_nacimiento: Boolean(e.entidadNacimiento),
    nacionalidad: Boolean(e.nacionalidad),
    documento_probatorio: Boolean(e.documentoProbatorio),
    anio_registro: Boolean(e.anioRegistro),
    numero_acta: Boolean(e.numeroActa),
    entidad_registro: Boolean(e.entidadRegistro),
    municipio_registro: Boolean(e.municipioRegistro),
  };

  for (const key of CAMPO_KEYS) {
    if (!presentFlags[key] && campos_coinciden[key] === null) {
      if (!campos_no_disponibles.includes(key)) campos_no_disponibles.push(key);
    }
  }

  return {
    texto_legible:
      parsed.status !== "PDF_NO_LEGIBLE" && parsed.status !== "ERROR_ANALISIS",
    status: parsed.status,
    message: parsed.message,
    certificada_registro_civil: e.certificadaRegistroCivil === true,
    certificacion_otra_autoridad: e.certificacionOtraAutoridad === true,
    acta_vinculada_registro_civil: e.certificadaRegistroCivil === true,
    curp_presente: Boolean(e.curp),
    nombre_presente: Boolean(e.nombre || e.nombreCompleto),
    fecha_presente: Boolean(e.fechaNacimiento),
    sexo_presente: Boolean(e.sexo),
    entidad_nacimiento_presente: Boolean(e.entidadNacimiento),
    campos_presentes: presentFlags,
    campos_coinciden,
    campos_con_diferencia,
    campos_no_disponibles: [...new Set(campos_no_disponibles)],
    documento_probatorio: e.documentoProbatorio,
    parser_version: CONSTANCIA_PARSER_VERSION,
  };
}

/** Tipos a invalidar según el cambio de datos (selectivo). */
export function tiposInvalidacionPorCambio(change: {
  curp?: boolean;
  nombreApellidosFecha?: boolean;
  rfc?: boolean;
  constanciaReemplazada?: boolean;
}): string[] {
  const out = new Set<string>();
  if (change.curp) {
    for (const t of [
      "curp_local",
      "curp_constancia",
      "curp_certificacion_registro_civil",
      "curp_coincidencia_datos",
      "rfc_estimado",
      "rfc_validacion_sat",
    ]) {
      out.add(t);
    }
  }
  if (change.nombreApellidosFecha) {
    out.add("curp_coincidencia_datos");
    out.add("rfc_estimado");
  }
  if (change.rfc) {
    out.add("rfc_estimado");
    out.add("rfc_validacion_sat");
  }
  if (change.constanciaReemplazada) {
    out.add("curp_constancia");
    out.add("curp_certificacion_registro_civil");
    out.add("curp_coincidencia_datos");
  }
  return [...out];
}
