"use client";

/** Documento persistido en `localStorage` con el contexto del usuario mock (Cynthia / mesa / asesor). */
export const MOCK_USER_KEY = "mock_user";

export type MockUserV1 = Readonly<{
  email: string;
  role: string;
  name: string;
}>;

/**
 * Operadoras Mesa Interno con capability `ver_externos_mesa` confirmada en Production.
 *
 * `mesa_control` es el rol UI legacy que ya habilita la bandeja mixta y su selector
 * Todos / Internos / Externos. La autoridad real sigue en Supabase: profiles.app_role,
 * RLS/RPC y `profile_capabilities`; este puente no amplía acceso de backend.
 */
const MESA_ORIGEN_MIXTO_EMAILS = new Set([
  "mesa.interno03@concasa.mx", // Sara
  "mesa.interno04@concasa.mx", // Kass
]);

/** `revisor` es alias legacy del mock; en producción solo existe `editor`. */
export function normalizeLegacyMockRole(role: string): string {
  const trimmed = role.trim();
  if (trimmed === "revisor") return "editor";
  return trimmed;
}

function safeParse(raw: string | null): MockUserV1 | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<MockUserV1>;
    if (
      typeof o.email === "string" &&
      typeof o.role === "string" &&
      typeof o.name === "string"
    ) {
      return {
        email: o.email.trim(),
        role: o.role.trim(),
        name: o.name.trim(),
      };
    }
  } catch {
    // ignore
  }
  return null;
}

export function readMockUser(): MockUserV1 | null {
  if (typeof window === "undefined") return null;
  return safeParse(window.localStorage.getItem(MOCK_USER_KEY));
}

function resolveMesaOrigenMixtoRole(role: string, email: string | null | undefined): string {
  const normalizedRole = normalizeLegacyMockRole(role);
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (
    normalizedRole === "mesa_control_interno" &&
    MESA_ORIGEN_MIXTO_EMAILS.has(normalizedEmail)
  ) {
    return "mesa_control";
  }
  return normalizedRole;
}

/**
 * Rol efectivo para permisos mock: prioriza `mock_user.role`, luego `mock_role` legacy.
 * Sara/Kass conservan su app_role real `mesa_interno`; únicamente la proyección UI
 * usa `mesa_control` para reflejar la capability de bandeja mixta ya otorgada.
 */
export function getEffectiveMockRole(): string | null {
  const u = readMockUser();
  if (u?.role) return resolveMesaOrigenMixtoRole(u.role, u.email);
  if (typeof window === "undefined") return null;
  const legacy = window.localStorage.getItem("mock_role");
  if (!legacy?.trim()) return null;
  const email = window.localStorage.getItem("mock_email");
  return resolveMesaOrigenMixtoRole(legacy, email);
}

export function getEffectiveMockEmail(): string | null {
  const u = readMockUser();
  if (u?.email) return u.email;
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("mock_email")?.trim() || null;
}

export function getEffectiveMockName(): string | null {
  const u = readMockUser();
  if (u?.name) return u.name;
  return null;
}

/** Persiste `mock_user` y mantiene `mock_role` / `mock_email` sincronizados para código legacy. */
export function persistMockUser(user: MockUserV1): void {
  if (typeof window === "undefined") return;
  const normalized: MockUserV1 = {
    email: user.email.trim(),
    role: normalizeLegacyMockRole(user.role),
    name: user.name.trim(),
  };
  window.localStorage.setItem(MOCK_USER_KEY, JSON.stringify(normalized));
  window.localStorage.setItem("mock_role", normalized.role);
  window.localStorage.setItem("mock_email", normalized.email);
}

/** Borra sesión mock (`mock_user` y claves legacy). Idempotente. */
export function clearMockUser(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(MOCK_USER_KEY);
  window.localStorage.removeItem("mock_role");
  window.localStorage.removeItem("mock_email");
}

export function isMesaControlAdminEffectiveRole(): boolean {
  return getEffectiveMockRole() === "mesa_control_admin";
}

/** Roles de mesa (mock) que comparten flujo UI “mesa” en seguimiento. */
export function isMesaControlMockRole(role: string | null): boolean {
  if (!role) return false;
  if (role === "mesa_control") return true;
  return role.startsWith("mesa_control_");
}
