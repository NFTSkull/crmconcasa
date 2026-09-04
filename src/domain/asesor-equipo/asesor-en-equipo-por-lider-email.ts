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
 */
export type ClienteDatosPerfilCaptura =
  | "asesor_completo"
  | "asesor_equipo_silvia_simplificado";

export type ClienteDatosCapturaVariant = "completo" | "simplificado";

/** Fail-closed: solo true si confirmación explícita. */
export function shouldUseClienteDatosVistaSimplificada(
  membresiaConfirmada: boolean | null | undefined,
): boolean {
  return membresiaConfirmada === true;
}

export function resolveClienteDatosPerfilCaptura(params: Readonly<{
  /**
   * Dueño del expediente en paquete documental externos (SQL).
   * Alias legacy: `duenoEnEquipoSilviaConfirmado`.
   */
  duenoEnPaqueteExternosConfirmado?: boolean | null;
  /** @deprecated Preferir `duenoEnPaqueteExternosConfirmado`. */
  duenoEnEquipoSilviaConfirmado?: boolean | null | undefined;
}>): ClienteDatosPerfilCaptura {
  const ok =
    params.duenoEnPaqueteExternosConfirmado === true ||
    params.duenoEnEquipoSilviaConfirmado === true;
  return ok ? "asesor_equipo_silvia_simplificado" : "asesor_completo";
}

export function resolveClienteDatosCapturaVariant(params: Readonly<{
  /**
   * Actor JWT en paquete documental externos (SQL).
   * Alias legacy: `actorEnEquipoSilviaConfirmado`.
   */
  actorEnPaqueteExternosConfirmado?: boolean | null;
  /** @deprecated Preferir `actorEnPaqueteExternosConfirmado`. */
  actorEnEquipoSilviaConfirmado?: boolean | null | undefined;
}>): ClienteDatosCapturaVariant {
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
