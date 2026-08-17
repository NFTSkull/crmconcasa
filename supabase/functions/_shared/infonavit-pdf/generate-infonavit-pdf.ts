/**
 * API pura P189 B1:
 * generateInfonavitPdf({ documentType, templateBytes, snapshot }) → Uint8Array
 *
 * Sin Storage / Supabase / fetch / DB / auth / service_role / Date.now().
 */

import { PDFCheckBox, PDFTextField, type PDFDocument } from "pdf-lib";
import { InfonavitPdfError } from "./errors.ts";
import { fillBajoProtesta } from "./fill-bajo-protesta.ts";
import { fillPresupuesto } from "./fill-presupuesto.ts";
import { fillSolicitud } from "./fill-solicitud.ts";
import { flattenAndSave, loadPdfDoc } from "./form-helpers.ts";
import { assertTemplateContract } from "./template-contract.ts";
import type {
  GenerateInfonavitPdfArgs,
  InfonavitDocumentType,
  InfonavitPdfSnapshotInput,
} from "./types.ts";

export type {
  GenerateInfonavitPdfArgs,
  InfonavitDocumentType,
  InfonavitPdfSnapshotInput,
};

export type FormFieldAudit = Record<string, string | boolean>;

/** Rellena + aplana. API pública. */
export async function generateInfonavitPdf(
  args: GenerateInfonavitPdfArgs,
): Promise<Uint8Array> {
  const { bytes } = await generateInfonavitPdfAudited(args);
  return bytes;
}

/**
 * Igual que generate, pero expone valores AcroForm ANTES de flatten
 * (solo para certificación / tests locales).
 */
export async function generateInfonavitPdfAudited(
  args: GenerateInfonavitPdfArgs,
): Promise<{ bytes: Uint8Array; fieldsBeforeFlatten: FormFieldAudit }> {
  const { documentType, templateBytes, snapshot } = args;
  assertSnapshotShape(snapshot);

  const doc = await loadPdfDoc(templateBytes);
  const contract = await assertTemplateContract({
    documentType,
    templateBytes,
    doc,
  });

  await applyFill(documentType, doc, contract, snapshot);
  const fieldsBeforeFlatten = readFormAudit(doc);
  const bytes = await flattenAndSave(doc);
  return { bytes, fieldsBeforeFlatten };
}

async function applyFill(
  documentType: InfonavitDocumentType,
  doc: PDFDocument,
  contract: Awaited<ReturnType<typeof assertTemplateContract>>,
  snapshot: InfonavitPdfSnapshotInput,
): Promise<void> {
  switch (documentType) {
    case "carta_bajo_protesta":
      await fillBajoProtesta({ doc, contract, snapshot });
      return;
    case "presupuesto_mejoramiento":
      await fillPresupuesto({ doc, contract, snapshot });
      return;
    case "solicitud_inscripcion_credito":
      await fillSolicitud({ doc, contract, snapshot });
      return;
    default: {
      const _exhaustive: never = documentType;
      throw new InfonavitPdfError(
        "INFONAVIT_UNSUPPORTED_DOCUMENT",
        "documentType no soportado",
        { documentType: String(_exhaustive) },
      );
    }
  }
}

export function readFormAudit(doc: PDFDocument): FormFieldAudit {
  const out: FormFieldAudit = {};
  const form = doc.getForm();
  for (const field of form.getFields()) {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      out[name] = field.getText() ?? "";
    } else if (field instanceof PDFCheckBox) {
      out[name] = field.isChecked();
    }
  }
  return out;
}

function assertSnapshotShape(snapshot: InfonavitPdfSnapshotInput): void {
  if (!snapshot || typeof snapshot !== "object") {
    throw new InfonavitPdfError(
      "INFONAVIT_INVALID_DATE",
      "snapshot inválido",
      { reason: "missing_snapshot" },
    );
  }
  if (typeof snapshot.fechaDocumento !== "string") {
    throw new InfonavitPdfError(
      "INFONAVIT_INVALID_DATE",
      "fechaDocumento requerida",
      { reason: "missing_fechaDocumento" },
    );
  }
  if (!snapshot.cliente || typeof snapshot.cliente !== "object") {
    throw new InfonavitPdfError(
      "INFONAVIT_TEMPLATE_CONTRACT_MISMATCH",
      "cliente requerido en snapshot",
      { reason: "missing_cliente" },
    );
  }
}
