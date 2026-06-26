/** Gates UI: cancelar/reagendar biométricos (P3M.4). */
export function canShowBiometricosManageActions(params: {
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
}): boolean {
  return params.etapaActual === 4 && params.hasActiveBooking;
}

/** Card asesor Supabase: etapa 4 siempre; etapa 5 solo tras cancelación Mesa sin booking activo. */
export function canShowAsesorBiometricosSupabaseCard(params: {
  submittedToMesa: boolean;
  etapaActual: number | null | undefined;
  hasActiveBooking?: boolean;
  hasLastCancelledBooking?: boolean;
}): boolean {
  if (!params.submittedToMesa) return false;
  const etapa = params.etapaActual;
  if (etapa === 4) return true;
  if (etapa === 5) {
    return !params.hasActiveBooking && Boolean(params.hasLastCancelledBooking);
  }
  return false;
}
