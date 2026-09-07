import type { ExpedienteClienteDatos } from "./types";

export type ClienteDatosReferenciaCaptura = ExpedienteClienteDatos["datos"]["referencias"][number];

export type ReferenciaEstructuradaPersistida = {
  nombre: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  celular: string;
  /** Solo históricos sin editar; evita perder grandfather al guardar otros campos. */
  legacyGrandfathered?: boolean;
};

/** Clave versionable en `p_datos` (sobrevive al RPC; no es `referencias`). */
export const REFERENCIAS_ESTRUCTURADAS_KEY = "referenciasEstructuradas" as const;

/**
 * Contrato vigente de una referencia (interno):
 * - grandfather → nombre combinado + celular
 * - nuevo/editado → nombres + ambos apellidos + celular
 */
export function referenciaCumpleContratoActual(
  r: ClienteDatosReferenciaCaptura | null | undefined,
): boolean {
  if (!r) return false;
  const celular = String(r.celular ?? "").trim();
  if (!celular) return false;
  if (r.legacyGrandfathered === true) {
    return Boolean(String(r.nombre ?? "").trim());
  }
  return Boolean(
    String(r.nombres ?? "").trim() &&
      String(r.apellidoPaterno ?? "").trim() &&
      String(r.apellidoMaterno ?? "").trim(),
  );
}

/** Etiquetas de faltantes (completitud); misma semántica que validación. */
export function referenciaCamposFaltantesContrato(
  r: ClienteDatosReferenciaCaptura | null | undefined,
  index1Based: number,
): string[] {
  const missing: string[] = [];
  const n = index1Based;
  const ref = r ?? { nombre: "", celular: "" };
  if (ref.legacyGrandfathered === true) {
    if (!String(ref.nombre ?? "").trim()) {
      missing.push(`Referencia ${n} — nombre`);
    }
    if (!String(ref.celular ?? "").trim()) {
      missing.push(`Referencia ${n} — celular`);
    }
    return missing;
  }
  if (!String(ref.nombres ?? "").trim()) {
    missing.push(`Referencia ${n} — nombre(s)`);
  }
  if (!String(ref.apellidoPaterno ?? "").trim()) {
    missing.push(`Referencia ${n} — primer apellido`);
  }
  if (!String(ref.apellidoMaterno ?? "").trim()) {
    missing.push(`Referencia ${n} — segundo apellido`);
  }
  if (!String(ref.celular ?? "").trim()) {
    missing.push(`Referencia ${n} — celular`);
  }
  return missing;
}

/** ¿Mostrar aviso discreto de histórico ambiguo (sin partes confiables)? */
export function referenciaLegacyAmbiguoSinPartes(
  r: ClienteDatosReferenciaCaptura | null | undefined,
): boolean {
  if (!r || r.legacyGrandfathered !== true) return false;
  const hasParts = Boolean(
    String(r.nombres ?? "").trim() &&
      String(r.apellidoPaterno ?? "").trim() &&
      String(r.apellidoMaterno ?? "").trim(),
  );
  return !hasParts && Boolean(String(r.nombre ?? "").trim());
}

/** Panel histórico: visible siempre que la ref siga grandfathered (parseable o no). */
export function shouldShowReferenciaHistoricaPanel(
  r: ClienteDatosReferenciaCaptura | null | undefined,
): boolean {
  return r?.legacyGrandfathered === true;
}

export function buildReferenciasEstructuradasForSave(
  referencias: readonly ClienteDatosReferenciaCaptura[],
): ReferenciaEstructuradaPersistida[] {
  const out: ReferenciaEstructuradaPersistida[] = [];
  for (let i = 0; i < 2; i += 1) {
    const r = referencias[i];
    const row: ReferenciaEstructuradaPersistida = {
      nombre: String(r?.nombre ?? "").trim(),
      nombres: String(r?.nombres ?? "").trim(),
      apellidoPaterno: String(r?.apellidoPaterno ?? "").trim(),
      apellidoMaterno: String(r?.apellidoMaterno ?? "").trim(),
      celular: String(r?.celular ?? "").trim(),
    };
    if (r?.legacyGrandfathered === true) {
      row.legacyGrandfathered = true;
    }
    out.push(row);
  }
  return out;
}

