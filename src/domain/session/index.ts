"use client";

import { useEffect, useMemo, useState } from "react";
import { MockSessionRepo } from "./mock.repo";
import { SupabaseSessionRepo } from "./supabase.repo";
import {
  clearMockUser,
  getEffectiveMockEmail,
  getEffectiveMockRole,
} from "@/lib/mockUser";
import {
  isSupabaseAuthEnabled,
  supabaseBrowser,
} from "@/lib/supabaseBrowser";
import { useMockStore } from "@/context/MockStoreContext";
import type { UserSession, Rol } from "./types";
import type { SessionRepo } from "./repo";

export type { UserSession, Rol } from "./types";
export type { SessionRepo } from "./repo";
export { MockSessionRepo } from "./mock.repo";
export { SupabaseSessionRepo, SupabaseSessionError } from "./supabase.repo";

/**
 * Hook que devuelve el repositorio de sesión y el usuario actual (sincronizado).
 * currentUser es undefined mientras no se ha resuelto la sesión; null si no hay usuario; UserSession si hay sesión.
 * Mock por defecto; Supabase Auth cuando `NEXT_PUBLIC_USE_SUPABASE_AUTH=true` y hay cliente configurado.
 */
export function useSessionRepo(): {
  sessionRepo: SessionRepo;
  /** undefined = aún cargando, null = no hay sesión, UserSession = sesión activa */
  currentUser: UserSession | null | undefined;
} {
  const store = useMockStore();
  const supabaseAuthEnabled = isSupabaseAuthEnabled();
  const sessionRepo = useMemo(() => {
    if (supabaseAuthEnabled) {
      return new SupabaseSessionRepo(store);
    }
    return new MockSessionRepo(store);
  }, [store, supabaseAuthEnabled]);
  /**
   * Siempre `undefined` en el primer render (SSR + hidratación) para evitar mismatch:
   * no leer localStorage en el inicializador de useState (solo existe en cliente).
   * La sesión mock o Supabase se resuelve en useEffect tras montar.
   */
  const [currentUser, setCurrentUser] = useState<UserSession | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!supabaseAuthEnabled || !supabaseBrowser) return;

    const {
      data: { subscription },
    } = supabaseBrowser.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;

      // La sesión real manda en producción. Si Supabase la invalida, eliminamos
      // de inmediato el puente legacy para que la UI no siga aparentando acceso.
      clearMockUser();
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("concasa_session");
      }
      store.logout();
      setCurrentUser(null);

      if (
        typeof window !== "undefined" &&
        window.location.pathname !== "/login"
      ) {
        window.location.replace("/login?reason=session_expired");
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [store, supabaseAuthEnabled]);

  useEffect(() => {
    let cancelled = false;

    const resolveSession = async () => {
      const mockEmail = getEffectiveMockEmail();
      const mockRole = getEffectiveMockRole();

      const mesaMockRoles = [
        "mesa_control",
        "mesa_control_admin",
        "mesa_control_interno",
        "mesa_control_externo",
      ] as const;

      if (!supabaseAuthEnabled && mockEmail && mockRole) {
        let mockSession: UserSession | null = null;
        const normalizedRole =
          mockRole === "revisor" ? "editor" : mockRole;
        if (mesaMockRoles.includes(mockRole as (typeof mesaMockRoles)[number])) {
          mockSession = { email: mockEmail, role: "mesa_control" };
        } else {
          switch (normalizedRole) {
            case "asesor":
            case "super_admin":
            case "admin":
            case "editor":
              mockSession = { email: mockEmail, role: normalizedRole as Rol };
              break;
            default:
              mockSession = null;
          }
        }
        if (mockSession && !cancelled) {
          setCurrentUser(mockSession);
          return;
        }
      }

      try {
        const user = await sessionRepo.getCurrentUser();
        if (cancelled) return;
        if (!user) {
          setCurrentUser(null);
          return;
        }
        // En producción Supabase es la única fuente de verdad de identidad/rol.
        // El bridge mock queda solo para compatibilidad visual y jamás puede
        // sobreescribir una sesión real.
        if (supabaseAuthEnabled) {
          setCurrentUser(user);
          return;
        }

        const roleOverride = getEffectiveMockRole();
        const mesaOverride = [
          "mesa_control",
          "mesa_control_admin",
          "mesa_control_interno",
          "mesa_control_externo",
        ];
        if (
          roleOverride === "asesor" ||
          roleOverride === "super_admin" ||
          roleOverride === "admin" ||
          roleOverride === "editor"
        ) {
          setCurrentUser({ ...user, role: roleOverride });
        } else if (roleOverride && mesaOverride.includes(roleOverride)) {
          setCurrentUser({ ...user, role: "mesa_control" });
        } else {
          setCurrentUser(user);
        }
      } catch {
        if (!cancelled) setCurrentUser(null);
      }
    };

    void resolveSession();
    return () => {
      cancelled = true;
    };
  }, [sessionRepo, supabaseAuthEnabled]);

  return { sessionRepo, currentUser };
}
