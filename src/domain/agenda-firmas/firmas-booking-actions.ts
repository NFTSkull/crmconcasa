/** Gates UI: cancelar/reagendar firmas (P3P.2). */
export function canShowFirmasManageActions(params: {
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
}): boolean {
  return params.etapaActual === 9 && params.hasActiveBooking;
}

/** Card asesor Supabase: etapa 9 siempre; etapa 10 solo tras cancelación Mesa sin booking activo. */
export function canShowAsesorFirmasSupabaseCard(params: {
  submittedToMesa: boolean;
  etapaActual: number | null | undefined;
  hasActiveBooking?: boolean;
  hasLastCancelledBooking?: boolean;
}): boolean {
  if (!params.submittedToMesa) return false;
  const etapa = params.etapaActual;
  if (etapa === 9) return true;
  if (etapa === 10) {
    return !params.hasActiveBooking && Boolean(params.hasLastCancelledBooking);
  }
  return false;
}
