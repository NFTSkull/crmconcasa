import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSaveClienteDatosRpcPayload,
  mapSupabaseRowToExpedienteClienteDatos,
} from "./map-supabase-cliente-datos";
import type { ExpedienteClienteDatos } from "./types";

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
        notaMesa: "Cliente prefiere cita matutina.",
        montoMejoravit: "175000",
        plazo: "18 meses",
      },
      referencias: [
        { nombre: "Ref 1", telefono: "5511111111" },
        { nombre: "Ref 2", celular: "5522222222" },
      ],
      porcentaje_cobro: 12.5,
      monto_calculado: 1875,
      metodo_pago: "efectivo",
      updated_by_profile: { email: "asesor@concasa.mx" },
    });

    assert.equal(domain.expedienteId, "exp-1");
    assert.equal(domain.porcentajeCobro, 12.5);
    assert.equal(domain.montoCalculado, 1875);
    assert.equal(domain.metodoPago, "efectivo");
    assert.equal(domain.estado, "completo");
    assert.equal(domain.datos.nombreCliente, "Marcela");
    assert.equal(domain.datos.referencias[0]?.celular, "5511111111");
    assert.equal(domain.datos.referencias[1]?.celular, "5522222222");
    assert.equal(domain.datos.montoMejoravit, "175000");
    assert.equal(domain.datos.plazo, "18 meses");
    assert.equal(domain.datos.montoCalculado, "1875");
    assert.equal(domain.datos.notaMesa, "Cliente prefiere cita matutina.");
    assert.equal(domain.updatedBy, "asesor@concasa.mx");
  });
  it("mapea montoMejoravit numérico y alias monto_mejoravit", () => {
    const domain = mapSupabaseRowToExpedienteClienteDatos({
      expediente_id: "exp-2",
      estado: "completo",
      updated_at: "2026-06-15T12:00:00.000Z",
      datos: {
        nombreCliente: "Ana",
        monto_mejoravit: 250000,
        plazo: 24,
      },
    });
    assert.equal(domain.datos.montoMejoravit, "250000");
    assert.equal(domain.datos.plazo, "24");
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
      montoMejoravit: "150000",
      plazo: "12 meses",
      porcentajeCobro: "10",
      montoCalculado: "2500",
      metodoPago: "transferencia",
      notaMesa: "  Observación Mesa  ",
    }, "Av. Cliente 100", "mejoravit");

    assert.equal(payload.p_expediente_id, "exp-1");
    assert.equal(payload.p_rfc, "xaxx010101000");
    assert.equal(payload.p_porcentaje_cobro, 10);
    assert.equal(payload.p_metodo_pago, "transferencia");
    assert.equal(payload.p_direccion_opcional, "Av. Cliente 100");
    assert.equal(payload.p_monto_calculado_manual, null);
    assert.equal(payload.p_telefono, "(55) 1234-5678");
    assert.equal(payload.p_estado, "completo");
    assert.equal(payload.p_datos.montoMejoravit, "150000");
    assert.equal(payload.p_datos.plazo, "12 meses");
    assert.deepEqual(payload.p_referencias[0], {
      nombre: "Ref 1",
      telefono: "5511111111",
    });
    assert.equal(payload.p_datos.nombreCliente, "Marcela");
    assert.equal(payload.p_datos.notaMesa, "Observación Mesa");
  });

  it("omite notaMesa vacía del payload RPC", () => {
    const payload = buildSaveClienteDatosRpcPayload("exp-1", {
      nombreCliente: "Marcela",
      nss: "12345678901",
      curp: "CURP123",
      rfc: "xaxx010101000",
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
      montoMejoravit: "150000",
      plazo: "12 meses",
      porcentajeCobro: "10",
      montoCalculado: "2500",
      metodoPago: "transferencia",
      notaMesa: "   ",
    }, "Av. Cliente 100", "mejoravit");

    assert.equal("notaMesa" in payload.p_datos, false);
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
      montoMejoravit: "100000",
      plazo: "6 meses",
      porcentajeCobro: "10",
      montoCalculado: "1500",
      metodoPago: "transferencia",
    }, "Av. Cliente 100", "mejoravit");

    assert.equal(payload.p_rfc, "");
    assert.equal(payload.p_porcentaje_cobro, 10);
  });

  it("rechaza payload sin monto Mejoravit o plazo", () => {
    const base = {
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
      montoMejoravit: "150000",
      plazo: "12 meses",
      porcentajeCobro: "10",
      montoCalculado: "1500",
      metodoPago: "transferencia",
    } as ExpedienteClienteDatos["datos"];

    assert.throws(
      () =>
        buildSaveClienteDatosRpcPayload(
          "exp-1",
          { ...base, montoMejoravit: "" },
          "Dir",
          "mejoravit",
        ),
      /monto Mejoravit/,
    );
    assert.throws(
      () =>
        buildSaveClienteDatosRpcPayload("exp-1", { ...base, plazo: "" }, "Dir", "mejoravit"),
      /plazo/,
    );
  });

  it("compro_tu_casa omite montoMejoravit y plazo del payload", () => {
    const payload = buildSaveClienteDatosRpcPayload(
      "exp-1",
      {
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
        montoMejoravit: "",
        plazo: "",
        porcentajeCobro: "10",
        montoCalculado: "1500",
        metodoPago: "transferencia",
      },
      "Dir",
      "compro_tu_casa",
    );
    assert.equal(payload.p_datos.montoMejoravit, undefined);
    assert.equal(payload.p_datos.plazo, undefined);
  });

  it("P055: envía p_monto_calculado_manual solo si es edición manual", () => {
    const base = {
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
      montoMejoravit: "",
      plazo: "",
      porcentajeCobro: "10",
      montoCalculado: "17000",
      metodoPago: "transferencia",
    } as ExpedienteClienteDatos["datos"];

    const auto = buildSaveClienteDatosRpcPayload("exp-1", base, "Dir", "compro_tu_casa");
    assert.equal(auto.p_monto_calculado_manual, null);

    const manual = buildSaveClienteDatosRpcPayload("exp-1", base, "Dir", "compro_tu_casa", {
      montoCalculadoEsManual: true,
    });
    assert.equal(manual.p_monto_calculado_manual, 17000);
  });
});
