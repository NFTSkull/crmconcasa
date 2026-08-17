/**
 * Contrato de plantillas Infonavit v1 — fail-safe por SHA + nombres + tipos.
 * Mapping por nombre AcroForm exacto (nunca por índice/orden).
 *
 * Import npm `pdf-lib` (compatible con tests Node/tsx). Futura Edge usará
 * el mismo paquete vía import map Deno — sin APIs Node en este módulo.
 */

import { PDFCheckBox, PDFDocument, PDFTextField, type PDFForm } from "pdf-lib";
import { InfonavitPdfError } from "./errors.ts";
import { sha256Hex } from "./sha256.ts";
import type { InfonavitDocumentType } from "./types.ts";

export const TEMPLATE_VERSION = "v1" as const;

export type AcroFieldKind = "text" | "checkbox";

export interface ExpectedFieldSpec {
  name: string;
  kind: AcroFieldKind;
}

export interface TemplateContract {
  templateId: InfonavitDocumentType;
  templateVersion: typeof TEMPLATE_VERSION;
  expectedSha256: string;
  expectedPageCount: number;
  expectedFields: ExpectedFieldSpec[];
  /** Capacidades certificadas (chars) para wrap determinista. */
  capacities: Record<string, number>;
}

const T = (n: number) => `Campo de texto${n}`;
const C = (n: number) => `Casilla de verificación${n}`;

function textFields(...indices: number[]): ExpectedFieldSpec[] {
  return indices.map((i) => ({ name: T(i), kind: "text" as const }));
}

function checkFields(...indices: number[]): ExpectedFieldSpec[] {
  return indices.map((i) => ({ name: C(i), kind: "checkbox" as const }));
}

