import {
  ADMIN_MONTO_MAYOR_A,
  isInstantInPeriod,
  isMontoMayorA20000,
  type AdminPeriodBounds,
} from "./period";

export type AdminProductionSummary = Readonly<{
  enviadosAMesa: number;
  precalificacionesAprobadas: number;
  precalificacionesNoCumple: number;
  aprobadasMayorA20000: number;
  /** Suma canónica Mejoravit aprobado (`monto_aprobado_al_aprobar`). */
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
  /** Fecha canónica visible: aprobado_at | no_cumple_at | null (pendiente). */
  fecha: string | null;
  aprobadoAt: string | null;
  noCumpleAt: string | null;
  clienteNombre: string;
  asesorId: string;
  asesorNombre: string | null;
  asesorEmail: string | null;
  decision: string;
  montoAprobadoAlAprobar: number | null;
  montoAprobadoActual: number | null;
  /** P084: aprobado_at histórico sin monto recuperable. */
  montoSnapshotNoRecuperable?: boolean;
  programa: string;
}>;

export const MONTO_SNAPSHOT_NO_RECUPERABLE_LABEL =
  "Aprobación histórica con monto no recuperable";

/** Texto visible de monto al aprobar (Admin/Excel). */
export function formatPrecalMontoAlAprobarDisplay(
  input: {
    montoAprobadoAlAprobar: number | null | undefined;
    montoSnapshotNoRecuperable?: boolean;
  },
  formatMonto: (n: number) => string,
): string {
  if (input.montoSnapshotNoRecuperable) {
    return MONTO_SNAPSHOT_NO_RECUPERABLE_LABEL;
  }
  if (
    typeof input.montoAprobadoAlAprobar === "number" &&
    Number.isFinite(input.montoAprobadoAlAprobar)
  ) {
    return formatMonto(input.montoAprobadoAlAprobar);
  }
  return "—";
}

/** Etiquetas visibles de `editor_decisions.decision` (valores DB intactos). */
export function labelEditorDecision(decision: string): string {
  switch (decision) {
    case "aprobado":
      return "Aprobada";
    case "no_cumple":
      return "Rechazada (No cumple)";
    case "pendiente":
      return "Pendiente actual";
    default:
      return decision;
  }
}

export function decisionBadgeClass(decision: string): string {
  switch (decision) {
    case "aprobado":
      return "inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900";
    case "no_cumple":
      return "inline-flex rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-900";
    case "pendiente":
      return "inline-flex rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950";
    default:
      return "inline-flex rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-900";
  }
}

/** Fecha visible de fila Admin (nunca `updated_at`). */
export function resolvePrecalVisibleFecha(input: {
  decision: string;
  aprobadoAt: string | null | undefined;
  noCumpleAt: string | null | undefined;
}): string | null {
  if (input.decision === "aprobado") {
    return input.aprobadoAt?.trim() || null;
  }
  if (input.decision === "no_cumple") {
    return input.noCumpleAt?.trim() || null;
  }
  return null;
}

export function isProgramaMejoravit(programa: string): boolean {
  return programa.trim().toLowerCase() === "mejoravit";
}

function hasMontoValido(monto: number | null | undefined): monto is number {
  return typeof monto === "number" && Number.isFinite(monto) && monto > 0;
}

/**
 * Fija `no_cumple_at` solo en la primera transición real a no_cumple.
 * No cambia al repetir no_cumple, editar monto/notas, ni al volver a no_cumple.
 */
export function nextNoCumpleAt(input: {
  prevDecision: string | null | undefined;
  nextDecision: string;
  prevNoCumpleAt: string | null | undefined;
  nowIso: string;
}): string | null {
  const prev = input.prevNoCumpleAt?.trim() || null;
  if (prev) return prev;
  const prevDec = input.prevDecision ?? null;
  if (
    input.nextDecision === "no_cumple" &&
    prevDec !== "no_cumple"
  ) {
    return input.nowIso;
  }
  return null;
}

export function computeAdminProductionSummary(input: {
  bounds: AdminPeriodBounds;
  mesaEnvios: readonly AdminMesaEnvioEvent[];
  precalRows: readonly AdminPrecalEvent[];
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
  let precalificacionesNoCumple = 0;
  let aprobadasMayorA20000 = 0;
  let montoAprobadoTotal = 0;

  for (const row of input.precalRows) {
    if (asesor && row.asesorId !== asesor) continue;

    if (
      row.decision === "aprobado" &&
      row.aprobadoAt &&
      isInstantInPeriod(row.aprobadoAt, input.bounds)
    ) {
      precalificacionesAprobadas += 1;
      const monto = row.montoAprobadoAlAprobar;
      if (hasMontoValido(monto) && isMontoMayorA20000(monto)) {
        aprobadasMayorA20000 += 1;
      }
      if (isProgramaMejoravit(row.programa) && hasMontoValido(monto)) {
        montoAprobadoTotal += monto;
      }
    }

    if (
      row.decision === "no_cumple" &&
      row.noCumpleAt &&
      isInstantInPeriod(row.noCumpleAt, input.bounds)
    ) {
      precalificacionesNoCumple += 1;
    }
  }

  return {
    enviadosAMesa,
    precalificacionesAprobadas,
    precalificacionesNoCumple,
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

export function computePrecalMontosMejoravit(
  rows: readonly AdminPrecalEvent[],
): Readonly<{ montoAprobadoTotal: number; montoPromedioAprobado: number }> {
  const subset = rows.filter(
    (r) =>
      r.decision === "aprobado" &&
      isProgramaMejoravit(r.programa) &&
      hasMontoValido(r.montoAprobadoAlAprobar),
  );
  const sum = subset.reduce((s, r) => s + (r.montoAprobadoAlAprobar as number), 0);
  return {
    montoAprobadoTotal: Math.round(sum * 100) / 100,
    montoPromedioAprobado:
      subset.length === 0 ? 0 : Math.round((sum / subset.length) * 100) / 100,
  };
}

export function computeAdminPrecalSummary(
  rows: readonly AdminPrecalEvent[],
): Readonly<{
  resueltasCount: number;
  aprobadasCount: number;
  noCumpleCount: number;
  pendientesActualesCount: number;
  mayores20000Count: number;
  mejoravitAprobadasCount: number;
  montoMejoravitTotal: number;
  montoMejoravitPromedio: number;
}> {
  const montos = computePrecalMontosMejoravit(rows);
  const aprobadas = rows.filter((r) => r.decision === "aprobado");
  const mejoravitAprobadas = aprobadas.filter(
    (r) =>
      isProgramaMejoravit(r.programa) && hasMontoValido(r.montoAprobadoAlAprobar),
  );
  const noCumple = rows.filter((r) => r.decision === "no_cumple").length;
  return {
    resueltasCount: aprobadas.length + noCumple,
    aprobadasCount: aprobadas.length,
    noCumpleCount: noCumple,
    pendientesActualesCount: rows.filter((r) => r.decision === "pendiente").length,
    mayores20000Count: aprobadas.filter(
      (r) =>
        hasMontoValido(r.montoAprobadoAlAprobar) &&
        isMontoMayorA20000(r.montoAprobadoAlAprobar),
    ).length,
    mejoravitAprobadasCount: mejoravitAprobadas.length,
    montoMejoravitTotal: montos.montoAprobadoTotal,
    montoMejoravitPromedio: montos.montoPromedioAprobado,
  };
}

export { ADMIN_MONTO_MAYOR_A, isMontoMayorA20000 };
