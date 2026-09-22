// Diagnostic-only PR: validate Mesa owner alias build fix.
import type { ExpedienteClienteDatos } from "@/domain/expediente-cliente-datos";
import { normalizeClienteDatosForSave } from "./clienteDatosValidation";
import { isValidPersonName } from "./clienteDatosFieldFormats";

/**
 * v1 + campo opcional `telefonoCasa` (compat: borradores viejos sin el campo siguen válidos).
 * No subir versión: evita invalidar drafts existentes en localStorage de asesores.
 */
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
  /**
   * Teléfono de casa (internos). Opcional en v1 para no romper drafts previos.
   * Externos no deben persistirlo en autosave.
   */
  telefonoCasa?: string;
};

export type ClienteDatosDraftFlushSnapshot = {
  clienteDatos: ExpedienteClienteDatos["datos"];
  direccionOpcional: string;
  telefonoCasa: string;
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
      telefonoCasa:
        typeof o.telefonoCasa === "string" ? o.telefonoCasa : undefined,
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
  telefonoCasa: string,
): string {
  return JSON.stringify({
    datos: normalizeClienteDatosForSave(datos),
    direccionOpcional: direccionOpcional.trim(),
    telefonoCasa: telefonoCasa.trim(),
  });
}

/** Compara contenido del borrador vs estado oficial ya hidratado en el formulario. */
export function clienteDatosDraftDiffersFromOfficial(
  draft: ClienteDatosDraft,
  officialDatos: ExpedienteClienteDatos["datos"],
  officialDireccionOpcional: string,
  officialTelefonoCasa = "",
): boolean {
  const draftKey = draftSnapshotKey(
    draft.clienteDatos,
    draft.direccionOpcional ?? "",
    draft.telefonoCasa ?? "",
  );
  const officialKey = draftSnapshotKey(
    officialDatos,
    officialDireccionOpcional,
    officialTelefonoCasa,
  );
  return draftKey !== officialKey;
}

function coreClienteDatosFilledCount(
  datos: ExpedienteClienteDatos["datos"],
): number {
  const values = [
    datos.nombreCliente,
    datos.nss,
    datos.curp,
    datos.rfc,
    datos.celular,
    datos.correo,
    datos.empresa,
    datos.registroPatronal,
    datos.telefonoEmpresa,
    datos.clabe,
    datos.montoMejoravit,
    datos.plazo,
    datos.beneficiario?.nombre,
    datos.beneficiario?.parentesco,
    datos.direccionEmpresa?.calle,
    datos.direccionEmpresa?.colonia,
    datos.direccionEmpresa?.municipio,
    datos.direccionEmpresa?.cp,
    ...(Array.isArray(datos.referencias)
      ? datos.referencias.flatMap((ref) => [ref?.nombre, ref?.celular])
      : []),
  ];
  return values.filter((value) => String(value ?? "").trim().length > 0).length;
}

function draftHasInvalidPersonNameWhileOfficialIsValid(
  draft: ClienteDatosDraft,
  officialDatos: ExpedienteClienteDatos["datos"],
): boolean {
  const pairs: Array<readonly [string, string]> = [
    [draft.clienteDatos.nombreCliente ?? "", officialDatos.nombreCliente ?? ""],
    [
      draft.clienteDatos.beneficiario?.nombre ?? "",
      officialDatos.beneficiario?.nombre ?? "",
    ],
  ];

  const maxRefs = Math.max(
    draft.clienteDatos.referencias?.length ?? 0,
    officialDatos.referencias?.length ?? 0,
  );
  for (let index = 0; index < maxRefs; index += 1) {
    pairs.push([
      draft.clienteDatos.referencias?.[index]?.nombre ?? "",
      officialDatos.referencias?.[index]?.nombre ?? "",
    ]);
  }

  return pairs.some(([draftName, officialName]) => {
    const draftTrimmed = String(draftName ?? "").trim();
    const officialTrimmed = String(officialName ?? "").trim();
    return (
      draftTrimmed.length > 0 &&
      !isValidPersonName(draftTrimmed) &&
      officialTrimmed.length > 0 &&
      isValidPersonName(officialTrimmed)
    );
  });
}

