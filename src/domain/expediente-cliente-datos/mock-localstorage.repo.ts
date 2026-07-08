"use client";

import type { ExpedienteClienteDatosRepo } from "./repo";
import type {
  ExpedienteClienteDatos,
  ExpedienteClienteDatosEstado,
  SaveExpedienteClienteDatosInput,
  UpdateEstadoExpedienteClienteDatosInput,
} from "./types";
import { parseMontoCalculadoInput } from "@/lib/clienteDatosCobro";
import {
  readClienteDatosMontoMejoravit,
  readClienteDatosPlazo,
} from "./map-supabase-cliente-datos";
import { emitExpedienteClienteDatosUpdated } from "./emit-updated";

const STORAGE_KEY = "expediente_cliente_datos";
const EVENT_NAME = "expediente_cliente_datos_updated";

type StoredRow = {
  expedienteId?: unknown;
  datos?: unknown;
  estado?: unknown;
  comentarioRechazo?: unknown;
  validatedAt?: unknown;
  validatedBy?: unknown;
  rejectedAt?: unknown;
  rejectedBy?: unknown;
  updatedAt?: unknown;
  updatedBy?: unknown;
  [k: string]: unknown;
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

function normalizeEstado(value: unknown): ExpedienteClienteDatosEstado {
  if (
    value === "pendiente" ||
    value === "completo" ||
    value === "validado" ||
    value === "rechazado"
  ) {
    return value;
  }
  return "pendiente";
}

function isDatosShape(value: unknown): value is ExpedienteClienteDatos["datos"] {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.nombreCliente === "string" &&
    typeof v.nss === "string" &&
    typeof v.curp === "string" &&
    typeof v.celular === "string" &&
    typeof v.correo === "string" &&
    typeof v.empresa === "string" &&
    typeof v.registroPatronal === "string" &&
    typeof v.telefonoEmpresa === "string" &&
    Array.isArray(v.referencias) &&
    typeof v.beneficiario === "object" &&
    v.beneficiario != null &&
    typeof (v.beneficiario as Record<string, unknown>).nombre === "string" &&
    typeof (v.beneficiario as Record<string, unknown>).parentesco === "string" &&
    typeof v.direccionEmpresa === "object" &&
    v.direccionEmpresa != null &&
    typeof (v.direccionEmpresa as Record<string, unknown>).calle === "string" &&
    typeof (v.direccionEmpresa as Record<string, unknown>).colonia === "string" &&
    typeof (v.direccionEmpresa as Record<string, unknown>).municipio === "string" &&
    typeof (v.direccionEmpresa as Record<string, unknown>).cp === "string"
  );
}

function rowToDomain(row: StoredRow): ExpedienteClienteDatos | null {
  const expedienteId = typeof row.expedienteId === "string" ? row.expedienteId : null;
  if (!expedienteId) return null;
  if (!isDatosShape(row.datos)) return null;
  const rawDatos = row.datos as Record<string, unknown>;
  const datos: ExpedienteClienteDatos["datos"] = {
    ...(row.datos as ExpedienteClienteDatos["datos"]),
    rfc: typeof rawDatos.rfc === "string" ? rawDatos.rfc : "",
    porcentajeCobro:
      typeof rawDatos.porcentajeCobro === "string" ? rawDatos.porcentajeCobro : "",
    montoCalculado:
      typeof rawDatos.montoCalculado === "string" ? rawDatos.montoCalculado : "",
    metodoPago: typeof rawDatos.metodoPago === "string" ? rawDatos.metodoPago : "",
    montoMejoravit: readClienteDatosMontoMejoravit(rawDatos),
    plazo: readClienteDatosPlazo(rawDatos),
  };
  const montoParsed = parseMontoCalculadoInput(datos.montoCalculado);
  const updatedAt = typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString();
  const updatedBy = typeof row.updatedBy === "string" ? row.updatedBy : "unknown";
  const comentarioRechazo =
    typeof row.comentarioRechazo === "string" && row.comentarioRechazo.trim() !== ""
      ? row.comentarioRechazo
      : undefined;
  const validatedAt =
    typeof row.validatedAt === "string" && row.validatedAt.trim() !== ""
      ? row.validatedAt
      : undefined;
  const validatedBy =
    typeof row.validatedBy === "string" && row.validatedBy.trim() !== ""
      ? row.validatedBy
      : undefined;
  const rejectedAt =
    typeof row.rejectedAt === "string" && row.rejectedAt.trim() !== ""
      ? row.rejectedAt
      : undefined;
  const rejectedBy =
    typeof row.rejectedBy === "string" && row.rejectedBy.trim() !== ""
      ? row.rejectedBy
      : undefined;
  return {
    expedienteId,
    datos,
    porcentajeCobro:
      typeof row.porcentajeCobro === "number" ? row.porcentajeCobro : null,
    montoCalculado:
      montoParsed ??
      (typeof row.montoCalculado === "number" ? row.montoCalculado : null),
    metodoPago:
      typeof row.metodoPago === "string" ? row.metodoPago : datos.metodoPago || null,
    estado: normalizeEstado(row.estado),
    comentarioRechazo,
    validatedAt,
    validatedBy,
    rejectedAt,
    rejectedBy,
    updatedAt,
    updatedBy,
  };
}

