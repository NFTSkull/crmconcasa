/** Texto visible para `role="alert"`; evita nodos vacíos en accesibilidad. */
export function hasAlertMessage(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export const MESA_OPS_UPDATED_EVENT = "mesa_ops_updated";

export function notifyMesaOpsUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MESA_OPS_UPDATED_EVENT));
}
