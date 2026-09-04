import {
  clienteDatosRequiereTelefonoCasa,
  isClienteDatosPerfilPendiente,
  type ClienteDatosPerfilCaptura,
} from "@/domain/asesor-equipo/asesor-en-equipo-por-lider-email";
import type { ClienteDatosFormShape } from "@/lib/clienteDatosFormCompleteness";
import {
  calcMontoCalculadoCobro,
  isProgramaMejoravitDb,
  parseMontoCalculadoInput,
  parsePorcentajeCobroInput,
} from "@/lib/clienteDatosCobro";
import {
  MSJ_DIGITS_ONLY,
  MSJ_PERSON_NAME_INVALID,
  isValidPersonName,
  normalizeDigitsOnly,
  normalizePersonName,
} from "@/lib/clienteDatosFieldFormats";
import {
  INFONAVIT_MEJORA_DESCRIPCION_MAX_CHARS,
  emptyInfonavitClienteDatosV1,
  formatInfonavitDwellingAddress,
  hasStructuredTitularName,
  joinNombreCompletoInfonavit,
  serializeInfonavitClienteDatosV1,
  type InfonavitClienteDatosV1,
} from "@/domain/expediente-cliente-datos/infonavit-datos";
import {
  combineLadaTelefonoMexico,
  findDuplicateTelefonosIntraExpediente,
  type TelefonoUnicidadEntry,
  type TelefonoUnicidadSlot,
} from "@/domain/expediente-cliente-datos/infonavit-telefonos";

export {
  MSJ_DIGITS_ONLY,
  MSJ_PERSON_NAME_INVALID,
  filterDigitsInput,
  filterPersonNameInput,
  isValidPersonName,
  normalizeDigitsOnly,
  normalizePersonName,
} from "@/lib/clienteDatosFieldFormats";

export const MSJ_DOMICILIO_REAL_OBLIGATORIO =
  "El domicilio real del cliente es obligatorio.";

export type ClienteDatosValidationContext = {
  montoAprobado?: number | null;
  direccionOpcional?: string | null;
  programaDb?: string | null;
  /** P189: exigir bloque infonavit. Default false = validación base + formatos opcionales. */
  requireInfonavit?: boolean;
  /**
   * Solo `asesor_equipo_silvia_simplificado` cuando el dueño confirmó membresía.
   * Fail-closed: omitido → validación completa.
   */
  perfilCaptura?: ClienteDatosPerfilCaptura;
  /** Solo internos. Externos (perfil silvia) no validan este campo aquí. */
  telefonoCasa?: string;
};

export type ClienteDatosFieldKey =
  | "nombreCliente"
  | "nss"
  | "curp"
  | "rfc"
  | "celular"
  | "correo"
  | "empresa"
  | "registroPatronal"
  | "telefonoEmpresa"
  | "referencia1Nombre"
  | "referencia1Nombres"
  | "referencia1ApellidoPaterno"
  | "referencia1ApellidoMaterno"
  | "referencia1Celular"
  | "referencia2Nombre"
  | "referencia2Nombres"
  | "referencia2ApellidoPaterno"
  | "referencia2ApellidoMaterno"
  | "referencia2Celular"
  | "telefonoCasa"
  | "beneficiarioNombre"
  | "beneficiarioParentesco"
  | "direccionCalle"
  | "direccionColonia"
  | "direccionMunicipio"
  | "direccionCp"
  | "direccionOpcional"
  | "montoMejoravit"
  | "plazo"
  | "porcentajeCobro"
  | "montoCalculado"
  | "metodoPago"
  // P189 B2
  | "infonavitTitularNombres"
  | "infonavitTitularApellidoPaterno"
  | "infonavitTitularApellidoMaterno"
  | "infonavitIdTipo"
  | "infonavitIdNumero"
  | "infonavitIdVigencia"
  | "infonavitGenero"
  | "infonavitEstadoCivil"
  | "infonavitRegimen"
  | "infonavitViviendaTipoPropiedad"
  | "infonavitViviendaLocalidad"
  | "infonavitViviendaCalle"
  | "infonavitViviendaNumeroExterior"
  | "infonavitViviendaNumeroInterior"
  | "infonavitViviendaLote"
  | "infonavitViviendaManzana"
  | "infonavitViviendaColonia"
  | "infonavitViviendaEntidad"
  | "infonavitViviendaMunicipio"
  | "infonavitViviendaCp"
  | "infonavitRef1Nombres"
  | "infonavitRef1ApellidoPaterno"
  | "infonavitRef1ApellidoMaterno"
  | "infonavitRef1Lada"
  | "infonavitRef1Telefono"
  | "infonavitRef1Celular"
  | "infonavitRef2Nombres"
  | "infonavitRef2ApellidoPaterno"
  | "infonavitRef2ApellidoMaterno"
  | "infonavitRef2Lada"
  | "infonavitRef2Telefono"
  | "infonavitRef2Celular"
  | "infonavitBeneficiarioNombres"
  | "infonavitBeneficiarioApellidoPaterno"
  | "infonavitBeneficiarioApellidoMaterno"
  | "infonavitBeneficiarioParentesco"
  | "infonavitMejoraDescripcion"
  | "infonavitMejoraPresupuesto";

