/**
 * Fill Presupuesto Mejoramiento.
 * texto0 + texto11 = nombre con split determinista por palabras.
 * mappingVersion>=3: NO auto llenar presupuesto estimado ni fecha inferior.
 * mappingVersion>=4: imprime una sola mejora.
 * Snapshots históricos conservan su render anterior.
 * No dibujar firma. No flatten aquí.
 */

import type { PDFDocument } from "pdf-lib";
import {
  blankable,
  formatMoneyMx,
  formatNombreCompleto,
  formatPresupuestoFecha,
} from "./formatters.ts";
import {
  embedHelvetica,
  resetAllFormFields,
  setTextValue,
  updateAllTextAppearances,
} from "./form-helpers.ts";
import {
  PRESUPUESTO_FIELD,
  type TemplateContract,
} from "./template-contract.ts";
import {
  splitMejoraDescripcion,
  splitNombrePresupuesto,
  splitTextToLines,
} from "./text-layout.ts";
import type { InfonavitPdfSnapshotInput } from "./types.ts";

const FONT_SIZE = 10;
const V3_DESC_FONT_SIZE = 9;
const V3_DESC_MIN_CAPACITY = 68;

function composeDireccionLibre(snapshot: InfonavitPdfSnapshotInput): string {
  const v = snapshot.vivienda;
  const libre = blankable(v?.direccionLibre, { collapseSpaces: true });
  if (libre) return libre;
  const parts = [
    blankable(v?.calle, { collapseSpaces: true }),
    blankable(v?.noExt) ? `No. ${blankable(v?.noExt)}` : "",
    blankable(v?.noInt) ? `Int. ${blankable(v?.noInt)}` : "",
    blankable(v?.colonia)
      ? `COL. ${blankable(v?.colonia, { collapseSpaces: true })}`
      : "",
    blankable(v?.municipio, { collapseSpaces: true }),
    blankable(v?.entidad, { collapseSpaces: true }),
    blankable(v?.cp) ? `CP ${blankable(v?.cp)}` : "",
  ].filter((p) => p.length > 0);
  return parts.join(", ");
}

export async function fillPresupuesto(args: {
  doc: PDFDocument;
  contract: TemplateContract;
  snapshot: InfonavitPdfSnapshotInput;
}): Promise<void> {
  const { doc, contract, snapshot } = args;
  const form = doc.getForm();
  resetAllFormFields(form);

  const caps = contract.capacities;
  const nombre = formatNombreCompleto(snapshot.cliente);
  const { line0, line11 } = splitNombrePresupuesto({
    fullName: nombre,
    maxCharsLine0: caps.nombreLine0 ?? 26,
    maxCharsLine11: caps.nombreLine11 ?? 60,
  });

  const dirRaw = composeDireccionLibre(snapshot);
  const dirLinesNarrowFirst = splitAddressThreeLines(dirRaw, caps);

  const isV3 = Number(snapshot.mappingVersion ?? 0) >= 3;
  const isV4 = Number(snapshot.mappingVersion ?? 0) >= 4;
  const descFontSize = isV3 ? V3_DESC_FONT_SIZE : FONT_SIZE;
  const descCapacity = isV3
    ? Math.max(caps.descripcionLine ?? 60, V3_DESC_MIN_CAPACITY)
    : (caps.descripcionLine ?? 60);

  const descLines = splitMejoraDescripcion({
    text: blankable(snapshot.mejora?.descripcion),
    maxLines: isV4 ? 1 : 4,
    maxCharsPerLine: descCapacity,
    documentType: "presupuesto_mejoramiento",
    semanticField: "mejora.descripcion",
  });

  const montoRaw = snapshot.mejora?.presupuestoEstimado;
  const monto =
    isV3 || montoRaw === null || montoRaw === undefined
      ? ""
      : formatMoneyMx(montoRaw, { withSymbol: false });
  const fecha = isV3 ? "" : formatPresupuestoFecha(snapshot.fechaDocumento);

  setTextValue(form, PRESUPUESTO_FIELD.T0_NOMBRE, line0, FONT_SIZE);
  setTextValue(form, PRESUPUESTO_FIELD.T11_NOMBRE_OVERFLOW, line11, FONT_SIZE);
  setTextValue(form, PRESUPUESTO_FIELD.T1_NSS, blankable(snapshot.cliente.nss), FONT_SIZE);
  setTextValue(form, PRESUPUESTO_FIELD.T2_DIR0, dirLinesNarrowFirst[0] ?? "", FONT_SIZE);
  setTextValue(form, PRESUPUESTO_FIELD.T3_DIR1, dirLinesNarrowFirst[1] ?? "", FONT_SIZE);
  setTextValue(form, PRESUPUESTO_FIELD.T4_DIR2, dirLinesNarrowFirst[2] ?? "", FONT_SIZE);
  setTextValue(form, PRESUPUESTO_FIELD.T5_DESC0, descLines[0] ?? "", descFontSize);
  setTextValue(form, PRESUPUESTO_FIELD.T6_DESC1, descLines[1] ?? "", descFontSize);
  setTextValue(form, PRESUPUESTO_FIELD.T7_DESC2, descLines[2] ?? "", descFontSize);
  setTextValue(form, PRESUPUESTO_FIELD.T8_DESC3, descLines[3] ?? "", descFontSize);
  setTextValue(form, PRESUPUESTO_FIELD.T9_MONTO, monto, FONT_SIZE);
  setTextValue(form, PRESUPUESTO_FIELD.T10_FECHA, fecha, FONT_SIZE);

  const font = await embedHelvetica(doc);
  updateAllTextAppearances(form, font);
}

function splitAddressThreeLines(
  text: string,
  caps: Record<string, number>,
): string[] {
  const max0 = caps.direccionLine0 ?? 30;
  const maxRest = caps.direccionLine ?? 60;
  const raw = (text ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return ["", "", ""];

  const words = raw.split(" ");
  let line0 = "";
  let consumed = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const candidate = line0 ? `${line0} ${w}` : w;
    if (candidate.length <= max0) {
      line0 = candidate;
      consumed = i + 1;
    } else {
      break;
    }
  }

  if (!line0 && words[0] && words[0].length > max0) {
    return splitTextToLines({
      text: raw,
      maxLines: 3,
      maxCharsPerLine: maxRest,
      documentType: "presupuesto_mejoramiento",
      semanticField: "vivienda.direccion",
    });
  }

  const rest = words.slice(consumed).join(" ");
  if (!rest) return [line0, "", ""];

  const restLines = splitTextToLines({
    text: rest,
    maxLines: 2,
    maxCharsPerLine: maxRest,
    documentType: "presupuesto_mejoramiento",
    semanticField: "vivienda.direccion",
  });
  return [line0, restLines[0] ?? "", restLines[1] ?? ""];
}
