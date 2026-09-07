import type {
  ClienteDatosImagen,
  ExpedienteClienteDatos,
  ExpedienteClienteDatosEstado,
} from "./types";
import {
  isProgramaMejoravitDb,
  parseMontoCalculadoInput,
  parsePorcentajeCobroInput,
  resolveMontoCalculadoManualForRpc,
} from "@/lib/clienteDatosCobro";
import {
  emptyInfonavitClienteDatosV1,
  hasCapturedInfonavitV1,
  mapDatosInfonavitFromUnknown,
  serializeInfonavitClienteDatosV1,
} from "./infonavit-datos";
import type { ClienteDatosPerfilCaptura } from "@/domain/asesor-equipo/asesor-en-equipo-por-lider-email";
import { parseLegacyReferenciaNombre } from "./parse-legacy-referencia-nombre";
import {
  REFERENCIAS_ESTRUCTURADAS_KEY,
  buildReferenciasEstructuradasForSave,
} from "./referencias-estructuradas";

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
  expediente?: { telefono_casa?: string | null } | null;
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

function normalizeTelefonoForCompare(value: unknown): string {
  let digits = asString(value).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("52")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits;
}

/**
 * Teléfono de casa dedicado del expediente.
 * Si un legado quedó igual al celular, se muestra vacío para no presentar
 * el mismo número como dos contactos distintos.
 */
