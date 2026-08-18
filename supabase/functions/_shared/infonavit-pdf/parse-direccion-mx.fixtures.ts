import type { DireccionMxParsed } from "./parse-direccion-mx.ts";

/** Campos comparables SQL ↔ TS (null SQL se normaliza a ''). */
export interface DireccionParityFields {
  direccionCompleta: string;
  calle: string;
  noExt: string;
  noInt: string;
  lote: string;
  manzana: string;
  colonia: string;
  cp: string;
  municipio: string;
  entidad: string;
}

export interface DireccionParityFixture {
  id: string;
  raw: string;
  expected: DireccionParityFields;
}

export const DIRECCION_PARITY_FIELDS: (keyof DireccionParityFields)[] = [
  "direccionCompleta",
  "calle",
  "noExt",
  "noInt",
  "lote",
  "manzana",
  "colonia",
  "cp",
  "municipio",
  "entidad",
];

export function toParityFields(d: DireccionMxParsed): DireccionParityFields {
  return {
    direccionCompleta: d.direccionCompleta,
    calle: d.calle,
    noExt: d.numeroExterior,
    noInt: d.numeroInterior,
    lote: d.lote,
    manzana: d.manzana,
    colonia: d.colonia,
    cp: d.codigoPostal,
    municipio: d.municipio,
    entidad: d.entidad,
  };
}

