import type { ExpedienteClienteDatos } from "@/domain/expediente-cliente-datos";
import type { ClienteDatosPerfilCaptura } from "@/domain/asesor-equipo/asesor-en-equipo-por-lider-email";
import { emptyInfonavitClienteDatosV1 } from "@/domain/expediente-cliente-datos/infonavit-datos";
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
  /** P189: solo cuando SQL/status.required=true. Default false = base pre-P189. */
  requireInfonavit?: boolean;
  /**
   * `asesor_equipo_silvia_simplificado` solo cuando el dueño del expediente
   * confirmó membresía al equipo Silvia (fail-closed → completo).
   */
  perfilCaptura?: ClienteDatosPerfilCaptura;
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

/** Campos P189 (bloque infonavit) + base Mejoravit. */
export const CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_MEJORAVIT = 50;

/** Completitud Mejoravit pre-P189 (sin bloque infonavit). */
export const CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_MEJORAVIT_BASE = 24;

/** Campos obligatorios sin sección Crédito Mejoravit / P189. */
export const CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_DEFAULT = 22;

/**
 * Subset Equipo Silvia (sin refs/beneficiario/correo/empresa/tel.empresa/registro/plazo/P189).
 * Formulario vacío Mejoravit: 13 (nombre/NSS/CURP/celular + dir×4 + domicilio + monto Mejoravit + % + método + monto calculado).
 */
export const CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_SILVIA_SIMPLIFICADO = 11;
export const CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_SILVIA_SIMPLIFICADO_MEJORAVIT = 13;

function isSilviaSimplificado(
  perfil: ClienteDatosPerfilCaptura | undefined,
): boolean {
  return perfil === "asesor_equipo_silvia_simplificado";
}

function pushInfonavitMissing(
  missing: string[],
  d: ClienteDatosFormShape,
): void {
  const req = (label: string, v: string) => {
    if (!String(v).trim()) missing.push(label);
  };
  const inf = d.infonavit ?? emptyInfonavitClienteDatosV1();
  req("Nombre(s)", inf.titular.nombres);
  req("Apellido paterno", inf.titular.apellidoPaterno);
  req("Apellido materno", inf.titular.apellidoMaterno);
  req("Tipo de identificación", inf.titular.identificacion.tipo);
  req("Número de identificación", inf.titular.identificacion.numero);
  req("Vigencia de identificación", inf.titular.identificacion.vigencia);
  if (!inf.titular.genero) missing.push("Género");
  if (!inf.titular.estadoCivil) missing.push("Estado civil");
  if (inf.titular.estadoCivil === "casado" && !inf.titular.regimenMatrimonial) {
    missing.push("Régimen matrimonial");
  }

  if (!inf.vivienda.tipoPropiedad) missing.push("Tipo de propiedad");
  req("Localidad / ciudad", inf.vivienda.localidad);
  req("Calle de la vivienda", inf.vivienda.calle);
  req("Número exterior", inf.vivienda.numeroExterior);
  req("Colonia de la vivienda", inf.vivienda.colonia);
  req("Entidad federativa", inf.vivienda.entidad);
  req("Municipio / alcaldía", inf.vivienda.municipio);
  req("CP de la vivienda", inf.vivienda.cp);

  for (const idx of [0, 1] as const) {
    const r = inf.referencias[idx];
    const n = idx + 1;
    req(`Referencia ${n} — nombre(s)`, r.nombres);
    req(`Referencia ${n} — apellido paterno`, r.apellidoPaterno);
    req(`Referencia ${n} — apellido materno`, r.apellidoMaterno);
    req(`Referencia ${n} — LADA`, r.lada);
    req(`Referencia ${n} — teléfono`, r.telefono);
    req(`Referencia ${n} — celular`, r.celular);
  }

  req("Beneficiario — nombre(s)", inf.beneficiario.nombres);
  req("Beneficiario — apellido paterno", inf.beneficiario.apellidoPaterno);
  req("Beneficiario — apellido materno", inf.beneficiario.apellidoMaterno);
  req("Beneficiario — parentesco", inf.beneficiario.parentesco);

  req("Descripción de la mejora", inf.mejora.descripcion);
  const presupuesto = parseMontoCalculadoInput(inf.mejora.presupuestoEstimado);
  if (presupuesto == null || presupuesto <= 0) {
    missing.push("Presupuesto estimado de la mejora");
  }
}

function pushBaseNombreRefsBeneficiarioDomicilio(
  missing: string[],
  d: ClienteDatosFormShape,
  direccionOpcional: string,
): void {
  const req = (label: string, v: string) => {
    if (!String(v).trim()) missing.push(label);
  };
  req("Nombre del cliente", d.nombreCliente);
  d.referencias.forEach((r, i) => {
    req(`Referencia ${i + 1} — nombre`, r.nombre);
    req(`Referencia ${i + 1} — celular`, r.celular);
  });
  req("Beneficiario — nombre", d.beneficiario.nombre);
  req("Beneficiario — parentesco", d.beneficiario.parentesco);
  req("Domicilio real del cliente", direccionOpcional);
}

/** Etiquetas legibles de campos obligatorios vacíos (trim). RFC no cuenta como faltante. */
export function getClienteDatosCamposFaltantes(
  d: ClienteDatosFormShape,
  ctx: ClienteDatosCompletenessContext = {},
): string[] {
  const missing: string[] = [];
  const req = (label: string, v: string) => {
    if (!String(v).trim()) missing.push(label);
  };
  const esMejoravit = isProgramaMejoravitDb(ctx.programaDb);
  const silvia = isSilviaSimplificado(ctx.perfilCaptura);
  const requireInfonavit =
    !silvia && Boolean(ctx.requireInfonavit) && esMejoravit;

  req("NSS", d.nss);
  req("CURP", d.curp);
  req("Celular", d.celular);
  if (!silvia) {
    req("Correo", d.correo);
    req("Empresa", d.empresa);
    req("Registro patronal", d.registroPatronal);
    req("Teléfono empresa", d.telefonoEmpresa);
  }
  req("Dirección empresa — calle", d.direccionEmpresa.calle);
  req("Dirección empresa — colonia", d.direccionEmpresa.colonia);
  req("Dirección empresa — municipio", d.direccionEmpresa.municipio);
  req("Dirección empresa — CP", d.direccionEmpresa.cp);

  if (silvia) {
    req("Nombre del cliente", d.nombreCliente);
    req("Domicilio real del cliente", String(ctx.direccionOpcional ?? ""));
    if (esMejoravit) {
      const montoMejoravit = parseMontoCalculadoInput(d.montoMejoravit);
      if (montoMejoravit == null || montoMejoravit <= 0) {
        missing.push("Monto Mejoravit");
      }
    }
  } else if (requireInfonavit) {
    pushInfonavitMissing(missing, d);
    const montoMejoravit = parseMontoCalculadoInput(d.montoMejoravit);
    if (montoMejoravit == null || montoMejoravit <= 0) {
      missing.push("Monto Mejoravit");
    }
    req("Plazo", d.plazo);
  } else {
    pushBaseNombreRefsBeneficiarioDomicilio(
      missing,
      d,
      String(ctx.direccionOpcional ?? ""),
    );
    if (esMejoravit) {
      const montoMejoravit = parseMontoCalculadoInput(d.montoMejoravit);
      if (montoMejoravit == null || montoMejoravit <= 0) {
        missing.push("Monto Mejoravit");
      }
      req("Plazo", d.plazo);
    }
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
export const CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT =
  CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_MEJORAVIT_BASE;