export function readTelefonoCasaDistinct(
  telefonoCasaRaw: unknown,
  celularRaw: unknown,
): string | undefined {
  const casa = asString(telefonoCasaRaw).trim();
  if (!casa) return undefined;
  const casaNorm = normalizeTelefonoForCompare(casa);
  const celularNorm = normalizeTelefonoForCompare(celularRaw);
  if (casaNorm && celularNorm && casaNorm === celularNorm) return undefined;
  return casa;
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

function hasStructuredNameParts(obj: {
  nombres?: unknown;
  apellidoPaterno?: unknown;
  apellidoMaterno?: unknown;
} | null): boolean {
  if (!obj) return false;
  return Boolean(
    asString(obj.nombres) ||
      asString(obj.apellidoPaterno) ||
      asString(obj.apellidoMaterno),
  );
}

function mapReferencias(
  datos: Record<string, unknown>,
  referenciasCol: unknown,
): ExpedienteClienteDatos["datos"]["referencias"] {
  const canonicalRaw =
    Array.isArray(referenciasCol) && referenciasCol.length > 0
      ? referenciasCol
      : Array.isArray(datos.referencias)
        ? datos.referencias
        : [];

  const estructuradasRaw = datos[REFERENCIAS_ESTRUCTURADAS_KEY];
  const estructuradas = Array.isArray(estructuradasRaw) ? estructuradasRaw : [];

  const mapped: ExpedienteClienteDatos["datos"]["referencias"] = [];

  for (let i = 0; i < 2; i += 1) {
    const canItem =
      canonicalRaw[i] && typeof canonicalRaw[i] === "object"
        ? (canonicalRaw[i] as ReferenciaJson & {
            nombres?: unknown;
            apellidoPaterno?: unknown;
            apellidoMaterno?: unknown;
          })
        : null;
    const estItem =
      estructuradas[i] && typeof estructuradas[i] === "object"
        ? (estructuradas[i] as Record<string, unknown>)
        : null;

    // Teléfono canónico: columna SQL / referencias normalizadas (prioridad).
    const celularCanonico =
      asString(canItem?.celular) || asString(canItem?.telefono) || "";

    const nombreCanonico = asString(canItem?.nombre);
    const nombreEst = asString(estItem?.nombre);
    const nombre = nombreCanonico || nombreEst;

    const flaggedLegacy = estItem?.legacyGrandfathered === true;

    // Estructura "real previa" = partes en DB sin bandera grandfather (nueva captura / editada).
    const structuredPriorInEst =
      !flaggedLegacy && hasStructuredNameParts(estItem);
    const structuredPriorInCan = hasStructuredNameParts(canItem);
    const hadRealStructuredPrior = structuredPriorInEst || structuredPriorInCan;

    // 1) Estructurado nuevo en p_datos.referenciasEstructuradas
    let nombres = asString(estItem?.nombres);
    let apellidoPaterno = asString(estItem?.apellidoPaterno);
    let apellidoMaterno = asString(estItem?.apellidoMaterno);

    // 2) Si la fila canónica ya trae partes estructuradas
    if (!nombres && !apellidoPaterno && !apellidoMaterno && canItem) {
      nombres = asString(canItem.nombres);
      apellidoPaterno = asString(canItem.apellidoPaterno);
      apellidoMaterno = asString(canItem.apellidoMaterno);
    }

    // 3) Legacy: parsear nombre compuesto con confianza (UI); no cambia origen grandfather.
    if (!nombres && !apellidoPaterno && !apellidoMaterno && nombre) {
      const parsed = parseLegacyReferenciaNombre(nombre);
      if (parsed.parsed) {
        nombres = parsed.nombres;
        apellidoPaterno = parsed.apellidoPaterno;
        apellidoMaterno = parsed.apellidoMaterno;
      }
    }

    // Celular de estructuradas solo si canónico vacío (no reintroducir teléfono viejo).
    const celular =
      celularCanonico ||
      asString(estItem?.celular) ||
      asString(estItem?.telefono);

    // Grandfather: contenido almacenado (nombre+celular, sin estructura real previa).
    // Aunque el parser rellene partes, el origen sigue siendo legacy.
    const legacyGrandfathered =
      flaggedLegacy ||
      (Boolean(nombre.trim()) &&
        Boolean(celular.trim()) &&
        !hadRealStructuredPrior);

    mapped.push({
      nombre,
      nombres: nombres || undefined,
      apellidoPaterno: apellidoPaterno || undefined,
      apellidoMaterno: apellidoMaterno || undefined,
      celular,
      ...(legacyGrandfathered ? { legacyGrandfathered: true } : {}),
    });
  }

  return mapped;
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
  const celular = asString(datos.celular) || asString(datos.telefono);

  return {
    expedienteId: row.expediente_id,
    datos: {
      nombreCliente: asString(datos.nombreCliente),
      nss: asString(datos.nss),
      curp: asString(datos.curp),
      rfc: asString(datos.rfc),
      celular,
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
      // Siempre string ("" si ausente) para ciclo DB ↔ formulario sin perder la clave.
      notaMesa: asString(datos.notaMesa),
      // Legacy sin bloque → defaults seguros (no throw).
      infonavit: mapDatosInfonavitFromUnknown(datos.infonavit),
    },
    porcentajeCobro: asNumber(row.porcentaje_cobro),
    montoCalculado: asNumber(row.monto_calculado),
    metodoPago: row.metodo_pago?.trim() || null,
    estado: normalizeEstado(row.estado),
    imagenes: mapImagenes(row.imagenes),
    telefonoNormalizado: row.telefono_normalizado?.trim() || undefined,
    telefonoCasa: readTelefonoCasaDistinct(
      row.expediente?.telefono_casa,
      row.telefono_normalizado ?? celular,
    ),
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
  options?: {
    montoCalculadoEsManual?: boolean;
    perfilCaptura?: ClienteDatosPerfilCaptura;
  },
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
  p_monto_calculado_manual: number | null;
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
  const silvia = options?.perfilCaptura === "asesor_equipo_silvia_simplificado";
  let montoMejoravitRaw = "";
  let plazo = "";
  if (esMejoravit) {
    montoMejoravitRaw = datos.montoMejoravit.trim();
    const montoMejoravit = parseMontoCalculadoInput(montoMejoravitRaw);
    if (!montoMejoravitRaw || montoMejoravit == null || montoMejoravit <= 0) {
      throw new Error("El monto Mejoravit es obligatorio.");
    }
    plazo = datos.plazo.trim();
    if (!silvia && !plazo) {
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
    if (!silvia || plazo) {
      p_datos.plazo = plazo;
    }
  }
  // Siempre incluir notaMesa: el RPC reemplaza `datos` completo.
  // Omitir la clave al guardar otros campos borraba notas previas.
  p_datos.notaMesa = String(datos.notaMesa ?? "").trim();

  // Internos: conservar nombres/apellidos de refs sin cambiar contrato p_referencias.
  // El RPC sobrescribe `referencias` canónicas; esta clave sí sobrevive en p_datos.
  if (!silvia) {
    p_datos[REFERENCIAS_ESTRUCTURADAS_KEY] = buildReferenciasEstructuradasForSave(
      datos.referencias,
    );
  }

  // P189 B7.1: no autogenerar bloque vacío. Persistir solo si hay captura real.
  if (esMejoravit && hasCapturedInfonavitV1(datos.infonavit)) {
    p_datos.infonavit = serializeInfonavitClienteDatosV1(
      datos.infonavit ?? emptyInfonavitClienteDatosV1(),
    );
  }

  return {
    p_expediente_id: expedienteId,
    p_rfc: datos.rfc.trim(),
    p_telefono: datos.celular.trim(),
    p_referencias: silvia
      ? []
      : datos.referencias.map((ref) => ({
          nombre: ref.nombre.trim(),
          telefono: ref.celular.trim(),
        })),
    p_datos,
    p_estado: "completo",
    p_porcentaje_cobro: pct,
    p_metodo_pago: metodo,
    p_direccion_opcional: direccionOpcional.trim(),
    p_monto_calculado_manual: resolveMontoCalculadoManualForRpc(
      datos.montoCalculado,
      Boolean(options?.montoCalculadoEsManual),
    ),
  };
}
