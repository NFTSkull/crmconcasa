/** Gates UI: cancelar/reagendar biométricos (P3M.4 / P063). */
export function canShowBiometricosManageActions(params: {
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
}): boolean {
  const etapa = params.etapaActual;
  return (etapa === 3 || etapa === 4) && params.hasActiveBooking;
}

/**
 * Card asesor Supabase: etapa 3 o 4 (legacy); etapa 5 solo tras cancelación Mesa sin booking activo.
 */
export function canShowAsesorBiometricosSupabaseCard(params: {
  submittedToMesa: boolean;
  etapaActual: number | null | undefined;
  hasActiveBooking?: boolean;
  hasLastCancelledBooking?: boolean;
}): boolean {
  if (!params.submittedToMesa) return false;
  const etapa = params.etapaActual;
  if (etapa === 3 || etapa === 4) return true;
  if (etapa === 5) {
    return !params.hasActiveBooking && Boolean(params.hasLastCancelledBooking);
  }
  return false;
}
