import type { CurpDerivedIdentity, CurpLocalStatus } from "./types";

/** Diccionario oficial del dígito verificador CURP. */
const CURP_DICT = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";

const ENTIDADES: Readonly<Record<string, string>> = {
  AS: "AGUASCALIENTES",
  BC: "BAJA CALIFORNIA",
  BS: "BAJA CALIFORNIA SUR",
  CC: "CAMPECHE",
  CL: "COAHUILA",
  CM: "COLIMA",
  CS: "CHIAPAS",
  CH: "CHIHUAHUA",
  DF: "CIUDAD DE MEXICO",
  DG: "DURANGO",
  GT: "GUANAJUATO",
  GR: "GUERRERO",
  HG: "HIDALGO",
  JC: "JALISCO",
  MC: "MEXICO",
  MN: "MICHOACAN",
  MS: "MORELOS",
  NT: "NAYARIT",
  NL: "NUEVO LEON",
  OC: "OAXACA",
  PL: "PUEBLA",
  QT: "QUERETARO",
  QR: "QUINTANA ROO",
  SP: "SAN LUIS POTOSI",
  SL: "SINALOA",
  SR: "SONORA",
  TC: "TABASCO",
  TS: "TAMAULIPAS",
  TL: "TLAXCALA",
  VZ: "VERACRUZ",
  YN: "YUCATAN",
  ZS: "ZACATECAS",
  NE: "NACIDO EN EL EXTRANJERO",
};

/** Normaliza CURP: mayúsculas, sin espacios ni guiones. */
export function normalizeCurp(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ]/g, "");
}

export function curpCheckDigit(body17: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = body17[i] ?? "";
    const idx = CURP_DICT.indexOf(ch);
    if (idx < 0) return "";
    sum += idx * (18 - i);
  }
  const mod = sum % 10;
  const digit = (10 - mod) % 10;
  return String(digit);
}

export function deriveIdentityFromCurp(curpRaw: string): CurpDerivedIdentity {
  const curp = normalizeCurp(curpRaw);
  if (curp.length !== 18) {
    return { fechaNacimiento: null, sexo: null, entidadNacimiento: null };
  }
  const yymmdd = curp.slice(4, 10);
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  const sexChar = curp[10];
  const entidad = curp.slice(11, 13);
  const centuryHint = curp[16] ?? "";
  // Pos 17: 0-9 ⇒ nacido antes 2000; A-Z ⇒ 2000+
  const century =
    /[0-9]/.test(centuryHint) ? 1900 : /[A-Z]/.test(centuryHint) ? 2000 : yy >= 30 ? 1900 : 2000;
  const year = century + yy;
  const fecha =
    mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31
      ? `${year.toString().padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
      : null;
  const sexo =
    sexChar === "H" || sexChar === "M" || sexChar === "X" ? sexChar : null;
  const entidadNacimiento = ENTIDADES[entidad] ? entidad : null;
  return { fechaNacimiento: fecha, sexo, entidadNacimiento };
}

export function entidadNombreFromCodigo(code: string | null | undefined): string | null {
  if (!code) return null;
  return ENTIDADES[code.toUpperCase()] ?? null;
}

export type ValidateCurpLocalInput = Readonly<{
  curp: string;
  fechaNacimiento?: string | null; // YYYY-MM-DD
  sexo?: string | null; // H|M|X
  entidadNacimiento?: string | null; // código 2 letras
}>;

export type ValidateCurpLocalResult = Readonly<{
  status: CurpLocalStatus;
  normalized: string;
  derived: CurpDerivedIdentity;
  message: string;
}>;

/**
 * Validación local de estructura CURP (sin portales).
 * No corrige la CURP.
 */
export function validateCurpLocal(
  input: ValidateCurpLocalInput,
): ValidateCurpLocalResult {
  const normalized = normalizeCurp(input.curp);
  const emptyDerived: CurpDerivedIdentity = {
    fechaNacimiento: null,
    sexo: null,
    entidadNacimiento: null,
  };

  if (!normalized) {
    return {
      status: "SIN_CURP",
      normalized: "",
      derived: emptyDerived,
      message: "Sin CURP",
    };
  }

  if (normalized.length !== 18) {
    return {
      status: "FORMATO_INVALIDO",
      normalized,
      derived: emptyDerived,
      message: "La CURP debe tener 18 caracteres",
    };
  }

  // Estructura: AAAA + YYMMDD + H/M/X + EE + CCC + D + V
  if (
    !/^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9]\d$/.test(
      normalized,
    )
  ) {
    return {
      status: "FORMATO_INVALIDO",
      normalized,
      derived: emptyDerived,
      message: "Formato de CURP inválido",
    };
  }

  const expected = curpCheckDigit(normalized.slice(0, 17));
  if (expected === "" || normalized[17] !== expected) {
    return {
      status: "DIGITO_INVALIDO",
      normalized,
      derived: deriveIdentityFromCurp(normalized),
      message: "Dígito verificador de CURP inválido",
    };
  }

  const derived = deriveIdentityFromCurp(normalized);

  const fechaIn = (input.fechaNacimiento ?? "").trim().slice(0, 10);
  if (fechaIn && derived.fechaNacimiento && fechaIn !== derived.fechaNacimiento) {
    return {
      status: "FECHA_NO_COINCIDE",
      normalized,
      derived,
      message: "Fecha de nacimiento no coincide",
    };
  }

  const sexoIn = (input.sexo ?? "").trim().toUpperCase();
  if (sexoIn && derived.sexo && sexoIn !== derived.sexo) {
    return {
      status: "SEXO_NO_COINCIDE",
      normalized,
      derived,
      message: "Sexo no coincide",
    };
  }

  const entIn = (input.entidadNacimiento ?? "").trim().toUpperCase();
  if (entIn && derived.entidadNacimiento && entIn !== derived.entidadNacimiento) {
    return {
      status: "ENTIDAD_NO_COINCIDE",
      normalized,
      derived,
      message: "Entidad de nacimiento no coincide",
    };
  }

  const hasPartialDatos =
    Boolean(fechaIn || sexoIn || entIn) &&
    !(fechaIn && sexoIn && entIn);
  if (hasPartialDatos && (!fechaIn || !sexoIn || !entIn)) {
    // Datos parciales en formulario: no bloquear; informar incompletos solo si se pidió comparación total
  }

  return {
    status: "VALIDA_LOCALMENTE",
    normalized,
    derived,
    message: "Formato de CURP válido",
  };
}
