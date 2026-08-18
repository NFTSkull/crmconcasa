import assert from "node:assert/strict";
import test from "node:test";
import { emptyInfonavitClienteDatosV1 } from "@/domain/expediente-cliente-datos/infonavit-datos";
import { fixtureInfonavitCompleto } from "@/domain/expediente-cliente-datos/infonavit-datos.fixtures";
import {
  CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_DEFAULT,
  CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_MEJORAVIT,
  CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_MEJORAVIT_BASE,
  getClienteDatosCamposFaltantes,
  getNotaMesaLongitudError,
  type ClienteDatosFormShape,
} from "./clienteDatosFormCompleteness";

const vacio: ClienteDatosFormShape = {
  nombreCliente: "",
  nss: "",
  curp: "",
  rfc: "",
  celular: "",
  correo: "",
  empresa: "",
  registroPatronal: "",
  telefonoEmpresa: "",
  referencias: [
    { nombre: "", celular: "" },
    { nombre: "", celular: "" },
  ],
  beneficiario: { nombre: "", parentesco: "" },
  direccionEmpresa: { calle: "", colonia: "", municipio: "", cp: "" },
  montoMejoravit: "",
  plazo: "",
  porcentajeCobro: "",
  montoCalculado: "",
  metodoPago: "",
};

const completoLegacy: ClienteDatosFormShape = {
  nombreCliente: "Juan",
  nss: "123",
  curp: "CURP123",
  rfc: "XAXX010101000",
  celular: "5512345678",
  correo: "a@b.co",
  empresa: "ACME",
  registroPatronal: "RP1",
  telefonoEmpresa: "5587654321",
  referencias: [
    { nombre: "R1", celular: "5511111111" },
    { nombre: "R2", celular: "5522222222" },
  ],
  beneficiario: { nombre: "B", parentesco: "Hermano" },
  direccionEmpresa: {
    calle: "C1",
    colonia: "Col",
    municipio: "Mun",
    cp: "01000",
  },
  montoMejoravit: "200000",
  plazo: "24",
  porcentajeCobro: "10",
  montoCalculado: "10000",
  metodoPago: "transferencia",
};

const completoMejoravit: ClienteDatosFormShape = {
  ...completoLegacy,
  nombreCliente: "ANGELA MUNOZ PENA",
  infonavit: fixtureInfonavitCompleto(),
};

test("getClienteDatosCamposFaltantes: formulario vacío lista muchos campos", () => {
  const m = getClienteDatosCamposFaltantes(vacio, { programaDb: "compro_tu_casa" });
  assert.ok(m.length >= 10);
  assert.ok(m.some((x) => x.includes("Nombre del cliente")));
});

test("getClienteDatosCamposFaltantes: Mejoravit sin vivienda estructurada falla", () => {
  const m = getClienteDatosCamposFaltantes(
    { ...completoLegacy, infonavit: undefined },
    {
      montoAprobado: 100_000,
      direccionOpcional: "",
      programaDb: "mejoravit",
      requireInfonavit: true,
    },
  );
  assert.ok(m.some((x) => x.includes("Calle de la vivienda") || x.includes("Nombre(s)")));
});

test("getClienteDatosCamposFaltantes: formulario Mejoravit completo no faltantes", () => {
  assert.deepEqual(
    getClienteDatosCamposFaltantes(completoMejoravit, {
      montoAprobado: 100_000,
      direccionOpcional: "",
      programaDb: "mejoravit",
      requireInfonavit: true,
    }),
    [],
  );
});

test("getClienteDatosCamposFaltantes: trim — solo espacios cuenta como vacío", () => {
  const soloEspacios: ClienteDatosFormShape = {
    ...completoLegacy,
    nombreCliente: "   ",
  };
  assert.ok(
    getClienteDatosCamposFaltantes(soloEspacios, {
      programaDb: "compro_tu_casa",
    }).includes("Nombre del cliente"),
  );
});

