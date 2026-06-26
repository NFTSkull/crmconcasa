export type MesaAgendaCancelKind = "biometricos" | "firmas";

export const MESA_CANCEL_BIO_BUTTON_LABEL =
  "Cancelar cita biométrica y solicitar reagenda";

export const MESA_CANCEL_FIRMAS_BUTTON_LABEL =
  "Cancelar cita de firmas y solicitar reagenda";

export const MESA_CANCEL_SUCCESS_MESSAGE =
  "Cita cancelada. El asesor puede reagendar.";

const MESA_CANCEL_AGENDA_ROLES = new Set([
  "mesa_admin",
  "mesa_interno",
  "mesa_externo",
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

export type MesaCancelCitaOperativaParams = Readonly<{
  kind: MesaAgendaCancelKind;
  mockRole: string | null | undefined;
  submittedToMesa: boolean;
  subestado: string | null | undefined;
  cicloEstado?: string | null;
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
}>;

function mesaCancelCitaOperativaBaseOk(
  params: Omit<MesaCancelCitaOperativaParams, "kind" | "etapaActual">,
): boolean {
  if (!params.submittedToMesa) return false;
  if (params.subestado !== "en_proceso") return false;
  if (params.cicloEstado != null && params.cicloEstado !== "activo") return false;
  if (!params.hasActiveBooking) return false;
  return canMesaRoleCancelAgendaRpc(params.mockRole);
}

export function canMesaCancelBiometricosBooking(params: {
  mockRole: string | null | undefined;
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
  submittedToMesa?: boolean;
  subestado?: string | null;
  cicloEstado?: string | null;
}): boolean {
  const etapa = params.etapaActual;
  if (etapa !== 4 && etapa !== 5) return false;
  if (params.submittedToMesa === false) return false;
  if (params.subestado != null && params.subestado !== "en_proceso") return false;
  if (params.cicloEstado != null && params.cicloEstado !== "activo") return false;
  if (!params.hasActiveBooking) return false;
  return canMesaRoleCancelAgendaRpc(params.mockRole);
}

export function canMesaCancelFirmasBooking(params: {
  mockRole: string | null | undefined;
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
  submittedToMesa?: boolean;
  subestado?: string | null;
  cicloEstado?: string | null;
}): boolean {
  const etapa = params.etapaActual;
  if (etapa !== 9 && etapa !== 10) return false;
  if (params.submittedToMesa === false) return false;
  if (params.subestado != null && params.subestado !== "en_proceso") return false;
  if (params.cicloEstado != null && params.cicloEstado !== "activo") return false;
  if (!params.hasActiveBooking) return false;
  return canMesaRoleCancelAgendaRpc(params.mockRole);
}

/** Gate completo para cancelar desde Decisión Mesa / vista operativa. */
export function canMesaShowCancelCitaOperativa(
  params: MesaCancelCitaOperativaParams,
): boolean {
  if (!mesaCancelCitaOperativaBaseOk(params)) return false;
  const etapa = params.etapaActual;
  if (params.kind === "firmas") {
    return etapa === 9 || etapa === 10;
  }
  return etapa === 4 || etapa === 5;
}

export function canMesaShowCancelCitaButton(params: {
  kind: MesaAgendaCancelKind;
  mockRole: string | null | undefined;
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
  submittedToMesa?: boolean;
  subestado?: string | null;
  cicloEstado?: string | null;
}): boolean {
  return canMesaShowCancelCitaOperativa({
    kind: params.kind,
    mockRole: params.mockRole,
    submittedToMesa: params.submittedToMesa ?? true,
    subestado: params.subestado ?? "en_proceso",
    cicloEstado: params.cicloEstado ?? "activo",
    etapaActual: params.etapaActual,
    hasActiveBooking: params.hasActiveBooking,
  });
}
