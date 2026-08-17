/**
 * Fill Carta Bajo Protesta — mapping B0 exacto por nombre AcroForm.
 * Campo de texto8 = nombre textual (NO firma / rúbrica / imagen).
 * No flatten aquí — lo hace generateInfonavitPdf.
 */

import type { PDFDocument } from "pdf-lib";
import {
  blankable,
  formatBajoProtestaDateParts,
  formatNombreCompleto,
} from "./formatters.ts";
import {
  embedHelvetica,
  resetAllFormFields,
  setTextValue,
  updateAllTextAppearances,
} from "./form-helpers.ts";
import { BAJO_FIELD, type TemplateContract } from "./template-contract.ts";
import { splitTextToLines } from "./text-layout.ts";
import type { InfonavitPdfSnapshotInput } from "./types.ts";

const FONT_SIZE = 9;

export async function fillBajoProtesta(args: {
  doc: PDFDocument;
  contract: TemplateContract;
  snapshot: InfonavitPdfSnapshotInput;
}): Promise<void> {
  const { doc, contract, snapshot } = args;
  const form = doc.getForm();
  resetAllFormFields(form);

  const caps = contract.capacities;
  const fecha = formatBajoProtestaDateParts(snapshot.fechaDocumento);
  const nombre = formatNombreCompleto(snapshot.cliente);
  const descLines = splitTextToLines({
    text: blankable(snapshot.mejora?.descripcion, { collapseSpaces: true }),
    maxLines: 4,
    maxCharsPerLine: caps.descripcionLine ?? 72,
    documentType: "carta_bajo_protesta",
    semanticField: "mejora.descripcion",
  });

  setTextValue(
    form,
    BAJO_FIELD.T0_LOCALIDAD,
    blankable(snapshot.localidad, { collapseSpaces: true }),
    FONT_SIZE,
  );
  setTextValue(form, BAJO_FIELD.T1_DIA, fecha.day, FONT_SIZE);
  setTextValue(form, BAJO_FIELD.T2_MES, fecha.month, FONT_SIZE);
  setTextValue(form, BAJO_FIELD.T3_ANIO, fecha.year2, FONT_SIZE);
  setTextValue(form, BAJO_FIELD.T4_DESC0, descLines[0] ?? "", FONT_SIZE);
  setTextValue(form, BAJO_FIELD.T5_DESC1, descLines[1] ?? "", FONT_SIZE);
  setTextValue(form, BAJO_FIELD.T6_DESC2, descLines[2] ?? "", FONT_SIZE);
  setTextValue(form, BAJO_FIELD.T7_DESC3, descLines[3] ?? "", FONT_SIZE);
  setTextValue(form, BAJO_FIELD.T8_NOMBRE, nombre, FONT_SIZE);
  setTextValue(
    form,
    BAJO_FIELD.T9_NSS,
    blankable(snapshot.cliente.nss),
    FONT_SIZE,
  );

  const font = await embedHelvetica(doc);
  updateAllTextAppearances(form, font);
}
