import assert from "node:assert/strict";
import test from "node:test";
import {
  getClienteDatosCamposFaltantes,
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
};

test("getClienteDatosCamposFaltantes: formulario vacío lista muchos campos", () => {
  const m = getClienteDatosCamposFaltantes(vacio);
  assert.ok(m.length >= 10);
  assert.ok(m.some((x) => x.includes("Nombre del cliente")));
});

test("getClienteDatosCamposFaltantes: formulario completo no devuelve faltantes", () => {
  assert.deepEqual(getClienteDatosCamposFaltantes(completo), []);
});

test("getClienteDatosCamposFaltantes: trim — solo espacios cuenta como vacío", () => {
  const soloEspacios: ClienteDatosFormShape = {
    ...completo,
    nombreCliente: "   ",
  };
  assert.ok(getClienteDatosCamposFaltantes(soloEspacios).includes("Nombre del cliente"));
});

test("getClienteDatosCamposFaltantes: RFC vacío es faltante", () => {
  const sinRfc: ClienteDatosFormShape = { ...completo, rfc: "" };
  assert.ok(getClienteDatosCamposFaltantes(sinRfc).includes("RFC"));
});