function normPhone(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

function refHasStructuredNames(r: ClienteDatosReferenciaCaptura | undefined): boolean {
  if (!r) return false;
  return Boolean(
    String(r.nombres ?? "").trim() ||
      String(r.apellidoPaterno ?? "").trim() ||
      String(r.apellidoMaterno ?? "").trim(),
  );
}

/**
 * Tras save exitoso: no borrar borrador local si la respuesta perdió captura crítica.
 */
export function clienteDatosSavedPreservesCapture(params: Readonly<{
  sent: ExpedienteClienteDatos["datos"];
  saved: ExpedienteClienteDatos["datos"];
  sentDireccionOpcional: string;
  savedDireccionOpcional?: string;
  sentTelefonoCasa?: string;
  savedTelefonoCasa?: string;
  requireReferenciasEstructuradas?: boolean;
  requireTelefonoCasa?: boolean;
}>): boolean {
  const {
    sent,
    saved,
    sentDireccionOpcional,
    savedDireccionOpcional,
    sentTelefonoCasa,
    savedTelefonoCasa,
    requireReferenciasEstructuradas = true,
    requireTelefonoCasa = false,
  } = params;

  const same = (a: string, b: string) =>
    String(a ?? "").trim() === String(b ?? "").trim();
  const samePhone = (a: string, b: string) => normPhone(a) === normPhone(b);

  if (!same(sent.nombreCliente, saved.nombreCliente)) return false;
  if (!same(sent.nss, saved.nss)) return false;
  if (!same(sent.curp, saved.curp)) return false;
  if (!same(sent.rfc, saved.rfc)) return false;
  if (!samePhone(sent.celular, saved.celular)) return false;
  if (!same(sent.correo, saved.correo)) return false;
  if (!same(sent.empresa, saved.empresa)) return false;
  if (!same(sent.registroPatronal, saved.registroPatronal)) return false;
  if (!samePhone(sent.telefonoEmpresa, saved.telefonoEmpresa)) return false;
  if (!same(sent.beneficiario.nombre, saved.beneficiario.nombre)) return false;
  if (!same(sent.beneficiario.parentesco, saved.beneficiario.parentesco)) return false;
  if (!same(sent.direccionEmpresa.calle, saved.direccionEmpresa.calle)) return false;
  if (!same(sent.direccionEmpresa.colonia, saved.direccionEmpresa.colonia)) return false;
  if (!same(sent.direccionEmpresa.municipio, saved.direccionEmpresa.municipio)) return false;
  if (!same(sent.direccionEmpresa.cp, saved.direccionEmpresa.cp)) return false;
  if (!same(sent.montoMejoravit ?? "", saved.montoMejoravit ?? "")) return false;
  if (!same(sent.plazo ?? "", saved.plazo ?? "")) return false;
  if (!same(sent.porcentajeCobro ?? "", saved.porcentajeCobro ?? "")) return false;
  if (!same(sent.metodoPago ?? "", saved.metodoPago ?? "")) return false;
  if (!same(sent.notaMesa ?? "", saved.notaMesa ?? "")) return false;
  if (
    savedDireccionOpcional != null &&
    !same(sentDireccionOpcional, savedDireccionOpcional)
  ) {
    return false;
  }
  if (requireTelefonoCasa) {
    if (!samePhone(sentTelefonoCasa ?? "", savedTelefonoCasa ?? "")) return false;
  }

  if (requireReferenciasEstructuradas) {
    for (let i = 0; i < 2; i += 1) {
      const a = sent.referencias[i];
      const b = saved.referencias[i];
      if (!samePhone(a?.celular ?? "", b?.celular ?? "")) return false;
      if (Boolean(a?.legacyGrandfathered) !== Boolean(b?.legacyGrandfathered)) {
        return false;
      }
      if (refHasStructuredNames(a)) {
        if (!same(a?.nombres ?? "", b?.nombres ?? "")) return false;
        if (!same(a?.apellidoPaterno ?? "", b?.apellidoPaterno ?? "")) return false;
        if (!same(a?.apellidoMaterno ?? "", b?.apellidoMaterno ?? "")) return false;
      } else if (String(a?.nombre ?? "").trim()) {
        if (!same(a?.nombre ?? "", b?.nombre ?? "")) return false;
      }
    }
  }

  return true;
}
