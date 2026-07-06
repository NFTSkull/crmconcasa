import assert from "node:assert/strict";
import test from "node:test";
import type { ClienteDatosFormShape } from "@/lib/clienteDatosFormCompleteness";
import {
  applyMontoMejoravitSugeridoSiVacio,
  calcBaseCobro,
  calcBaseCobroDesdeMontoEditor,
  calcMontoCalculadoCobro,
  calcMontoMejoravitDesdeEditor,
  isMontoMejoravitGuardado,
  parseMontoCalculadoInput,
  parsePorcentajeCobroInput,
} from "./clienteDatosCobro";

const BASE_DATOS: ClienteDatosFormShape = {
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

test("parsePorcentajeCobroInput acepta decimales", () => {
  assert.equal(parsePorcentajeCobroInput("12.5"), 12.5);
  assert.equal(parsePorcentajeCobroInput("10"), 10);
});

test("parseMontoCalculadoInput acepta montos", () => {
  assert.equal(parseMontoCalculadoInput("2500"), 2500);
  assert.equal(parseMontoCalculadoInput("$2,500.50"), 2500.5);
  assert.equal(parseMontoCalculadoInput(""), null);
});

test("calcMontoMejoravitDesdeEditor — casos de negocio", () => {
  assert.equal(calcMontoMejoravitDesdeEditor(150000), 133500);
  assert.equal(calcMontoMejoravitDesdeEditor(170000), 151300);
  assert.equal(calcMontoMejoravitDesdeEditor(200000), 169000);
  assert.equal(calcMontoMejoravitDesdeEditor(28584.57), 25440.27);
});

test("Mejoravit editor 200000 autopopula 169000 si vacío", () => {
  const result = applyMontoMejoravitSugeridoSiVacio(
    { ...BASE_DATOS, montoMejoravit: "" },
    "mejoravit",
    200000,
  );
  assert.equal(result.montoMejoravit, "169000");
});

test("applyMontoMejoravitSugeridoSiVacio no pisa valor guardado al recargar", () => {
  const result = applyMontoMejoravitSugeridoSiVacio(
    { ...BASE_DATOS, montoMejoravit: "150000" },
    "mejoravit",
    200000,
  );
  assert.equal(result.montoMejoravit, "150000");
  assert.equal(isMontoMejoravitGuardado("150000"), true);
});

test("calcMontoCalculadoCobro — otros programas sin 11% ni tope", () => {
  assert.equal(calcMontoCalculadoCobro(100000, 10, "compro_tu_casa"), 13000);
  assert.equal(calcMontoCalculadoCobro(25000, 12.5, "subcuenta"), 6125);
  assert.equal(calcMontoCalculadoCobro(166100.12, 10, "compro_tu_casa"), 19610.01);
  assert.equal(calcMontoCalculadoCobro(747580, 10, "compro_tu_casa"), 77758);
});

test("calcMontoCalculadoCobro — Mejoravit usa montoMejoravit del formulario", () => {
  assert.equal(
    calcMontoCalculadoCobro(200000, 10, {
      programaDb: "mejoravit",
      montoMejoravitForm: "169000",
    }),
    19900,
  );
  assert.equal(
    calcMontoCalculadoCobro(200000, 10, {
      programaDb: "mejoravit",
      montoMejoravitForm: "150000",
    }),
    18000,
  );
  assert.equal(
    calcMontoCalculadoCobro(28584.57, 10, {
      programaDb: "mejoravit",
      montoMejoravitForm: "25440.27",
    }),
    5544.03,
  );
});

test("calcMontoCalculadoCobro — Mejoravit sin monto en formulario devuelve null", () => {
  assert.equal(calcMontoCalculadoCobro(200000, 10, "mejoravit"), null);
  assert.equal(
    calcMontoCalculadoCobro(200000, 10, {
      programaDb: "mejoravit",
      montoMejoravitForm: "",
    }),
    null,
  );
});

test("calcBaseCobroDesdeMontoEditor — solo sugerido", () => {
  assert.equal(calcBaseCobroDesdeMontoEditor("mejoravit", 200000), 169000);
  assert.equal(calcBaseCobroDesdeMontoEditor("compro_tu_casa", 747580), 747580);
});

test("calcBaseCobro — Mejoravit desde formulario", () => {
  assert.equal(calcBaseCobro("mejoravit", 200000, "150000"), 150000);
  assert.equal(calcBaseCobro("compro_tu_casa", 747580, ""), 747580);
});

test("calcMontoCalculadoCobro sin monto aprobado devuelve null en no-Mejoravit", () => {
  assert.equal(calcMontoCalculadoCobro(null, 10, "compro_tu_casa"), null);
  assert.equal(calcMontoCalculadoCobro(0, 10, "compro_tu_casa"), null);
});