function dispatchUpdated(expedienteId: string): void {
  emitExpedienteClienteDatosUpdated(expedienteId);
}

export class MockExpedienteClienteDatosLocalStorageRepo implements ExpedienteClienteDatosRepo {
  async getByExpedienteId(expedienteId: string): Promise<ExpedienteClienteDatos | null> {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = safeParseArray(raw);
    const found = arr.find((x) => {
      if (!x || typeof x !== "object") return false;
      const obj = x as Record<string, unknown>;
      return obj.expedienteId === expedienteId;
    }) as StoredRow | undefined;
    return found ? rowToDomain(found) : null;
  }

  async listEstadoByExpedienteIds(
    expedienteIds: readonly string[],
  ): Promise<Record<string, ExpedienteClienteDatosEstado>> {
    const wanted = new Set(
      expedienteIds.map((id) => String(id).trim()).filter(Boolean),
    );
    if (wanted.size === 0 || typeof window === "undefined") return {};

    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = safeParseArray(raw);
    const out: Record<string, ExpedienteClienteDatosEstado> = {};
    for (const x of arr) {
      if (!x || typeof x !== "object") continue;
      const obj = x as StoredRow;
      const expedienteId = typeof obj.expedienteId === "string" ? obj.expedienteId : null;
      if (!expedienteId || !wanted.has(expedienteId)) continue;
      out[expedienteId] = normalizeEstado(obj.estado);
    }
    return out;
  }

  async listEstadoBatchByExpedienteIds(
    expedienteIds: readonly string[],
  ): Promise<Record<string, import("./types").ClienteDatosEstadoBatch>> {
    const wanted = new Set(
      expedienteIds.map((id) => String(id).trim()).filter(Boolean),
    );
    if (wanted.size === 0 || typeof window === "undefined") return {};

    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = safeParseArray(raw);
    const out: Record<string, import("./types").ClienteDatosEstadoBatch> = {};
    for (const x of arr) {
      if (!x || typeof x !== "object") continue;
      const obj = x as StoredRow;
      const expedienteId = typeof obj.expedienteId === "string" ? obj.expedienteId : null;
      if (!expedienteId || !wanted.has(expedienteId)) continue;
      const domain = rowToDomain(obj);
      if (!domain) continue;
      out[expedienteId] = {
        estado: domain.estado,
        updatedAt: domain.updatedAt ?? null,
        validatedAt: domain.validatedAt ?? null,
      };
    }
    return out;
  }

