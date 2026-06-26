export type MesaAgendaCancelKind = "biometricos" | "firmas";

const MESA_CANCEL_AGENDA_ROLES = new Set([
  "mesa_control_admin",
  "mesa_control_interno",
  "mesa_control_externo",
  "super_admin",
  /** Legacy mock mesa admin. */
  "mesa_control",
]);

/** Roles mock/Supabase que pueden llamar cancel_* como Mesa (037). */
export function canMesaRoleCancelAgendaRpc(mockRole: string | null | undefined): boolean {
  const role = String(mockRole ?? "").trim();
  return MESA_CANCEL_AGENDA_ROLES.has(role);
}

/** @deprecated Usar canMesaRoleCancelAgendaRpc */
export function canMesaRoleCancelFirmasRpc(mockRole: string | null | undefined): boolean {
  return canMesaRoleCancelAgendaRpc(mockRole);
}

export function canMesaCancelBiometricosBooking(params: {
  mockRole: string | null | undefined;
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
}): boolean {
  if (!params.hasActiveBooking) return false;
  const etapa = params.etapaActual;
  if (etapa !== 4 && etapa !== 5) return false;
  return canMesaRoleCancelAgendaRpc(params.mockRole);
}

export function canMesaCancelFirmasBooking(params: {
  mockRole: string | null | undefined;
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
}): boolean {
  if (!params.hasActiveBooking) return false;
  const etapa = params.etapaActual;
  if (etapa !== 9 && etapa !== 10) return false;
  return canMesaRoleCancelAgendaRpc(params.mockRole);
}

export function canMesaShowCancelCitaButton(params: {
  kind: MesaAgendaCancelKind;
  mockRole: string | null | undefined;
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
}): boolean {
  if (params.kind === "firmas") {
    return canMesaCancelFirmasBooking(params);
  }
  return canMesaCancelBiometricosBooking(params);
}
