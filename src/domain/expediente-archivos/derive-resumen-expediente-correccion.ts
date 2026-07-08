import type { ExpedienteClienteDatosEstado } from "@/domain/expediente-cliente-datos/types";
import { clienteDatosCorreccionEnviadaPendiente } from "@/lib/mesaCorreccionEntrada";
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
}>;

/**
 * Resumen operativo de corrección para bandejas Mesa/Asesor.
 * Combina documentos (paquete base) con rechazo/corrección de datos generales.
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