export function normalizeSqlText(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

/** 18 fixtures canónicos — sin PII real. */
export const PARSE_DIRECCION_MX_FIXTURES: DireccionParityFixture[] = [
  {
    id: "1-col-cp-nl",
    raw: "CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ N.L.",
    expected: {
      direccionCompleta: "CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ N.L.",
      calle: "CALLE PRUEBA",
      noExt: "309",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "CENTRO",
      cp: "67250",
      municipio: "JUAREZ",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "2-col-dot-comma-nl",
    raw: "C CERRO DEL TEPEYAC 309 COL. CERRO DE LA SILLA 67250 JUAREZ, N.L.",
    expected: {
      direccionCompleta:
        "C CERRO DEL TEPEYAC 309 COL. CERRO DE LA SILLA 67250 JUAREZ, N.L.",
      calle: "C CERRO DEL TEPEYAC",
      noExt: "309",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "CERRO DE LA SILLA",
      cp: "67250",
      municipio: "JUAREZ",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "3-colonia-nuevo-leon",
    raw: "AV REFORMA 100 COLONIA CENTRO 64000 MONTERREY NUEVO LEON",
    expected: {
      direccionCompleta:
        "AV REFORMA 100 COLONIA CENTRO 64000 MONTERREY NUEVO LEON",
      calle: "AV REFORMA",
      noExt: "100",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "CENTRO",
      cp: "64000",
      municipio: "MONTERREY",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "4-nuevo-leon-acento",
    raw: "CALLE SOL 10 COL CENTRO 64000 MONTERREY NUEVO LEÓN",
    expected: {
      direccionCompleta: "CALLE SOL 10 COL CENTRO 64000 MONTERREY NUEVO LEÓN",
      calle: "CALLE SOL",
      noExt: "10",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "CENTRO",
      cp: "64000",
      municipio: "MONTERREY",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "5-nl-sin-puntos",
    raw: "CALLE SOL 10 COL CENTRO 64000 MONTERREY NL",
    expected: {
      direccionCompleta: "CALLE SOL 10 COL CENTRO 64000 MONTERREY NL",
      calle: "CALLE SOL",
      noExt: "10",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "CENTRO",
      cp: "64000",
      municipio: "MONTERREY",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "6-sin-coma",
    raw: "C LOMA DEL TESORO 100 COL. LOMAS DEL SUR 64000 MONTERREY N.L.",
    expected: {
      direccionCompleta:
        "C LOMA DEL TESORO 100 COL. LOMAS DEL SUR 64000 MONTERREY N.L.",
      calle: "C LOMA DEL TESORO",
      noExt: "100",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "LOMAS DEL SUR",
      cp: "64000",
      municipio: "MONTERREY",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "7-noext-alfanumerico",
    raw: "CALLE PRUEBA 309A COL CENTRO 67250 JUAREZ N.L.",
    expected: {
      direccionCompleta: "CALLE PRUEBA 309A COL CENTRO 67250 JUAREZ N.L.",
      calle: "CALLE PRUEBA",
      noExt: "309A",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "CENTRO",
      cp: "67250",
      municipio: "JUAREZ",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "8-sin-cp",
    raw: "CALLE SOL 10 COL CENTRO N.L.",
    expected: {
      direccionCompleta: "CALLE SOL 10 COL CENTRO N.L.",
      calle: "CALLE SOL",
      noExt: "10",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "CENTRO",
      cp: "",
      municipio: "",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "9-sin-col",
    raw: "CALLE SOL 10 64000 MONTERREY N.L.",
    expected: {
      direccionCompleta: "CALLE SOL 10 64000 MONTERREY N.L.",
      calle: "CALLE SOL",
      noExt: "10",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "",
      cp: "64000",
      municipio: "MONTERREY",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "10-sin-numero",
    raw: "DOMICILIO SIN ESTRUCTURA CLARA",
    expected: {
      direccionCompleta: "DOMICILIO SIN ESTRUCTURA CLARA",
      calle: "DOMICILIO SIN ESTRUCTURA CLARA",
      noExt: "",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "",
      cp: "",
      municipio: "",
      entidad: "",
    },
  },
  {
    id: "11-int-etiquetado",
    raw: "CALLE SOL 10 INT 2 COL CENTRO 64000 MONTERREY N.L.",
    expected: {
      direccionCompleta: "CALLE SOL 10 INT 2 COL CENTRO 64000 MONTERREY N.L.",
      calle: "CALLE SOL",
      noExt: "10",
      noInt: "2",
      lote: "",
      manzana: "",
      colonia: "CENTRO",
      cp: "64000",
      municipio: "MONTERREY",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "12-vacio",
    raw: "  ",
    expected: {
      direccionCompleta: "",
      calle: "",
      noExt: "",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "",
      cp: "",
      municipio: "",
      entidad: "",
    },
  },
  {
    id: "A-colonia-ejemplo",
    raw: "C PRUEBA 123 COL. COLONIA EJEMPLO 64000 MONTERREY N.L.",
    expected: {
      direccionCompleta: "C PRUEBA 123 COL. COLONIA EJEMPLO 64000 MONTERREY N.L.",
      calle: "C PRUEBA",
      noExt: "123",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "COLONIA EJEMPLO",
      cp: "64000",
      municipio: "MONTERREY",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "B-col-centro-nl",
    raw: "CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ NL",
    expected: {
      direccionCompleta: "CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ NL",
      calle: "CALLE PRUEBA",
      noExt: "309",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "CENTRO",
      cp: "67250",
      municipio: "JUAREZ",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "C-col-int",
    raw: "CALLE SOL 10 COL. LAS TORRES INT 4 64000 MONTERREY N.L.",
    expected: {
      direccionCompleta:
        "CALLE SOL 10 COL. LAS TORRES INT 4 64000 MONTERREY N.L.",
      calle: "CALLE SOL",
      noExt: "10",
      noInt: "4",
      lote: "",
      manzana: "",
      colonia: "LAS TORRES",
      cp: "64000",
      municipio: "MONTERREY",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "D-cerro-de-la-silla",
    raw: "C CERRO DEL TEPEYAC 309 COL. CERRO DE LA SILLA 67250 JUAREZ N.L.",
    expected: {
      direccionCompleta:
        "C CERRO DEL TEPEYAC 309 COL. CERRO DE LA SILLA 67250 JUAREZ N.L.",
      calle: "C CERRO DEL TEPEYAC",
      noExt: "309",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "CERRO DE LA SILLA",
      cp: "67250",
      municipio: "JUAREZ",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "E-sin-cp-municipio-conservador",
    raw: "CALLE SOL 10 COL CENTRO N.L.",
    expected: {
      direccionCompleta: "CALLE SOL 10 COL CENTRO N.L.",
      calle: "CALLE SOL",
      noExt: "10",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "CENTRO",
      cp: "",
      municipio: "",
      entidad: "NUEVO LEÓN",
    },
  },
  {
    id: "c27-sintetico-cp-hash",
    raw: "AV SIEMPRE VIVA # 214. COL. LOMAS DEL VALLE APODACA C.P. 66635",
    expected: {
      direccionCompleta:
        "AV SIEMPRE VIVA # 214. COL. LOMAS DEL VALLE APODACA C.P. 66635",
      calle: "AV SIEMPRE VIVA",
      noExt: "214",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "LOMAS DEL VALLE",
      cp: "66635",
      municipio: "APODACA",
      entidad: "",
    },
  },
];
