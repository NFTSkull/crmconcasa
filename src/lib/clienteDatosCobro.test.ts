import assert from "node:assert/strict";
import test from "node:test";
import type { ClienteDatosFormShape } from "@/lib/clienteDatosFormCompleteness";
import {
  applyMontoCalculadoSugeridoSiNoBloqueado,
  applyMontoCalculadoSugeridoSiNoEditado,
  applyMontoMejoravitSugeridoSiVacio,
  calcBaseCobro,
  calcBaseCobroDesdeMontoEditor,
  calcMontoCalculadoCobro,
  calcMontoMejoravitDesdeEditor,
  cobroInputsAfectanMontoCalculado,
  isMontoCalculadoManualRespectoAuto,
  isMontoMejoravitGuardado,
  parseMontoCalculadoInput,
  parsePorcentajeCobroInput,
  resolveMontoCalculadoManualForRpc,
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

test("P055: default automático base 150000 porcentaje 10 → 18000", () => {
  assert.equal(calcMontoCalculadoCobro(150000, 10, "compro_tu_casa"), 18000);
});

test("P055: resolveMontoCalculadoManualForRpc manual 17000", () => {
  assert.equal(resolveMontoCalculadoManualForRpc("17000", true), 17000);
  assert.equal(resolveMontoCalculadoManualForRpc("17000", false), null);
});

test("P055: applyMontoCalculadoSugeridoSiNoEditado respeta valor distinto al auto", () => {
  const conManual = applyMontoCalculadoSugeridoSiNoBloqueado(
    { ...BASE_DATOS, porcentajeCobro: "10", montoCalculado: "17000" },
    150000,
    "compro_tu_casa",
    true,
  );
  assert.equal(conManual.montoCalculado, "17000");
});

test("P055: applyMontoCalculadoSugeridoSiNoEditado autopuebla 18000", () => {
  const auto = applyMontoCalculadoSugeridoSiNoEditado(
    { ...BASE_DATOS, porcentajeCobro: "10", montoCalculado: "" },
    150000,
    "compro_tu_casa",
  );
  assert.equal(auto.montoCalculado, "18000");
});

test("P055.1: porcentaje 10 con montoMejoravit 150000 autopuebla 18000", () => {
  const auto = applyMontoCalculadoSugeridoSiNoEditado(
    {
      ...BASE_DATOS,
      porcentajeCobro: "10",
      montoMejoravit: "150000",
      montoCalculado: "",
    },
    200000,
    "mejoravit",
  );
  assert.equal(auto.montoCalculado, "18000");
});

test("P055.1: porcentaje 25 con montoMejoravit 150000 autopuebla 40500", () => {
  const auto = applyMontoCalculadoSugeridoSiNoEditado(
    {
      ...BASE_DATOS,
      porcentajeCobro: "25",
      montoMejoravit: "150000",
      montoCalculado: "",
    },
    200000,
    "mejoravit",
  );
  assert.equal(auto.montoCalculado, "40500");
});

test("P055.1: applyMontoCalculadoSugeridoSiNoBloqueado respeta lock manual", () => {
  const datos = {
    ...BASE_DATOS,
    porcentajeCobro: "10",
    montoMejoravit: "150000",
    montoCalculado: "17000",
  };
  const bloqueado = applyMontoCalculadoSugeridoSiNoBloqueado(
    { ...datos, porcentajeCobro: "25" },
    200000,
    "mejoravit",
    true,
  );
  assert.equal(bloqueado.montoCalculado, "17000");
});

test("P055.1: vacío + porcentaje recalcula al cambiar base", () => {
  const vacioPct10 = applyMontoCalculadoSugeridoSiNoEditado(
    {
      ...BASE_DATOS,
      porcentajeCobro: "10",
      montoMejoravit: "150000",
      montoCalculado: "",
    },
    200000,
    "mejoravit",
  );
  assert.equal(vacioPct10.montoCalculado, "18000");

  const pct25 = applyMontoCalculadoSugeridoSiNoEditado(
    { ...vacioPct10, porcentajeCobro: "25" },
    200000,
    "mejoravit",
  );
  assert.equal(pct25.montoCalculado, "40500");
});

test("P055.1: montoMejoravit cambia recalcula si no hay lock", () => {
  const base = {
    ...BASE_DATOS,
    porcentajeCobro: "10",
    montoMejoravit: "150000",
    montoCalculado: "18000",
  };
  const recalculado = applyMontoCalculadoSugeridoSiNoBloqueado(
    { ...base, montoMejoravit: "169000" },
    200000,
    "mejoravit",
    false,
  );
  assert.equal(recalculado.montoCalculado, "19900");
});

test("P055.1: montoMejoravit cambia no pisa manual bloqueado", () => {
  const manual = applyMontoCalculadoSugeridoSiNoBloqueado(
    {
      ...BASE_DATOS,
      porcentajeCobro: "10",
      montoMejoravit: "169000",
      montoCalculado: "17000",
    },
    200000,
    "mejoravit",
    true,
  );
  assert.equal(manual.montoCalculado, "17000");
});

test("P055.1: isMontoCalculadoManualRespectoAuto no bloquea sin auto comparable", () => {
  assert.equal(isMontoCalculadoManualRespectoAuto("17000", null), false);
  assert.equal(isMontoCalculadoManualRespectoAuto("", null), false);
});

test("P055.1: cobroInputsAfectanMontoCalculado detecta porcentaje y montoMejoravit", () => {
  const prev = { ...BASE_DATOS, porcentajeCobro: "10", montoMejoravit: "150000" };
  assert.equal(
    cobroInputsAfectanMontoCalculado(prev, { ...prev, porcentajeCobro: "25" }),
    true,
  );
  assert.equal(
    cobroInputsAfectanMontoCalculado(prev, { ...prev, montoMejoravit: "169000" }),
    true,
  );
  assert.equal(
    cobroInputsAfectanMontoCalculado(prev, { ...prev, nombreCliente: "Ana" }),
    false,
  );
});
