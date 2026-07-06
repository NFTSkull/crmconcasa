import type {
  ClienteDatosImagen,
  ExpedienteClienteDatos,
  ExpedienteClienteDatosEstado,
} from "./types";
import {
  isProgramaMejoravitDb,
  parseMontoCalculadoInput,
  parsePorcentajeCobroInput,
} from "@/lib/clienteDatosCobro";

export type SupabaseClienteDatosRow = {
  expediente_id: string;
  datos: Record<string, unknown> | null;
  estado: string;
  comentario_rechazo?: string | null;
  validated_at?: string | null;
  validated_by?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
  telefono_normalizado?: string | null;
  porcentaje_cobro?: number | string | null;
  monto_calculado?: number | string | null;
  metodo_pago?: string | null;
  updated_at: string;
  referencias?: unknown;
  imagenes?: unknown;
  updated_by_profile?: { email?: string | null } | null;
  validated_by_profile?: { email?: string | null } | null;
  rejected_by_profile?: { email?: string | null } | null;
};

type ReferenciaJson = {
  nombre?: unknown;
  celular?: unknown;
  telefono?: unknown;
};

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

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Texto en JSON `datos` (acepta número serializado). */
function asDatosTextField(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function readClienteDatosMontoMejoravit(
  datos: Record<string, unknown>,
): string {
  const camel = asDatosTextField(datos.montoMejoravit);
  if (camel.trim()) return camel;
  return asDatosTextField(datos.monto_mejoravit);
}

export function readClienteDatosPlazo(datos: Record<string, unknown>): string {
  return asDatosTextField(datos.plazo);
}

function mapReferencias(
  datos: Record<string, unknown>,
  referenciasCol: unknown,
): ExpedienteClienteDatos["datos"]["referencias"] {
  const raw =
    Array.isArray(referenciasCol) && referenciasCol.length > 0
      ? referenciasCol
      : Array.isArray(datos.referencias)
        ? datos.referencias
        : [];

  const mapped = raw
    .filter((item): item is ReferenciaJson => !!item && typeof item === "object")
    .map((item) => ({
      nombre: asString(item.nombre),
      celular: asString(item.celular) || asString(item.telefono),
    }));

  while (mapped.length < 2) {
    mapped.push({ nombre: "", celular: "" });
  }

  return mapped.slice(0, 2);
}

function mapBeneficiario(
  value: unknown,
): ExpedienteClienteDatos["datos"]["beneficiario"] {
  if (!value || typeof value !== "object") {
    return { nombre: "", parentesco: "" };
  }
  const obj = value as Record<string, unknown>;
  return {
    nombre: asString(obj.nombre),
    parentesco: asString(obj.parentesco),
  };
}

function mapImagenes(value: unknown): ClienteDatosImagen[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      tipo: asString(item.tipo) || undefined,
      filename: asString(item.filename) || undefined,
      mime_type: asString(item.mime_type) || undefined,
      size_bytes:
        typeof item.size_bytes === "number" && Number.isFinite(item.size_bytes)
          ? item.size_bytes
          : undefined,
    }))
    .filter((img) => img.tipo || img.filename || img.mime_type);
}