test("getClienteDatosCamposFaltantes: RFC vacío no es faltante", () => {
  const sinRfc: ClienteDatosFormShape = { ...completoLegacy, rfc: "" };
  assert.equal(
    getClienteDatosCamposFaltantes(sinRfc, { programaDb: "compro_tu_casa" }).includes(
      "RFC",
    ),
    false,
  );
});

test("getClienteDatosCamposFaltantes: faltan campos de cobro", () => {
  const sinCobro: ClienteDatosFormShape = {
    ...completoLegacy,
    porcentajeCobro: "",
    metodoPago: "",
  };
  const faltantes = getClienteDatosCamposFaltantes(sinCobro, {
    montoAprobado: 100_000,
    programaDb: "compro_tu_casa",
    direccionOpcional: "Calle 1",
  });
  assert.ok(faltantes.includes("Porcentaje de cobro"));
  assert.ok(faltantes.includes("Monto calculado"));
  assert.ok(faltantes.includes("Método de pago"));
});

test("getClienteDatosCamposFaltantes: formulario vacío tiene 50 obligatorios en mejoravit P189", () => {
  assert.equal(
    getClienteDatosCamposFaltantes(vacio, {
      programaDb: "mejoravit",
      requireInfonavit: true,
    }).length,
    CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_MEJORAVIT,
  );
  assert.equal(CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_MEJORAVIT, 50);
});

test("getClienteDatosCamposFaltantes: Mejoravit FLAG OFF usa base 24 (no P189)", () => {
  const m = getClienteDatosCamposFaltantes(
    { ...completoLegacy },
    {
      montoAprobado: 100_000,
      direccionOpcional: "Calle 1",
      programaDb: "mejoravit",
      requireInfonavit: false,
    },
  );
  assert.deepEqual(m, []);
  assert.equal(
    getClienteDatosCamposFaltantes(vacio, {
      programaDb: "mejoravit",
      requireInfonavit: false,
    }).length,
    CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_MEJORAVIT_BASE,
  );
});

test("getClienteDatosCamposFaltantes: compro_tu_casa sin sección Mejoravit", () => {
  assert.equal(
    getClienteDatosCamposFaltantes(vacio, { programaDb: "compro_tu_casa" }).length,
    CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_DEFAULT,
  );
  assert.equal(CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_DEFAULT, 22);
});

test("getClienteDatosCamposFaltantes: notaMesa vacía no es faltante", () => {
  const ctx = {
    montoAprobado: 100_000,
    direccionOpcional: "Calle Principal 123",
    programaDb: "mejoravit",
  };
  assert.deepEqual(
    getClienteDatosCamposFaltantes({ ...completoMejoravit, notaMesa: "" }, { ...ctx, requireInfonavit: true }),
    [],
  );
  assert.deepEqual(
    getClienteDatosCamposFaltantes({ ...completoMejoravit, notaMesa: undefined }, { ...ctx, requireInfonavit: true }),
    [],
  );
});

test("getNotaMesaLongitudError: vacía no genera error", () => {
  assert.equal(getNotaMesaLongitudError(""), null);
  assert.equal(getNotaMesaLongitudError(undefined), null);
});

test("getNotaMesaLongitudError: supera límite", () => {
  assert.ok(getNotaMesaLongitudError("x".repeat(1001)));
});

test("P189 B8: completeness no toma infonavit vacío como autoridad de refs", () => {
  const m = getClienteDatosCamposFaltantes(
    { ...completoLegacy, infonavit: emptyInfonavitClienteDatosV1() },
    {
      montoAprobado: 100_000,
      direccionOpcional: "Calle Principal 123",
      programaDb: "mejoravit",
      requireInfonavit: false,
    },
  );
  assert.equal(
    m.filter((x) => /Referencia/.test(x)).length,
    0,
  );
  assert.equal(
    m.filter((x) => /Nombre del cliente|Beneficiario/.test(x)).length,
    0,
  );
});
