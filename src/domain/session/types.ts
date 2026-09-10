/**
 * Tipos de dominio para la sesión de usuario.
 *
 * Producción (Supabase `app_role`): asesor, editor, mesa_*, super_admin.
 * `revisor` es alias legacy del mock — normalizar a `editor` vía `normalizeLegacyMockRole`.
 */

export type Rol =
  | "asesor"
  | "revisor" // legacy mock; normalizar a editor — no existe en producción
  | "super_admin"
  | "admin"
  | "editor"
  | "mesa_control";

export interface UserSession {
  email: string;
  role: Rol;
  /**
   * Solo producción/Supabase. Permite adaptar UX de asesor sin confiar en
   * metadata del navegador; la autoridad sigue siendo `public.profiles`/RPC.
   */
  tipoAsesorOrigen?: string | null;
}
