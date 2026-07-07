import type { ResumenEstatus } from "./types";
import {
  isIntegrationDocAsesorOpcionalTipo,
  type IntegrationDocAsesorUploadTipo,
} from "./integration-docs-completos";

/** Upload inicial pre-envío a Mesa (5 oblig + opcionales). */
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

/** Post-Mesa: primer upload de opcional que no se envió antes del envío. */
export function asesorPuedeSubirOpcionalFaltantePostMesa(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
  tipoDocumento: IntegrationDocAsesorUploadTipo,
): boolean {
  return (
    submittedToMesa &&
    estatusRevision === "faltante" &&
    isIntegrationDocAsesorOpcionalTipo(tipoDocumento)
  );
}

/** Post-Mesa: reemplazar documento ya registrado (sin reenviar expediente). */
export function asesorPuedeReemplazarDocumentoExistentePostMesa(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
): boolean {
  return (
    submittedToMesa &&
    estatusRevision !== "faltante" &&
    estatusRevision !== "rechazado"
  );
}

export function asesorPuedeSubirOCorregirDocumento(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
  tipoDocumento?: IntegrationDocAsesorUploadTipo,
): boolean {
  if (!submittedToMesa) return true;
  if (asesorPuedeCorregirDocumentoRechazado(submittedToMesa, estatusRevision)) {
    return true;
  }
  if (
    tipoDocumento &&
    asesorPuedeSubirOpcionalFaltantePostMesa(
      submittedToMesa,
      estatusRevision,
      tipoDocumento,
    )
  ) {
    return true;
  }
  if (asesorPuedeReemplazarDocumentoExistentePostMesa(submittedToMesa, estatusRevision)) {
    return true;
  }
  return false;
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
  tipoDocumento?: IntegrationDocAsesorUploadTipo,
): AsesorDocumentoUploadMode | null {
  if (!submittedToMesa) return "normal";
  if (estatusRevision === "rechazado") return "correccion";
  if (
    tipoDocumento &&
    asesorPuedeSubirOpcionalFaltantePostMesa(
      submittedToMesa,
      estatusRevision,
      tipoDocumento,
    )
  ) {
    return "normal";
  }
  if (asesorPuedeReemplazarDocumentoExistentePostMesa(submittedToMesa, estatusRevision)) {
    return "normal";
  }
  return null;
}

export function asesorPuedeEditarClienteDatos(
  _submittedToMesa: boolean,
  _estado: "pendiente" | "completo" | "validado" | "rechazado",
): boolean {
  return true;
}

/** Post-envío a Mesa: guardar vía RPC de corrección/actualización (no `save` inicial). */
export function asesorDebeUsarCorreccionClienteDatos(
  submittedToMesa: boolean,
  tieneDatosGuardados: boolean,
): boolean {
  return submittedToMesa && tieneDatosGuardados;
}

/** Corrección tras rechazo explícito de Mesa (limpia rechazo y vuelve a completo). */
export function asesorEsCorreccionRechazoClienteDatos(
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