export type ClienteDatosFieldErrors = Partial<Record<ClienteDatosFieldKey, string>>;

export type ClienteDatosValidationResult = Readonly<{
  errors: ClienteDatosFieldErrors;
  messages: string[];
  isValid: boolean;
}>;

const CURP_RE = /^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[0-9A-Z][0-9]$/;
const RFC_RE = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normaliza teléfono MX (espacios, guiones, +52). */
export function normalizeTelefonoMexico(input: string): string {
  let digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("52")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits;
}

function isTelefonoMexicoValido(input: string): boolean {
  const norm = normalizeTelefonoMexico(input);
  return /^[0-9]{10}$/.test(norm);
}

function isRfcMexicoValido(rfc: string): boolean {
  const v = rfc.trim().toUpperCase();
  return (v.length === 12 || v.length === 13) && RFC_RE.test(v);
}

function isCurpMexicoValida(curp: string): boolean {
  return CURP_RE.test(curp.trim().toUpperCase());
}

function setError(
  errors: ClienteDatosFieldErrors,
  key: ClienteDatosFieldKey,
  message: string,
): void {
  if (!errors[key]) errors[key] = message;
}

function reqText(value: string, label: string): string | null {
  return String(value ?? "").trim() ? null : `${label} es obligatorio.`;
}

function normalizeInfonavitBlock(
  raw: InfonavitClienteDatosV1 | undefined,
): InfonavitClienteDatosV1 {
  const base = serializeInfonavitClienteDatosV1(
    raw ?? emptyInfonavitClienteDatosV1(),
  );
  const normRef = (r: InfonavitClienteDatosV1["referencias"][0]) => ({
    nombres: normalizePersonName(r.nombres),
    apellidoPaterno: normalizePersonName(r.apellidoPaterno),
    apellidoMaterno: normalizePersonName(r.apellidoMaterno),
    lada: normalizeDigitsOnly(r.lada),
    telefono: normalizeDigitsOnly(r.telefono),
    celular: normalizeTelefonoMexico(r.celular),
  });
  base.titular = {
    ...base.titular,
    nombres: normalizePersonName(base.titular.nombres),
    apellidoPaterno: normalizePersonName(base.titular.apellidoPaterno),
    apellidoMaterno: normalizePersonName(base.titular.apellidoMaterno),
    identificacion: {
      tipo: String(base.titular.identificacion.tipo ?? "").trim(),
      numero: String(base.titular.identificacion.numero ?? "").trim(),
      vigencia: String(base.titular.identificacion.vigencia ?? "").trim(),
    },
  };
  if (base.titular.estadoCivil !== "casado") {
    base.titular.regimenMatrimonial = "";
  }
  base.vivienda = {
    ...base.vivienda,
    localidad: String(base.vivienda.localidad ?? "").trim(),
    calle: String(base.vivienda.calle ?? "").trim(),
    numeroExterior: String(base.vivienda.numeroExterior ?? "").trim(),
    numeroInterior: String(base.vivienda.numeroInterior ?? "").trim(),
    lote: String(base.vivienda.lote ?? "").trim(),
    manzana: String(base.vivienda.manzana ?? "").trim(),
    colonia: String(base.vivienda.colonia ?? "").trim(),
    entidad: String(base.vivienda.entidad ?? "").trim(),
    municipio: String(base.vivienda.municipio ?? "").trim(),
    cp: normalizeDigitsOnly(base.vivienda.cp),
  };
  base.referencias = [normRef(base.referencias[0]), normRef(base.referencias[1])];
  base.beneficiario = {
    nombres: normalizePersonName(base.beneficiario.nombres),
    apellidoPaterno: normalizePersonName(base.beneficiario.apellidoPaterno),
    apellidoMaterno: normalizePersonName(base.beneficiario.apellidoMaterno),
    parentesco: normalizePersonName(base.beneficiario.parentesco),
  };
  base.mejora = {
    descripcion: String(base.mejora.descripcion ?? "").trim().replace(/\s+/g, " "),
    presupuestoEstimado: String(base.mejora.presupuestoEstimado ?? "").trim(),
  };
  return base;
}

/**
 * Sincroniza legacy desde `datos.infonavit` (Mejoravit).
 * No parsea nombreCliente → estructurado.
 */
