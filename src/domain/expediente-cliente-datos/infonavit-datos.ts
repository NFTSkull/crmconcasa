/**
 * P189 B2 — bloque semántico `datos.infonavit` (schemaVersion 1).
 * Independiente del renderer B1; no genera PDFs.
 */

/** Capacidad compartida B1 (Presupuesto 4×60; Bajo 4×72). Usar el mínimo. */
export const INFONAVIT_MEJORA_DESCRIPCION_MAX_CHARS = 240;

export const INFONAVIT_DATOS_SCHEMA_VERSION = 1 as const;

export type InfonavitGeneroForm = "M" | "F" | "";
export type InfonavitEstadoCivilForm = "soltero" | "casado" | "";
export type InfonavitRegimenForm =
  | "separacion_bienes"
  | "sociedad_conyugal"
  | "";
export type InfonavitTipoPropiedadForm =
  | "propia"
  | "conyuge_concubino"
  | "familiar"
  | "";

export type InfonavitIdentificacionForm = {
  tipo: string;
  numero: string;
  /** YYYY-MM-DD */
  vigencia: string;
};

export type InfonavitTitularForm = {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  identificacion: InfonavitIdentificacionForm;
  genero: InfonavitGeneroForm;
  estadoCivil: InfonavitEstadoCivilForm;
  regimenMatrimonial: InfonavitRegimenForm;
};

export type InfonavitViviendaForm = {
  tipoPropiedad: InfonavitTipoPropiedadForm;
  localidad: string;
  calle: string;
  numeroExterior: string;
  numeroInterior: string;
  lote: string;
  manzana: string;
  colonia: string;
  entidad: string;
  municipio: string;
  cp: string;
};

export type InfonavitReferenciaForm = {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  lada: string;
  telefono: string;
  celular: string;
};

export type InfonavitBeneficiarioForm = {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  parentesco: string;
};

export type InfonavitMejoraForm = {
  descripcion: string;
  /** Monto textual; independiente de montoMejoravit. */
  presupuestoEstimado: string;
};

export type InfonavitClienteDatosV1 = {
  schemaVersion: typeof INFONAVIT_DATOS_SCHEMA_VERSION;
  titular: InfonavitTitularForm;
  vivienda: InfonavitViviendaForm;
  referencias: [InfonavitReferenciaForm, InfonavitReferenciaForm];
  beneficiario: InfonavitBeneficiarioForm;
  mejora: InfonavitMejoraForm;
};

export function emptyInfonavitIdentificacion(): InfonavitIdentificacionForm {
  return { tipo: "", numero: "", vigencia: "" };
}

export function emptyInfonavitTitular(): InfonavitTitularForm {
  return {
    nombres: "",
    apellidoPaterno: "",
    apellidoMaterno: "",
    identificacion: emptyInfonavitIdentificacion(),
    genero: "",
    estadoCivil: "",
    regimenMatrimonial: "",
  };
}

export function emptyInfonavitVivienda(): InfonavitViviendaForm {
  return {
    tipoPropiedad: "",
    localidad: "",
    calle: "",
    numeroExterior: "",
    numeroInterior: "",
    lote: "",
    manzana: "",
    colonia: "",
    entidad: "",
    municipio: "",
    cp: "",
  };
}

export function emptyInfonavitReferencia(): InfonavitReferenciaForm {
  return {
    nombres: "",
    apellidoPaterno: "",
    apellidoMaterno: "",
    lada: "",
    telefono: "",
    celular: "",
  };
}

export function emptyInfonavitBeneficiario(): InfonavitBeneficiarioForm {
  return {
    nombres: "",
    apellidoPaterno: "",
    apellidoMaterno: "",
    parentesco: "",
  };
}

export function emptyInfonavitMejora(): InfonavitMejoraForm {
  return { descripcion: "", presupuestoEstimado: "" };
}

export function emptyInfonavitClienteDatosV1(): InfonavitClienteDatosV1 {
  return {
    schemaVersion: INFONAVIT_DATOS_SCHEMA_VERSION,
    titular: emptyInfonavitTitular(),
    vivienda: emptyInfonavitVivienda(),
    referencias: [emptyInfonavitReferencia(), emptyInfonavitReferencia()],
    beneficiario: emptyInfonavitBeneficiario(),
    mejora: emptyInfonavitMejora(),
  };
}

