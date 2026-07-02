import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSaveClienteDatosRpcPayload,
  mapSupabaseRowToExpedienteClienteDatos,
} from "./map-supabase-cliente-datos";

describe("mapSupabaseRowToExpedienteClienteDatos", () => {
  it("mapea fila Supabase a dominio UI", () => {
    const domain = mapSupabaseRowToExpedienteClienteDatos({
      expediente_id: "exp-1",
      estado: "completo",
      updated_at: "2026-06-15T12:00:00.000Z",
      datos: {
        nombreCliente: "Marcela",
        nss: "12345678901",
        curp: "CURP123",
        rfc: "XAXX010101000",
        celular: "5512345678",
        correo: "marcela@concasa.mx",
        empresa: "Empresa SA",
        registroPatronal: "RP-1",
        telefonoEmpresa: "5599999999",
        beneficiario: { nombre: "Ben", parentesco: "Hija" },
        direccionEmpresa: {
          calle: "Calle 1",
          colonia: "Centro",
          municipio: "CDMX",
          cp: "01000",
        },
      },
      referencias: [
        { nombre: "Ref 1", telefono: "5511111111" },
        { nombre: "Ref 2", celular: "5522222222" },
      ],
      updated_by_profile: { email: "asesor@concasa.mx" },
    });

    assert.equal(domain.expedienteId, "exp-1");
    assert.equal(domain.estado, "completo");
    assert.equal(domain.datos.nombreCliente, "Marcela");
    assert.equal(domain.datos.referencias[0]?.celular, "5511111111");
    assert.equal(domain.datos.referencias[1]?.celular, "5522222222");
    assert.equal(domain.updatedBy, "asesor@concasa.mx");
  });
});

describe("buildSaveClienteDatosRpcPayload", () => {
  it("arma argumentos RPC con RFC, teléfono y referencias", () => {
    const payload = buildSaveClienteDatosRpcPayload("exp-1", {
      nombreCliente: "Marcela",
      nss: "12345678901",
      curp: "CURP123",
      rfc: "xaxx010101000",
      celular: "(55) 1234-5678",
      correo: "marcela@concasa.mx",
      empresa: "Empresa SA",
      registroPatronal: "RP-1",
      telefonoEmpresa: "5599999999",
      referencias: [
        { nombre: "Ref 1", celular: "5511111111" },
        { nombre: "Ref 2", celular: "5522222222" },
      ],
      beneficiario: { nombre: "Ben", parentesco: "Hija" },
      direccionEmpresa: {
        calle: "Calle 1",
        colonia: "Centro",
        municipio: "CDMX",
        cp: "01000",
      },
    });

    assert.equal(payload.p_expediente_id, "exp-1");
    assert.equal(payload.p_rfc, "xaxx010101000");
    assert.equal(payload.p_telefono, "(55) 1234-5678");
    assert.equal(payload.p_estado, "completo");
    assert.deepEqual(payload.p_referencias[0], {
      nombre: "Ref 1",
      telefono: "5511111111",
    });
    assert.equal(payload.p_datos.nombreCliente, "Marcela");
  });

  it("acepta RFC vacío en payload RPC", () => {
    const payload = buildSaveClienteDatosRpcPayload("exp-1", {
      nombreCliente: "Marcela",
      nss: "12345678901",
      curp: "CURP123",
      rfc: "",
      celular: "5512345678",
      correo: "marcela@concasa.mx",
      empresa: "Empresa SA",
      registroPatronal: "RP-1",
      telefonoEmpresa: "5599999999",
      referencias: [
        { nombre: "Ref 1", celular: "5511111111" },
        { nombre: "Ref 2", celular: "5522222222" },
      ],
      beneficiario: { nombre: "Ben", parentesco: "Hija" },
      direccionEmpresa: {
        calle: "Calle 1",
        colonia: "Centro",
        municipio: "CDMX",
        cp: "01000",
      },
    });

    assert.equal(payload.p_rfc, "");
  });
});
