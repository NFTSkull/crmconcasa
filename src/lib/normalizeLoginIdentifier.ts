/**
 * Normaliza el identificador del login Supabase.
 * Alias exacto controlado: `asesor.mejoravit` → correo interno.
 * No es un sistema general de usernames.
 */

export const LOGIN_ALIAS_ASESOR_MEJORAVIT = "asesor.mejoravit" as const;

export const LOGIN_EMAIL_ASESOR_MEJORAVIT =
  "asesor.mejoravit@usuarios.concasa.mx" as const;

export const MSG_LOGIN_IDENTIFICADOR_INVALIDO =
  "Usuario no reconocido. Usa tu correo o el usuario autorizado.";

export const MSG_LOGIN_IDENTIFICADOR_VACIO =
  "Correo o usuario y contraseña son obligatorios.";

/**
 * `trim` + lowercase. Alias exacto `asesor.mejoravit` → email interno.
 * Si contiene `@`, se trata como correo (también en minúsculas).
 * Cualquier otro valor sin `@` se rechaza.
 */
export function normalizeLoginIdentifier(raw: string): string {
  const id = String(raw ?? "").trim().toLowerCase();
  if (!id) {
    throw new Error(MSG_LOGIN_IDENTIFICADOR_VACIO);
  }
  if (id === LOGIN_ALIAS_ASESOR_MEJORAVIT) {
    return LOGIN_EMAIL_ASESOR_MEJORAVIT;
  }
  if (id.includes("@")) {
    return id;
  }
  throw new Error(MSG_LOGIN_IDENTIFICADOR_INVALIDO);
}
