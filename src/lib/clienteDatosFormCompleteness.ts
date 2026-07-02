import type { ExpedienteClienteDatos } from "@/domain/expediente-cliente-datos";

export type ClienteDatosFormShape = ExpedienteClienteDatos["datos"];

/** Campos obligatorios en Datos Generales (RFC es opcional). */
export const CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT = 18;

/** Etiquetas legibles de campos obligatorios vacíos (trim). RFC no cuenta como faltante. */
export function getClienteDatosCamposFaltantes(d: ClienteDatosFormShape): string[] {
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
  return missing;
}