function draftIsSuspiciouslySparseVsOfficial(
  draft: ClienteDatosDraft,
  officialDatos: ExpedienteClienteDatos["datos"],
  officialDireccionOpcional: string,
): boolean {
  const draftCount =
    coreClienteDatosFilledCount(draft.clienteDatos) +
    (String(draft.direccionOpcional ?? "").trim() ? 1 : 0);
  const officialCount =
    coreClienteDatosFilledCount(officialDatos) +
    (String(officialDireccionOpcional ?? "").trim() ? 1 : 0);

  // Protege reingresos/correcciones contra un snapshot local vacío o casi vacío
  // que, por timestamp, podría tapar una captura oficial ya completa.
  return officialCount >= 4 && draftCount <= 1;
}

/** Decidir si el borrador debe aplicarse automáticamente al hidratar. */
export function shouldAutoRestoreClienteDatosDraft(
  draft: ClienteDatosDraft,
  officialDatos: ExpedienteClienteDatos["datos"],
  officialDireccionOpcional: string,
  officialTelefonoCasa = "",
  officialUpdatedAt?: string | null,
): boolean {
  // Nunca permitir que un borrador local viejo tape información más reciente.
  if (
    officialUpdatedAt &&
    !isDraftNewerThanOfficial(draft.updatedAt, officialUpdatedAt)
  ) {
    return false;
  }

  // Aunque sea más nuevo, un draft casi vacío nunca debe ocultar una captura
  // oficial completa. Este caso puede aparecer por pestañas antiguas/reingresos.
  if (
    draftIsSuspiciouslySparseVsOfficial(
      draft,
      officialDatos,
      officialDireccionOpcional,
    )
  ) {
    return false;
  }

  // Si una automatización antigua dejó un artefacto inválido (ej. PI#A),
  // preferimos el valor oficial válido y descartamos ese draft local.
  if (draftHasInvalidPersonNameWhileOfficialIsValid(draft, officialDatos)) {
    return false;
  }

  return clienteDatosDraftDiffersFromOfficial(
    draft,
    officialDatos,
    officialDireccionOpcional,
    officialTelefonoCasa,
  );
}

/** @deprecated Usar `shouldAutoRestoreClienteDatosDraft`. */
export function shouldOfferClienteDatosDraftRestore(
  draft: ClienteDatosDraft,
  officialDatos: ExpedienteClienteDatos["datos"],
  officialDireccionOpcional: string,
  officialTelefonoCasa = "",
  officialUpdatedAt?: string | null,
): boolean {
  return shouldAutoRestoreClienteDatosDraft(
    draft,
    officialDatos,
    officialDireccionOpcional,
    officialTelefonoCasa,
    officialUpdatedAt,
  );
}

/**
 * Guard: no reemplazar el formulario vivo por snapshot DB si ya hay edición local.
 * Excepciones: cambio de expediente, force (save OK / descartar borrador).
 */
export function shouldSkipClienteDatosOfficialRehydrate(params: Readonly<{
  hydratedForExpedienteId: string | null;
  expedienteId: string;
  hasUserEdited: boolean;
  force?: boolean;
}>): boolean {
  if (params.force) return false;
  if (params.hydratedForExpedienteId !== params.expedienteId) return false;
  return params.hasUserEdited;
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
    // Compat: aceptar solo la versión actual (v1). Campo telefonoCasa opcional.
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
  telefonoCasa?: string,
): ClienteDatosDraft {
  const draft: ClienteDatosDraft = {
    expedienteId: String(expedienteId),
    updatedAt: new Date().toISOString(),
    draftVersion: CLIENTE_DATOS_DRAFT_VERSION,
    clienteDatos,
    direccionOpcional:
      typeof direccionOpcional === "string" ? direccionOpcional : undefined,
    telefonoCasa: typeof telefonoCasa === "string" ? telefonoCasa : undefined,
  };
  if (typeof window !== "undefined") {
    const key = buildClienteDatosDraftKey(userKey, expedienteId);
    window.localStorage.setItem(key, JSON.stringify(draft));
  }
  return draft;
}

/** Flush síncrono desde snapshot (pagehide / beforeunload / última tecla). */
export function flushClienteDatosDraftSnapshot(
  userKey: string,
  expedienteId: string,
  snapshot: ClienteDatosDraftFlushSnapshot,
  options?: Readonly<{ persistTelefonoCasa?: boolean }>,
): ClienteDatosDraft {
  const persistCasa = options?.persistTelefonoCasa !== false;
  return writeClienteDatosDraft(
    userKey,
    expedienteId,
    snapshot.clienteDatos,
    snapshot.direccionOpcional,
    persistCasa ? snapshot.telefonoCasa : undefined,
  );
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
