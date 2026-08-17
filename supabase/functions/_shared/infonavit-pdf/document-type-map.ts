/**
 * Mapping explícito DB outbox → B1. Sin heurística string replace.
 */

import { InfonavitPdfError } from "./errors.ts";
import type { InfonavitDocumentType } from "./types.ts";

export const INFONAVIT_DB_DOCUMENT_TYPES = [
  "infonavit_carta_bajo_protesta",
  "infonavit_presupuesto_mejoramiento",
  "infonavit_solicitud_inscripcion",
] as const;

export type InfonavitDbDocumentType =
  (typeof INFONAVIT_DB_DOCUMENT_TYPES)[number];

export const INFONAVIT_DB_TO_B1: Record<
  InfonavitDbDocumentType,
  InfonavitDocumentType
> = {
  infonavit_carta_bajo_protesta: "carta_bajo_protesta",
  infonavit_presupuesto_mejoramiento: "presupuesto_mejoramiento",
  infonavit_solicitud_inscripcion: "solicitud_inscripcion_credito",
};

export const INFONAVIT_B1_TEMPLATE_FILE: Record<InfonavitDocumentType, string> =
  {
    carta_bajo_protesta: "carta-bajo-protesta.pdf",
    presupuesto_mejoramiento: "presupuesto-mejoramiento.pdf",
    solicitud_inscripcion_credito: "solicitud-inscripcion-credito.pdf",
  };

export function isInfonavitDbDocumentType(
  raw: string,
): raw is InfonavitDbDocumentType {
  return (INFONAVIT_DB_DOCUMENT_TYPES as readonly string[]).includes(raw);
}

export function mapDbDocumentTypeToB1(
  raw: string,
): InfonavitDocumentType {
  if (!isInfonavitDbDocumentType(raw)) {
    throw new InfonavitPdfError(
      "INFONAVIT_UNSUPPORTED_DOCUMENT",
      "document_type no soportado",
      { reason: "unknown_db_document_type" },
    );
  }
  return INFONAVIT_DB_TO_B1[raw];
}
