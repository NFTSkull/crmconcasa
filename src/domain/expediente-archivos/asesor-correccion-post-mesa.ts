import type { ResumenEstatus } from "./types";
import type { IntegrationDocAsesorUploadTipo } from "./integration-docs-completos";

/** Upload inicial pre-envío a Mesa (4 oblig + opcionales). */
export function asesorPuedeSubirDocumentoPreMesa(submittedToMesa: boolean): boolean {
  return !submittedToMesa;
}

/** Corrección post-Mesa: solo documentos rechazados explícitamente. */
export function asesorPuedeCorregirDocumentoRechazado(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
): boolean {
  return submittedToMesa && estatusRevision === "rechazado";
}

export function asesorPuedeSubirOCorregirDocumento(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
): boolean {
  if (!submittedToMesa) return true;
  return asesorPuedeCorregirDocumentoRechazado(submittedToMesa, estatusRevision);
}

export function asesorDebeUsarCorreccionDocumento(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
): boolean {
  return asesorPuedeCorregirDocumentoRechazado(submittedToMesa, estatusRevision);
}

export type AsesorDocumentoUploadMode = "normal" | "correccion";

export function asesorDocumentoUploadMode(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
): AsesorDocumentoUploadMode | null {
  if (!submittedToMesa) return "normal";
  if (estatusRevision === "rechazado") return "correccion";
  return null;
}

export function asesorPuedeEditarClienteDatos(
  submittedToMesa: boolean,
  estado: "pendiente" | "completo" | "validado" | "rechazado",
): boolean {
  if (!submittedToMesa) return true;
  return estado === "rechazado";
}

export function asesorDebeUsarCorreccionClienteDatos(
  submittedToMesa: boolean,
  estado: "pendiente" | "completo" | "validado" | "rechazado",
): boolean {
  return submittedToMesa && estado === "rechazado";
}

export type CorreccionDocumentoParams = {
  expedienteId: string;
  tipo_documento: IntegrationDocAsesorUploadTipo;
  file: File;
};
