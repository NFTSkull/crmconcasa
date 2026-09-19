const MANAGE_AGENDA_CONFIG_ROLES = new Set([
  "mesa_admin",
  "mesa_control_admin",
  "super_admin",
]);

/**
 * Solo Mesa Admin y Super Admin pueden ver/editar configuración de agendas en `/mesa-control`.
 * Mesa Interno/Externo y la proyección UI de bandeja mixta no deben ver estos bloques
 * (ni siquiera en solo lectura). La autorización real de agenda permanece separada.
 */
export function canManageAgendaConfig(profileRole: string | null | undefined): boolean {
  const role = String(profileRole ?? "").trim();
  return MANAGE_AGENDA_CONFIG_ROLES.has(role);
}
