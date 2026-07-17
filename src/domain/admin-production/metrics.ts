import {
  ADMIN_MONTO_MAYOR_A,
  isInstantInPeriod,
  isMontoMayorA20000,
  type AdminPeriodBounds,
} from "./period";

export type AdminProductionSummary = Readonly<{
  enviadosAMesa: number;
  precalificacionesAprobadas: number;
  aprobadasMayorA20000: number;
  montoAprobadoTotal: number;
}>;

export type AdminMesaEnvioEvent = Readonly<{
  expedienteId: string;
  fechaEnvioMesa: string;
  clienteNombre: string;
  asesorId: string;
  asesorNombre: string | null;
  asesorEmail: string | null;
  etapaActual: number;
  subestado: string;
  cicloEstado: string;
  programa: string;
  montoAprobadoActual: number | null;
  montoAprobadoAlAprobar: number | null;
  updatedAt: string | null;
}>;

export type AdminPrecalEvent = Readonly<{
  expedienteId: string;
  aprobadoAt: string;
  clienteNombre: string;
  asesorId: string;
  asesorNombre: string | null;
  asesorEmail: string | null;
  decision: string;
  montoAprobadoAlAprobar: number;
  montoAprobadoActual: number | null;
  programa: string;
}>;

export function computeAdminProductionSummary(input: {
  bounds: AdminPeriodBounds;
  mesaEnvios: readonly AdminMesaEnvioEvent[];
  precalAprobadas: readonly AdminPrecalEvent[];
  asesorId?: string | null;
  etapaActual?: number | null;
}): AdminProductionSummary {
  const asesor = input.asesorId?.trim() || null;
  const etapa = input.etapaActual ?? null;

  let enviadosAMesa = 0;
  for (const row of input.mesaEnvios) {
    if (!isInstantInPeriod(row.fechaEnvioMesa, input.bounds)) continue;
    if (asesor && row.asesorId !== asesor) continue;
    if (etapa != null && row.etapaActual !== etapa) continue;
    enviadosAMesa += 1;
  }

  let precalificacionesAprobadas = 0;
  let aprobadasMayorA20000 = 0;
  let montoAprobadoTotal = 0;

  for (const row of input.precalAprobadas) {
    if (!isInstantInPeriod(row.aprobadoAt, input.bounds)) continue;
    if (asesor && row.asesorId !== asesor) continue;
    // Etapa filtra solo cohorte Mesa; precalificaciones no se recortan por etapa actual
    precalificacionesAprobadas += 1;
    montoAprobadoTotal += row.montoAprobadoAlAprobar;
    if (isMontoMayorA20000(row.montoAprobadoAlAprobar)) {
      aprobadasMayorA20000 += 1;
    }
  }

  return {
    enviadosAMesa,
    precalificacionesAprobadas,
    aprobadasMayorA20000,
    montoAprobadoTotal: Math.round(montoAprobadoTotal * 100) / 100,
  };
}

export function groupMesaEnviosByEtapaActual(
  rows: readonly AdminMesaEnvioEvent[],
): ReadonlyArray<{ etapa: number; count: number; pct: number }> {
  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.etapaActual, (counts.get(row.etapaActual) ?? 0) + 1);
  }
  const total = rows.length;
  const out: Array<{ etapa: number; count: number; pct: number }> = [];
  for (let etapa = 1; etapa <= 12; etapa += 1) {
    const count = counts.get(etapa) ?? 0;
    out.push({
      etapa,
      count,
      pct: total === 0 ? 0 : Math.round((count / total) * 1000) / 10,
    });
  }
  return out;
}

export { ADMIN_MONTO_MAYOR_A, isMontoMayorA20000 };
