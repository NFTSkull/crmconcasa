"use client";

import type {
  ExpedienteRetencionEnvioMesa,
  ExpedienteRetencionEnvioMesaRepo,
  RetencionEnvioMesaEstado,
  RetencionOpcion,
  SaveExpedienteRetencionEnvioMesaInput,
} from "./types";

export const RETENCION_ENVIO_MESA_STORAGE_KEY = "expediente_retencion_envio_mesa_v1";
export const RETENCION_ENVIO_MESA_EVENT = "expediente_retencion_envio_mesa_updated";

type StoredRow = {
  expedienteId?: unknown;
  enviado?: unknown;
  fechaEnvioMesa?: unknown;
  opcion?: unknown;
  estado?: unknown;
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

function isEstado(value: unknown): value is RetencionEnvioMesaEstado {
  return value === "enviado" || value === "correccion_requerida";
}

function rowToDomain(row: StoredRow): ExpedienteRetencionEnvioMesa | null {
  const expedienteId = typeof row.expedienteId === "string" ? row.expedienteId : null;
  if (!expedienteId) return null;
  if (row.enviado !== true) return null;
  if (!isRetencionOpcion(row.opcion)) return null;
  const fechaEnvioMesa =
    typeof row.fechaEnvioMesa === "string"
      ? row.fechaEnvioMesa
      : new Date().toISOString();
  const estado = isEstado(row.estado) ? row.estado : "enviado";
  return {
    expedienteId,
    enviado: true,
    fechaEnvioMesa,
    opcion: row.opcion,
    estado,
  };
}

function dispatchUpdated(expedienteId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(RETENCION_ENVIO_MESA_EVENT, {
      detail: { expedienteId },
    }),
  );
}

export class MockExpedienteRetencionEnvioMesaLocalStorageRepo
  implements ExpedienteRetencionEnvioMesaRepo
{
  async getByExpedienteId(
    expedienteId: string,
  ): Promise<ExpedienteRetencionEnvioMesa | null> {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(RETENCION_ENVIO_MESA_STORAGE_KEY);
    const rows = safeParseArray(raw) as StoredRow[];
    const found = rows.find((r) => r.expedienteId === expedienteId);
    return found ? rowToDomain(found) : null;
  }

  async save(
    input: SaveExpedienteRetencionEnvioMesaInput,
  ): Promise<ExpedienteRetencionEnvioMesa> {
    const fechaEnvioMesa = new Date().toISOString();
    const estado: RetencionEnvioMesaEstado = input.estado ?? "enviado";
    const domain: ExpedienteRetencionEnvioMesa = {
      expedienteId: input.expedienteId,
      enviado: true,
      fechaEnvioMesa,
      opcion: input.opcion,
      estado,
    };

    if (typeof window === "undefined") return domain;

    const raw = window.localStorage.getItem(RETENCION_ENVIO_MESA_STORAGE_KEY);
    const rows = safeParseArray(raw) as StoredRow[];
    const nextRow: StoredRow = {
      expedienteId: input.expedienteId,
      enviado: true,
      fechaEnvioMesa,
      opcion: input.opcion,
      estado,
    };
    const without = rows.filter((r) => r.expedienteId !== input.expedienteId);
    window.localStorage.setItem(
      RETENCION_ENVIO_MESA_STORAGE_KEY,
      JSON.stringify([...without, nextRow]),
    );
    dispatchUpdated(input.expedienteId);
    return domain;
  }

  async markCorreccionRequerida(
    expedienteId: string,
  ): Promise<ExpedienteRetencionEnvioMesa | null> {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(RETENCION_ENVIO_MESA_STORAGE_KEY);
    const rows = safeParseArray(raw) as StoredRow[];
    const idx = rows.findIndex((r) => r.expedienteId === expedienteId);
    if (idx < 0) return null;
    const prev = rows[idx];
    const domain = rowToDomain({
      ...prev,
      estado: "correccion_requerida",
    });
    if (!domain) return null;
    const nextRows = [...rows];
    nextRows[idx] = {
      expedienteId: domain.expedienteId,
      enviado: true,
      fechaEnvioMesa: domain.fechaEnvioMesa,
      opcion: domain.opcion,
      estado: "correccion_requerida",
    };
    window.localStorage.setItem(
      RETENCION_ENVIO_MESA_STORAGE_KEY,
      JSON.stringify(nextRows),
    );
    dispatchUpdated(expedienteId);
    return domain;
  }
}
