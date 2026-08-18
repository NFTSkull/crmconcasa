/**
 * Carta Bajo Protesta — DOCX nativo editable.
 * Texto oficial + valores del print model. Sin imágenes.
 */

import { Document, Packer, PageBreak, Paragraph, type FileChild } from "docx";
import {
  blankLine,
  editableValue,
  heading,
  labeledField,
  p,
  sectionTitle,
  spacer,
  subheading,
} from "./docx-layout.ts";
import type { InfonavitPrintModel } from "./print-model.ts";

const CLAUSES_P1: string[] = [
  "Por medio de la presente, bajo protesta de decir verdad manifiesto que:",
  "I. Cumplo con los requisitos establecidos por el INFONAVIT para poder acceder al financiamiento del producto “MEJORAVIT SOLO PARA TI”, los cuales me fueron informados y explicados previo a la firma de este documento.",
  "II. La vivienda en la cual se realizarán las reparaciones, ampliaciones o mejoras es el inmueble que habito y que es: (i) de mi propiedad o bien (ii) propiedad de mi cónyuge o concubino, o (iii) propiedad de algún familiar consanguíneo hasta el segundo grado o bien (iv) propiedad de un familiar por afinidad hasta el segundo grado limitado de forma ascendente a suegros, así mismo, en el caso de tener la posesión de la vivienda a partir del arrendamiento de esta, cuento con contrato vigente y con las facturas del pago de renta que cumplan con los requisitos fiscales exigibles, y que el plazo de vigencia de dicho contrato es de al menos un año contado a partir de la fecha de formalización del crédito que el INFONAVIT, o (v) detento la legítima tenencia de la vivienda, lo cual he acreditado al INFONAVIT previo al otorgamiento del crédito y que dichos documentos son verdaderos. Los documentos para acreditar la legítima tenencia están disponibles para consulta en el portal institucional www.infonavit.org.mx.",
  "III. Por medio de la presente me obligo a:",
  "i. Destinar los recursos que obtenga del crédito que el INFONAVIT me otorgue, única y exclusivamente para la reparación, ampliación y mejoramiento de la vivienda sin que implique su afectación estructural que habito, y en caso de que así lo haya solicitado, para destinarlo a la regularización de la propiedad de la vivienda, siempre que esta se encuentre a mi nombre;",
  "ii. Realizar puntual y de forma completa todos los pagos que el INFONAVIT me señale hasta la liquidación del crédito que el INFONAVIT me otorgue;",
  "iii. A fin de brindar debido cumplimiento a la Ley del Infonavit, me obligo a cargar a través de las herramientas que el INFONAVIT ponga a mi disposición, la evidencia que acredite la reparación, ampliación o mejora realizada. Asimismo, comprendo que el INFONAVIT se reserva la facultad de llevar a cabo en cualquier momento, verificaciones o inspecciones a la vivienda a fin de constatar la aplicación de los recursos en los términos que se acuerden en el Contrato de Crédito respectivo.",
];

const CLAUSES_P2: string[] = [
  "IV. Con el fin de que el INFONAVIT vigile que los recursos se destinen al fin para el que fueron concedidos, manifiesto que los mismos serán utilizados de la siguiente manera:",
  "V. A la fecha de firma del contrato no estoy tramitando jubilación o pensión ante el Instituto Mexicano del Seguro Social, no estoy tramitando la determinación de alguna incapacidad ante el Instituto Mexicano del Seguro Social y tampoco estoy tramitando ante la administradora de fondos el retiro correspondiente, la devolución parcial o total del saldo de la cuenta individual del Sistema de Ahorro para el Retiro.",
  "VI. La información que he proporcionado al INFONAVIT, así como las declaraciones contenidas en este documento son ciertas, correctas, exactas y verdaderas.",
  "VII. Tengo conocimiento y comprendo el contenido del artículo 58 de la Ley del Infonavit, el cual señala que “Se reputará como fraude y se sancionará como tal, en los términos del Código Penal Federal, el obtener los créditos o recibir los depósitos a que esta Ley se refiere, sin tener derecho a ello, mediante engaño, simulación o sustitución de persona”.",
];

export async function buildCartaDocx(model: InfonavitPrintModel): Promise<Uint8Array> {
  const fechaLine = `${model.cartaFecha.day} de ${model.cartaFecha.month} de 20${model.cartaFecha.year2}`;
  const children: FileChild[] = [
    heading("CARTA BAJO PROTESTA DE DECIR VERDAD"),
    subheading("“Mejoravit solo para ti”"),
    labeledField("Localidad o ciudad donde se ubica la vivienda", model.localidad),
    spacer(),
    labeledField("Fecha", fechaLine),
    spacer(),
    ...CLAUSES_P1.map((t) => p(t, { size: 20, spaceAfter: 120 })),
    new Paragraph({ children: [new PageBreak()] }),
    p(CLAUSES_P2[0]!, { size: 20, spaceAfter: 120 }),
    sectionTitle("Describa brevemente la mejora o remodelación a realizar."),
    ...(model.propuestaLines.length > 0
      ? model.propuestaLines.map((line) => editableValue(line, { size: 20 }))
      : [editableValue("", { size: 20 })]),
    spacer(),
    ...CLAUSES_P2.slice(1).map((t) => p(t, { size: 20, spaceAfter: 120 })),
    p("Protesto lo necesario", { bold: true, center: true, spaceAfter: 240 }),
    labeledField("Nombre completo", model.nombreCompleto),
    spacer(),
    labeledField("NSS", model.nss),
    blankLine("Firma"),
  ];

  const doc = new Document({
    creator: "concasa-crm-p189",
    title: "Carta bajo protesta — editable",
    sections: [{ properties: {}, children }],
  });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}
