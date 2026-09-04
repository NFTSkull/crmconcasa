/**
 * Membresía a equipo asesor por email de líder (RPC genérica).
 * Fail-closed: error / payload inválido / RPC ausente → false.
 */
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

/** Líder canónico Equipo Silvia (mismo email que documento_tipo_scope_equipo). */
export const EQUIPO_LIDER_EMAIL_SILVIA_REYES =
  "silvia.reyes@concasa.mx" as const;

/**
 * Nombre histórico; actualmente representa el perfil simplificado del paquete
 * documental de externos definido por SQL (Silvia u Orlando).
 *
 * `clasificacion_pendiente`: RPC de paquete aún no resuelta / error —
 * UNKNOWN ≠ INTERNO (no activa B1–B5; acciones críticas bloqueadas en UI).
 */
export type ClienteDatosPerfilCaptura =
  | "asesor_completo"
  | "asesor_equipo_silvia_simplificado"
  | "clasificacion_pendiente";

export type ClienteDatosCapturaVariant = "completo" | "simplificado";

/** Clasificación tri-state del paquete documental (autoridad SQL). */
export type PaqueteDocumentalClasificacion =
  | "externo"
  | "interno"
  | "unknown";

/** Fail-closed: solo true si confirmación explícita. */
export function shouldUseClienteDatosVistaSimplificada(
  membresiaConfirmada: boolean | null | undefined,
): boolean {
  return membresiaConfirmada === true;
}

export function isClienteDatosPerfilPendiente(
  perfil: ClienteDatosPerfilCaptura | null | undefined,
): boolean {
  return perfil === "clasificacion_pendiente";
}

/**
 * Teléfono de casa (B1) solo para internos.
 * - `asesor_completo` / perfil omitido (legacy completo) → true
 * - externo (`asesor_equipo_silvia_simplificado`) → false
 * - unknown (`clasificacion_pendiente`) → false
 */
export function clienteDatosRequiereTelefonoCasa(
  perfil: ClienteDatosPerfilCaptura | null | undefined,
): boolean {
  if (perfil === "asesor_equipo_silvia_simplificado") return false;
  if (perfil === "clasificacion_pendiente") return false;
  return true;
}

/**
 * Resuelve perfil de captura.
 * Preferir `duenoClasificacion` tri-state; el booleano legacy trata
 * `false`/`null` como interno solo cuando no hay tri-state (compat tests).
 */
export function resolveClienteDatosPerfilCaptura(params: Readonly<{
  /**
   * Tri-state autoridad: externo | interno | unknown.
   * Si viene definido, manda sobre el booleano legacy.
   */
  duenoClasificacion?: PaqueteDocumentalClasificacion | null;
  /**
   * Dueño del expediente en paquete documental externos (SQL).
   * Alias legacy: `duenoEnEquipoSilviaConfirmado`.
   * Solo usar cuando la clasificación ya está resuelta (true/false reales).
   */
  duenoEnPaqueteExternosConfirmado?: boolean | null;
  /** @deprecated Preferir `duenoEnPaqueteExternosConfirmado`. */
  duenoEnEquipoSilviaConfirmado?: boolean | null | undefined;
}>): ClienteDatosPerfilCaptura {
  if (params.duenoClasificacion === "unknown") {
    return "clasificacion_pendiente";
  }
  if (params.duenoClasificacion === "externo") {
    return "asesor_equipo_silvia_simplificado";
  }
  if (params.duenoClasificacion === "interno") {
    return "asesor_completo";
  }
  const ok =
    params.duenoEnPaqueteExternosConfirmado === true ||
    params.duenoEnEquipoSilviaConfirmado === true;
  return ok ? "asesor_equipo_silvia_simplificado" : "asesor_completo";
}

export function resolveClienteDatosCapturaVariant(params: Readonly<{
  /**
   * Tri-state actor JWT. `unknown` / no resuelto → simplificado (no flash B1–B5 UI).
   */
  actorClasificacion?: PaqueteDocumentalClasificacion | null;
  actorClasificacionResuelta?: boolean;
  /**
   * Actor JWT en paquete documental externos (SQL).
   * Alias legacy: `actorEnEquipoSilviaConfirmado`.
   */
  actorEnPaqueteExternosConfirmado?: boolean | null;
  /** @deprecated Preferir `actorEnPaqueteExternosConfirmado`. */
  actorEnEquipoSilviaConfirmado?: boolean | null | undefined;
}>): ClienteDatosCapturaVariant {
  if (params.actorClasificacionResuelta === false) {
    return "simplificado";
  }
  if (params.actorClasificacion === "unknown") {
    return "simplificado";
  }
  if (params.actorClasificacion === "externo") {
    return "simplificado";
  }
  if (params.actorClasificacion === "interno") {
    return "completo";
  }
  const ok =
    params.actorEnPaqueteExternosConfirmado === true ||
    params.actorEnEquipoSilviaConfirmado === true;
  return shouldUseClienteDatosVistaSimplificada(ok) ? "simplificado" : "completo";
}

export function parseAsesorEnEquipoPorLiderEmail(raw: unknown): boolean {
  return raw === true;
}

/**
 * Llama `asesor_en_equipo_por_lider_email`.
 * `asesorId` UUID del perfil a evaluar; omitido/null → JWT actual.
 * Nunca lanza: fail-closed → false.
 */
export async function fetchAsesorEnEquipoPorLiderEmail(params: Readonly<{
  leaderEmail: string;
  asesorId?: string | null;
}>): Promise<boolean> {
  try {
    const leader = String(params.leaderEmail ?? "").trim().toLowerCase();
    if (!leader || !leader.includes("@")) return false;
    if (!isSupabaseConfigured() || !supabaseBrowser) return false;

    const args: { p_leader_email: string; p_asesor_id?: string } = {
      p_leader_email: leader,
    };
    const asesorId = String(params.asesorId ?? "").trim();
    if (
      asesorId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        asesorId,
      )
    ) {
      args.p_asesor_id = asesorId;
    }

    const { data, error } = await supabaseBrowser.rpc(
      "asesor_en_equipo_por_lider_email",
      args,
    );
    if (error) return false;
    return parseAsesorEnEquipoPorLiderEmail(data);
  } catch {
    return false;
  }
}
