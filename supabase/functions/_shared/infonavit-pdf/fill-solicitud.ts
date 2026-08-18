/**
 * Fill Solicitud Inscripción Crédito — reset defaults + mapping B0.
 * Género: C1=M, C0=F. MUST_STAY_BLANK: T31–T33, T49–T54, T55.
 * No flatten aquí.
 */

import type { PDFDocument } from "pdf-lib";
import {
  blankable,
  formatMoneyMx,
  formatSolicitudCierreDateParts,
} from "./formatters.ts";
import {
  embedHelvetica,
  resetAllFormFields,
  setExclusiveCheck,
  setTextValue,
  updateAllTextAppearances,
} from "./form-helpers.ts";
import { SOLICITUD_FIELD, type TemplateContract } from "./template-contract.ts";
import type { InfonavitPdfSnapshotInput } from "./types.ts";

const FONT_SIZE = 9;

export const SOLICITUD_MUST_STAY_BLANK = [
  SOLICITUD_FIELD.T31_BLANK,
  SOLICITUD_FIELD.T32_BLANK,
  SOLICITUD_FIELD.T33_BLANK,
  SOLICITUD_FIELD.T49_PROMOTOR_BLANK,
  SOLICITUD_FIELD.T50_PROMOTOR_BLANK,
  SOLICITUD_FIELD.T51_PROMOTOR_BLANK,
  SOLICITUD_FIELD.T52_PROMOTOR_BLANK,
  SOLICITUD_FIELD.T53_PROMOTOR_BLANK,
  SOLICITUD_FIELD.T54_PROMOTOR_BLANK,
  SOLICITUD_FIELD.T55_CREDITO_INFONAVIT_BLANK,
] as const;

