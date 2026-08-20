/**
 * Proyección visual Admin de etapas operativas.
 * Etapa interna 10 («Cita para firma») es LEGACY solo en presentación Admin:
 * se agrupa con 9 («Listo para agendar firma»).
 * No modifica ETAPAS_OPERATIVAS_ASESOR ni el flujo Mesa/Asesor.
 */

import {
  ETAPAS_OPERATIVAS_ASESOR,
  ETAPA_INTERNA_LEGACY_CITA_BIOMETRICOS,
  getEtapaOperativaNombre,
} from "@/domain/expedientes/asesor-seguimiento-operativo";
import type { AdminEtapaBucket } from "./repo";

/** Legacy Admin: cita de firma agendada (ya no es etapa visible del flujo). */
export const ADMIN_ETAPA_INTERNA_LEGACY_CITA_FIRMA = 10;

/** Canónica visible: Listo para agendar firma. */
export const ADMIN_ETAPA_INTERNA_LISTO_FIRMA = 9;

export const TOTAL_PASOS_ADMIN_VISIBLES = 10;

export type AdminVisibleStage = Readonly<{
  /** Numeración consecutiva Admin 1–10 (sin «Cita para firma»). */
  pasoAdmin: number;
  nombre: string;
  /** Internas DB que pertenecen a este paso (filtros / counts). */
  etapaInternas: readonly number[];
  /** Etapa usada como clave de tarjeta Resumen (canónica). */
  etapaCanonDisplay: number;
}>;

/**
 * Catálogo Admin 10 pasos:
 * - Paso 3 = Listo biométrico + legacy interna 4 (P115).
 * - Paso 8 = Listo firma + legacy interna 10.
 */
export const ADMIN_VISIBLE_STAGES: readonly AdminVisibleStage[] = [
  { pasoAdmin: 1, nombre: "Integración", etapaInternas: [1], etapaCanonDisplay: 1 },
  { pasoAdmin: 2, nombre: "Registro", etapaInternas: [2], etapaCanonDisplay: 2 },
  {
    pasoAdmin: 3,
    nombre: "Listo para cita de biométrico",
    etapaInternas: [3, ETAPA_INTERNA_LEGACY_CITA_BIOMETRICOS],
    etapaCanonDisplay: 3,
  },
  {
    pasoAdmin: 4,
    nombre: "Biometría (resultado)",
    etapaInternas: [5],
    etapaCanonDisplay: 5,
  },
  { pasoAdmin: 5, nombre: "Inscripción", etapaInternas: [6], etapaCanonDisplay: 6 },
  { pasoAdmin: 6, nombre: "Notificación", etapaInternas: [7], etapaCanonDisplay: 7 },
  {
    pasoAdmin: 7,
    nombre: "Acuse / Aviso de retención",
    etapaInternas: [8],
    etapaCanonDisplay: 8,
  },
  {
    pasoAdmin: 8,
    nombre: "Listo para agendar firma",
    etapaInternas: [ADMIN_ETAPA_INTERNA_LISTO_FIRMA, ADMIN_ETAPA_INTERNA_LEGACY_CITA_FIRMA],
    etapaCanonDisplay: ADMIN_ETAPA_INTERNA_LISTO_FIRMA,
  },
  { pasoAdmin: 9, nombre: "Firmado", etapaInternas: [11], etapaCanonDisplay: 11 },
  {
    pasoAdmin: 10,
    nombre: "Pago a ConCasa",
    etapaInternas: [12],
    etapaCanonDisplay: 12,
  },
] as const;

/** Mapea etapa interna DB → paso Admin 1–10. */
export function mapEtapaInternaAAdminPaso(etapaInterna: number): number {
  if (etapaInterna <= 3) return etapaInterna;
  if (etapaInterna === ETAPA_INTERNA_LEGACY_CITA_BIOMETRICOS) return 3;
  if (etapaInterna === 5) return 4;
  if (etapaInterna === 6) return 5;
  if (etapaInterna === 7) return 6;
  if (etapaInterna === 8) return 7;
  if (
    etapaInterna === ADMIN_ETAPA_INTERNA_LISTO_FIRMA ||
    etapaInterna === ADMIN_ETAPA_INTERNA_LEGACY_CITA_FIRMA
  ) {
    return 8;
  }
  if (etapaInterna === 11) return 9;
  if (etapaInterna === 12) return 10;
  // Fallback defensivo
  return Math.min(TOTAL_PASOS_ADMIN_VISIBLES, Math.max(1, etapaInterna));
}

