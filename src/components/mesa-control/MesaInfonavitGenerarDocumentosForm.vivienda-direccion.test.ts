import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMesaInfonavitGeneratePayload,
  type MesaInfonavitDocumentDraft,
} from "./MesaInfonavitGenerarDocumentosForm";

function draftWithVivienda(
  vivienda: MesaInfonavitDocumentDraft["vivienda"],
): MesaInfonavitDocumentDraft {
  return {
    schemaVersion: 1,
    mappingVersion: 3,
    fechaDocumento: "2026-09-18",
    localidad: "NUEVO LEÓN",
    ciudadCierre: "NUEVO LEÓN",
    cliente: {
      nombreCompleto: "PERSONA PRUEBA",
      nombres: "PERSONA",
      apellidoPaterno: "PRUEBA",
      apellidoMaterno: "",
      nss: "12345678901",
      curp: "",
      rfc: "",
      celular: "",
      telefono: "",
      ladaTelefono: "",
      correo: "",
      genero: "",
      estadoCivil: "",
      regimenMatrimonial: "",
      identificacion: { tipo: "", numero: "", vigencia: "" },
    },
    empresa: {
      nombre: "EMPRESA PRUEBA",
      registroPatronal: "RP123",
      lada: "",
      telefono: "",
      extension: "",
    },
    vivienda,
    credito: { montoSolicitado: 50000, plazoAnios: 3 },
    destinoRecursos: {
      porcentajeTitulacion: "",
      clabeNotaria: "",
      clabeDerechohabiente: "",
    },
    referencias: [
      {
        apellidoPaterno: "",
        apellidoMaterno: "",
        nombres: "",
        lada: "",
        telefono: "",
        celular: "",
      },
      {
        apellidoPaterno: "",
        apellidoMaterno: "",
        nombres: "",
        lada: "",
        telefono: "",
        celular: "",
      },
    ],
    beneficiario: {
      parentesco: "HIJO",
      apellidoPaterno: "",
      apellidoMaterno: "",
      nombres: "BENEFICIARIO",
    },
    mejora: { descripcion: "", presupuestoEstimado: null },
  };
}

describe("Mesa INFONAVIT vivienda", () => {
  it("reconstruye direccionCompleta con la calle editada antes de generar", () => {
    const draft = draftWithVivienda({
      direccionCompleta:
        "CALLE ANTERIOR 10 COL. CENTRO MONTERREY NUEVO LEÓN CP 64000",
      calle: "CALLE NUEVA",
      noExt: "25",
      noInt: "4",
      lote: "8",
      manzana: "12",
      colonia: "COLONIA NUEVA",
      entidad: "NUEVO LEÓN",
      municipio: "MONTERREY",
      cp: "64010",
      tipoPropiedad: "propia",
    });

    const payload = buildMesaInfonavitGeneratePayload(draft);

    assert.equal(
      payload.vivienda.direccionCompleta,
      "CALLE NUEVA, No. 25, Int. 4, Lote 8, Mz. 12, Col. COLONIA NUEVA, MONTERREY, NUEVO LEÓN, CP 64010",
    );
    assert.equal(payload.vivienda.calle, "CALLE NUEVA");
    assert.doesNotMatch(payload.vivienda.direccionCompleta, /CALLE ANTERIOR/);
  });

  it("conserva direccionCompleta original si no existen componentes estructurados", () => {
    const draft = draftWithVivienda({
      direccionCompleta: "  DOMICILIO LEGACY 123  ",
      calle: "",
      noExt: "",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "",
      entidad: "",
      municipio: "",
      cp: "",
      tipoPropiedad: "",
    });

    const payload = buildMesaInfonavitGeneratePayload(draft);

    assert.equal(payload.vivienda.direccionCompleta, "DOMICILIO LEGACY 123");
  });
});
