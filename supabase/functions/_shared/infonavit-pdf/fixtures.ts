/**
 * Fixtures 100% ficticias P189 B1 — sin PII productiva.
 */

import type { InfonavitPdfSnapshotInput } from "./types.ts";

/** Caso base operativo. */
export const FIXTURE_NORMAL: InfonavitPdfSnapshotInput = {
  fechaDocumento: "2026-08-17",
  localidad: "MONTERREY",
  cliente: {
    nombres: "MARIA ELENA",
    apellidoPaterno: "GARCIA",
    apellidoMaterno: "LOPEZ",
    nss: "12345678901",
    curp: "GALM850101MNLRPR09",
    rfc: "GALM850101XXX",
    celular: "8181234567",
    telefono: "8187654321",
    ladaTelefono: "81",
    correo: "maria.elena.ficticia@example.com",
    genero: "F",
    estadoCivil: "casado",
    regimenMatrimonial: "sociedad_conyugal",
    identificacion: {
      tipo: "INE",
      numero: "1234567890123",
      vigencia: "31/12/30",
    },
  },
  empresa: {
    nombre: "EMPRESA FICTICIA SA DE CV",
    registroPatronal: "Y1234567890",
    lada: "81",
    telefono: "8181112233",
    extension: "100",
  },
  vivienda: {
    calle: "CALLE FICTICIA 100",
    noExt: "100",
    noInt: "A",
    lote: "12",
    manzana: "3",
    colonia: "CENTRO",
    entidad: "NUEVO LEON",
    municipio: "MONTERREY",
    cp: "64000",
    tipoPropiedad: "propia",
    direccionLibre:
      "CALLE FICTICIA 100, COL. CENTRO, MONTERREY, NUEVO LEON, CP 64000",
  },
  credito: {
    montoSolicitado: 125000.5,
    plazoMeses: 30,
  },
  referencias: [
    {
      apellidoPaterno: "PEREZ",
      apellidoMaterno: "DIAZ",
      nombres: "ANA",
      lada: "81",
      telefono: "8182223344",
      celular: "8183334455",
    },
    {
      apellidoPaterno: "RAMIREZ",
      apellidoMaterno: "SOTO",
      nombres: "LUIS",
      lada: "81",
      telefono: "8184445566",
      celular: "8185556677",
    },
  ],
  beneficiario: {
    parentesco: "HIJO",
    apellidoPaterno: "GARCIA",
    apellidoMaterno: "LOPEZ",
    nombres: "CARLOS",
  },
  mejora: {
    descripcion: "REPARACION DE BAÑO Y PINTURA GENERAL",
    presupuestoEstimado: 125000.5,
  },
};

/** Obligatorio: acentos / Ñ / glyphs españoles. */
export const FIXTURE_SPANISH: InfonavitPdfSnapshotInput = {
  fechaDocumento: "2026-01-03",
  localidad: "SAN NICOLÁS",
  cliente: {
    nombres: "ÁNGELA",
    apellidoPaterno: "MUÑOZ",
    apellidoMaterno: "PEÑA",
    nss: "10987654321",
    curp: "MUXA900203MNLRNN08",
    rfc: "MUXA900203XX1",
    celular: "8112345678",
    telefono: "8187654321",
    ladaTelefono: "81",
    correo: "angela.munoz.ficticia@example.com",
    genero: "F",
    estadoCivil: "soltero",
    regimenMatrimonial: null,
    identificacion: {
      tipo: "PASAPORTE",
      numero: "G12345678",
      vigencia: "15/06/28",
    },
  },
  empresa: {
    nombre: "TALLER MÉXICO ÑANDÚ SA",
    registroPatronal: "Z0987654321",
    lada: "81",
    telefono: "8111223344",
    extension: "",
  },
  vivienda: {
    calle: "AV. NIÑOS HÉROES",
    noExt: "123",
    noInt: "",
    lote: "",
    manzana: "",
    colonia: "PEÑASCO",
    entidad: "NUEVO LEÓN",
    municipio: "SAN NICOLÁS",
    cp: "66450",
    tipoPropiedad: "familiar",
    direccionLibre: "AV. NIÑOS HÉROES 123, COL. PEÑASCO",
  },
  credito: {
    montoSolicitado: 98000,
    plazoMeses: 24,
  },
  referencias: [
    {
      apellidoPaterno: "GÜEMES",
      apellidoMaterno: "ÍÑIGUEZ",
      nombres: "JOSÉ",
      lada: "81",
      telefono: "8111111111",
      celular: "8222222222",
    },
    {
      apellidoPaterno: "OCHOA",
      apellidoMaterno: "RÍOS",
      nombres: "MARÍA",
      lada: "81",
      telefono: "8333333333",
      celular: "8444444444",
    },
  ],
  beneficiario: {
    parentesco: "MADRE",
    apellidoPaterno: "PEÑA",
    apellidoMaterno: "SÁNCHEZ",
    nombres: "ROCÍO",
  },
  mejora: {
    descripcion:
      "REPARACIÓN DE BAÑO, PINTURA Y CAMBIO DE TUBERÍA",
    presupuestoEstimado: 98000,
  },
};

/** Campos largos para overflow / wrap. */
export const FIXTURE_LONG_FIELDS: InfonavitPdfSnapshotInput = {
  ...FIXTURE_NORMAL,
  fechaDocumento: "2026-12-31",
  cliente: {
    ...FIXTURE_NORMAL.cliente,
    nombres: "MARIA DE LOS ANGELES DEL CARMEN",
    apellidoPaterno: "GARCIA-HERNANDEZ",
    apellidoMaterno: "LOPEZ-SANCHEZ",
    genero: "M",
    estadoCivil: "casado",
    regimenMatrimonial: "separacion_bienes",
  },
  vivienda: {
    ...FIXTURE_NORMAL.vivienda!,
    tipoPropiedad: "conyuge_concubino",
    direccionLibre:
      "AVENIDA DE LOS INSURGENTES SUR NUMERO MIL DOSCIENTOS TREINTA Y CUATRO INTERIOR B COLONIA DEL VALLE CENTRO DELEGACION BENITO JUAREZ CIUDAD DE MEXICO CODIGO POSTAL CERO TRES UNO CERO CERO",
  },
  mejora: {
    descripcion:
      "REPARACION INTEGRAL DE BAÑO PRINCIPAL INCLUYENDO DEMOLICION DE AZULEJO CAMBIO DE TUBERIA HIDRAULICA Y SANITARIA IMPERMEABILIZACION REPOSICION DE PISO Y PINTURA COMPLETA DE MUROS Y PLAFON",
    presupuestoEstimado: 250000,
  },
};
