"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MockStoreContextValue } from "@/context/MockStoreContext";
import type { Rol as MockStoreRol } from "@/lib/mock-store";
import { persistMockUser, clearMockUser } from "@/lib/mockUser";
import { normalizeLoginIdentifier } from "@/lib/normalizeLoginIdentifier";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import type { SessionRepo } from "./repo";
import type { Rol, UserSession } from "./types";

const SESSION_KEY = "concasa_session";

const APP_ROLE_TO_MOCK: Readonly<Record<string, string>> = {
  asesor: "asesor",
  editor: "editor",
  super_admin: "super_admin",
  mesa_admin: "mesa_control_admin",
  mesa_interno: "mesa_control_interno",
  mesa_externo: "mesa_control_externo",
};

type ProfileRow = Readonly<{
  email: string;
  full_name: string;
  app_role: string;
  tipo_mesa: string | null;
  tipo_asesor_origen: string | null;
  organization_id: string;
  active: boolean;
}>;

/** Perfil resuelto en memoria; `organization_id` no se persiste en `mock_user` (P3A). */
export type ResolvedSupabaseProfile = Readonly<{
  email: string;
  fullName: string;
  mockRole: string;
  sessionRole: Rol;
  organizationId: string;
  tipoMesa: string | null;
  tipoAsesorOrigen: string | null;
}>;

export class SupabaseSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseSessionError";
  }
}

/** Traduce `app_role` de Postgres al rol mock que consume la UI actual. */
export function mapAppRoleToMockRole(appRole: string): string {
  const mapped = APP_ROLE_TO_MOCK[appRole.trim()];
  if (!mapped) {
    throw new SupabaseSessionError(
      `Rol de perfil no soportado: ${appRole}. Contacta al administrador.`,
    );
  }
  return mapped;
}

/** Colapsa rol mock detallado al `Rol` de sesión usado por routing (`mesa_control_*` → `mesa_control`). */
export function mapMockRoleToSessionRole(mockRole: string): Rol {
  const normalized = mockRole.trim();
  if (normalized.startsWith("mesa_control")) return "mesa_control";
  if (
    normalized === "asesor" ||
    normalized === "editor" ||
    normalized === "super_admin" ||
    normalized === "admin"
  ) {
    return normalized as Rol;
  }
  throw new SupabaseSessionError(
    `Rol de sesión no soportado: ${mockRole}. Contacta al administrador.`,
  );
}

function resolveProfileRow(row: ProfileRow): ResolvedSupabaseProfile {
  if (!row.active) {
    throw new SupabaseSessionError(
      "Tu cuenta está inactiva. Contacta al administrador para reactivarla.",
    );
  }

  const mockRole = mapAppRoleToMockRole(row.app_role);
  return {
    email: row.email.trim(),
    fullName: row.full_name.trim() || row.email.trim(),
    mockRole,
    sessionRole: mapMockRoleToSessionRole(mockRole),
    organizationId: row.organization_id,
    tipoMesa: row.tipo_mesa,
    tipoAsesorOrigen: row.tipo_asesor_origen,
  };
}

function toUserSession(resolved: ResolvedSupabaseProfile): UserSession {
  return {
    email: resolved.email,
    role: resolved.sessionRole,
  };
}

async function fetchProfileForUser(
  client: SupabaseClient,
  userId: string,
): Promise<ResolvedSupabaseProfile> {
  const { data, error } = await client
    .from("profiles")
    .select(
      "email, full_name, app_role, tipo_mesa, tipo_asesor_origen, organization_id, active",
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new SupabaseSessionError(
      "No se pudo cargar tu perfil. Intenta de nuevo o contacta al administrador.",
    );
  }

  if (!data) {
    throw new SupabaseSessionError(
      "No existe un perfil asociado a tu cuenta. Contacta al administrador.",
    );
  }

  return resolveProfileRow(data as ProfileRow);
}

async function syncMockBridge(resolved: ResolvedSupabaseProfile): Promise<void> {
  persistMockUser({
    email: resolved.email,
    role: resolved.mockRole,
    name: resolved.fullName,
  });
}

function getClient(): SupabaseClient {
  if (!supabaseBrowser) {
    throw new SupabaseSessionError(
      "Supabase no está configurado en este entorno.",
    );
  }
  return supabaseBrowser;
}

/**
 * Sesión vía Supabase Auth + `public.profiles`.
 * Persiste `mock_user` / `mock_role` / `mock_email` como puente temporal para la UI mock.
 */
export class SupabaseSessionRepo implements SessionRepo {
  constructor(private store: MockStoreContextValue) {}

  async getCurrentUser(): Promise<UserSession | null> {
    const client = getClient();
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();

    if (sessionError || !session?.user) {
      return null;
    }

    try {
      const resolved = await fetchProfileForUser(client, session.user.id);
      await syncMockBridge(resolved);
      this.store.login(resolved.email, "", resolved.sessionRole as MockStoreRol);
      return toUserSession(resolved);
    } catch (err) {
      if (err instanceof SupabaseSessionError) {
        await client.auth.signOut();
        clearMockUser();
        if (typeof window !== "undefined") {
          localStorage.removeItem(SESSION_KEY);
        }
        this.store.logout();
      }
      return null;
    }
  }

  async login(email: string, password: string): Promise<UserSession> {
    const client = getClient();
    const trimmedPassword = password;

    if (!String(email ?? "").trim() || !trimmedPassword) {
      throw new SupabaseSessionError("Correo o usuario y contraseña son obligatorios.");
    }

    let normalizedEmail: string;
    try {
      normalizedEmail = normalizeLoginIdentifier(email);
    } catch (err) {
      throw new SupabaseSessionError(
        err instanceof Error
          ? err.message
          : "Usuario no reconocido. Usa tu correo o el usuario autorizado.",
      );
    }

    const { data: signInData, error: signInError } =
      await client.auth.signInWithPassword({
        email: normalizedEmail,
        password: trimmedPassword,
      });

    if (signInError || !signInData.user) {
      throw new SupabaseSessionError(
        "Correo o contraseña incorrectos. Verifica tus datos e intenta de nuevo.",
      );
    }

    let resolved: ResolvedSupabaseProfile;
    try {
      resolved = await fetchProfileForUser(client, signInData.user.id);
    } catch (err) {
      await client.auth.signOut();
      throw err;
    }

    try {
      await syncMockBridge(resolved);
    } catch (err) {
      await client.auth.signOut();
      clearMockUser();
      throw err;
    }

    this.store.login(resolved.email, "", resolved.sessionRole as MockStoreRol);
    return toUserSession(resolved);
  }

  async logout(): Promise<void> {
    const client = supabaseBrowser;
    if (client) {
      await client.auth.signOut();
    }
    this.store.logout();
    clearMockUser();
    if (typeof window !== "undefined") {
      localStorage.removeItem(SESSION_KEY);
    }
  }
}
