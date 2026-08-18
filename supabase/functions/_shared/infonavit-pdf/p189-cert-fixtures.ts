/**
 * 5 fixtures sintéticos de certificación visual P189 (sin PII real).
 */
import { buildPropuestaMejoramiento } from "./build-propuesta-mejoramiento.ts";
import { parseDireccionMxParaSolicitud } from "./parse-direccion-mx.ts";
import { parseNombrePersonaMx } from "./parse-nombre-persona-mx.ts";
import type { InfonavitPdfSnapshotInput } from "./types.ts";

export interface CertFixtureDef {
  id: string;
  label: string;
  nombreCliente: string;
  montoAprobado: number;
  montoMejoravit: number;
  direccionOpcional: string;
  nss: string;
  plazo: number | null;
  ref1: string;
  ref2: string;
  beneficiario: string;
  parentesco: string;
  descripcionExplicita?: string;
  fechaDocumento: string;
}

export const CERT_FIXTURES: CertFixtureDef[] = [
  {
    id: "principal",
    label: "caso estructural real (sin PII)",
    nombreCliente: "RUBEN CASTRO QUIÑONES",
    montoAprobado: 113921.51,
    montoMejoravit: 102529.36,
    direccionOpcional: "C CERRO DEL TEPEYAC 309 COL. CERRO DE LA SILLA 67250 JUAREZ, N.L.",
    nss: "18900000001",
    plazo: 10,
    ref1: "DEBANHI ABIGAIL CASTRO JUAREZ",
    ref2: "NALLELY BERENICE CASTRO JUAREZ",
    beneficiario: "MAYRA ELIZABETH JUAREZ CASTAÑEDA",
    parentesco: "CONCUBINA",
    fechaDocumento: "2026-08-18",
  },
  {
    id: "particulas",
    label: "nombre compuesto + partículas DE LA",
    nombreCliente: "JUAN DE LA CRUZ PEREZ",
    montoAprobado: 90000,
    montoMejoravit: 80000,
    direccionOpcional: "AV REFORMA 100 COLONIA CENTRO 64000 MONTERREY NUEVO LEON",
    nss: "18900000002",
    plazo: 8,
    ref1: "MARIA DEL CARMEN LOPEZ HERNANDEZ",
    ref2: "JOSE LUIS SAN JUAN PEREZ",
    beneficiario: "ANA DE LAS CASAS RUIZ",
    parentesco: "ESPOSA",
    fechaDocumento: "2026-08-18",
  },
  {
    id: "dir-incompleta",
    label: "dirección sin CP",
    nombreCliente: "RUBEN CASTRO QUIÑONES",
    montoAprobado: 70000,
    montoMejoravit: 65000,
    direccionOpcional: "CALLE SOL 10 COL CENTRO N.L.",
    nss: "18900000003",
    plazo: 5,
    ref1: "DEBANHI ABIGAIL CASTRO JUAREZ",
    ref2: "NALLELY BERENICE CASTRO JUAREZ",
    beneficiario: "MAYRA ELIZABETH JUAREZ CASTAÑEDA",
    parentesco: "CONCUBINA",
    fechaDocumento: "2026-08-18",
  },
  {
    id: "monto-alto",
    label: "monto alto banda 130-169k",
    nombreCliente: "RUBEN CASTRO QUIÑONES",
    montoAprobado: 160000,
    montoMejoravit: 155000,
    direccionOpcional: "CALLE PRUEBA 309 COL CENTRO 67250 JUAREZ N.L.",
    nss: "18900000004",
    plazo: 10,
    ref1: "DEBANHI ABIGAIL CASTRO JUAREZ",
    ref2: "NALLELY BERENICE CASTRO JUAREZ",
    beneficiario: "MAYRA ELIZABETH JUAREZ CASTAÑEDA",
    parentesco: "CONCUBINA",
    fechaDocumento: "2026-08-18",
  },
  {
    id: "monto-bajo",
    label: "monto bajo banda hasta 50k",
    nombreCliente: "RUBEN CASTRO QUIÑONES",
    montoAprobado: 50000,
    montoMejoravit: 40000,
    direccionOpcional: "CALLE PRUEBA 309A COL CENTRO 67250 JUAREZ N.L.",
    nss: "18900000005",
    plazo: 3,
    ref1: "DEBANHI ABIGAIL CASTRO JUAREZ",
    ref2: "NALLELY BERENICE CASTRO JUAREZ",
    beneficiario: "MAYRA ELIZABETH JUAREZ CASTAÑEDA",
    parentesco: "CONCUBINA",
    fechaDocumento: "2026-08-18",
  },
];

function mapRef(nombre: string, celular: string) {
  const p = parseNombrePersonaMx(nombre);
  return {
    nombres: p.nombres,
    apellidoPaterno: p.apellidoPaterno,
    apellidoMaterno: p.apellidoMaterno,
    lada: "",
    telefono: "",
    celular,
  };
}

export function buildCertSnapshot(def: CertFixtureDef): InfonavitPdfSnapshotInput {
  const titular = parseNombrePersonaMx(def.nombreCliente);
  const dir = parseDireccionMxParaSolicitud(def.direccionOpcional);
  const ben = parseNombrePersonaMx(def.beneficiario);
  const propuesta =
    def.descripcionExplicita?.trim() ||
    buildPropuestaMejoramiento(def.montoMejoravit);
  const ciudad = "NUEVO LEÓN";
  return {
    fechaDocumento: def.fechaDocumento,
    localidad: ciudad,
    ciudadCierre: ciudad,
    cliente: {
      nombreCompleto: def.nombreCliente,
      nombres: titular.nombres,
      apellidoPaterno: titular.apellidoPaterno,
      apellidoMaterno: titular.apellidoMaterno,
      nss: def.nss,
      curp: "XAXX010101HDFXXX09",
      rfc: "XAXX010101000",
      celular: "5518900001",
      correo: "cliente.prueba@test.local",
      telefono: "",
      ladaTelefono: "",
      identificacion: { tipo: "", numero: "", vigencia: "" },
    },
    empresa: {
      nombre: "Empresa Prueba P189",
      registroPatronal: "Y1890000001",
      telefono: "8189000001",
      lada: "",
      extension: "",
    },
    vivienda: {
      direccionCompleta: dir.direccionCompleta,
      direccionLibre: dir.direccionCompleta,
      calle: dir.calle,
      noExt: dir.numeroExterior,
      noInt: dir.numeroInterior,
      lote: dir.lote,
      manzana: dir.manzana,
      colonia: dir.colonia,
      entidad: dir.entidad,
      municipio: dir.municipio,
      cp: dir.codigoPostal,
    },
    credito: {
      montoSolicitado: def.montoMejoravit,
      plazoAnios: def.plazo,
    },
    referencias: [
      mapRef(def.ref1, "8118900001"),
      mapRef(def.ref2, "8118900002"),
    ],
    beneficiario: {
      nombres: ben.nombres,
      apellidoPaterno: ben.apellidoPaterno,
      apellidoMaterno: ben.apellidoMaterno,
      parentesco: def.parentesco,
    },
    mejora: {
      descripcion: propuesta,
      presupuestoEstimado: def.montoMejoravit,
    },
  };
}
