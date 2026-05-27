"use client";

import type {
  ExpedienteRetencionOpcion,
  ExpedienteRetencionOpcionRepo,
  RetencionOpcion,
  SaveExpedienteRetencionOpcionInput,
} from "./types";

const STORAGE_KEY = "expediente_retencion_opcion_v1";
const EVENT_NAME = "expediente_retencion_opcion_updated";

type StoredRow = {
  expedienteId?: unknown;
  retencion_opcion?: unknown;
  updatedAt?: unknown;
};

function safeParseArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRetencionOpcion(value: unknown): value is RetencionOpcion {
  return value === "con_sello" || value === "sin_sello";
}

function rowToDomain(row: StoredRow): ExpedienteRetencionOpcion | null {
  const expedienteId = typeof row.expedienteId === "string" ? row.expedienteId : null;
  if (!expedienteId) return null;
  if (!isRetencionOpcion(row.retencion_opcion)) return null;
  const updatedAt =
    typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString();
  return {
    expedienteId,
    retencion_opcion: row.retencion_opcion,
    updatedAt,
  };
}

function dispatchUpdated(expedienteId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(EVENT_NAME, {
      detail: { expedienteId },
    }),
  );
}

export class MockExpedienteRetencionOpcionLocalStorageRepo
  implements ExpedienteRetencionOpcionRepo
{
  async getByExpedienteId(expedienteId: string): Promise<ExpedienteRetencionOpcion | null> {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const rows = safeParseArray(raw) as StoredRow[];
    const found = rows.find((r) => r.expedienteId === expedienteId);
    return found ? rowToDomain(found) : null;
  }

  async save(input: SaveExpedienteRetencionOpcionInput): Promise<ExpedienteRetencionOpcion> {
    if (typeof window === "undefined") {
      return {
        expedienteId: input.expedienteId,
        retencion_opcion: input.retencion_opcion,
        updatedAt: new Date().toISOString(),
      };
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    const rows = safeParseArray(raw) as StoredRow[];
    const now = new Date().toISOString();
    const nextRow: StoredRow = {
      expedienteId: input.expedienteId,
      retencion_opcion: input.retencion_opcion,
      updatedAt: now,
    };
    const without = rows.filter((r) => r.expedienteId !== input.expedienteId);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...without, nextRow]));
    dispatchUpdated(input.expedienteId);
    return {
      expedienteId: input.expedienteId,
      retencion_opcion: input.retencion_opcion,
      updatedAt: now,
    };
  }
}
