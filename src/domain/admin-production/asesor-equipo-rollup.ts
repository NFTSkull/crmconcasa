/**
 * Rollup Admin: líder + equipo cuentan como un solo asesor.
 * Espejo de helpers SQL `admin_expand_asesor_ids` / `admin_reporting_asesor_id`.
 */

export type AdminEquipoRollup = Readonly<{
  leaderId: string;
  /** Miembros activos (sin el líder, aunque también esté en miembros). */
  memberIds: readonly string[];
}>;

/** Si `asesorId` es líder de un equipo, incluye líder + miembros; si no, solo él. */
export function expandAdminAsesorFilterIds(
  asesorId: string | null | undefined,
  equipos: readonly AdminEquipoRollup[],
): string[] | null {
  const id = typeof asesorId === "string" ? asesorId.trim() : "";
  if (!id) return null;
  const team = equipos.find((e) => e.leaderId === id);
  if (!team) return [id];
  const out = new Set<string>([team.leaderId]);
  for (const m of team.memberIds) {
    const mid = String(m ?? "").trim();
    if (mid) out.add(mid);
  }
  return [...out];
}

/** Miembro activo → leaderId; líder u orfandad → self. */
export function reportingAdminAsesorId(
  asesorId: string,
  equipos: readonly AdminEquipoRollup[],
): string {
  const id = String(asesorId ?? "").trim();
  if (!id) return id;
  const asMember = equipos.filter((e) =>
    e.memberIds.some((m) => String(m).trim() === id),
  );
  if (asMember.length === 1) return asMember[0]!.leaderId;
  return id;
}

export function matchesAdminAsesorEquipoFilter(
  rowAsesorId: string,
  filterAsesorId: string | null | undefined,
  equipos: readonly AdminEquipoRollup[],
): boolean {
  const expanded = expandAdminAsesorFilterIds(filterAsesorId, equipos);
  if (expanded == null) return true;
  return expanded.includes(String(rowAsesorId ?? "").trim());
}
