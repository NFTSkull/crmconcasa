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
  /** Rol de sesión colapsado (Supabase Mesa). */
  "mesa_control",
]);

/** Roles mock/Supabase que pueden llamar cancel_* como Mesa (037). */
export function canMesaRoleCancelAgendaRpc(role: string | null | undefined): boolean {
  const normalized = String(role ?? "").trim();
  return MESA_CANCEL_AGENDA_ROLES.has(normalized);
}

/** @deprecated Usar canMesaRoleCancelAgendaRpc */
export function canMesaRoleCancelFirmasRpc(mockRole: string | null | undefined): boolean {
  return canMesaRoleCancelAgendaRpc(mockRole);
}

/**
 * El botón avanzar usa `currentUser.role` (`mesa_control`).
 * La RPC `cancel_biometricos` (037) lee `profiles.app_role` (`mesa_admin`, etc.), no este alias.
 * Si `mock_user` no está en localStorage, el gate de cancelación debe usar el rol de sesión.
 */
export function resolveMesaAgendaCancelRole(params: {
  mockRole?: string | null;
  sessionRole?: string | null;
}): string | null {
  const mock = String(params.mockRole ?? "").trim();
  if (mock && canMesaRoleCancelAgendaRpc(mock)) return mock;

  const session = String(params.sessionRole ?? "").trim();
  if (session && canMesaRoleCancelAgendaRpc(session)) return session;

  return mock || null;
}

export function mesaHasCitaProgramadaParaCancel(params: {
  hasActiveBooking: boolean;
  fechaCita?: string | null;
}): boolean {
  if (params.hasActiveBooking) return true;
  return typeof params.fechaCita === "string" && params.fechaCita.trim() !== "";
}

export type MesaCancelCitaOperativaParams = Readonly<{
  kind: MesaAgendaCancelKind;
  mockRole?: string | null;
  sessionRole?: string | null;
  submittedToMesa: boolean;
  subestado: string | null | undefined;
  cicloEstado?: string | null;
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
  fechaCita?: string | null;
}>;

export type MesaCancelCitaOperativaExplain = Readonly<{
  visible: boolean;
  failedChecks: string[];
  resolvedRole: string | null;
}>;

export function explainMesaShowCancelCitaOperativa(
  params: MesaCancelCitaOperativaParams,
): MesaCancelCitaOperativaExplain {
  const failedChecks: string[] = [];
  const resolvedRole = resolveMesaAgendaCancelRole({
    mockRole: params.mockRole,
    sessionRole: params.sessionRole,
  });

  if (!params.submittedToMesa) failedChecks.push("submittedToMesa");
  if (params.subestado !== "en_proceso") failedChecks.push("subestado");
  if (params.cicloEstado != null && params.cicloEstado !== "activo") {
    failedChecks.push("cicloEstado");
  }
  if (
    !mesaHasCitaProgramadaParaCancel({
      hasActiveBooking: params.hasActiveBooking,
      fechaCita: params.fechaCita,
    })
  ) {
    failedChecks.push("citaProgramada");
  }
  if (!canMesaRoleCancelAgendaRpc(resolvedRole)) {
    failedChecks.push("rol");
  }

  const etapa = params.etapaActual;
  const etapaOk =
    params.kind === "firmas"
      ? etapa === 9 || etapa === 10
      : etapa === 3 || etapa === 4 || etapa === 5;
  if (!etapaOk) failedChecks.push("etapa");

  return {
    visible: failedChecks.length === 0,
    failedChecks,
    resolvedRole,
  };
}

function mesaCancelCitaOperativaBaseOk(
  params: MesaCancelCitaOperativaParams,
): boolean {
  return explainMesaShowCancelCitaOperativa(params).visible;
}

export function canMesaCancelBiometricosBooking(params: {
  mockRole?: string | null;
  sessionRole?: string | null;
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
  fechaCita?: string | null;
  submittedToMesa?: boolean;
  subestado?: string | null;
  cicloEstado?: string | null;
}): boolean {
  return canMesaShowCancelCitaOperativa({
    kind: "biometricos",
    mockRole: params.mockRole,
    sessionRole: params.sessionRole,
    submittedToMesa: params.submittedToMesa ?? true,
    subestado: params.subestado ?? "en_proceso",
    cicloEstado: params.cicloEstado ?? "activo",
    etapaActual: params.etapaActual,
    hasActiveBooking: params.hasActiveBooking,
    fechaCita: params.fechaCita,
  });
}

export function canMesaCancelFirmasBooking(params: {
  mockRole?: string | null;
  sessionRole?: string | null;
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
  fechaCita?: string | null;
  submittedToMesa?: boolean;
  subestado?: string | null;
  cicloEstado?: string | null;
}): boolean {
  return canMesaShowCancelCitaOperativa({
    kind: "firmas",
    mockRole: params.mockRole,
    sessionRole: params.sessionRole,
    submittedToMesa: params.submittedToMesa ?? true,
    subestado: params.subestado ?? "en_proceso",
    cicloEstado: params.cicloEstado ?? "activo",
    etapaActual: params.etapaActual,
    hasActiveBooking: params.hasActiveBooking,
    fechaCita: params.fechaCita,
  });
}

/** Gate completo para cancelar desde Decisión Mesa / vista operativa. */
export function canMesaShowCancelCitaOperativa(
  params: MesaCancelCitaOperativaParams,
): boolean {
  return mesaCancelCitaOperativaBaseOk(params);
}

export function canMesaShowCancelCitaButton(params: {
  kind: MesaAgendaCancelKind;
  mockRole?: string | null;
  sessionRole?: string | null;
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
  fechaCita?: string | null;
  submittedToMesa?: boolean;
  subestado?: string | null;
  cicloEstado?: string | null;
}): boolean {
  return canMesaShowCancelCitaOperativa({
    kind: params.kind,
    mockRole: params.mockRole,
    sessionRole: params.sessionRole,
    submittedToMesa: params.submittedToMesa ?? true,
    subestado: params.subestado ?? "en_proceso",
    cicloEstado: params.cicloEstado ?? "activo",
    etapaActual: params.etapaActual,
    hasActiveBooking: params.hasActiveBooking,
    fechaCita: params.fechaCita,
  });
}
