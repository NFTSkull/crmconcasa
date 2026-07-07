import type { ExpedienteClienteDatos } from "@/domain/expediente-cliente-datos";
import { normalizeClienteDatosForSave } from "./clienteDatosValidation";

export const CLIENTE_DATOS_DRAFT_VERSION = 1;

/** Debounce recomendado para autosave en UI del asesor. */
export const CLIENTE_DATOS_DRAFT_DEBOUNCE_MS = 400;

export type ClienteDatosDraft = {
  expedienteId: string;
  updatedAt: string;
  draftVersion: number;
  clienteDatos: ExpedienteClienteDatos["datos"];
  /** Domicilio real del cliente (`expedientes.direccion_opcional`), fuera del JSON datos. */
  direccionOpcional?: string;
};

export function buildClienteDatosDraftKey(
  userKey: string,
  expedienteId: string,
): string {
  const user = String(userKey).trim().toLowerCase();
  const exp = String(expedienteId).trim();
  return `crmconcasa:cliente-datos-draft:${user}:${exp}`;
}

export function parseClienteDatosDraft(raw: string): ClienteDatosDraft | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.expedienteId !== "string") return null;
    if (typeof o.updatedAt !== "string") return null;
    if (typeof o.draftVersion !== "number") return null;
    if (!o.clienteDatos || typeof o.clienteDatos !== "object") return null;
    return {
      expedienteId: o.expedienteId,
      updatedAt: o.updatedAt,
      draftVersion: o.draftVersion,
      clienteDatos: o.clienteDatos as ExpedienteClienteDatos["datos"],
      direccionOpcional:
        typeof o.direccionOpcional === "string" ? o.direccionOpcional : undefined,
    };
  } catch {
    return null;
  }
}

/** `true` si el borrador es más reciente que el guardado oficial (o no hay oficial). */
export function isDraftNewerThanOfficial(
  draftUpdatedAt: string,
  officialUpdatedAt: string | null | undefined,
): boolean {
  if (!officialUpdatedAt) return true;
  const draftMs = Date.parse(draftUpdatedAt);
  const officialMs = Date.parse(officialUpdatedAt);
  if (Number.isNaN(draftMs)) return false;
  if (Number.isNaN(officialMs)) return true;
  return draftMs > officialMs;
}

function draftSnapshotKey(
  datos: ExpedienteClienteDatos["datos"],
  direccionOpcional: string,
): string {
  return JSON.stringify({
    datos: normalizeClienteDatosForSave(datos),
    direccionOpcional: direccionOpcional.trim(),
  });
}

/** Compara contenido del borrador vs estado oficial ya hidratado en el formulario. */
export function clienteDatosDraftDiffersFromOfficial(
  draft: ClienteDatosDraft,
  officialDatos: ExpedienteClienteDatos["datos"],
  officialDireccionOpcional: string,
): boolean {
  const draftKey = draftSnapshotKey(
    draft.clienteDatos,
    draft.direccionOpcional ?? "",
  );
  const officialKey = draftSnapshotKey(officialDatos, officialDireccionOpcional);
  return draftKey !== officialKey;
}

/** Ofrecer restaurar si el borrador difiere del oficial cargado (no depende solo del reloj). */
export function shouldOfferClienteDatosDraftRestore(
  draft: ClienteDatosDraft,
  officialDatos: ExpedienteClienteDatos["datos"],
  officialDireccionOpcional: string,
): boolean {
  return clienteDatosDraftDiffersFromOfficial(
    draft,
    officialDatos,
    officialDireccionOpcional,
  );
}

export function readClienteDatosDraft(
  userKey: string,
  expedienteId: string,
): ClienteDatosDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const key = buildClienteDatosDraftKey(userKey, expedienteId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const draft = parseClienteDatosDraft(raw);
    if (!draft) return null;
    if (draft.expedienteId !== String(expedienteId)) return null;
    if (draft.draftVersion !== CLIENTE_DATOS_DRAFT_VERSION) return null;
    return draft;
  } catch {
    return null;
  }
}

export function writeClienteDatosDraft(
  userKey: string,
  expedienteId: string,
  clienteDatos: ExpedienteClienteDatos["datos"],
  direccionOpcional?: string,
): ClienteDatosDraft {
  const draft: ClienteDatosDraft = {
    expedienteId: String(expedienteId),
    updatedAt: new Date().toISOString(),
    draftVersion: CLIENTE_DATOS_DRAFT_VERSION,
    clienteDatos,
    direccionOpcional:
      typeof direccionOpcional === "string" ? direccionOpcional : undefined,
  };
  if (typeof window !== "undefined") {
    const key = buildClienteDatosDraftKey(userKey, expedienteId);
    window.localStorage.setItem(key, JSON.stringify(draft));
  }
  return draft;
}

export function removeClienteDatosDraft(
  userKey: string,
  expedienteId: string,
): void {
  if (typeof window === "undefined") return;
  try {
    const key = buildClienteDatosDraftKey(userKey, expedienteId);
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
