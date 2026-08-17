/**
 * Helpers AcroForm — Uint8Array / pdf-lib only (sin fs/Buffer).
 */

import {
  PDFCheckBox,
  PDFDocument,
  PDFTextField,
  StandardFonts,
  type PDFFont,
  type PDFForm,
} from "pdf-lib";

export async function loadPdfDoc(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

export function getTextField(form: PDFForm, name: string): PDFTextField {
  return form.getTextField(name);
}

export function getCheckBox(form: PDFForm, name: string): PDFCheckBox {
  return form.getCheckBox(name);
}

/** Fuerza vacío (limpia defaults). */
export function setTextEmpty(form: PDFForm, name: string): void {
  const f = getTextField(form, name);
  f.setText("");
}

export function setTextValue(
  form: PDFForm,
  name: string,
  value: string,
  fontSize?: number,
): void {
  const f = getTextField(form, name);
  if (fontSize !== undefined) f.setFontSize(fontSize);
  f.setText(value ?? "");
}

export function uncheck(form: PDFForm, name: string): void {
  getCheckBox(form, name).uncheck();
}

export function check(form: PDFForm, name: string): void {
  getCheckBox(form, name).check();
}

/**
 * Exclusión mutua: apaga todos, enciende a lo sumo uno.
 * activeName null → todos Off.
 */
export function setExclusiveCheck(
  form: PDFForm,
  candidates: readonly string[],
  activeName: string | null,
): void {
  for (const name of candidates) uncheck(form, name);
  if (activeName) check(form, activeName);
}

/** Reset total de todos los widgets del form. */
export function resetAllFormFields(form: PDFForm): void {
  for (const field of form.getFields()) {
    if (field instanceof PDFTextField) {
      field.setText("");
    } else if (field instanceof PDFCheckBox) {
      field.uncheck();
    }
  }
}

export async function embedHelvetica(doc: PDFDocument): Promise<PDFFont> {
  return doc.embedFont(StandardFonts.Helvetica);
}

export function updateAllTextAppearances(form: PDFForm, font: PDFFont): void {
  for (const field of form.getFields()) {
    if (field instanceof PDFTextField) {
      try {
        field.updateAppearances(font);
      } catch {
        // Algunos widgets con DA /Tf 0 fallan si no hay fontSize; reintento con size.
        try {
          field.setFontSize(10);
          field.updateAppearances(font);
        } catch {
          // leave as-is; flatten still embeds values
        }
      }
    }
  }
}

/** Metadata estable (reduce ruido entre runs; no garantiza hash idéntico). */
export function normalizePdfMetadata(doc: PDFDocument): void {
  const epoch = new Date("2026-01-01T00:00:00.000Z");
  doc.setTitle("INFONAVIT");
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setProducer("concasa-infonavit-pdf-v1");
  doc.setCreator("concasa-crm-p189");
  doc.setCreationDate(epoch);
  doc.setModificationDate(epoch);
}

export async function flattenAndSave(doc: PDFDocument): Promise<Uint8Array> {
  doc.getForm().flatten();
  normalizePdfMetadata(doc);
  const saved = await doc.save({ useObjectStreams: false });
  return saved instanceof Uint8Array ? saved : new Uint8Array(saved);
}