/** Internas para un filtro de paso Admin (string del select). */
export function etapasInternasParaAdminPasoFilter(
  pasoFilter: string,
): number[] | null {
  if (pasoFilter === "todas" || pasoFilter.trim() === "") return null;
  const paso = Number(pasoFilter);
  if (!Number.isFinite(paso)) return null;
  const entry = ADMIN_VISIBLE_STAGES.find((e) => e.pasoAdmin === paso);
  return entry ? [...entry.etapaInternas] : null;
}

/**
 * Tarjetas Resumen: 11 buckets visibles (12 internas − etapa 10).
 * Count de 9 = stage9 + stage10; pct contra el mismo total.
 * Orden = catálogo operativo sin tarjeta propia de 10.
 * La tarjeta «Cita agendada (biométricos)» (interna 4) se conserva.
 */
export function projectAdminVisibleStageBuckets(
  byEtapa: readonly AdminEtapaBucket[],
  totalActual: number,
): readonly AdminEtapaBucket[] {
  const byId = new Map<number, number>();
  for (const b of byEtapa) {
    byId.set(b.etapa, b.count);
  }
  const out: AdminEtapaBucket[] = [];
  for (const e of ETAPAS_OPERATIVAS_ASESOR) {
    if (e.id === ADMIN_ETAPA_INTERNA_LEGACY_CITA_FIRMA) continue;
    let count = byId.get(e.id) ?? 0;
    if (e.id === ADMIN_ETAPA_INTERNA_LISTO_FIRMA) {
      count += byId.get(ADMIN_ETAPA_INTERNA_LEGACY_CITA_FIRMA) ?? 0;
    }
    const pct =
      totalActual === 0 ? 0 : Math.round((count * 1000) / totalActual) / 10;
    out.push({ etapa: e.id, count, pct });
  }
  return out;
}

/** Label Admin: etapa 10 se presenta como Listo para agendar firma. */
export function getAdminEtapaDisplayNombre(
  etapaId: number | null | undefined,
): string {
  if (etapaId == null) return "—";
  if (etapaId === ADMIN_ETAPA_INTERNA_LEGACY_CITA_FIRMA) {
    return (
      ETAPAS_OPERATIVAS_ASESOR.find((e) => e.id === ADMIN_ETAPA_INTERNA_LISTO_FIRMA)
        ?.nombre ?? "Listo para agendar firma"
    );
  }
  return getEtapaOperativaNombre(etapaId);
}

export function opcionesFiltroPasoAdminVisible(): ReadonlyArray<{
  value: string;
  label: string;
}> {
  return ADMIN_VISIBLE_STAGES.map((e) => ({
    value: String(e.pasoAdmin),
    label: `${e.pasoAdmin}. ${e.nombre}`,
  }));
}

export function labelAdminPasoFilter(pasoFilter: string): string | null {
  if (pasoFilter === "todas") return null;
  const paso = Number(pasoFilter);
  const entry = ADMIN_VISIBLE_STAGES.find((e) => e.pasoAdmin === paso);
  if (!entry) return null;
  return `Paso ${entry.pasoAdmin} de ${TOTAL_PASOS_ADMIN_VISIBLES} — ${entry.nombre}`;
}

export function shortAdminPasoFilterNombre(pasoFilter: string): string | null {
  if (pasoFilter === "todas") return null;
  const paso = Number(pasoFilter);
  const entry = ADMIN_VISIBLE_STAGES.find((e) => e.pasoAdmin === paso);
  return entry?.nombre ?? null;
}

/** ¿Alguna etapa del catálogo Admin visible contiene el texto prohibido? */
export function adminVisibleStagesContainCitaParaFirma(): boolean {
  return ADMIN_VISIBLE_STAGES.some((e) =>
    /cita para firma/i.test(e.nombre),
  );
}
