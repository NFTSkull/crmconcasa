import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_DEFAULT,
  CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_MEJORAVIT,
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

const completo: ClienteDatosFormShape = {
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
  plazo: "24 meses",
  porcentajeCobro: "10",
  montoCalculado: "10000",
  metodoPago: "transferencia",
};

test("getClienteDatosCamposFaltantes: formulario vacío lista muchos campos", () => {
  const m = getClienteDatosCamposFaltantes(vacio);
  assert.ok(m.length >= 10);
  assert.ok(m.some((x) => x.includes("Nombre del cliente")));
});

test("getClienteDatosCamposFaltantes: formulario completo sin domicilio real falla", () => {
  const m = getClienteDatosCamposFaltantes(completo, {
    montoAprobado: 100_000,
    direccionOpcional: "",
    programaDb: "mejoravit",
  });
  assert.ok(m.includes("Domicilio real del cliente"));
});

test("getClienteDatosCamposFaltantes: formulario completo no devuelve faltantes", () => {
  assert.deepEqual(
    getClienteDatosCamposFaltantes(completo, {
      montoAprobado: 100_000,
      direccionOpcional: "Calle Principal 123",
      programaDb: "mejoravit",
    }),
    [],
  );
});

test("getClienteDatosCamposFaltantes: trim — solo espacios cuenta como vacío", () => {
  const soloEspacios: ClienteDatosFormShape = {
    ...completo,
    nombreCliente: "   ",
  };
  assert.ok(getClienteDatosCamposFaltantes(soloEspacios).includes("Nombre del cliente"));
});

test("getClienteDatosCamposFaltantes: RFC vacío no es faltante", () => {
  const sinRfc: ClienteDatosFormShape = { ...completo, rfc: "" };
  assert.equal(
    getClienteDatosCamposFaltantes(sinRfc).includes("RFC"),
    false,
  );
});

test("getClienteDatosCamposFaltantes: faltan campos de cobro", () => {
  const sinCobro: ClienteDatosFormShape = {
    ...completo,
    porcentajeCobro: "",
    metodoPago: "",
  };
  const faltantes = getClienteDatosCamposFaltantes(sinCobro, { montoAprobado: 100_000 });
  assert.ok(faltantes.includes("Porcentaje de cobro"));
  assert.ok(faltantes.includes("Monto calculado"));
  assert.ok(faltantes.includes("Método de pago"));
});

test("getClienteDatosCamposFaltantes: formulario vacío tiene 24 obligatorios en mejoravit", () => {
  assert.equal(
    getClienteDatosCamposFaltantes(vacio, { programaDb: "mejoravit" }).length,
    CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_MEJORAVIT,
  );
  assert.equal(CLIENTE_DATOS_OBLIGATORY_FIELD_COUNT_MEJORAVIT, 24);
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
  assert.deepEqual(getClienteDatosCamposFaltantes({ ...completo, notaMesa: "" }, ctx), []);
  assert.deepEqual(
    getClienteDatosCamposFaltantes({ ...completo, notaMesa: undefined }, ctx),
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
