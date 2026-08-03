/** Gates UI: cancelar/reagendar firmas (P3P.2 + hotfix post-Acuse). */
export function canShowFirmasManageActions(params: {
  etapaActual: number | null | undefined;
  hasActiveBooking: boolean;
}): boolean {
  const etapa = params.etapaActual;
  return (
    params.hasActiveBooking &&
    (etapa === 9 || etapa === 10)
  );
}

/**
 * Card asesor Supabase:
 * - etapa 9: siempre (agendar o gestionar);
 * - etapa 10: con booking activo (reagendar/cancelar) o tras cancelación sin booking (re-agendar).
 */
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
    if (params.hasActiveBooking) return true;
    return Boolean(params.hasLastCancelledBooking);
  }
  return false;
}
