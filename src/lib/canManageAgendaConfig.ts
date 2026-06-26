const MANAGE_AGENDA_CONFIG_ROLES = new Set([
  "mesa_admin",
  "mesa_control_admin",
  "super_admin",
  /** Legacy mock: mismo criterio que mesa admin. */
  "mesa_control",
]);

/**
 * Solo Mesa Admin y Super Admin pueden ver/editar configuración de agendas en `/mesa-control`.
 * Mesa Interno/Externo no deben ver estos bloques (ni siquiera en solo lectura).
 */
export function canManageAgendaConfig(profileRole: string | null | undefined): boolean {
  const role = String(profileRole ?? "").trim();
  return MANAGE_AGENDA_CONFIG_ROLES.has(role);
}
