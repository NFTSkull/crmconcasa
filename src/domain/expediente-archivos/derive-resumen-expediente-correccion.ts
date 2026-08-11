import type { ExpedienteClienteDatosEstado } from "@/domain/expediente-cliente-datos/types";
import { clienteDatosCorreccionEnviadaPendiente } from "@/lib/mesaCorreccionEntrada";
import { isRetencionPrincipalDocumentTipo } from "@/lib/fileUploadValidation";
import {
  INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
} from "./integration-docs-completos";
import {
  deriveResumenDocumental,
  type CategoriaResumenDocumental,
  type ExpedienteArchivoResumen,
} from "./types";

export type DeriveResumenExpedienteCorreccionContext = Readonly<{
  clienteDatosEstado?: ExpedienteClienteDatosEstado | null;
  clienteDatosUpdatedAt?: string | null;
  clienteDatosValidatedAt?: string | null;
  fechaEnvioMesa?: string | null;
  /** Si Mesa pidió corrección de Acuse vía envío de retención. */
  retencionEnvioEstado?: string | null;
}>;

const TIPOS_CORREGIBLES_ASESOR: readonly string[] = [
  ...INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
  ...INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
  "ine",
  "estado_cuenta",
  "nss",
  "direccion",
];

function isTipoCorregibleAsesor(tipo: string): boolean {
  return (
    TIPOS_CORREGIBLES_ASESOR.includes(tipo) || isRetencionPrincipalDocumentTipo(tipo)
  );
}

function hasDocRechazadoAsesor(
  resumen: readonly ExpedienteArchivoResumen[],
): boolean {
  return resumen.some(
    (r) =>
      r.estatus_revision === "rechazado" &&
      isTipoCorregibleAsesor(String(r.tipo_documento ?? "")),
  );
}

function hasDocResubidoAsesor(
  resumen: readonly ExpedienteArchivoResumen[],
): boolean {
  return resumen.some(
    (r) =>
      r.estatus_revision === "resubido" &&
      isTipoCorregibleAsesor(String(r.tipo_documento ?? "")),
  );
}

/**
 * Resumen operativo de corrección para bandejas Mesa/Asesor.
 * Combina datos generales, docs `cliente_*` (+ legado) y Acuse/retención.
 */
export function deriveResumenExpedienteCorreccion(
  resumen: readonly ExpedienteArchivoResumen[],
  clienteDatosEstadoOrCtx?: ExpedienteClienteDatosEstado | DeriveResumenExpedienteCorreccionContext | null,
  legacyFechaEnvioMesa?: string | null,
): CategoriaResumenDocumental {
  const ctx: DeriveResumenExpedienteCorreccionContext =
    typeof clienteDatosEstadoOrCtx === "string" || clienteDatosEstadoOrCtx == null
      ? {
          clienteDatosEstado: clienteDatosEstadoOrCtx ?? null,
          fechaEnvioMesa: legacyFechaEnvioMesa ?? null,
        }
      : clienteDatosEstadoOrCtx;

  if (ctx.clienteDatosEstado === "rechazado") return "correccion_requerida";

  if (ctx.retencionEnvioEstado === "correccion_requerida") {
    return "correccion_requerida";
  }

  if (hasDocRechazadoAsesor(resumen)) return "correccion_requerida";

  if (hasDocResubidoAsesor(resumen)) return "correccion_enviada";

  const docResumen = deriveResumenDocumental(resumen);
  if (docResumen === "correccion_requerida" || docResumen === "correccion_enviada") {
    return docResumen;
  }

  if (
    clienteDatosCorreccionEnviadaPendiente(
      {
        estado: ctx.clienteDatosEstado ?? null,
        updatedAt: ctx.clienteDatosUpdatedAt,
        validatedAt: ctx.clienteDatosValidatedAt,
      },
      ctx.fechaEnvioMesa,
    )
  ) {
    return "correccion_enviada";
  }

  return docResumen;
}
