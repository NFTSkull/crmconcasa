export const EXPEDIENTE_CLIENTE_DATOS_UPDATED_EVENT = "expediente_cliente_datos_updated";

export function emitExpedienteClienteDatosUpdated(expedienteId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(EXPEDIENTE_CLIENTE_DATOS_UPDATED_EVENT, {
      detail: { expedienteId },
    }),
  );
}
