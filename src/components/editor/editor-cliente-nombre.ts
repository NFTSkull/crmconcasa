/** Nombre placeholder cuando el autofill Infonavit aún no llenó cliente_datos. */
export const POR_CAPTURAR_NOMBRE = "POR CAPTURAR";

export function isPorCapturarNombre(
  nombre: string | null | undefined,
): boolean {
  return String(nombre ?? "").trim() === POR_CAPTURAR_NOMBRE;
}
