/**
 * Helpers de fixture P189 B2 (100% ficticios).
 */
import {
  emptyInfonavitClienteDatosV1,
  type InfonavitClienteDatosV1,
} from "./infonavit-datos";

export function fixtureInfonavitCompleto(
  overrides?: Partial<InfonavitClienteDatosV1>,
): InfonavitClienteDatosV1 {
  const base = emptyInfonavitClienteDatosV1();
  return {
    ...base,
    ...overrides,
    schemaVersion: 1,
    titular: {
      ...base.titular,
      nombres: "ANGELA",
      apellidoPaterno: "MUNOZ",
      apellidoMaterno: "PENA",
      genero: "F",
      estadoCivil: "soltero",
      regimenMatrimonial: "",
      ...(overrides?.titular ?? {}),
      identificacion: {
        tipo: "PASAPORTE",
        numero: "G12345678",
        vigencia: "2028-06-15",
        ...(overrides?.titular?.identificacion ?? {}),
      },
    },
    vivienda: {
      ...base.vivienda,
      tipoPropiedad: "familiar",
      localidad: "SAN NICOLAS",
      calle: "AV NIÑOS HEROES",
      numeroExterior: "123",
      colonia: "PENASCO",
      entidad: "NUEVO LEON",
      municipio: "SAN NICOLAS",
      cp: "66450",
      ...(overrides?.vivienda ?? {}),
    },
    referencias: [
      {
        nombres: "ANA",
        apellidoPaterno: "PEREZ",
        apellidoMaterno: "DIAZ",
        lada: "81",
        telefono: "11111111",
        celular: "8111111111",
        ...(overrides?.referencias?.[0] ?? {}),
      },
      {
        nombres: "LUIS",
        apellidoPaterno: "RAMIREZ",
        apellidoMaterno: "SOTO",
        lada: "81",
        telefono: "22222222",
        celular: "8222222222",
        ...(overrides?.referencias?.[1] ?? {}),
      },
    ],
    beneficiario: {
      nombres: "ROCIO",
      apellidoPaterno: "PENA",
      apellidoMaterno: "SANCHEZ",
      parentesco: "MADRE",
      ...(overrides?.beneficiario ?? {}),
    },
    mejora: {
      descripcion: "REPARACION DE BANO Y PINTURA",
      presupuestoEstimado: "98000",
      ...(overrides?.mejora ?? {}),
    },
  };
}
