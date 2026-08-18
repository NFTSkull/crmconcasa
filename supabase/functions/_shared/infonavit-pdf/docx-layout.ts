/**
 * Primitivas OOXML para DOCX P189: párrafos y celdas de texto nativo.
 * Sin imágenes, sin PDF embebido, sin raster.
 */

import {
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
  type IBorderOptions,
} from "docx";

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
export const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const THIN: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: "666666" };
export const BOX_BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN };

const FONT = "Calibri";

export function run(text: string, opts?: { bold?: boolean; size?: number; underline?: boolean }): TextRun {
  return new TextRun({
    font: FONT,
    text,
    bold: opts?.bold ?? false,
    size: opts?.size ?? 22, // half-points (22 = 11pt)
    underline: opts?.underline ? { type: UnderlineType.SINGLE } : undefined,
  });
}

export function p(
  text: string,
  opts?: { bold?: boolean; size?: number; center?: boolean; spaceAfter?: number },
): Paragraph {
  return new Paragraph({
    alignment: opts?.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { after: opts?.spaceAfter ?? 80 },
    children: [run(text, { bold: opts?.bold, size: opts?.size ?? 22 })],
  });
}

export function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [run(text, { bold: true, size: 28 })],
  });
}

export function subheading(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [run(text, { bold: true, size: 22 })],
  });
}

export function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 120 },
    children: [run(text, { bold: true, size: 22 })],
  });
}

/** Valor editable: siempre un w:t (nunca drawing). Vacío → subrayado clickable. */
export function editableValue(value: string, opts?: { bold?: boolean; size?: number }): Paragraph {
  const text = value.trim().length > 0 ? value : "____________________";
  return new Paragraph({
    spacing: { after: 40 },
    children: [
      run(text, {
        bold: opts?.bold,
        size: opts?.size ?? 22,
        underline: true,
      }),
    ],
  });
}

function cell(children: Paragraph[], widthPct: number, boxed = true): TableCell {
  return new TableCell({
    borders: boxed ? BOX_BORDERS : NO_BORDERS,
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children,
  });
}

export function labeledField(label: string, value: string, opts?: { labelPct?: number }): Table {
  const labelPct = opts?.labelPct ?? 32;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [labelPct * 50, (100 - labelPct) * 50],
    rows: [
      new TableRow({
        children: [
          cell([p(label, { bold: true, size: 18, spaceAfter: 0 })], labelPct),
          cell([editableValue(value, { size: 20 })], 100 - labelPct),
        ],
      }),
    ],
  });
}

export function twoColFields(
  left: { label: string; value: string },
  right: { label: string; value: string },
): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [2500, 2500, 2500, 2500],
    rows: [
      new TableRow({
        children: [
          cell([p(left.label, { bold: true, size: 18, spaceAfter: 0 })], 20),
          cell([editableValue(left.value, { size: 20 })], 30),
          cell([p(right.label, { bold: true, size: 18, spaceAfter: 0 })], 20),
          cell([editableValue(right.value, { size: 20 })], 30),
        ],
      }),
    ],
  });
}

export function blankLine(label = "Firma"): Paragraph {
  return new Paragraph({
    spacing: { before: 400, after: 80 },
    children: [
      run(`${label}: `, { size: 20 }),
      run("________________________________", { size: 20, underline: true }),
    ],
  });
}

export function spacer(): Paragraph {
  return new Paragraph({ spacing: { after: 80 }, children: [] });
}
