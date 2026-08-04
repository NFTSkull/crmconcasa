import { normalizeCurp, entidadNombreFromCodigo } from "./curp-local";
import type { CampoComparacion, ConstanciaExtractedIdentity } from "./types";

export function normalizeIdentityText(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/Ñ/g, "N")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type DatosGeneralesComparables = Readonly<{
  curp?: string | null;
  nombreCliente?: string | null;
  nombre?: string | null;
  primerApellido?: string | null;
  segundoApellido?: string | null;
  fechaNacimiento?: string | null;
  sexo?: string | null;
  entidadNacimiento?: string | null;
}>;

function cmpField(
  campo: string,
  capturado: string | null | undefined,
  constancia: string | null | undefined,
  mensajeNoCoincide: string,
): CampoComparacion {
  const c = normalizeIdentityText(capturado);
  const k = normalizeIdentityText(constancia);
  if (!k) {
    return {
      campo,
      capturado: capturado?.trim() || null,
      constancia: null,
      resultado: "no_disponible",
    };
  }
  if (!c) {
    return {
      campo,
      capturado: null,
      constancia: constancia?.trim() || null,
      resultado: "no_disponible",
    };
  }
  if (c === k || c.includes(k) || k.includes(c)) {
    return {
      campo,
      capturado: capturado?.trim() || null,
      constancia: constancia?.trim() || null,
      resultado: "coincide",
    };
  }
  return {
    campo,
    capturado: capturado?.trim() || null,
    constancia: constancia?.trim() || null,
    resultado: "no_coincide",
    mensaje: mensajeNoCoincide,
  };
}

export function compareConstanciaVsDatosGenerales(
  datos: DatosGeneralesComparables,
  extracted: ConstanciaExtractedIdentity,
): CampoComparacion[] {
  const nombreCapturado =
    datos.nombreCliente ||
    [datos.primerApellido, datos.segundoApellido, datos.nombre]
      .filter(Boolean)
      .join(" ");

  const nombreConst =
    extracted.nombreCompleto ||
    [extracted.primerApellido, extracted.segundoApellido, extracted.nombre]
      .filter(Boolean)
      .join(" ");

  const entidadCap =
    datos.entidadNacimiento ||
    null;
  const entidadConst =
    extracted.entidadNacimiento ||
    extracted.entidadRegistro ||
    null;

  const entidadCapNorm =
    entidadCap && entidadCap.length === 2
      ? entidadNombreFromCodigo(entidadCap) ?? entidadCap
      : entidadCap;

  return [
    cmpField(
      "CURP",
      normalizeCurp(datos.curp ?? ""),
      extracted.curp,
      "CURP del PDF no coincide",
    ),
    cmpField("Nombre", nombreCapturado, nombreConst, "Nombre no coincide"),
    cmpField(
      "Primer apellido",
      datos.primerApellido,
      extracted.primerApellido,
      "Primer apellido no coincide",
    ),
    cmpField(
      "Segundo apellido",
      datos.segundoApellido,
      extracted.segundoApellido,
      "Segundo apellido no coincide",
    ),
    cmpField(
      "Fecha de nacimiento",
      datos.fechaNacimiento,
      extracted.fechaNacimiento,
      "Fecha de nacimiento no coincide",
    ),
    cmpField("Sexo", datos.sexo, extracted.sexo, "Sexo no coincide"),
    cmpField(
      "Entidad de nacimiento",
      entidadCapNorm,
      entidadConst,
      "Entidad de nacimiento no coincide",
    ),
  ];
}

export function hasDiscrepancia(campos: readonly CampoComparacion[]): boolean {
  return campos.some((c) => c.resultado === "no_coincide");
}

export function fingerprintIdentidad(parts: Record<string, string | null | undefined>): string {
  const canon = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${normalizeIdentityText(parts[k] ?? "")}`)
    .join("|");
  // hash simple no criptográfico para invalidación (sin crypto subtle en node:test)
  let h = 0;
  for (let i = 0; i < canon.length; i++) {
    h = (h * 31 + canon.charCodeAt(i)) >>> 0;
  }
  return `fp_${h.toString(16)}_${canon.length}`;
}
