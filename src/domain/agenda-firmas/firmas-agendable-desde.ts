/**
 * Fecha mínima del picker de firmas.
 * Ya no se exige +5 días hábiles: hoy (o firma_agendable_desde si aún es futura en datos viejos).
 * Fechas pasadas siguen prohibidas vía `todayYmd`.
 */
export function resolveFirmasPickerMinDateYmd(params: {
  todayYmd: string;
  firmaAgendableDesde?: string | null;
}): string {
  const today = String(params.todayYmd ?? "").trim().slice(0, 10);
  const desde = String(params.firmaAgendableDesde ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return today;
  return desde > today ? desde : today;
}

/** True si aún hay un gate futuro (p.ej. Cloud sin mig 139). */
export function firmasTieneGateFuturo(params: {
  todayYmd: string;
  firmaAgendableDesde?: string | null;
}): boolean {
  const today = String(params.todayYmd ?? "").trim().slice(0, 10);
  const desde = String(params.firmaAgendableDesde ?? "").trim().slice(0, 10);
  return Boolean(desde && /^\d{4}-\d{2}-\d{2}$/.test(desde) && desde > today);
}