  async save(input: SaveExpedienteClienteDatosInput): Promise<ExpedienteClienteDatos> {
    if (typeof window === "undefined") {
      throw new Error("save solo disponible en cliente");
    }
    const now = new Date().toISOString();
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = safeParseArray(raw);
    const existing = arr.find((x) => {
      if (!x || typeof x !== "object") return false;
      const obj = x as Record<string, unknown>;
      return obj.expedienteId === input.expedienteId;
    }) as StoredRow | undefined;
    const existingDomain = existing ? rowToDomain(existing) : null;

    const montoParsed = parseMontoCalculadoInput(input.datos.montoCalculado);

    const next: ExpedienteClienteDatos = {
      expedienteId: input.expedienteId,
      datos: input.datos,
      montoCalculado: montoParsed,
      estado: "completo",
      comentarioRechazo: existingDomain?.comentarioRechazo,
      validatedAt: existingDomain?.validatedAt,
      validatedBy: existingDomain?.validatedBy,
      rejectedAt: existingDomain?.rejectedAt,
      rejectedBy: existingDomain?.rejectedBy,
      updatedAt: now,
      updatedBy: input.updatedBy,
    };
    const without = arr.filter((x) => {
      if (!x || typeof x !== "object") return true;
      const obj = x as Record<string, unknown>;
      return obj.expedienteId !== input.expedienteId;
    });
    without.push(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(without));
    dispatchUpdated(input.expedienteId);
    return next;
  }

  async saveCorreccion(input: SaveExpedienteClienteDatosInput): Promise<ExpedienteClienteDatos> {
    const existing = await this.getByExpedienteId(input.expedienteId);
    const saved = await this.save(input);
    if (existing?.estado === "rechazado") {
      return {
        ...saved,
        estado: "completo",
        comentarioRechazo: undefined,
        rejectedAt: undefined,
        rejectedBy: undefined,
        validatedAt: undefined,
        validatedBy: undefined,
      };
    }
    if (existing) {
      return {
        ...saved,
        estado: existing.estado,
        comentarioRechazo: existing.comentarioRechazo,
        validatedAt: existing.validatedAt,
        validatedBy: existing.validatedBy,
        rejectedAt: existing.rejectedAt,
        rejectedBy: existing.rejectedBy,
      };
    }
    return saved;
  }

  async updateEstado(
    input: UpdateEstadoExpedienteClienteDatosInput,
  ): Promise<ExpedienteClienteDatos | null> {
    if (typeof window === "undefined") return null;
    if (
      input.estado === "rechazado" &&
      (!input.comentarioRechazo || input.comentarioRechazo.trim() === "")
    ) {
      throw new Error("El comentario de rechazo es obligatorio.");
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = safeParseArray(raw);
    const now = new Date().toISOString();
    let updated: ExpedienteClienteDatos | null = null;

    const nextArr = arr.map((x) => {
      if (!x || typeof x !== "object") return x;
      const obj = x as Record<string, unknown>;
      if (obj.expedienteId !== input.expedienteId) return x;
      const domain = rowToDomain(obj as StoredRow);
      if (!domain) return x;
      updated = {
        ...domain,
        estado: input.estado,
        comentarioRechazo:
          input.estado === "rechazado" ? input.comentarioRechazo?.trim() : undefined,
        validatedAt:
          input.estado === "validado" ? now : input.estado === "rechazado" ? undefined : domain.validatedAt,
        validatedBy:
          input.estado === "validado"
            ? input.updatedBy
            : input.estado === "rechazado"
              ? undefined
              : domain.validatedBy,
        rejectedAt:
          input.estado === "rechazado" ? now : input.estado === "validado" ? undefined : domain.rejectedAt,
        rejectedBy:
          input.estado === "rechazado"
            ? input.updatedBy
            : input.estado === "validado"
              ? undefined
              : domain.rejectedBy,
        updatedAt: now,
        updatedBy: input.updatedBy,
      };
      return updated;
    });

    if (!updated) return null;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextArr));
    dispatchUpdated(input.expedienteId);
    return updated;
  }
}

export const EXPEDIENTE_CLIENTE_DATOS_EVENT = EVENT_NAME;
export const EXPEDIENTE_CLIENTE_DATOS_STORAGE_KEY = STORAGE_KEY;

