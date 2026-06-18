/** Programa en labels UI (formulario asesor). */
export type ExpedienteProgramaUi =
  | "Mejoravit"
  | "Subcuenta"
  | "Compro tu casa";

/** Payload para crear expediente desde `/asesor/nueva`. */
export interface CreateExpedienteInput {
  programa: ExpedienteProgramaUi;
  nss: string;
  cliente_nombre: string;
  telefono_cliente: string;
  direccion_opcional: string;
  /**
   * Email del asesor autenticado (mock `localStorage`).
   * La RPC Supabase ignora este campo y usa `auth.uid()`.
   */
  asesorEmail: string;
}
