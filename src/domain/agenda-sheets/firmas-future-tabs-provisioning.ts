/**
 * P212 Fase 1.7 — estrategia tabs futuras (Oct+) + provisioner idempotente (diseño).
 *
 * Evidencia repo (NO asumir):
 * - `GOOGLE_SHEETS_TAB_MAP_JSON` + fallback live metadata resuelven tabs existentes.
 * - Docs/API: «No crea pestañas». Worker/live-sync/reconcile NO provisionan estructura.
 * - No hay cron/script en repo que duplique tabs mensuales automáticamente.
 *
 * Conclusión: creación de tabs = proceso manual / proceso externo fuera del CRM.
 * Por tanto: hace falta provisioner explícito append-only ANTES de abrir bookings,
 * + hard gate físico (Sheet rows) fail-closed aunque SQL diga capacity=5.
 */

import {
  FIRMAS_TARGET_HOURS,
  type FirmasHourDeficit,
  type FirmasTargetHour,
} from "./firmas-append-only-planner";

export type FutureTabCreationMechanism =
  | "manual_or_external"
  | "repo_auto_duplicate"
  | "repo_cron"
  | "unknown";

/** Resultado de auditoría estática del repo (sin Sheet writes). */
export function detectFutureTabCreationMechanism(evidence: {
  repoCreatesTabs: boolean;
  hasTabDuplicateScript: boolean;
  hasTabCron: boolean;
  docsSayNoCreateTabs: boolean;
}): FutureTabCreationMechanism {
  if (evidence.repoCreatesTabs || evidence.hasTabDuplicateScript || evidence.hasTabCron) {
    if (evidence.hasTabCron) return "repo_cron";
    if (evidence.hasTabDuplicateScript) return "repo_auto_duplicate";
  }
  if (evidence.docsSayNoCreateTabs && !evidence.repoCreatesTabs) {
    return "manual_or_external";
  }
  return "unknown";
}

export type FirmasProvisionStrategy =
  | "update_source_template_tab"
  | "idempotent_append_only_provisioner"
  | "explicit_admin_provision_op";

/**
 * Preferencia Fase 1.8:
 * Provisioner idempotente append-only usa FirmasCanonicalTemplate (código),
 * NO busca “fila vacía perfecta” legacy en cada run.
 * Trigger: operación admin explícita ANTES de habilitar bookings.
 * Live-sync NUNCA provisiona.
 */
export function recommendedFirmasFutureProvisionStrategy(
  mechanism: FutureTabCreationMechanism,
): FirmasProvisionStrategy {
  void mechanism;
  return "idempotent_append_only_provisioner";
}

/** Contrato de activación: enabled=false por default; publish controlado. */
export type FirmasActivationContract = Readonly<{
  enabled: boolean;
  effective_from: string | null;
}>;

export const FIRMAS_ACTIVATION_DEFAULT: FirmasActivationContract = {
  enabled: false,
  effective_from: null,
};

export type ProvisionDeficitPlan = Readonly<{
  sede: "monterrey" | "apodaca";
  hours: Record<FirmasTargetHour, FirmasHourDeficit>;
  addTotal: number;
}>;

/** Déficit real: target 5; si ya 5 → add 0; si 3 → add 2. Nunca >5 final. */
export function computeFirmasProvisionDeficit(input: {
  sede: "monterrey" | "apodaca";
  physicalCountsByHour: Partial<Record<FirmasTargetHour, number>>;
  targetPerHour?: number;
}): ProvisionDeficitPlan {
  const target = input.targetPerHour ?? 5;
  const hours = {} as Record<FirmasTargetHour, FirmasHourDeficit>;
  let addTotal = 0;
  for (const hour of FIRMAS_TARGET_HOURS) {
    const current = Math.max(0, Math.trunc(input.physicalCountsByHour[hour] ?? 0));
    const add = Math.max(0, target - current);
    const final = current + add;
    hours[hour] = { hour, current, add, final };
    addTotal += add;
  }
  return { sede: input.sede, hours, addTotal };
}

/**
 * Simula N ejecuciones del provisioner: la 2ª debe ser 0 writes si la 1ª aplicó.
 * No escribe Sheet; solo verifica idempotencia del cálculo.
 */
export function simulateIdempotentProvisionPasses(input: {
  initialCounts: Partial<Record<FirmasTargetHour, number>>;
  passes: number;
}): ReadonlyArray<{ pass: number; addTotal: number; countsAfter: Record<FirmasTargetHour, number> }> {
  const counts = {
    "08:00": input.initialCounts["08:00"] ?? 0,
    "09:00": input.initialCounts["09:00"] ?? 0,
    "10:00": input.initialCounts["10:00"] ?? 0,
  } as Record<FirmasTargetHour, number>;
  const out: Array<{
    pass: number;
    addTotal: number;
    countsAfter: Record<FirmasTargetHour, number>;
  }> = [];
  for (let p = 1; p <= input.passes; p++) {
    const plan = computeFirmasProvisionDeficit({
      sede: "monterrey",
      physicalCountsByHour: counts,
    });
    for (const h of FIRMAS_TARGET_HOURS) {
      counts[h] = plan.hours[h]!.final;
    }
    out.push({ pass: p, addTotal: plan.addTotal, countsAfter: { ...counts } });
  }
  return out;
}

/**
 * Hard gate futuro: SQL capacity≠disponibilidad física.
 * Si tab no provisionada 5/5/5, disponibilidad = filas físicas available (fail-closed).
 */
export function firmasBookGateRespectsPhysicalRows(input: {
  sqlHourlyCapacity: number;
  physicalAvailableRows: number;
}): { allowBookSlots: number; reason: string } {
  const allow = Math.max(
    0,
    Math.min(input.sqlHourlyCapacity, input.physicalAvailableRows),
  );
  return {
    allowBookSlots: allow,
    reason:
      input.physicalAvailableRows < input.sqlHourlyCapacity
        ? "PHYSICAL_SHEET_LIMIT_FAIL_CLOSED"
        : "SQL_AND_PHYSICAL_ALIGNED",
  };
}
