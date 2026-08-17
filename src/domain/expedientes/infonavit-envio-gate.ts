import { isProgramaMejoravitDb } from "@/lib/clienteDatosCobro";

/** Mensaje UI P189 B3: no auto-save al enviar/reingresar. */
export const MSJ_INFONAVIT_GUARDA_DATOS_ANTES_ENVIO =
  "Guarda primero los Datos Generales del cliente antes de enviarlo a Mesa.";

/**
 * Solo Mejoravit cuando el envío va a generar snapshot P189:
 * cambios locales no persistidos no pueden generar snapshot.
 * FLAG OFF / legacy sin enqueue: no introduce bloqueo nuevo.
 */
export function bloqueaEnvioInfonavitPorCambiosSinGuardar(input: {
  programaDb?: string | null;
  hasUnsavedClienteDatos: boolean;
  p189SnapshotRelevant?: boolean;
}): boolean {
  if (!isProgramaMejoravitDb(input.programaDb)) return false;
  if (!input.hasUnsavedClienteDatos) return false;
  return input.p189SnapshotRelevant === true;
}
