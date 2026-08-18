/**
 * Solicitud de Inscripción — DOCX nativo editable (2 páginas prácticas).
 * Campos sin fuente = celdas vacías subrayadas (Mesa puede escribir).
 */

import { Document, Packer, PageBreak, Paragraph, type FileChild } from "docx";
import {
  blankLine,
  heading,
  labeledField,
  p,
  sectionTitle,
  spacer,
  subheading,
  twoColFields,
} from "./docx-layout.ts";
import type { InfonavitPrintModel } from "./print-model.ts";

export async function buildSolicitudDocx(
  model: InfonavitPrintModel,
): Promise<Uint8Array> {
  const children: FileChild[] = [
    heading("SOLICITUD DE INSCRIPCIÓN DE CRÉDITO"),
    subheading("“Mejoravit solo para ti”"),
    sectionTitle("1. DATOS DE IDENTIFICACIÓN DE LA O EL DERECHOHABIENTE"),
    labeledField("NSS", model.nss),
    spacer(),
    twoColFields(
      { label: "CURP", value: model.curp },
      { label: "RFC", value: model.rfc },
    ),
    spacer(),
    labeledField("Apellido paterno", model.apellidoPaterno),
    spacer(),
    labeledField("Apellido materno", model.apellidoMaterno),
    spacer(),
    labeledField("Nombre(s)", model.nombres),
    spacer(),
    labeledField("Tipo de identificación", model.identificacionTipo),
    spacer(),
    twoColFields(
      { label: "Número de identificación", value: model.identificacionNumero },
      { label: "Vigencia (dd/mm/aaaa)", value: model.identificacionVigencia },
    ),
    spacer(),
    twoColFields(
      { label: "LADA teléfono", value: model.ladaTelefono },
      { label: "Teléfono fijo", value: model.telefono },
    ),
    spacer(),
    twoColFields(
      { label: "Celular", value: model.celular },
      { label: "Correo electrónico", value: model.correo },
    ),
    spacer(),
    p("Estado civil / régimen: espacios editables (sin fuente automática P189).", {
      size: 18,
      spaceAfter: 80,
    }),
    twoColFields(
      { label: "Estado civil", value: "" },
      { label: "Régimen patrimonial", value: "" },
    ),
    spacer(),
    sectionTitle("2. DATOS DE LA EMPRESA"),
    labeledField("Nombre de la empresa o patrón", model.empresaNombre),
    spacer(),
    labeledField("Número de registro patronal (NRPP)", model.registroPatronal),
    spacer(),
    twoColFields(
      { label: "LADA empresa", value: model.empresaLada },
      { label: "Teléfono empresa", value: model.empresaTelefono },
    ),
    spacer(),
    labeledField("Extensión", model.empresaExtension),
    spacer(),
    sectionTitle("3. DATOS DE LA VIVIENDA A MEJORAR"),
    labeledField("Calle", model.calle),
    spacer(),
    twoColFields(
      { label: "No. ext.", value: model.noExt },
      { label: "No. int.", value: model.noInt },
    ),
    spacer(),
    twoColFields(
      { label: "Lote", value: model.lote },
      { label: "Manzana", value: model.manzana },
    ),
    spacer(),
    labeledField("Colonia o fraccionamiento", model.colonia),
    spacer(),
    twoColFields(
      { label: "Entidad", value: model.entidad },
      { label: "Municipio o alcaldía", value: model.municipio },
    ),
    spacer(),
    labeledField("Código postal", model.cp),
    spacer(),
    p("Tipo de propiedad: espacios editables (sin fuente automática P189).", {
      size: 18,
      spaceAfter: 80,
    }),
    labeledField("La vivienda para mejorar es", ""),
    spacer(),
    sectionTitle("4. DATOS DEL CRÉDITO"),
    p("Destino del crédito: Reparación, ampliación o mejoramiento a la vivienda sin afectación estructural.", {
      size: 20,
    }),
    p("Tipo de crédito: INDIVIDUAL", { size: 20 }),
    labeledField("Monto de crédito solicitado ($)", model.montoMejoravit),
    spacer(),
    labeledField("Plazo solicitado (años, máximo 10)", model.plazo),
    spacer(),
    sectionTitle("4.1 DESTINO DE LOS RECURSOS (editable; sin fuente automática)"),
    labeledField("% para titulación (máximo 30)", ""),
    spacer(),
    labeledField("CLABE de la notaría", ""),
    spacer(),
    labeledField("CLABE del derechohabiente", ""),
    spacer(),
    labeledField("Número de crédito INFONAVIT", ""),
    spacer(),
    labeledField("Promotor", ""),
    new Paragraph({ children: [new PageBreak()] }),
    sectionTitle("5. REFERENCIAS FAMILIARES"),
    p("Referencia 1", { bold: true, size: 20 }),
    labeledField("Apellido paterno", model.ref1.apellidoPaterno),
    spacer(),
    labeledField("Apellido materno", model.ref1.apellidoMaterno),
    spacer(),
    labeledField("Nombre(s)", model.ref1.nombres),
    spacer(),
    twoColFields(
      { label: "LADA / teléfono", value: model.ref1.lada || model.ref1.telefono },
      { label: "Celular", value: model.ref1.celular },
    ),
    spacer(),
    p("Referencia 2", { bold: true, size: 20 }),
    labeledField("Apellido paterno", model.ref2.apellidoPaterno),
    spacer(),
    labeledField("Apellido materno", model.ref2.apellidoMaterno),
    spacer(),
    labeledField("Nombre(s)", model.ref2.nombres),
    spacer(),
    twoColFields(
      { label: "LADA / teléfono", value: model.ref2.lada || model.ref2.telefono },
      { label: "Celular", value: model.ref2.celular },
    ),
    spacer(),
    sectionTitle("6. BENEFICIARIO EN CASO DE FALLECIMIENTO DEL TITULAR"),
    labeledField("Parentesco", model.beneficiario.parentesco),
    spacer(),
    labeledField("Apellido paterno", model.beneficiario.apellidoPaterno),
    spacer(),
    labeledField("Apellido materno", model.beneficiario.apellidoMaterno),
    spacer(),
    labeledField("Nombre(s)", model.beneficiario.nombres),
    spacer(),
    sectionTitle("CIERRE"),
    labeledField("Ciudad", model.ciudadCierre),
    spacer(),
    labeledField(
      "Fecha",
      `${model.solicitudFecha.day} de ${model.solicitudFecha.monthName} de 20${model.solicitudFecha.year2}`,
    ),
    blankLine("Firma del derechohabiente"),
  ];

  const doc = new Document({
    creator: "concasa-crm-p189",
    title: "Solicitud de inscripción — editable",
    sections: [{ properties: {}, children }],
  });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}