function mapDireccionEmpresa(
  value: unknown,
): ExpedienteClienteDatos["datos"]["direccionEmpresa"] {
  if (!value || typeof value !== "object") {
    return { calle: "", colonia: "", municipio: "", cp: "" };
  }
  const obj = value as Record<string, unknown>;
  return {
    calle: asString(obj.calle),
    colonia: asString(obj.colonia),
    municipio: asString(obj.municipio),
    cp: asString(obj.cp),
  };
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function mapSupabaseRowToExpedienteClienteDatos(
  row: SupabaseClienteDatosRow,
): ExpedienteClienteDatos {
  const datos = row.datos ?? {};

  return {
    expedienteId: row.expediente_id,
    datos: {
      nombreCliente: asString(datos.nombreCliente),
      nss: asString(datos.nss),
      curp: asString(datos.curp),
      rfc: asString(datos.rfc),
      celular: asString(datos.celular) || asString(datos.telefono),
      correo: asString(datos.correo),
      empresa: asString(datos.empresa),
      registroPatronal: asString(datos.registroPatronal),
      telefonoEmpresa: asString(datos.telefonoEmpresa),
      referencias: mapReferencias(datos, row.referencias),
      beneficiario: mapBeneficiario(datos.beneficiario),
      direccionEmpresa: mapDireccionEmpresa(datos.direccionEmpresa),
      montoMejoravit: readClienteDatosMontoMejoravit(datos),
      plazo: readClienteDatosPlazo(datos),
      porcentajeCobro:
        asString(datos.porcentajeCobro) ||
        (row.porcentaje_cobro != null ? String(row.porcentaje_cobro) : ""),
      montoCalculado:
        asString(datos.montoCalculado) ||
        (row.monto_calculado != null ? String(row.monto_calculado) : ""),
      metodoPago: asString(datos.metodoPago) || asString(row.metodo_pago),
      notaMesa: asString(datos.notaMesa) || undefined,
    },
    porcentajeCobro: asNumber(row.porcentaje_cobro),
    montoCalculado: asNumber(row.monto_calculado),
    metodoPago: row.metodo_pago?.trim() || null,
    estado: normalizeEstado(row.estado),
    imagenes: mapImagenes(row.imagenes),
    telefonoNormalizado: row.telefono_normalizado?.trim() || undefined,
    comentarioRechazo: row.comentario_rechazo?.trim() || undefined,
    validatedAt: row.validated_at ?? undefined,
    validatedBy:
      row.validated_by_profile?.email?.trim() ||
      row.validated_by?.trim() ||
      undefined,
    rejectedAt: row.rejected_at ?? undefined,
    rejectedBy:
      row.rejected_by_profile?.email?.trim() ||
      row.rejected_by?.trim() ||
      undefined,
    updatedAt: row.updated_at,
    updatedBy:
      row.updated_by_profile?.email?.trim() ||
      "asesor",
  };
}

export function buildSaveClienteDatosRpcPayload(
  expedienteId: string,
  datos: ExpedienteClienteDatos["datos"],
  direccionOpcional: string,
  programaDb?: string | null,
): {
  p_expediente_id: string;
  p_rfc: string;
  p_telefono: string;
  p_referencias: { nombre: string; telefono: string }[];
  p_datos: Record<string, unknown>;
  p_estado: "completo";
  p_porcentaje_cobro: number;
  p_metodo_pago: string;
  p_direccion_opcional: string;
} {
  const pct = parsePorcentajeCobroInput(datos.porcentajeCobro);
  if (pct == null) {
    throw new Error("Porcentaje de cobro inválido.");
  }
  const metodo = datos.metodoPago.trim().toLowerCase();
  if (!metodo) {
    throw new Error("Método de pago es obligatorio.");
  }

  const esMejoravit = isProgramaMejoravitDb(programaDb);
  let montoMejoravitRaw = "";
  let plazo = "";
  if (esMejoravit) {
    montoMejoravitRaw = datos.montoMejoravit.trim();
    const montoMejoravit = parseMontoCalculadoInput(montoMejoravitRaw);
    if (!montoMejoravitRaw || montoMejoravit == null || montoMejoravit <= 0) {
      throw new Error("El monto Mejoravit es obligatorio.");
    }
    plazo = datos.plazo.trim();
    if (!plazo) {
      throw new Error("El plazo es obligatorio.");
    }
  }

  const p_datos: Record<string, unknown> = {
    nombreCliente: datos.nombreCliente.trim(),
    nss: datos.nss.trim(),
    curp: datos.curp.trim(),
    correo: datos.correo.trim(),
    empresa: datos.empresa.trim(),
    registroPatronal: datos.registroPatronal.trim(),
    telefonoEmpresa: datos.telefonoEmpresa.trim(),
    beneficiario: {
      nombre: datos.beneficiario.nombre.trim(),
      parentesco: datos.beneficiario.parentesco.trim(),
    },
    direccionEmpresa: {
      calle: datos.direccionEmpresa.calle.trim(),
      colonia: datos.direccionEmpresa.colonia.trim(),
      municipio: datos.direccionEmpresa.municipio.trim(),
      cp: datos.direccionEmpresa.cp.trim(),
    },
  };
  if (esMejoravit) {
    p_datos.montoMejoravit = montoMejoravitRaw;
    p_datos.plazo = plazo;
  }
  if (datos.notaMesa?.trim()) {
    p_datos.notaMesa = datos.notaMesa.trim();
  }

  return {
    p_expediente_id: expedienteId,
    p_rfc: datos.rfc.trim(),
    p_telefono: datos.celular.trim(),
    p_referencias: datos.referencias.map((ref) => ({
      nombre: ref.nombre.trim(),
      telefono: ref.celular.trim(),
    })),
    p_datos,
    p_estado: "completo",
    p_porcentaje_cobro: pct,
    p_metodo_pago: metodo,
    p_direccion_opcional: direccionOpcional.trim(),
  };
}