export function syncLegacyFromInfonavit(
  d: ClienteDatosFormShape,
): ClienteDatosFormShape {
  const inf = normalizeInfonavitBlock(d.infonavit);
  const nombreTitular = joinNombreCompletoInfonavit(inf.titular);
  const refs = [
    {
      nombre: joinNombreCompletoInfonavit(inf.referencias[0]),
      celular: inf.referencias[0].celular,
    },
    {
      nombre: joinNombreCompletoInfonavit(inf.referencias[1]),
      celular: inf.referencias[1].celular,
    },
  ];
  const benefNombre = joinNombreCompletoInfonavit(inf.beneficiario);
  return {
    ...d,
    infonavit: inf,
    nombreCliente: nombreTitular || normalizePersonName(d.nombreCliente),
    referencias: refs,
    beneficiario: {
      nombre: benefNombre || normalizePersonName(d.beneficiario?.nombre ?? ""),
      parentesco:
        inf.beneficiario.parentesco ||
        normalizePersonName(d.beneficiario?.parentesco ?? ""),
    },
  };
}

/** Mayúsculas en CURP/RFC; nombres/dígitos normalizados (P133). */
export function normalizeClienteDatosForSave(
  d: ClienteDatosFormShape,
): ClienteDatosFormShape {
  // P189 B8 Mesa-only: infonavit no es autoridad de los campos históricos
  // (nombre, referencias, beneficiario). Conservar valores visibles del formulario.
  const working: ClienteDatosFormShape = { ...d };

  const refs = (working.referencias ?? []).map((r) => {
    const nombres = normalizePersonName(String(r?.nombres ?? ""));
    const apellidoPaterno = normalizePersonName(String(r?.apellidoPaterno ?? ""));
    const apellidoMaterno = normalizePersonName(String(r?.apellidoMaterno ?? ""));
    const composed = [nombres, apellidoPaterno, apellidoMaterno]
      .filter(Boolean)
      .join(" ")
      .trim();
    const nombreLegacy = normalizePersonName(String(r?.nombre ?? ""));
    return {
      ...r,
      nombres,
      apellidoPaterno,
      apellidoMaterno,
      nombre: composed || nombreLegacy,
      celular: normalizeTelefonoMexico(String(r?.celular ?? "")),
    };
  });
  return {
    ...working,
    nombreCliente: normalizePersonName(String(working.nombreCliente ?? "")),
    nss: normalizeDigitsOnly(String(working.nss ?? "")),
    curp: String(working.curp ?? "").trim().toUpperCase(),
    rfc: String(working.rfc ?? "").trim().toUpperCase().replace(/\s+/g, ""),
    celular: normalizeTelefonoMexico(String(working.celular ?? "")),
    telefonoEmpresa: normalizeTelefonoMexico(String(working.telefonoEmpresa ?? "")),
    referencias: refs.length >= 2 ? refs : [
      refs[0] ?? { nombre: "", celular: "" },
      refs[1] ?? { nombre: "", celular: "" },
    ],
    beneficiario: {
      nombre: normalizePersonName(String(working.beneficiario?.nombre ?? "")),
      parentesco: normalizePersonName(String(working.beneficiario?.parentesco ?? "")),
    },
    direccionEmpresa: {
      ...working.direccionEmpresa,
      cp: normalizeDigitsOnly(String(working.direccionEmpresa?.cp ?? "")),
    },
    porcentajeCobro: String(working.porcentajeCobro ?? "").trim(),
    montoCalculado: String(working.montoCalculado ?? "").trim(),
    metodoPago: String(working.metodoPago ?? "").trim().toLowerCase(),
    montoMejoravit: String(working.montoMejoravit ?? "").trim(),
    plazo: normalizeDigitsOnly(String(working.plazo ?? "")),
    notaMesa: String(working.notaMesa ?? "").trim(),
    infonavit: working.infonavit
      ? normalizeInfonavitBlock(working.infonavit)
      : undefined,
  };
}

const SLOT_TO_FIELD: Record<TelefonoUnicidadSlot, ClienteDatosFieldKey> = {
  "cliente.celular": "celular",
  "cliente.telefonoCasa": "telefonoCasa",
  "empresa.telefono": "telefonoEmpresa",
  "ref1.telefonoCompleto": "infonavitRef1Telefono",
  "ref1.celular": "infonavitRef1Celular",
  "ref2.telefonoCompleto": "infonavitRef2Telefono",
  "ref2.celular": "infonavitRef2Celular",
};

const SLOT_LABEL: Record<TelefonoUnicidadSlot, string> = {
  "cliente.celular": "celular del cliente",
  "cliente.telefonoCasa": "teléfono de casa",
  "empresa.telefono": "teléfono empresa",
  "ref1.telefonoCompleto": "teléfono fijo de referencia 1",
  "ref1.celular": "celular de referencia 1",
  "ref2.telefonoCompleto": "teléfono fijo de referencia 2",
  "ref2.celular": "celular de referencia 2",
};

/**
 * Validación cliente-side alineada a campos obligatorios actuales y reglas de formato.
 * No valida duplicados globales entre expedientes (solo dentro del formulario).
 */
