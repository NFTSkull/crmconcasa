/**
 * API pura P189 DOCX:
 * generateInfonavitDocx({ documentType, snapshot }) → Uint8Array (.docx nativo)
 *
 * Mismo snapshot canónico que generateInfonavitPdf.
 * NO convierte PDF. NO rasteriza. NO toca flattenAndSave.
 */

import { InfonavitPdfError } from "./errors.ts";
import { buildCartaDocx } from "./generate-infonavit-docx-carta.ts";
import { buildPresupuestoDocx } from "./generate-infonavit-docx-presupuesto.ts";
import { buildSolicitudDocx } from "./generate-infonavit-docx-solicitud.ts";
import { buildInfonavitPrintModel } from "./print-model.ts";
import type {
  InfonavitDocumentType,
  InfonavitPdfSnapshotInput,
} from "./types.ts";

export interface GenerateInfonavitDocxArgs {
  documentType: InfonavitDocumentType;
  snapshot: InfonavitPdfSnapshotInput;
}

export async function generateInfonavitDocx(
  args: GenerateInfonavitDocxArgs,
): Promise<Uint8Array> {
  const { documentType, snapshot } = args;
  if (!snapshot || typeof snapshot !== "object") {
    throw new InfonavitPdfError(
      "INFONAVIT_INVALID_DATE",
      "snapshot inválido",
      { reason: "missing_snapshot" },
    );
  }
  const model = buildInfonavitPrintModel(snapshot);
  switch (documentType) {
    case "carta_bajo_protesta":
      return buildCartaDocx(model);
    case "presupuesto_mejoramiento":
      return buildPresupuestoDocx(model);
    case "solicitud_inscripcion_credito":
      return buildSolicitudDocx(model);
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
