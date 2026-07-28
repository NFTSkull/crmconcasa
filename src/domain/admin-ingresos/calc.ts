/**
 * P134 — cálculo de ingresos (sin tope $169,000 ni cargo fijo $3,000).
 * Fórmula: round(monto_base × porcentaje_cobro / 100, 2)
 */

export type IngresosMontoFuente = "mesa_actualizado" | "datos_generales";

export function calcIngresoProyectado(
  montoBase: number,
  porcentajeCobro: number,
): number {
  return calcIngresoProyectadoSqlRound(montoBase, porcentajeCobro);
}

/** Redondeo a 2 decimales alineado a SQL `round(x, 2)` para valores positivos. */
export function calcIngresoProyectadoSqlRound(
  montoBase: number,
  porcentajeCobro: number,
): number {
  if (!Number.isFinite(montoBase) || !Number.isFinite(porcentajeCobro)) {
    throw new Error("Monto o porcentaje inválido");
  }
  if (montoBase < 0 || porcentajeCobro <= 0) {
    throw new Error("Monto o porcentaje inválido");
  }
  const raw = (montoBase * porcentajeCobro) / 100;
  return Math.round(raw * 100) / 100;
}

export function resolveMontoBaseIngresos(params: {
  montoActualizado: number | null | undefined;
  montoGeneral: number | null | undefined;
}): Readonly<{ montoBase: number; fuente: IngresosMontoFuente } | null> {
  const actualizado = params.montoActualizado;
  if (actualizado != null && Number.isFinite(actualizado) && actualizado > 0) {
    return { montoBase: actualizado, fuente: "mesa_actualizado" };
  }
  const general = params.montoGeneral;
  if (general != null && Number.isFinite(general) && general > 0) {
    return { montoBase: general, fuente: "datos_generales" };
  }
  return null;
}

export function calcPendientePorCobrar(
  proyectado: number,
  real: number,
): number {
  return Math.max(proyectado - real, 0);
}

export function calcCumplimientoPct(proyectado: number, real: number): number {
  if (!Number.isFinite(proyectado) || proyectado === 0) return 0;
  if (!Number.isFinite(real)) return 0;
  return Math.round((real * 10000) / proyectado) / 100;
}

export function formatIngresosCalculoLabel(
  montoBase: number,
  porcentaje: number,
  ingreso: number,
): string {
  const fmt = (n: number) =>
    n.toLocaleString("es-MX", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  return `$${fmt(montoBase)} × ${porcentaje}% = $${fmt(ingreso)}`;
}

export const INGRESOS_TOPE_TOOLTIP =
  "Los ingresos usan el monto real del expediente. El tope administrativo de Mejoravit no aplica en este módulo.";

export const INGRESOS_HISTORICO_ESTIMADO_TOOLTIP =
  "Calculado con los valores disponibles al habilitar este módulo; no existía un snapshot histórico.";

export const INGRESOS_FECHA_EXPLICACION =
  "La proyección se agrupa por aprobación biométrica y el ingreso real por la fecha de Pago a ConCasa.";