/** Bajo protesta — 10 textos, 0 checks, 2 páginas. */
export const BAJO_PROTESTA_CONTRACT: TemplateContract = {
  templateId: "carta_bajo_protesta",
  templateVersion: TEMPLATE_VERSION,
  expectedSha256:
    "bfff2e484ca40e96aef3cb86fb3c6303d37afdbf795556688e96ed3307689ea4",
  expectedPageCount: 2,
  expectedFields: textFields(0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
  capacities: {
    localidad: 36,
    dia: 2,
    mes: 2,
    anio2: 2,
    descripcionLine: 72,
    nombreCompleto: 48,
    nss: 11,
  },
};

/** Presupuesto — 12 textos. */
export const PRESUPUESTO_CONTRACT: TemplateContract = {
  templateId: "presupuesto_mejoramiento",
  templateVersion: TEMPLATE_VERSION,
  expectedSha256:
    "8402f7e6cae5d569dcff1afd3dd41cd24203fd164d9c8e5ab88d337f2d3e0581",
  expectedPageCount: 1,
  expectedFields: textFields(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11),
  capacities: {
    nombreLine0: 26,
    nombreLine11: 60,
    nss: 11,
    direccionLine0: 30,
    direccionLine: 60,
    descripcionLine: 60,
    monto: 18,
    fecha: 10,
  },
};

/**
 * Solicitud — textos 0–27,29–59 (sin 28) + checks 0–8.
 * Aliases T0.. solo documentación; runtime usa nombres AcroForm.
 */
export const SOLICITUD_CONTRACT: TemplateContract = {
  templateId: "solicitud_inscripcion_credito",
  templateVersion: TEMPLATE_VERSION,
  expectedSha256:
    "f091c744a30c269bfbf9a534544838e214eb9cad56602a3dc3e2d603a55d90a6",
  expectedPageCount: 2,
  expectedFields: [
    ...textFields(
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
      20, 21, 22, 23, 24, 25, 26, 27, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38,
      39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
      57, 58, 59,
    ),
    ...checkFields(0, 1, 2, 3, 4, 5, 6, 7, 8),
  ],
  capacities: {},
};

export const CONTRACTS_BY_TYPE: Record<InfonavitDocumentType, TemplateContract> =
  {
    carta_bajo_protesta: BAJO_PROTESTA_CONTRACT,
    presupuesto_mejoramiento: PRESUPUESTO_CONTRACT,
    solicitud_inscripcion_credito: SOLICITUD_CONTRACT,
  };

/** Nombres AcroForm (documentación / constantes internas). */
export const SOLICITUD_FIELD = {
  T0_NSS: T(0),
  T1_CURP: T(1),
  T2_RFC: T(2),
  T3_AP_PATERNO: T(3),
  T4_AP_MATERNO: T(4),
  T5_NOMBRES: T(5),
  T6_TIPO_ID: T(6),
  T7_NUM_ID: T(7),
  T8_VIGENCIA: T(8),
  T9_LADA: T(9),
  T10_TELEFONO: T(10),
  T11_CELULAR: T(11),
  T12_CORREO: T(12),
  T13_EMPRESA: T(13),
  T14_REG_PATRONAL: T(14),
  T15_EMP_LADA: T(15),
  T16_EMP_TEL: T(16),
  T17_EMP_EXT: T(17),
  T18_CALLE: T(18),
  T19_NO_EXT: T(19),
  T20_NO_INT: T(20),
  T21_LOTE: T(21),
  T22_MANZANA: T(22),
  T23_COLONIA: T(23),
  T24_ENTIDAD: T(24),
  T25_MUNICIPIO: T(25),
  T26_CP: T(26),
  T27_MONTO: T(27),
  T29_PLAZO: T(29),
  T30_REF1_AP_PAT: T(30),
  T31_BLANK: T(31),
  T32_BLANK: T(32),
  T33_BLANK: T(33),
  T34_REF1_AP_MAT: T(34),
  T35_REF1_NOMBRES: T(35),
  T36_REF1_LADA: T(36),
  T37_REF1_TEL: T(37),
  T38_REF1_CEL: T(38),
  T39_REF2_AP_PAT: T(39),
  T40_REF2_AP_MAT: T(40),
  T41_REF2_NOMBRES: T(41),
  T42_REF2_LADA: T(42),
  T43_REF2_TEL: T(43),
  T44_REF2_CEL: T(44),
  T45_BEN_PARENTESCO: T(45),
  T46_BEN_AP_PAT: T(46),
  T47_BEN_AP_MAT: T(47),
  T48_BEN_NOMBRES: T(48),
  T49_PROMOTOR_BLANK: T(49),
  T50_PROMOTOR_BLANK: T(50),
  T51_PROMOTOR_BLANK: T(51),
  T52_PROMOTOR_BLANK: T(52),
  T53_PROMOTOR_BLANK: T(53),
  T54_PROMOTOR_BLANK: T(54),
  T55_CREDITO_INFONAVIT_BLANK: T(55),
  T56_CIUDAD: T(56),
  T57_DIA: T(57),
  T58_MES: T(58),
  T59_ANIO: T(59),
  C0_GENERO_F: C(0),
  C1_GENERO_M: C(1),
  C2_REGIMEN_SEPARACION: C(2),
  C3_REGIMEN_SOCIEDAD: C(3),
  C4_PROP_CONYUGE: C(4),
  C5_PROP_FAMILIAR: C(5),
  C6_SOLTERO: C(6),
  C7_CASADO: C(7),
  C8_PROP_PROPIA: C(8),
} as const;

export const BAJO_FIELD = {
  T0_LOCALIDAD: T(0),
  T1_DIA: T(1),
  T2_MES: T(2),
  T3_ANIO: T(3),
  T4_DESC0: T(4),
  T5_DESC1: T(5),
  T6_DESC2: T(6),
  T7_DESC3: T(7),
  T8_NOMBRE: T(8),
  T9_NSS: T(9),
} as const;

export const PRESUPUESTO_FIELD = {
  T0_NOMBRE: T(0),
  T1_NSS: T(1),
  T2_DIR0: T(2),
  T3_DIR1: T(3),
  T4_DIR2: T(4),
  T5_DESC0: T(5),
  T6_DESC1: T(6),
  T7_DESC2: T(7),
  T8_DESC3: T(8),
  T9_MONTO: T(9),
  T10_FECHA: T(10),
  T11_NOMBRE_OVERFLOW: T(11),
} as const;

export function getContract(
  documentType: InfonavitDocumentType,
): TemplateContract {
  return CONTRACTS_BY_TYPE[documentType];
}

function fieldKindOf(form: PDFForm, name: string): AcroFieldKind | "other" {
  try {
    const f = form.getField(name);
    if (f instanceof PDFTextField) return "text";
    if (f instanceof PDFCheckBox) return "checkbox";
    return "other";
  } catch {
    return "other";
  }
}

/**
 * Verifica SHA + páginas + set exacto de fields + tipos.
 * Error: INFONAVIT_TEMPLATE_CONTRACT_MISMATCH (sin PII).
 */
export async function assertTemplateContract(args: {
  documentType: InfonavitDocumentType;
  templateBytes: Uint8Array;
  doc: PDFDocument;
}): Promise<TemplateContract> {
  const contract = getContract(args.documentType);
  const actualSha = await sha256Hex(args.templateBytes);
  if (actualSha !== contract.expectedSha256) {
    throw new InfonavitPdfError(
      "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH",
      "SHA256 de plantilla no coincide",
      {
        documentType: args.documentType,
        templateVersion: contract.templateVersion,
        reason: "sha256_mismatch",
        expectedSha256Prefix: contract.expectedSha256.slice(0, 12),
        actualSha256Prefix: actualSha.slice(0, 12),
      },
    );
  }

  const pageCount = args.doc.getPageCount();
  if (pageCount !== contract.expectedPageCount) {
    throw new InfonavitPdfError(
      "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH",
      "page count de plantilla no coincide",
      {
        documentType: args.documentType,
        reason: "page_count_mismatch",
        expectedPageCount: contract.expectedPageCount,
        actualPageCount: pageCount,
      },
    );
  }

  const form = args.doc.getForm();
  const actualNames = new Set(form.getFields().map((f) => f.getName()));
  const expectedNames = new Set(contract.expectedFields.map((f) => f.name));

  for (const spec of contract.expectedFields) {
    if (!actualNames.has(spec.name)) {
      throw new InfonavitPdfError(
        "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH",
        "falta campo requerido en plantilla",
        {
          documentType: args.documentType,
          reason: "missing_field",
          fieldName: spec.name,
        },
      );
    }
    const kind = fieldKindOf(form, spec.name);
    if (kind !== spec.kind) {
      throw new InfonavitPdfError(
        "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH",
        "tipo de campo no coincide",
        {
          documentType: args.documentType,
          reason: "field_type_mismatch",
          fieldName: spec.name,
          expectedKind: spec.kind,
          actualKind: kind,
        },
      );
    }
  }

  for (const name of actualNames) {
    if (!expectedNames.has(name)) {
      throw new InfonavitPdfError(
        "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH",
        "campo inesperado en plantilla",
        {
          documentType: args.documentType,
          reason: "unexpected_field",
          fieldName: name,
        },
      );
    }
  }

  return contract;
}

export { PDFCheckBox, PDFDocument, PDFTextField };
