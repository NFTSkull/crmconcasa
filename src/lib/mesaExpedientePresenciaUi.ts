/** Formato badge «Abierto ahora por …» (presencia Mesa P128). */

export const MESA_PRESENCIA_TTL_MS = 90_000;
export const MESA_PRESENCIA_HEARTBEAT_MS = 25_000;
export const MESA_PRESENCIA_DASHBOARD_POLL_MS = 30_000;

export type MesaPresenciaUser = Readonly<{
  userId: string;
  fullName: string | null;
}>;

export type MesaPresenciaByExpediente = Readonly<{
  expedienteId: string;
  users: readonly MesaPresenciaUser[];
}>;

/** Nombre visible: full_name; nunca email/número. */
export function mesaPresenciaDisplayName(user: MesaPresenciaUser): string {
  const name = user.fullName?.trim();
  if (name) return name;
  return "Usuario Mesa";
}

/**
 * - 1: Abierto ahora por Jorge
 * - 2: Abierto ahora por Jorge y Sara
 * - >2: Abierto ahora por Jorge, Sara +N
 */
export function formatMesaAbiertoAhoraBadge(
  users: readonly MesaPresenciaUser[] | null | undefined,
): string | null {
  if (!users || users.length === 0) return null;
  const names = users.map(mesaPresenciaDisplayName);
  if (names.length === 1) return `Abierto ahora por ${names[0]}`;
  if (names.length === 2) return `Abierto ahora por ${names[0]} y ${names[1]}`;
  const rest = names.length - 2;
  return `Abierto ahora por ${names[0]}, ${names[1]} +${rest}`;
}


/** Usuarios activos distintos del operador actual; dedupe por userId. */
export function mesaPresenciaOtrosUsuarios(
  users: readonly MesaPresenciaUser[] | null | undefined,
  currentUserId: string | null | undefined,
): readonly MesaPresenciaUser[] {
  if (!users?.length) return [];
  const current = String(currentUserId ?? "").trim();
  const seen = new Set<string>();
  const out: MesaPresenciaUser[] = [];
  for (const user of users) {
    const id = String(user.userId ?? "").trim();
    if (!id || (current && id === current) || seen.has(id)) continue;
    seen.add(id);
    out.push(user);
  }
  return out;
}

/** Copy corto para advertencia de trabajo simultáneo. */
export function formatMesaOtrosActivosLabel(
  users: readonly MesaPresenciaUser[] | null | undefined,
  currentUserId: string | null | undefined,
): string | null {
  const others = mesaPresenciaOtrosUsuarios(users, currentUserId);
  if (others.length === 0) return null;
  const names = others.map(mesaPresenciaDisplayName);
  if (names.length === 1) return `${names[0]} lo tiene abierto ahora`;
  if (names.length === 2) return `${names[0]} y ${names[1]} lo tienen abierto ahora`;
  return `${names[0]}, ${names[1]} +${names.length - 2} lo tienen abierto ahora`;
}