export function validateClienteDatos(
  d: ClienteDatosFormShape,
  ctx: ClienteDatosValidationContext = {},
): ClienteDatosValidationResult {
  const errors: ClienteDatosFieldErrors = {};
  // UNKNOWN ≠ INTERNO: no aplicar B1–B5 ni marcar válido.
  if (isClienteDatosPerfilPendiente(ctx.perfilCaptura)) {
    return {
      isValid: false,
      errors,
      messages: ["Validando perfil del expediente"],
    };
  }
  const data = normalizeClienteDatosForSave(d);
  const esMejoravit = isProgramaMejoravitDb(ctx.programaDb);
  const silvia = ctx.perfilCaptura === "asesor_equipo_silvia_simplificado";
  const requireInfonavit =
    !silvia && Boolean(ctx.requireInfonavit) && esMejoravit;

  const req = (key: ClienteDatosFieldKey, value: string, label: string) => {
    const msg = reqText(value, label);
    if (msg) setError(errors, key, msg);
  };

  if (requireInfonavit) {
    const inf = data.infonavit ?? emptyInfonavitClienteDatosV1();
    req("infonavitTitularNombres", inf.titular.nombres, "Nombre(s)");
    req(
      "infonavitTitularApellidoPaterno",
      inf.titular.apellidoPaterno,
      "Apellido paterno",
    );
    req(
      "infonavitTitularApellidoMaterno",
      inf.titular.apellidoMaterno,
      "Apellido materno",
    );
    req("infonavitIdTipo", inf.titular.identificacion.tipo, "Tipo de identificación");
    req(
      "infonavitIdNumero",
      inf.titular.identificacion.numero,
      "Número de identificación",
    );
    req(
      "infonavitIdVigencia",
      inf.titular.identificacion.vigencia,
      "Vigencia de identificación",
    );
    if (!errors.infonavitIdVigencia) {
      const vig = inf.titular.identificacion.vigencia;
      if (!YMD_RE.test(vig)) {
        setError(
          errors,
          "infonavitIdVigencia",
          "Vigencia debe ser una fecha válida (AAAA-MM-DD).",
        );
      } else {
        const [y, m, day] = vig.split("-").map(Number);
        const probe = new Date(Date.UTC(y!, m! - 1, day!));
        if (
          probe.getUTCFullYear() !== y ||
          probe.getUTCMonth() !== m! - 1 ||
          probe.getUTCDate() !== day
        ) {
          setError(
            errors,
            "infonavitIdVigencia",
            "Vigencia debe ser una fecha válida (AAAA-MM-DD).",
          );
        }
      }
    }
    if (!inf.titular.genero) {
      setError(errors, "infonavitGenero", "Género es obligatorio.");
    }
    if (!inf.titular.estadoCivil) {
      setError(errors, "infonavitEstadoCivil", "Estado civil es obligatorio.");
    }
    if (inf.titular.estadoCivil === "casado" && !inf.titular.regimenMatrimonial) {
      setError(
        errors,
        "infonavitRegimen",
        "Régimen matrimonial es obligatorio si el estado civil es casado.",
      );
    }

    const v = inf.vivienda;
    if (!v.tipoPropiedad) {
      setError(
        errors,
        "infonavitViviendaTipoPropiedad",
        "Tipo de propiedad es obligatorio.",
      );
    }
    req("infonavitViviendaLocalidad", v.localidad, "Localidad / ciudad");
    req("infonavitViviendaCalle", v.calle, "Calle de la vivienda");
    req(
      "infonavitViviendaNumeroExterior",
      v.numeroExterior,
      "Número exterior",
    );
    req("infonavitViviendaColonia", v.colonia, "Colonia");
    req("infonavitViviendaEntidad", v.entidad, "Entidad federativa");
    req("infonavitViviendaMunicipio", v.municipio, "Municipio / alcaldía");
    req("infonavitViviendaCp", v.cp, "CP de la vivienda");
    if (!errors.infonavitViviendaCp && !/^\d{5}$/.test(v.cp)) {
      setError(errors, "infonavitViviendaCp", "CP debe tener 5 dígitos.");
    }

    const validateRef = (
      idx: 0 | 1,
      prefix: "infonavitRef1" | "infonavitRef2",
    ) => {
      const r = inf.referencias[idx];
      req(`${prefix}Nombres` as ClienteDatosFieldKey, r.nombres, `Nombre(s) referencia ${idx + 1}`);
      req(
        `${prefix}ApellidoPaterno` as ClienteDatosFieldKey,
        r.apellidoPaterno,
        `Apellido paterno referencia ${idx + 1}`,
      );
      req(
        `${prefix}ApellidoMaterno` as ClienteDatosFieldKey,
        r.apellidoMaterno,
        `Apellido materno referencia ${idx + 1}`,
      );
      req(`${prefix}Lada` as ClienteDatosFieldKey, r.lada, `LADA referencia ${idx + 1}`);
      req(
        `${prefix}Telefono` as ClienteDatosFieldKey,
        r.telefono,
        `Teléfono referencia ${idx + 1}`,
      );
      req(
        `${prefix}Celular` as ClienteDatosFieldKey,
        r.celular,
        `Celular referencia ${idx + 1}`,
      );
      const ladaKey = `${prefix}Lada` as ClienteDatosFieldKey;
      const telKey = `${prefix}Telefono` as ClienteDatosFieldKey;
      if (!errors[ladaKey] && !errors[telKey]) {
        const comb = combineLadaTelefonoMexico(r.lada, r.telefono);
        if (!comb.ok) {
          setError(
            errors,
            telKey,
            `LADA + teléfono de referencia ${idx + 1} deben sumar 10 dígitos (LADA 2–3).`,
          );
        }
      }
      const celKey = `${prefix}Celular` as ClienteDatosFieldKey;
      if (!errors[celKey] && !isTelefonoMexicoValido(r.celular)) {
        setError(
          errors,
          celKey,
          `Celular de referencia ${idx + 1} debe tener 10 dígitos.`,
        );
      }
    };
    validateRef(0, "infonavitRef1");
    validateRef(1, "infonavitRef2");

    req(
      "infonavitBeneficiarioNombres",
      inf.beneficiario.nombres,
      "Beneficiario — nombre(s)",
    );
    req(
      "infonavitBeneficiarioApellidoPaterno",
      inf.beneficiario.apellidoPaterno,
      "Beneficiario — apellido paterno",
    );
    req(
      "infonavitBeneficiarioApellidoMaterno",
      inf.beneficiario.apellidoMaterno,
      "Beneficiario — apellido materno",
    );
    req(
      "infonavitBeneficiarioParentesco",
      inf.beneficiario.parentesco,
      "Beneficiario — parentesco",
    );

    req(
      "infonavitMejoraDescripcion",
      inf.mejora.descripcion,
      "Descripción de la mejora",
    );
    if (
      !errors.infonavitMejoraDescripcion &&
      inf.mejora.descripcion.length > INFONAVIT_MEJORA_DESCRIPCION_MAX_CHARS
    ) {
      setError(
        errors,
        "infonavitMejoraDescripcion",
        `La descripción de la mejora no puede superar ${INFONAVIT_MEJORA_DESCRIPCION_MAX_CHARS} caracteres.`,
      );
    }
    req(
      "infonavitMejoraPresupuesto",
      inf.mejora.presupuestoEstimado,
      "Presupuesto estimado de la mejora",
    );
    if (!errors.infonavitMejoraPresupuesto) {
      const presupuesto = parseMontoCalculadoInput(inf.mejora.presupuestoEstimado);
      if (presupuesto == null || presupuesto <= 0) {
        setError(
          errors,
          "infonavitMejoraPresupuesto",
          "El presupuesto estimado debe ser mayor a 0.",
        );
      }
    }

    // nombreCliente se deriva; si falta estructurado ya hay errores.
    if (!hasStructuredTitularName(inf.titular) && !data.nombreCliente.trim()) {
      setError(errors, "nombreCliente", "Nombre del cliente es obligatorio.");
    }
  } else {
    req("nombreCliente", data.nombreCliente, "Nombre del cliente");
    if (!silvia) {
      for (const [idx, prefix] of [
        [0, "referencia1"],
        [1, "referencia2"],
      ] as const) {
        const r = data.referencias[idx] ?? { nombre: "", celular: "" };
        const nombres = String(r.nombres ?? "").trim();
        const apPat = String(r.apellidoPaterno ?? "").trim();
        const apMat = String(r.apellidoMaterno ?? "").trim();
        // Históricos: si solo hay `nombre` combinado, aún exigimos partes al completar.
        req(
          `${prefix}Nombres` as ClienteDatosFieldKey,
          nombres,
          `Nombre(s) de referencia ${idx + 1}`,
        );
        req(
          `${prefix}ApellidoPaterno` as ClienteDatosFieldKey,
          apPat,
          `Primer apellido de referencia ${idx + 1}`,
        );
        req(
          `${prefix}ApellidoMaterno` as ClienteDatosFieldKey,
          apMat,
          `Segundo apellido de referencia ${idx + 1}`,
        );
        req(
          `${prefix}Celular` as ClienteDatosFieldKey,
          r.celular ?? "",
          `Celular de referencia ${idx + 1}`,
        );
      }
      req("beneficiarioNombre", data.beneficiario.nombre, "Beneficiario — nombre");
      req("beneficiarioParentesco", data.beneficiario.parentesco, "Beneficiario — parentesco");
    }
  }

  if (esMejoravit && !requireInfonavit) {
    const infOpt = data.infonavit ?? emptyInfonavitClienteDatosV1();
    const vig = infOpt.titular.identificacion.vigencia.trim();
    if (vig) {
      if (!YMD_RE.test(vig)) {
        setError(
          errors,
          "infonavitIdVigencia",
          "Vigencia debe ser una fecha válida (AAAA-MM-DD).",
        );
      }
    }
    const cpOpt = infOpt.vivienda.cp.trim();
    if (cpOpt && !/^\d{5}$/.test(cpOpt)) {
      setError(errors, "infonavitViviendaCp", "CP debe tener 5 dígitos.");
    }
    const descOpt = infOpt.mejora.descripcion.trim();
    if (descOpt.length > INFONAVIT_MEJORA_DESCRIPCION_MAX_CHARS) {
      setError(
        errors,
        "infonavitMejoraDescripcion",
        `La descripción de la mejora no puede superar ${INFONAVIT_MEJORA_DESCRIPCION_MAX_CHARS} caracteres.`,
      );
    }
    const presOpt = infOpt.mejora.presupuestoEstimado.trim();
    if (presOpt) {
      const presupuesto = parseMontoCalculadoInput(presOpt);
      if (presupuesto == null || presupuesto <= 0) {
        setError(
          errors,
          "infonavitMejoraPresupuesto",
          "El presupuesto estimado debe ser mayor a 0.",
        );
      }
    }
    for (const idx of [0, 1] as const) {
      const r = infOpt.referencias[idx];
      const prefix = idx === 0 ? "infonavitRef1" : "infonavitRef2";
      const hasLada = Boolean(r.lada.trim());
      const hasTel = Boolean(r.telefono.trim());
      if (hasLada || hasTel) {
        const comb = combineLadaTelefonoMexico(r.lada, r.telefono);
        if (!comb.ok) {
          setError(
            errors,
            `${prefix}Telefono` as ClienteDatosFieldKey,
            `LADA + teléfono de referencia ${idx + 1} deben sumar 10 dígitos (LADA 2–3).`,
          );
        }
      }
      if (r.celular.trim() && !isTelefonoMexicoValido(r.celular)) {
        setError(
          errors,
          `${prefix}Celular` as ClienteDatosFieldKey,
          `Celular de referencia ${idx + 1} debe tener 10 dígitos.`,
        );
      }
    }
  }

  req("nss", data.nss, "NSS");
  req("curp", data.curp, "CURP");
  req("celular", data.celular, "Celular");
  if (!silvia) {
    req("correo", data.correo, "Correo");
    req("empresa", data.empresa, "Empresa");
    req("registroPatronal", data.registroPatronal, "Registro patronal");
    req("telefonoEmpresa", data.telefonoEmpresa, "Teléfono empresa");
  }

  req("direccionCalle", data.direccionEmpresa.calle, "Calle de la empresa");
  req("direccionColonia", data.direccionEmpresa.colonia, "Colonia de la empresa");
  req("direccionMunicipio", data.direccionEmpresa.municipio, "Municipio de la empresa");
  req("direccionCp", data.direccionEmpresa.cp, "CP");

  const domicilioReal = String(ctx.direccionOpcional ?? "").trim();
  if (requireInfonavit) {
    // Vivienda estructurada alimenta domicilio; si hay CP/calle OK no exigir texto libre vacío.
    const viv = data.infonavit?.vivienda;
    const vivOk = Boolean(
      viv?.calle?.trim() &&
        viv?.numeroExterior?.trim() &&
        viv?.colonia?.trim() &&
        viv?.municipio?.trim() &&
        viv?.cp?.trim(),
    );
    if (!vivOk && !domicilioReal) {
      setError(errors, "direccionOpcional", MSJ_DOMICILIO_REAL_OBLIGATORIO);
    }
  } else if (!domicilioReal) {
    setError(errors, "direccionOpcional", MSJ_DOMICILIO_REAL_OBLIGATORIO);
  }

  if (esMejoravit) {
    const montoMejoravitRaw = String(data.montoMejoravit ?? "").trim();
    if (!montoMejoravitRaw) {
      setError(errors, "montoMejoravit", "El monto Mejoravit es obligatorio.");
    } else {
      const montoMejoravit = parseMontoCalculadoInput(montoMejoravitRaw);
      if (montoMejoravit == null || montoMejoravit <= 0) {
        setError(errors, "montoMejoravit", "El monto Mejoravit es obligatorio.");
      }
    }

    const plazoRaw = String(d.plazo ?? "").trim();
    if (!silvia) {
      if (!plazoRaw) {
        setError(errors, "plazo", "El plazo es obligatorio.");
      } else if (!/^\d+$/.test(plazoRaw)) {
        setError(errors, "plazo", MSJ_DIGITS_ONLY);
      }
    } else if (plazoRaw && !/^\d+$/.test(plazoRaw)) {
      setError(errors, "plazo", MSJ_DIGITS_ONLY);
    }
  } else {
    const plazoRaw = String(d.plazo ?? "").trim();
    if (plazoRaw && !/^\d+$/.test(plazoRaw)) {
      setError(errors, "plazo", MSJ_DIGITS_ONLY);
    }
  }

  req("porcentajeCobro", data.porcentajeCobro, "Porcentaje de cobro");
  req("metodoPago", data.metodoPago, "Método de pago");

  if (!errors.porcentajeCobro) {
    const pct = parsePorcentajeCobroInput(data.porcentajeCobro);
    if (pct == null) {
      setError(errors, "porcentajeCobro", "Porcentaje de cobro no es válido.");
    } else if (pct <= 0) {
      setError(errors, "porcentajeCobro", "Porcentaje de cobro debe ser mayor a 0.");
    } else if (pct > 100) {
      setError(errors, "porcentajeCobro", "Porcentaje de cobro no puede ser mayor a 100.");
    }
  }

  const montoAprobado = ctx.montoAprobado;
  const pctVal = parsePorcentajeCobroInput(data.porcentajeCobro);
  if (!errors.montoCalculado) {
    const montoVal = parseMontoCalculadoInput(data.montoCalculado);
    if (montoVal == null || montoVal <= 0) {
      const auto =
        pctVal != null && pctVal > 0
          ? calcMontoCalculadoCobro(montoAprobado, pctVal, {
              programaDb: ctx.programaDb,
              montoMejoravitForm: data.montoMejoravit,
            })
          : null;
      if (auto == null) {
        if (esMejoravit) {
          setError(
            errors,
            "montoCalculado",
            "Captura el monto calculado o permite que se calcule automáticamente.",
          );
        } else if (
          montoAprobado == null ||
          !Number.isFinite(montoAprobado) ||
          montoAprobado <= 0
        ) {
          setError(
            errors,
            "montoCalculado",
            "No hay monto aprobado para calcular el cobro.",
          );
        } else {
          setError(
            errors,
            "montoCalculado",
            "Captura el monto calculado o permite que se calcule automáticamente.",
          );
        }
      } else {
        setError(
          errors,
          "montoCalculado",
          "Captura el monto calculado o permite que se calcule automáticamente.",
        );
      }
    }
  }

  const personNameFields: ReadonlyArray<{
    key: ClienteDatosFieldKey;
    raw: string;
  }> = silvia
    ? [{ key: "nombreCliente", raw: data.nombreCliente }]
    : esMejoravit
    ? [
        {
          key: "infonavitTitularNombres",
          raw: data.infonavit?.titular.nombres ?? "",
        },
        {
          key: "infonavitTitularApellidoPaterno",
          raw: data.infonavit?.titular.apellidoPaterno ?? "",
        },
        {
          key: "infonavitTitularApellidoMaterno",
          raw: data.infonavit?.titular.apellidoMaterno ?? "",
        },
        {
          key: "infonavitBeneficiarioParentesco",
          raw: data.infonavit?.beneficiario.parentesco ?? "",
        },
      ]
    : [
        { key: "nombreCliente", raw: data.nombreCliente },
        { key: "referencia1Nombre", raw: data.referencias[0]?.nombre ?? "" },
        { key: "referencia2Nombre", raw: data.referencias[1]?.nombre ?? "" },
        { key: "beneficiarioNombre", raw: data.beneficiario.nombre },
        { key: "beneficiarioParentesco", raw: data.beneficiario.parentesco },
      ];
  for (const field of personNameFields) {
    if (errors[field.key]) continue;
    if (field.raw && !isValidPersonName(field.raw)) {
      setError(errors, field.key, MSJ_PERSON_NAME_INVALID);
    }
  }

  if (!errors.nss && !/^\d{11}$/.test(normalizeDigitsOnly(data.nss))) {
    setError(errors, "nss", "NSS debe tener 11 dígitos.");
  }

  if (!errors.curp && !isCurpMexicoValida(data.curp)) {
    setError(errors, "curp", "CURP no tiene formato válido.");
  }

  if (data.rfc.trim() && !errors.rfc && !isRfcMexicoValido(data.rfc)) {
    setError(errors, "rfc", "RFC no tiene formato válido.");
  }

  if (
    !silvia &&
    data.correo.trim() &&
    !errors.correo &&
    !EMAIL_RE.test(data.correo.trim())
  ) {
    setError(errors, "correo", "Correo no tiene formato válido.");
  }

  if (!errors.direccionCp && !/^\d{5}$/.test(normalizeDigitsOnly(data.direccionEmpresa.cp))) {
    setError(errors, "direccionCp", "CP debe tener 5 dígitos.");
  }

  // Teléfonos base
  if (!errors.celular && !isTelefonoMexicoValido(data.celular)) {
    setError(errors, "celular", "Celular debe tener 10 dígitos.");
  }
  if (
    !silvia &&
    !errors.telefonoEmpresa &&
    !isTelefonoMexicoValido(data.telefonoEmpresa)
  ) {
    setError(errors, "telefonoEmpresa", "Teléfono empresa debe tener 10 dígitos.");
  }

  if (!silvia && !requireInfonavit) {
    for (const [idx, key] of [
      [0, "referencia1Celular"],
      [1, "referencia2Celular"],
    ] as const) {
      if (errors[key]) continue;
      const raw = data.referencias[idx]?.celular ?? "";
      if (!isTelefonoMexicoValido(raw)) {
        setError(errors, key, `Celular de referencia ${idx + 1} debe tener 10 dígitos.`);
      }
    }
  }

  // Teléfono de casa: solo internos resueltos (`clienteDatosRequiereTelefonoCasa`).
  if (
    clienteDatosRequiereTelefonoCasa(ctx.perfilCaptura) &&
    ctx.telefonoCasa !== undefined
  ) {
    const casa = String(ctx.telefonoCasa ?? "").trim();
    req("telefonoCasa", casa, "Teléfono de casa");
    if (!errors.telefonoCasa && casa && !isTelefonoMexicoValido(casa)) {
      setError(errors, "telefonoCasa", "Teléfono de casa debe tener 10 dígitos.");
    }
    if (!errors.telefonoCasa && !errors.celular && casa) {
      const celNorm = normalizeTelefonoMexico(data.celular);
      const casaNorm = normalizeTelefonoMexico(casa);
      if (celNorm && casaNorm && celNorm === casaNorm) {
        setError(
          errors,
          "telefonoCasa",
          "El teléfono de casa no puede ser igual al celular principal.",
        );
      }
    }
  }

  // Unicidad intra-expediente (matriz genérica)
  const inf = data.infonavit ?? emptyInfonavitClienteDatosV1();
  const ref1Fijo = combineLadaTelefonoMexico(
    inf.referencias[0].lada,
    inf.referencias[0].telefono,
  );
  const ref2Fijo = combineLadaTelefonoMexico(
    inf.referencias[1].lada,
    inf.referencias[1].telefono,
  );

  const phoneEntries: TelefonoUnicidadEntry[] = silvia
    ? [{ slot: "cliente.celular", raw: data.celular }]
    : [
        { slot: "cliente.celular", raw: data.celular },
        ...(clienteDatosRequiereTelefonoCasa(ctx.perfilCaptura) &&
        ctx.telefonoCasa !== undefined
          ? [{ slot: "cliente.telefonoCasa" as const, raw: String(ctx.telefonoCasa ?? "") }]
          : []),
        { slot: "empresa.telefono", raw: data.telefonoEmpresa },
        {
          slot: "ref1.celular",
          raw: requireInfonavit
            ? inf.referencias[0].celular
            : data.referencias[0]?.celular ?? "",
        },
        {
          slot: "ref2.celular",
          raw: requireInfonavit
            ? inf.referencias[1].celular
            : data.referencias[1]?.celular ?? "",
        },
      ];
  if (!silvia && ref1Fijo.ok) {
    phoneEntries.push({ slot: "ref1.telefonoCompleto", raw: ref1Fijo.phone });
  }
  if (!silvia && ref2Fijo.ok) {
    phoneEntries.push({ slot: "ref2.telefonoCompleto", raw: ref2Fijo.phone });
  }

  // Non-required P189: map ref celular errors to legacy keys
  const dups = findDuplicateTelefonosIntraExpediente(phoneEntries);
  for (const dup of dups) {
    let field = SLOT_TO_FIELD[dup.slot];
    if (!requireInfonavit) {
      if (dup.slot === "ref1.celular") field = "referencia1Celular";
      if (dup.slot === "ref2.celular") field = "referencia2Celular";
    }
    setError(
      errors,
      field,
      `Este teléfono se repite con ${SLOT_LABEL[dup.conflictsWith]} del mismo expediente.`,
    );
  }

  const messages = Object.values(errors);
  return { errors, messages, isValid: messages.length === 0 };
}

export function formatClienteDatosValidationSummary(
  result: ClienteDatosValidationResult,
  maxItems = 5,
): string {
  if (result.isValid) return "";
  const head = result.messages.slice(0, maxItems).join("\n");
  const rest = result.messages.length - maxItems;
  if (rest > 0) return `${head}\n…y ${rest} error(es) más.`;
  return head;
}

/** Resuelve domicilio a persistir (Mejoravit usa vivienda estructurada). */
export function resolveDireccionOpcionalForSave(args: {
  programaDb?: string | null;
  direccionOpcional: string;
  datos: ClienteDatosFormShape;
}): string {
  if (!isProgramaMejoravitDb(args.programaDb)) {
    return String(args.direccionOpcional ?? "").trim();
  }
  const viv = args.datos.infonavit?.vivienda;
  if (!viv) return String(args.direccionOpcional ?? "").trim();
  const formatted = formatInfonavitDwellingAddress(viv);
  return formatted || String(args.direccionOpcional ?? "").trim();
}
