/**
 * Adapter estricto B3 snapshot payload → InfonavitPdfSnapshotInput B1.
 * No infiere LADA/52/81/Monterrey. No convierte plazoAnios ×12.
 */

import type {
  EstadoCivilCodigo,
  GeneroCodigo,
  InfonavitPdfSnapshotInput,
  InfonavitReferenciaInput,
  RegimenMatrimonialCodigo,
  TipoPropiedadCodigo,
} from "./types.ts";

export class InfonavitSnapshotAdapterError extends Error {
  readonly code = "SNAPSHOT_CONTRACT_INVALID" as const;
  readonly reason: string;

  constructor(reason: string) {
    super("snapshot contract invalid");
    this.name = "InfonavitSnapshotAdapterError";
    this.reason = reason;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function asString(v: unknown, reason: string): string {
  if (v === null || v === undefined) return "";
  if (typeof v !== "string") {
    throw new InfonavitSnapshotAdapterError(reason);
  }
  return v;
}

function optionalString(v: unknown, reason: string): string {
  return asString(v, reason).trim();
}

function optionalNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asNumber(v: unknown, reason: string): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new InfonavitSnapshotAdapterError(reason);
}

function optionalPlazoAnios(v: unknown, reason: string): number | null {
  if (v === null || v === undefined) return null;
  try {
    const n = asNumber(v, reason);
    if (!Number.isInteger(n) || n < 1 || n > 10) return null;
    return n;
  } catch {
    return null;
  }
}

function optionalEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  reason: string,
): T | null {
  const s = asString(v, reason).trim();
  if (!s) return null;
  if ((allowed as readonly string[]).includes(s)) return s as T;
  throw new InfonavitSnapshotAdapterError(reason);
}

function mapReferencia(
  v: unknown,
  reason: string,
): InfonavitReferenciaInput {
  if (!isRecord(v)) throw new InfonavitSnapshotAdapterError(reason);
  return {
    nombres: asString(v.nombres, reason),
    apellidoPaterno: asString(v.apellidoPaterno, reason),
    apellidoMaterno: asString(v.apellidoMaterno, reason),
    lada: asString(v.lada, reason),
    telefono: asString(v.telefono, reason),
    celular: asString(v.celular, reason),
  };
}

/**
 * Convierte payload B3 inmutable a input B1.
 * Exige schemaVersion=1, 2 referencias, credito.plazoAnios (no plazoMeses).
 */
