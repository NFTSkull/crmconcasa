import { curpCheckDigit, normalizeCurp } from "../curp-local";

/** Construye CURP sintética válida (solo tests/fixtures). */
export function buildSyntheticCurp(opts: {
  letters4: string;
  yymmdd: string;
  sexo: "H" | "M" | "X";
  entidad: string;
  consonants3: string;
  dif: string;
}): string {
  const body =
    normalizeCurp(opts.letters4).slice(0, 4).padEnd(4, "X") +
    opts.yymmdd +
    opts.sexo +
    opts.entidad.slice(0, 2).toUpperCase() +
    opts.consonants3.slice(0, 3).toUpperCase().padEnd(3, "X") +
    opts.dif.slice(0, 1).toUpperCase();
  return body + curpCheckDigit(body);
}

/** Texto sintético tipo constancia compacta (sin datos reales). */
export function syntheticConstanciaTextCertificada(curp: string, nombreCompleto: string): string {
  return [
    "CONSTANCIA DE LA CLAVE UNICA DE REGISTRO DE POBLACION",
    "CLAVE:",
    curp,
    "NOMBRE",
    nombreCompleto,
    "ENTIDAD DE REGISTRO:",
    "CIUDAD DE MEXICO",
    "CURP Certificada: verificada con el Registro Civil",
    "Folio de la digitalizacion: SYNTH-0001",
  ].join("\n");
}

export function syntheticConstanciaTextNoCert(curp: string, nombreCompleto: string): string {
  return [
    "CONSTANCIA DE LA CLAVE UNICA DE REGISTRO DE POBLACION",
    "CLAVE:",
    curp,
    "NOMBRE",
    nombreCompleto,
    "ENTIDAD DE REGISTRO:",
    "JALISCO",
  ].join("\n");
}

export function syntheticConstanciaTextOtraAutoridad(curp: string): string {
  return [
    "CONSTANCIA CURP",
    "CLAVE:",
    curp,
    "NOMBRE",
    "PRUEBA SINTETICA UNO",
    "CURP Certificada: verificada con el Instituto Nacional Electoral",
  ].join("\n");
}

export function syntheticConstanciaTextLabeled(curp: string): string {
  return [
    "CURP:",
    curp,
    "PRIMER APELLIDO: PRUEBA",
    "SEGUNDO APELLIDO: SINTETICA",
    "NOMBRE(S): UNO DOS",
    "SEXO: H",
    "FECHA DE NACIMIENTO: 01/01/1990",
    "NACIONALIDAD: MEXICANA",
    "ENTIDAD DE NACIMIENTO: CIUDAD DE MEXICO",
    "DOCUMENTO PROBATORIO: ACTA DE NACIMIENTO",
    "ANIO DE REGISTRO: 1990",
    "NUMERO DE ACTA: 123",
    "ENTIDAD DE REGISTRO: CIUDAD DE MEXICO",
    "MUNICIPIO DE REGISTRO: COYOACAN",
    "CURP Certificada: verificada con el Registro Civil",
  ].join("\n");
}
