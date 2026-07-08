import type { ExpedienteClienteDatos } from "@/domain/expediente-cliente-datos";
import {
  calcMontoCalculadoCobro,
  isProgramaMejoravitDb,
  parseMontoCalculadoInput,
  parsePorcentajeCobroInput,
} from "@/lib/clienteDatosCobro";

export type ClienteDatosFormShape = ExpedienteClienteDatos["datos"];

export type ClienteDatosCompletenessContext = {
  montoAprobado?: number | null;
  direccionOpcional?: string | null;
  programaDb?: string | null;
};

export const CLIENTE_DATOS_NOTA_MESA_MAX_LENGTH = 1000;

/** Error si la nota opcional supera el límite; vacía no genera error. */
export function getNotaMesaLongitudError(
  nota: string | undefined,
): string | null {
  const len = (nota ?? "").length;
  if (len > CLIENTE_DATOS_NOTA_MESA_MAX_LENGTH) {
    return `La nota para Mesa no puede superar ${CLIENTE_DATOS_NOTA_MESA_MAX_LENGTH} caracteres.`;
  }
  return null;
}

/** Campos obligatorios en Datos Generales para Mejoravit (RFC opcional). */
export const CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_MEJORAVIT = 24;

/** Campos obligatorios sin sección Crédito Mejoravit. */
export const CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_DEFAULT = 22;

/** Etiquetas legibles de campos obligatorios vacíos (trim). RFC no cuenta como faltante. */
export function getClienteDatosCamposFaltantes(
  d: ClienteDatosFormShape,
  ctx: ClienteDatosCompletenessContext = {},
): string[] {
  const missing: string[] = [];
  const req = (label: string, v: string) => {
    if (!String(v).trim()) missing.push(label);
  };
  req("Nombre del cliente", d.nombreCliente);
  req("NSS", d.nss);
  req("CURP", d.curp);
  req("Celular", d.celular);
  req("Correo", d.correo);
  req("Empresa", d.empresa);
  req("Registro patronal", d.registroPatronal);
  req("Teléfono empresa", d.telefonoEmpresa);
  d.referencias.forEach((r, i) => {
    req(`Referencia ${i + 1} — nombre`, r.nombre);
    req(`Referencia ${i + 1} — celular`, r.celular);
  });
  req("Beneficiario — nombre", d.beneficiario.nombre);
  req("Beneficiario — parentesco", d.beneficiario.parentesco);
  req("Dirección empresa — calle", d.direccionEmpresa.calle);
  req("Dirección empresa — colonia", d.direccionEmpresa.colonia);
  req("Dirección empresa — municipio", d.direccionEmpresa.municipio);
  req("Dirección empresa — CP", d.direccionEmpresa.cp);
  req("Domicilio real del cliente", String(ctx.direccionOpcional ?? ""));

  const esMejoravit = isProgramaMejoravitDb(ctx.programaDb);
  if (esMejoravit) {
    const montoMejoravit = parseMontoCalculadoInput(d.montoMejoravit);
    if (montoMejoravit == null || montoMejoravit <= 0) {
      missing.push("Monto Mejoravit");
    }
    req("Plazo", d.plazo);
  }

  req("Porcentaje de cobro", d.porcentajeCobro);
  req("Método de pago", d.metodoPago);

  const pct = parsePorcentajeCobroInput(d.porcentajeCobro);
  const monto = calcMontoCalculadoCobro(ctx.montoAprobado, pct, {
    programaDb: ctx.programaDb,
    montoMejoravitForm: d.montoMejoravit,
  });
  if (monto == null || monto <= 0) {
    missing.push("Monto calculado");
  }

  return missing;
}

/** @deprecated Usar constantes MEJORAVIT/DEFAULT según programa. */
export const CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT = CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_MEJORAVIT;
