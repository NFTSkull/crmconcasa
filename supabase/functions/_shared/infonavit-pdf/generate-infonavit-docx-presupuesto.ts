/**
 * Presupuesto de Mejoramiento — DOCX nativo editable.
 * mappingVersion>=3 deja presupuesto estimado y fecha inferior vacíos.
 * Snapshots históricos conservan el comportamiento anterior.
 */

import { Document, Packer, type FileChild } from "docx";
import {
  blankLine,
  editableValue,
  heading,
  labeledField,
  sectionTitle,
  spacer,
} from "./docx-layout.ts";
import type { InfonavitPrintModel } from "./print-model.ts";

export async function buildPresupuestoDocx(
  model: InfonavitPrintModel,
): Promise<Uint8Array> {
  const isV3 = model.mappingVersion >= 3;
  const children: FileChild[] = [
    heading("PRESUPUESTO DE MEJORAMIENTO"),
    sectionTitle("DATOS GENERALES"),
    labeledField("Nombre de la persona Derechohabiente", model.nombreCompleto),
    spacer(),
    labeledField("Número de Seguridad Social", model.nss),
    spacer(),
    labeledField("Dirección donde se realizará la mejora", model.domicilioLibre),
    spacer(),
    sectionTitle("BREVE DESCRIPCIÓN DE LA MEJORA A REALIZAR"),
    ...(model.propuestaLines.length > 0
      ? model.propuestaLines.map((line) => editableValue(line, { size: 20 }))
      : [editableValue("", { size: 20 })]),
    spacer(),
    sectionTitle("PRESUPUESTO ESTIMADO"),
    labeledField("Monto ($)", isV3 ? "" : model.montoMejoravit),
    spacer(),
    labeledField("Fecha", isV3 ? "" : model.presupuestoFecha),
    blankLine("Firma de la persona Derechohabiente"),
  ];

  const doc = new Document({
    creator: "concasa-crm-p189",
    title: "Presupuesto de mejoramiento — editable",
    sections: [{ properties: {}, children }],
  });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}