/** Une partes de nombre legal (México): nombres + apellidos. No parsea. */
export function joinNombreCompletoInfonavit(parts: {
  nombres?: string | null;
  apellidoPaterno?: string | null;
  apellidoMaterno?: string | null;
}): string {
  return [parts.nombres, parts.apellidoPaterno, parts.apellidoMaterno]
    .map((s) => String(s ?? "").trim())
    .filter((s) => s.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Domicilio estructurado → texto para `expedientes.direccion_opcional`. */
export function formatInfonavitDwellingAddress(
  v: InfonavitViviendaForm,
): string {
  const parts: string[] = [];
  const calle = v.calle.trim();
  const noExt = v.numeroExterior.trim();
  const noInt = v.numeroInterior.trim();
  if (calle) {
    let line = calle;
    if (noExt) line += ` ${noExt}`;
    if (noInt) line += ` Int. ${noInt}`;
    parts.push(line);
  }
  if (v.lote.trim()) parts.push(`Lote ${v.lote.trim()}`);
  if (v.manzana.trim()) parts.push(`Mza ${v.manzana.trim()}`);
  if (v.colonia.trim()) parts.push(`Col. ${v.colonia.trim()}`);
  if (v.municipio.trim()) parts.push(v.municipio.trim());
  if (v.entidad.trim()) parts.push(v.entidad.trim());
  if (v.cp.trim()) parts.push(`CP ${v.cp.trim()}`);
  if (v.localidad.trim() && v.localidad.trim() !== v.municipio.trim()) {
    parts.push(v.localidad.trim());
  }
  return parts.join(", ").replace(/\s+/g, " ").trim();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asGenero(value: unknown): InfonavitGeneroForm {
  return value === "M" || value === "F" ? value : "";
}

function asEstadoCivil(value: unknown): InfonavitEstadoCivilForm {
  return value === "soltero" || value === "casado" ? value : "";
}

function asRegimen(value: unknown): InfonavitRegimenForm {
  return value === "separacion_bienes" || value === "sociedad_conyugal"
    ? value
    : "";
}

function asTipoPropiedad(value: unknown): InfonavitTipoPropiedadForm {
  return value === "propia" ||
    value === "conyuge_concubino" ||
    value === "familiar"
    ? value
    : "";
}

function mapReferencia(raw: unknown): InfonavitReferenciaForm {
  if (!raw || typeof raw !== "object") return emptyInfonavitReferencia();
  const o = raw as Record<string, unknown>;
  return {
    nombres: asString(o.nombres),
    apellidoPaterno: asString(o.apellidoPaterno),
    apellidoMaterno: asString(o.apellidoMaterno),
    lada: asString(o.lada),
    telefono: asString(o.telefono),
    celular: asString(o.celular),
  };
}

/**
 * Mapper seguro: legacy / malformado → defaults vacíos (sin throw).
 * No muta el input.
 */
export function mapDatosInfonavitFromUnknown(
  value: unknown,
): InfonavitClienteDatosV1 {
  const base = emptyInfonavitClienteDatosV1();
  if (!value || typeof value !== "object") return base;
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== 1 && root.schemaVersion !== "1") {
    // Versión desconocida o ausente: defaults seguros (no crash).
    if (root.schemaVersion != null && root.schemaVersion !== 1) return base;
  }

  const titularRaw =
    root.titular && typeof root.titular === "object"
      ? (root.titular as Record<string, unknown>)
      : {};
  const idRaw =
    titularRaw.identificacion && typeof titularRaw.identificacion === "object"
      ? (titularRaw.identificacion as Record<string, unknown>)
      : {};
  const vivRaw =
    root.vivienda && typeof root.vivienda === "object"
      ? (root.vivienda as Record<string, unknown>)
      : {};
  const benRaw =
    root.beneficiario && typeof root.beneficiario === "object"
      ? (root.beneficiario as Record<string, unknown>)
      : {};
  const mejRaw =
    root.mejora && typeof root.mejora === "object"
      ? (root.mejora as Record<string, unknown>)
      : {};
  const refsRaw = Array.isArray(root.referencias) ? root.referencias : [];

  const estadoCivil = asEstadoCivil(titularRaw.estadoCivil);
  let regimen = asRegimen(titularRaw.regimenMatrimonial);
  if (estadoCivil !== "casado") regimen = "";

  return {
    schemaVersion: INFONAVIT_DATOS_SCHEMA_VERSION,
    titular: {
      nombres: asString(titularRaw.nombres),
      apellidoPaterno: asString(titularRaw.apellidoPaterno),
      apellidoMaterno: asString(titularRaw.apellidoMaterno),
      identificacion: {
        tipo: asString(idRaw.tipo),
        numero: asString(idRaw.numero),
        vigencia: asString(idRaw.vigencia),
      },
      genero: asGenero(titularRaw.genero),
      estadoCivil,
      regimenMatrimonial: regimen,
    },
    vivienda: {
      tipoPropiedad: asTipoPropiedad(vivRaw.tipoPropiedad),
      localidad: asString(vivRaw.localidad),
      calle: asString(vivRaw.calle),
      numeroExterior: asString(vivRaw.numeroExterior),
      numeroInterior: asString(vivRaw.numeroInterior),
      lote: asString(vivRaw.lote),
      manzana: asString(vivRaw.manzana),
      colonia: asString(vivRaw.colonia),
      entidad: asString(vivRaw.entidad),
      municipio: asString(vivRaw.municipio),
      cp: asString(vivRaw.cp),
    },
    referencias: [mapReferencia(refsRaw[0]), mapReferencia(refsRaw[1])],
    beneficiario: {
      nombres: asString(benRaw.nombres),
      apellidoPaterno: asString(benRaw.apellidoPaterno),
      apellidoMaterno: asString(benRaw.apellidoMaterno),
      parentesco: asString(benRaw.parentesco),
    },
    mejora: {
      descripcion: asString(mejRaw.descripcion),
      presupuestoEstimado: asString(mejRaw.presupuestoEstimado),
    },
  };
}

/** Serializa para `p_datos.infonavit` (solo strings/enums limpios). */
export function serializeInfonavitClienteDatosV1(
  value: InfonavitClienteDatosV1,
): InfonavitClienteDatosV1 {
  const mapped = mapDatosInfonavitFromUnknown(value);
  if (mapped.titular.estadoCivil !== "casado") {
    mapped.titular.regimenMatrimonial = "";
  }
  return mapped;
}

export function hasStructuredTitularName(t: InfonavitTitularForm): boolean {
  return Boolean(
    t.nombres.trim() && t.apellidoPaterno.trim() && t.apellidoMaterno.trim(),
  );
}

/** True si hay datos P189 realmente capturados (no el default vacío de schemaVersion 1). */
export function hasCapturedInfonavitV1(
  inf: InfonavitClienteDatosV1 | null | undefined,
): boolean {
  if (!inf || Number(inf.schemaVersion) !== 1) return false;
  const values: string[] = [
    inf.titular.nombres,
    inf.titular.apellidoPaterno,
    inf.titular.apellidoMaterno,
    inf.titular.identificacion.tipo,
    inf.titular.identificacion.numero,
    inf.titular.identificacion.vigencia,
    inf.titular.genero,
    inf.titular.estadoCivil,
    inf.titular.regimenMatrimonial,
    inf.vivienda.tipoPropiedad,
    inf.vivienda.localidad,
    inf.vivienda.calle,
    inf.vivienda.numeroExterior,
    inf.vivienda.numeroInterior,
    inf.vivienda.lote,
    inf.vivienda.manzana,
    inf.vivienda.colonia,
    inf.vivienda.entidad,
    inf.vivienda.municipio,
    inf.vivienda.cp,
    inf.referencias[0]?.nombres ?? "",
    inf.referencias[0]?.apellidoPaterno ?? "",
    inf.referencias[0]?.apellidoMaterno ?? "",
    inf.referencias[0]?.lada ?? "",
    inf.referencias[0]?.telefono ?? "",
    inf.referencias[0]?.celular ?? "",
    inf.referencias[1]?.nombres ?? "",
    inf.referencias[1]?.apellidoPaterno ?? "",
    inf.referencias[1]?.apellidoMaterno ?? "",
    inf.referencias[1]?.lada ?? "",
    inf.referencias[1]?.telefono ?? "",
    inf.referencias[1]?.celular ?? "",
    inf.beneficiario.nombres,
    inf.beneficiario.apellidoPaterno,
    inf.beneficiario.apellidoMaterno,
    inf.beneficiario.parentesco,
    inf.mejora.descripcion,
    inf.mejora.presupuestoEstimado,
  ];
  return values.some((v) => String(v ?? "").trim().length > 0);
}