export function adaptB3SnapshotToB1(
  payload: unknown,
): InfonavitPdfSnapshotInput {
  if (!isRecord(payload)) {
    throw new InfonavitSnapshotAdapterError("payload_not_object");
  }

  if (payload.schemaVersion !== 1) {
    throw new InfonavitSnapshotAdapterError("schema_version");
  }

  const fechaDocumento = optionalString(payload.fechaDocumento, "fechaDocumento");
  if (!fechaDocumento || !/^\d{4}-\d{2}-\d{2}$/.test(fechaDocumento)) {
    throw new InfonavitSnapshotAdapterError("fechaDocumento");
  }

  if (!isRecord(payload.cliente)) {
    throw new InfonavitSnapshotAdapterError("cliente");
  }
  if (!isRecord(payload.empresa)) {
    throw new InfonavitSnapshotAdapterError("empresa");
  }
  if (!isRecord(payload.vivienda)) {
    throw new InfonavitSnapshotAdapterError("vivienda");
  }
  if (!isRecord(payload.credito)) {
    throw new InfonavitSnapshotAdapterError("credito");
  }
  if (!Array.isArray(payload.referencias) || payload.referencias.length !== 2) {
    throw new InfonavitSnapshotAdapterError("referencias_count");
  }
  if (!isRecord(payload.beneficiario)) {
    throw new InfonavitSnapshotAdapterError("beneficiario");
  }
  if (!isRecord(payload.mejora)) {
    throw new InfonavitSnapshotAdapterError("mejora");
  }

  const c = payload.cliente;
  const emp = payload.empresa;
  const viv = payload.vivienda;
  const cred = payload.credito;
  const ben = payload.beneficiario;
  const mej = payload.mejora;
  const id = isRecord(c.identificacion) ? c.identificacion : {};

  if ("plazoMeses" in cred && cred.plazoMeses !== undefined) {
    throw new InfonavitSnapshotAdapterError("plazoMeses_forbidden");
  }

  const plazoAnios = optionalPlazoAnios(cred.plazoAnios, "plazoAnios");

  const telefono = asString(c.telefono, "cliente.telefono");
  const ladaTelefono = asString(c.ladaTelefono, "cliente.ladaTelefono");
  const empLada = asString(emp.lada, "empresa.lada");
  const empExt = asString(emp.extension, "empresa.extension");

  const localidad = optionalString(payload.localidad, "localidad");
  const ciudadCierre =
    optionalString(payload.ciudadCierre, "ciudadCierre") || localidad;

  return {
    fechaDocumento,
    localidad,
    ciudadCierre,
    cliente: {
      nombreCompleto: optionalString(c.nombreCompleto, "cliente.nombreCompleto"),
      nombres: optionalString(c.nombres, "cliente.nombres"),
      apellidoPaterno: optionalString(
        c.apellidoPaterno,
        "cliente.apellidoPaterno",
      ),
      apellidoMaterno: optionalString(
        c.apellidoMaterno,
        "cliente.apellidoMaterno",
      ),
      nss: optionalString(c.nss, "cliente.nss"),
      curp: optionalString(c.curp, "cliente.curp"),
      rfc: optionalString(c.rfc, "cliente.rfc"),
      celular: asString(c.celular, "cliente.celular"),
      telefono,
      ladaTelefono,
      correo: asString(c.correo, "cliente.correo"),
      genero: optionalEnum<GeneroCodigo>(c.genero, ["M", "F"], "cliente.genero"),
      estadoCivil: optionalEnum<EstadoCivilCodigo>(
        c.estadoCivil,
        ["soltero", "casado"],
        "cliente.estadoCivil",
      ),
      regimenMatrimonial: optionalEnum<RegimenMatrimonialCodigo>(
        c.regimenMatrimonial,
        ["separacion_bienes", "sociedad_conyugal"],
        "cliente.regimenMatrimonial",
      ),
      identificacion: {
        tipo: asString(id.tipo, "identificacion.tipo"),
        numero: asString(id.numero, "identificacion.numero"),
        vigencia: asString(id.vigencia, "identificacion.vigencia"),
      },
    },
    empresa: {
      nombre: asString(emp.nombre, "empresa.nombre"),
      registroPatronal: asString(
        emp.registroPatronal,
        "empresa.registroPatronal",
      ),
      telefono: asString(emp.telefono, "empresa.telefono"),
      lada: empLada,
      extension: empExt,
    },
    vivienda: {
      direccionCompleta: optionalString(
        viv.direccionCompleta,
        "vivienda.direccionCompleta",
      ),
      direccionLibre: optionalString(
        viv.direccionCompleta ?? viv.direccionLibre,
        "vivienda.direccionLibre",
      ),
      calle: asString(viv.calle, "vivienda.calle"),
      noExt: asString(viv.noExt, "vivienda.noExt"),
      noInt: asString(viv.noInt, "vivienda.noInt"),
      lote: asString(viv.lote, "vivienda.lote"),
      manzana: asString(viv.manzana, "vivienda.manzana"),
      colonia: asString(viv.colonia, "vivienda.colonia"),
      entidad: asString(viv.entidad, "vivienda.entidad"),
      municipio: asString(viv.municipio, "vivienda.municipio"),
      cp: asString(viv.cp, "vivienda.cp"),
      tipoPropiedad: optionalEnum<TipoPropiedadCodigo>(
        viv.tipoPropiedad,
        ["propia", "conyuge_concubino", "familiar"],
        "vivienda.tipoPropiedad",
      ),
    },
    credito: {
      montoSolicitado: optionalNumber(cred.montoSolicitado),
      plazoAnios,
    },
    referencias: [
      mapReferencia(payload.referencias[0], "referencias[0]"),
      mapReferencia(payload.referencias[1], "referencias[1]"),
    ],
    beneficiario: {
      nombres: asString(ben.nombres, "beneficiario.nombres"),
      apellidoPaterno: asString(
        ben.apellidoPaterno,
        "beneficiario.apellidoPaterno",
      ),
      apellidoMaterno: asString(
        ben.apellidoMaterno,
        "beneficiario.apellidoMaterno",
      ),
      parentesco: asString(ben.parentesco, "beneficiario.parentesco"),
    },
    mejora: {
      descripcion: optionalString(mej.descripcion, "mejora.descripcion"),
      presupuestoEstimado: optionalNumber(mej.presupuestoEstimado),
    },
  };
}
