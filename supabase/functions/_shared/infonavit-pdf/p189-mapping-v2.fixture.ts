/**
 * Fixture sintético P189 mapping v2 FINAL — sin PII real.
 */
import { buildPropuestaMejoramiento } from "./build-propuesta-mejoramiento.ts";
import { parseDireccionMxParaSolicitud } from "./parse-direccion-mx.ts";
import { parseNombrePersonaMx } from "./parse-nombre-persona-mx.ts";
import type { InfonavitPdfSnapshotInput } from "./types.ts";

export const P189_V2_FIXTURE = {
  nombreCliente: "RUBEN CASTRO QUIÑONES",
  montoAprobado: 113921.51,
  montoMejoravit: 102529.36,
  direccionOpcional: "CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ N.L.",
  nss: "18900000001",
  curp: "XAXX010101HDFXXX09",
  rfc: "XAXX010101000",
  celular: "5518900001",
  correo: "cliente.prueba@test.local",
  empresa: "Empresa Prueba P189",
  registroPatronal: "Y1890000001",
  telefonoEmpresa: "8189000001",
  plazo: 10,
  ref1: {
    nombre: "DEBANHI ABIGAIL CASTRO JUAREZ",
    celular: "8118900001",
  },
  ref2: {
    nombre: "NALLELY BERENICE CASTRO JUAREZ",
    celular: "8118900002",
  },
  beneficiario: {
    nombre: "MAYRA ELIZABETH JUAREZ CASTAÑEDA",
    parentesco: "CONCUBINA",
  },
  fechaDocumento: "2026-08-18",
} as const;

export function buildP189V2FixtureSnapshot(): InfonavitPdfSnapshotInput {
  const f = P189_V2_FIXTURE;
  const titular = parseNombrePersonaMx(f.nombreCliente);
  const dir = parseDireccionMxParaSolicitud(f.direccionOpcional);
  const ref1 = parseNombrePersonaMx(f.ref1.nombre);
  const ref2 = parseNombrePersonaMx(f.ref2.nombre);
  const ben = parseNombrePersonaMx(f.beneficiario.nombre);
  const propuesta = buildPropuestaMejoramiento(f.montoMejoravit);
  const ciudad = "NUEVO LEÓN";

  return {
    fechaDocumento: f.fechaDocumento,
    localidad: ciudad,
    ciudadCierre: ciudad,
    cliente: {
      nombreCompleto: f.nombreCliente,
      nombres: titular.nombres,
      apellidoPaterno: titular.apellidoPaterno,
      apellidoMaterno: titular.apellidoMaterno,
      nss: f.nss,
      curp: f.curp,
      rfc: f.rfc,
      celular: f.celular,
      correo: f.correo,
      telefono: "",
      ladaTelefono: "",
      genero: null,
      estadoCivil: null,
      regimenMatrimonial: null,
      identificacion: { tipo: "", numero: "", vigencia: "" },
    },
    empresa: {
      nombre: f.empresa,
      registroPatronal: f.registroPatronal,
      telefono: f.telefonoEmpresa,
      lada: "",
      extension: "",
    },
    vivienda: {
      direccionCompleta: dir.direccionCompleta,
      direccionLibre: dir.direccionCompleta,
      calle: dir.calle,
      noExt: dir.numeroExterior,
      noInt: dir.numeroInterior,
      lote: "",
      manzana: "",
      colonia: dir.colonia,
      entidad: dir.entidad,
      municipio: dir.municipio,
      cp: dir.codigoPostal,
      tipoPropiedad: null,
    },
    credito: {
      montoSolicitado: f.montoMejoravit,
      plazoAnios: f.plazo,
    },
    referencias: [
      {
        nombres: ref1.nombres,
        apellidoPaterno: ref1.apellidoPaterno,
        apellidoMaterno: ref1.apellidoMaterno,
        lada: "",
        telefono: "",
        celular: f.ref1.celular,
      },
      {
        nombres: ref2.nombres,
        apellidoPaterno: ref2.apellidoPaterno,
        apellidoMaterno: ref2.apellidoMaterno,
        lada: "",
        telefono: "",
        celular: f.ref2.celular,
      },
    ],
    beneficiario: {
      nombres: ben.nombres,
      apellidoPaterno: ben.apellidoPaterno,
      apellidoMaterno: ben.apellidoMaterno,
      parentesco: f.beneficiario.parentesco,
    },
    mejora: {
      descripcion: propuesta,
      presupuestoEstimado: f.montoMejoravit,
    },
  };
}
