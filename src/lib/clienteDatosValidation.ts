import type { ClienteDatosFormShape } from "@/lib/clienteDatosFormCompleteness";
import {
  calcMontoCalculadoCobro,
  isProgramaMejoravitDb,
  parseMontoCalculadoInput,
  parsePorcentajeCobroInput,
} from "@/lib/clienteDatosCobro";

export const MSJ_DOMICILIO_REAL_OBLIGATORIO =
  "El domicilio real del cliente es obligatorio.";

export type ClienteDatosValidationContext = {
  montoAprobado?: number | null;
  direccionOpcional?: string | null;
  programaDb?: string | null;
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
  | "referencia1Celular"
  | "referencia2Nombre"
  | "referencia2Celular"
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
  | "metodoPago";

export type ClienteDatosFieldErrors = Partial<Record<ClienteDatosFieldKey, string>>;

export type ClienteDatosValidationResult = Readonly<{
  errors: ClienteDatosFieldErrors;
  messages: string[];
  isValid: boolean;
}>;

const CURP_RE = /^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[0-9A-Z][0-9]$/;
const RFC_RE = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/** Mayúsculas en CURP/RFC para guardado y validación consistente. */
export function normalizeClienteDatosForSave(
  d: ClienteDatosFormShape,
): ClienteDatosFormShape {
  return {
    ...d,
    curp: String(d.curp ?? "").trim().toUpperCase(),
    rfc: String(d.rfc ?? "").trim().toUpperCase(),
    porcentajeCobro: String(d.porcentajeCobro ?? "").trim(),
    montoCalculado: String(d.montoCalculado ?? "").trim(),
    metodoPago: String(d.metodoPago ?? "").trim().toLowerCase(),
    montoMejoravit: String(d.montoMejoravit ?? "").trim(),
    plazo: String(d.plazo ?? "").trim(),
  };
}

/**
 * Validación cliente-side alineada a campos obligatorios actuales y reglas de formato.
 * No valida duplicados globales entre expedientes (solo dentro del formulario).
 */
export function validateClienteDatos(
  d: ClienteDatosFormShape,
  ctx: ClienteDatosValidationContext = {},
): ClienteDatosValidationResult {
  const errors: ClienteDatosFieldErrors = {};
  const data = normalizeClienteDatosForSave(d);

  const req = (key: ClienteDatosFieldKey, value: string, label: string) => {
    const msg = reqText(value, label);
    if (msg) setError(errors, key, msg);
  };

  req("nombreCliente", data.nombreCliente, "Nombre del cliente");
  req("nss", data.nss, "NSS");
  req("curp", data.curp, "CURP");
  req("celular", data.celular, "Celular");
  req("correo", data.correo, "Correo");
  req("empresa", data.empresa, "Empresa");
  req("registroPatronal", data.registroPatronal, "Registro patronal");
  req("telefonoEmpresa", data.telefonoEmpresa, "Teléfono empresa");

  req("referencia1Nombre", data.referencias[0]?.nombre ?? "", "Nombre de referencia 1");
  req("referencia1Celular", data.referencias[0]?.celular ?? "", "Celular de referencia 1");
  req("referencia2Nombre", data.referencias[1]?.nombre ?? "", "Nombre de referencia 2");
  req("referencia2Celular", data.referencias[1]?.celular ?? "", "Celular de referencia 2");

  req("beneficiarioNombre", data.beneficiario.nombre, "Beneficiario — nombre");
  req("beneficiarioParentesco", data.beneficiario.parentesco, "Beneficiario — parentesco");

  req("direccionCalle", data.direccionEmpresa.calle, "Calle de la empresa");
  req("direccionColonia", data.direccionEmpresa.colonia, "Colonia de la empresa");
  req("direccionMunicipio", data.direccionEmpresa.municipio, "Municipio de la empresa");
  req("direccionCp", data.direccionEmpresa.cp, "CP");

  const domicilioReal = String(ctx.direccionOpcional ?? "").trim();
  if (!domicilioReal) {
    setError(errors, "direccionOpcional", MSJ_DOMICILIO_REAL_OBLIGATORIO);
  }

  const esMejoravit = isProgramaMejoravitDb(ctx.programaDb);
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

    const plazo = String(data.plazo ?? "").trim();
    if (!plazo) {
      setError(errors, "plazo", "El plazo es obligatorio.");
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

  if (!errors.nss && !/^\d{11}$/.test(data.nss.replace(/\D/g, ""))) {
    setError(errors, "nss", "NSS debe tener 11 dígitos.");
  }

  if (!errors.curp && !isCurpMexicoValida(data.curp)) {
    setError(errors, "curp", "CURP no tiene formato válido.");
  }

  if (data.rfc.trim() && !errors.rfc && !isRfcMexicoValido(data.rfc)) {
    setError(errors, "rfc", "RFC no tiene formato válido.");
  }

  if (!errors.correo && !EMAIL_RE.test(data.correo.trim())) {
    setError(errors, "correo", "Correo no tiene formato válido.");
  }

  if (!errors.direccionCp && !/^\d{5}$/.test(data.direccionEmpresa.cp.replace(/\D/g, ""))) {
    setError(errors, "direccionCp", "CP debe tener 5 dígitos.");
  }

  const phoneFields: ReadonlyArray<{
    key: ClienteDatosFieldKey;
    raw: string;
    label: string;
  }> = [
    { key: "celular", raw: data.celular, label: "Celular" },
    { key: "telefonoEmpresa", raw: data.telefonoEmpresa, label: "Teléfono empresa" },
    { key: "referencia1Celular", raw: data.referencias[0]?.celular ?? "", label: "Celular de referencia 1" },
    { key: "referencia2Celular", raw: data.referencias[1]?.celular ?? "", label: "Celular de referencia 2" },
  ];

  const normalizedPhones = new Map<ClienteDatosFieldKey, string>();

  for (const field of phoneFields) {
    if (errors[field.key]) continue;
    if (!isTelefonoMexicoValido(field.raw)) {
      setError(errors, field.key, `${field.label} debe tener 10 dígitos.`);
      continue;
    }
    normalizedPhones.set(field.key, normalizeTelefonoMexico(field.raw));
  }

  const cel = normalizedPhones.get("celular");
  const emp = normalizedPhones.get("telefonoEmpresa");
  const ref1 = normalizedPhones.get("referencia1Celular");
  const ref2 = normalizedPhones.get("referencia2Celular");

  if (cel && ref1 && cel === ref1) {
    setError(errors, "referencia1Celular", "Celular de referencia 1 no puede repetirse con celular del cliente.");
  }
  if (cel && ref2 && cel === ref2) {
    setError(errors, "referencia2Celular", "Celular de referencia 2 no puede repetirse con celular del cliente.");
  }
  if (ref1 && ref2 && ref1 === ref2) {
    setError(errors, "referencia2Celular", "Celular de referencia 2 no puede repetirse con referencia 1.");
  }
  if (cel && emp && cel === emp) {
    setError(errors, "telefonoEmpresa", "Teléfono empresa no puede repetirse con celular del cliente.");
  }
  if (emp && ref1 && emp === ref1) {
    setError(errors, "referencia1Celular", "Celular de referencia 1 no puede repetirse con teléfono empresa.");
  }
  if (emp && ref2 && emp === ref2) {
    setError(errors, "referencia2Celular", "Celular de referencia 2 no puede repetirse con teléfono empresa.");
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