export async function fillSolicitud(args: {
  doc: PDFDocument;
  contract: TemplateContract;
  snapshot: InfonavitPdfSnapshotInput;
}): Promise<void> {
  const { doc, snapshot } = args;
  const form = doc.getForm();

  resetAllFormFields(form);

  const c = snapshot.cliente;
  const id = c.identificacion;
  const emp = snapshot.empresa;
  const viv = snapshot.vivienda;
  const cred = snapshot.credito;
  const refs = snapshot.referencias ?? [];
  const ref1 = refs[0];
  const ref2 = refs[1];
  const ben = snapshot.beneficiario;
  const cierre = formatSolicitudCierreDateParts(snapshot.fechaDocumento);

  setTextValue(form, SOLICITUD_FIELD.T0_NSS, blankable(c.nss), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T1_CURP, blankable(c.curp), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T2_RFC, blankable(c.rfc), FONT_SIZE);
  setTextValue(
    form,
    SOLICITUD_FIELD.T3_AP_PATERNO,
    blankable(c.apellidoPaterno),
    FONT_SIZE,
  );
  setTextValue(
    form,
    SOLICITUD_FIELD.T4_AP_MATERNO,
    blankable(c.apellidoMaterno),
    FONT_SIZE,
  );
  setTextValue(form, SOLICITUD_FIELD.T5_NOMBRES, blankable(c.nombres), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T6_TIPO_ID, blankable(id?.tipo), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T7_NUM_ID, blankable(id?.numero), FONT_SIZE);
  setTextValue(
    form,
    SOLICITUD_FIELD.T8_VIGENCIA,
    blankable(id?.vigencia),
    FONT_SIZE,
  );
  setTextValue(form, SOLICITUD_FIELD.T9_LADA, blankable(c.ladaTelefono), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T10_TELEFONO, blankable(c.telefono), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T11_CELULAR, blankable(c.celular), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T12_CORREO, blankable(c.correo), FONT_SIZE);

  const generoActive =
    c.genero === "M"
      ? SOLICITUD_FIELD.C1_GENERO_M
      : c.genero === "F"
        ? SOLICITUD_FIELD.C0_GENERO_F
        : null;
  setExclusiveCheck(
    form,
    [SOLICITUD_FIELD.C0_GENERO_F, SOLICITUD_FIELD.C1_GENERO_M],
    generoActive,
  );

  const civilActive =
    c.estadoCivil === "soltero"
      ? SOLICITUD_FIELD.C6_SOLTERO
      : c.estadoCivil === "casado"
        ? SOLICITUD_FIELD.C7_CASADO
        : null;
  setExclusiveCheck(
    form,
    [SOLICITUD_FIELD.C6_SOLTERO, SOLICITUD_FIELD.C7_CASADO],
    civilActive,
  );

  let regimenActive: string | null = null;
  if (c.estadoCivil === "casado") {
    if (c.regimenMatrimonial === "separacion_bienes") {
      regimenActive = SOLICITUD_FIELD.C2_REGIMEN_SEPARACION;
    } else if (c.regimenMatrimonial === "sociedad_conyugal") {
      regimenActive = SOLICITUD_FIELD.C3_REGIMEN_SOCIEDAD;
    }
  }
  setExclusiveCheck(
    form,
    [SOLICITUD_FIELD.C2_REGIMEN_SEPARACION, SOLICITUD_FIELD.C3_REGIMEN_SOCIEDAD],
    regimenActive,
  );

  setTextValue(form, SOLICITUD_FIELD.T13_EMPRESA, blankable(emp?.nombre), FONT_SIZE);
  setTextValue(
    form,
    SOLICITUD_FIELD.T14_REG_PATRONAL,
    blankable(emp?.registroPatronal),
    FONT_SIZE,
  );
  setTextValue(form, SOLICITUD_FIELD.T15_EMP_LADA, blankable(emp?.lada), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T16_EMP_TEL, blankable(emp?.telefono), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T17_EMP_EXT, blankable(emp?.extension), FONT_SIZE);

  setTextValue(
    form,
    SOLICITUD_FIELD.T18_CALLE,
    blankable(viv?.calle) ||
      blankable(viv?.direccionCompleta, { collapseSpaces: true }),
    FONT_SIZE,
  );
  setTextValue(form, SOLICITUD_FIELD.T19_NO_EXT, blankable(viv?.noExt), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T20_NO_INT, blankable(viv?.noInt), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T21_LOTE, blankable(viv?.lote), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T22_MANZANA, blankable(viv?.manzana), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T23_COLONIA, blankable(viv?.colonia), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T24_ENTIDAD, blankable(viv?.entidad), FONT_SIZE);
  setTextValue(
    form,
    SOLICITUD_FIELD.T25_MUNICIPIO,
    blankable(viv?.municipio),
    FONT_SIZE,
  );
  setTextValue(form, SOLICITUD_FIELD.T26_CP, blankable(viv?.cp), FONT_SIZE);

  const propActive =
    viv?.tipoPropiedad === "propia"
      ? SOLICITUD_FIELD.C8_PROP_PROPIA
      : viv?.tipoPropiedad === "conyuge_concubino"
        ? SOLICITUD_FIELD.C4_PROP_CONYUGE
        : viv?.tipoPropiedad === "familiar"
          ? SOLICITUD_FIELD.C5_PROP_FAMILIAR
          : null;
  setExclusiveCheck(
    form,
    [
      SOLICITUD_FIELD.C8_PROP_PROPIA,
      SOLICITUD_FIELD.C4_PROP_CONYUGE,
      SOLICITUD_FIELD.C5_PROP_FAMILIAR,
    ],
    propActive,
  );

  const monto =
    cred?.montoSolicitado === null || cred?.montoSolicitado === undefined
      ? ""
      : formatMoneyMx(cred.montoSolicitado, { withSymbol: false });
  setTextValue(form, SOLICITUD_FIELD.T27_MONTO, monto, FONT_SIZE);
  const plazo =
    cred?.plazoAnios === null || cred?.plazoAnios === undefined
      ? cred?.plazoMeses
      : cred.plazoAnios;
  setTextValue(
    form,
    SOLICITUD_FIELD.T29_PLAZO,
    plazo === null || plazo === undefined ? "" : String(plazo),
    FONT_SIZE,
  );

  setTextValue(
    form,
    SOLICITUD_FIELD.T30_REF1_AP_PAT,
    blankable(ref1?.apellidoPaterno),
    FONT_SIZE,
  );
  setTextValue(
    form,
    SOLICITUD_FIELD.T34_REF1_AP_MAT,
    blankable(ref1?.apellidoMaterno),
    FONT_SIZE,
  );
  setTextValue(
    form,
    SOLICITUD_FIELD.T35_REF1_NOMBRES,
    blankable(ref1?.nombres),
    FONT_SIZE,
  );
  setTextValue(form, SOLICITUD_FIELD.T36_REF1_LADA, blankable(ref1?.lada), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T37_REF1_TEL, blankable(ref1?.telefono), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T38_REF1_CEL, blankable(ref1?.celular), FONT_SIZE);

  setTextValue(
    form,
    SOLICITUD_FIELD.T39_REF2_AP_PAT,
    blankable(ref2?.apellidoPaterno),
    FONT_SIZE,
  );
  setTextValue(
    form,
    SOLICITUD_FIELD.T40_REF2_AP_MAT,
    blankable(ref2?.apellidoMaterno),
    FONT_SIZE,
  );
  setTextValue(
    form,
    SOLICITUD_FIELD.T41_REF2_NOMBRES,
    blankable(ref2?.nombres),
    FONT_SIZE,
  );
  setTextValue(form, SOLICITUD_FIELD.T42_REF2_LADA, blankable(ref2?.lada), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T43_REF2_TEL, blankable(ref2?.telefono), FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T44_REF2_CEL, blankable(ref2?.celular), FONT_SIZE);

  setTextValue(
    form,
    SOLICITUD_FIELD.T45_BEN_PARENTESCO,
    blankable(ben?.parentesco),
    FONT_SIZE,
  );
  setTextValue(
    form,
    SOLICITUD_FIELD.T46_BEN_AP_PAT,
    blankable(ben?.apellidoPaterno),
    FONT_SIZE,
  );
  setTextValue(
    form,
    SOLICITUD_FIELD.T47_BEN_AP_MAT,
    blankable(ben?.apellidoMaterno),
    FONT_SIZE,
  );
  setTextValue(
    form,
    SOLICITUD_FIELD.T48_BEN_NOMBRES,
    blankable(ben?.nombres),
    FONT_SIZE,
  );

  setTextValue(
    form,
    SOLICITUD_FIELD.T56_CIUDAD,
    blankable(snapshot.ciudadCierre || snapshot.localidad, {
      collapseSpaces: true,
    }),
    FONT_SIZE,
  );
  setTextValue(form, SOLICITUD_FIELD.T57_DIA, cierre.day, FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T58_MES, cierre.monthName, FONT_SIZE);
  setTextValue(form, SOLICITUD_FIELD.T59_ANIO, cierre.year2, FONT_SIZE);

  for (const name of SOLICITUD_MUST_STAY_BLANK) {
    setTextValue(form, name, "", FONT_SIZE);
  }

  const font = await embedHelvetica(doc);
  updateAllTextAppearances(form, font);
}
