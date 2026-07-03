import type { ExpedienteClienteDatosEstado } from "@/domain/expediente-cliente-datos/types";
import {
  deriveResumenDocumental,
  type CategoriaResumenDocumental,
  type ExpedienteArchivoResumen,
} from "./types";

/**
 * Resumen operativo de corrección para bandejas Mesa/Asesor.
 * Combina documentos (paquete base) con rechazo de datos generales del cliente.
 */
export function deriveResumenExpedienteCorreccion(
  resumen: readonly ExpedienteArchivoResumen[],
  clienteDatosEstado?: ExpedienteClienteDatosEstado | null,
): CategoriaResumenDocumental {
  if (clienteDatosEstado === "rechazado") return "correccion_requerida";
  return deriveResumenDocumental(resumen);
}
