import assert from "node:assert/strict";
import test from "node:test";
import type { ClienteDatosFormShape } from "@/lib/clienteDatosFormCompleteness";
import {
  normalizeClienteDatosForSave,
  normalizeTelefonoMexico,
  validateClienteDatos,
} from "@/lib/clienteDatosValidation";
import { calcMontoCalculadoCobro } from "@/lib/clienteDatosCobro";

const COBRO_CTX = {
  montoAprobado: 100_000,
  direccionOpcional: "Calle Principal 123",
  programaDb: "mejoravit",
};

const baseValid: ClienteDatosFormShape = {
  nombreCliente: "Juan Pérez",
  nss: "12345678901",
  curp: "PEGJ850101HDFRRN09",
  rfc: "PEGJ850101ABC",
  celular: "8119087564",
  correo: "juan@ejemplo.mx",
  empresa: "ACME SA",
  registroPatronal: "A1234567890",
  telefonoEmpresa: "8187654321",
  referencias: [
    { nombre: "Ref Uno", celular: "8111111111" },
    { nombre: "Ref Dos", celular: "8222222222" },
  ],
  beneficiario: { nombre: "María", parentesco: "Hermana" },
  direccionEmpresa: {
    calle: "Av. Principal 100",
    colonia: "Centro",
    municipio: "Monterrey",
    cp: "64000",
  },
  montoMejoravit: "150000",
  plazo: "12 meses",
  porcentajeCobro: "10",
  montoCalculado: "10000",
  metodoPago: "transferencia",
};

test("validateClienteDatos: domicilio real del cliente es obligatorio", () => {
  const sinDomicilio = validateClienteDatos(baseValid, { ...COBRO_CTX, direccionOpcional: "" });
  assert.equal(
    sinDomicilio.errors.direccionOpcional,
    "El domicilio real del cliente es obligatorio.",
  );
  assert.equal(sinDomicilio.isValid, false);

  const conDomicilio = validateClienteDatos(baseValid, {
    ...COBRO_CTX,
    direccionOpcional: "Calle Principal 123",
  });
  assert.equal(conDomicilio.errors.direccionOpcional, undefined);
  assert.equal(conDomicilio.isValid, true);
});

test("validateClienteDatos: monto Mejoravit obligatorio solo en mejoravit", () => {
  const r = validateClienteDatos(
    { ...baseValid, montoMejoravit: "" },
    { ...COBRO_CTX, programaDb: "mejoravit" },
  );
  assert.equal(r.errors.montoMejoravit, "El monto Mejoravit es obligatorio.");
});

test("validateClienteDatos: compro_tu_casa no exige monto Mejoravit", () => {
  const r = validateClienteDatos(
    { ...baseValid, montoMejoravit: "", plazo: "" },
    { ...COBRO_CTX, programaDb: "compro_tu_casa" },
  );
  assert.equal(r.errors.montoMejoravit, undefined);
  assert.equal(r.errors.plazo, undefined);
});

test("validateClienteDatos: monto Mejoravit debe ser mayor a 0", () => {
  const r = validateClienteDatos({ ...baseValid, montoMejoravit: "0" }, COBRO_CTX);
  assert.equal(r.errors.montoMejoravit, "El monto Mejoravit es obligatorio.");
});

test("validateClienteDatos: plazo obligatorio", () => {
  const r = validateClienteDatos({ ...baseValid, plazo: "" }, COBRO_CTX);
  assert.equal(r.errors.plazo, "El plazo es obligatorio.");
});

test("validateClienteDatos: payload válido sin errores", () => {
  const r = validateClienteDatos(baseValid, COBRO_CTX);
  assert.equal(r.isValid, true);
  assert.deepEqual(r.errors, {});
});

test("validateClienteDatos: requerido faltante", () => {
  const r = validateClienteDatos({ ...baseValid, nombreCliente: "" }, COBRO_CTX);
  assert.equal(r.errors.nombreCliente, "Nombre del cliente es obligatorio.");
});

test("validateClienteDatos: NSS inválido", () => {
  const r = validateClienteDatos({ ...baseValid, nss: "123" }, COBRO_CTX);
  assert.equal(r.errors.nss, "NSS debe tener 11 dígitos.");
});

test("normalizeTelefonoMexico: espacios y guiones", () => {
  assert.equal(normalizeTelefonoMexico("81 1908 7564"), "8119087564");
  assert.equal(normalizeTelefonoMexico("(81)1908-7564"), "8119087564");
});

test("validateClienteDatos: celular inválido", () => {
  const r = validateClienteDatos({ ...baseValid, celular: "12345" }, COBRO_CTX);
  assert.equal(r.errors.celular, "Celular debe tener 10 dígitos.");
});

test("validateClienteDatos: celular cliente repetido con referencia 1", () => {
  const r = validateClienteDatos({
    ...baseValid,
    celular: "8119087564",
    referencias: [
      { nombre: "Ref Uno", celular: "81 1908 7564" },
      baseValid.referencias[1],
    ],
  }, COBRO_CTX);
  assert.match(
    r.errors.referencia1Celular ?? "",
    /no puede repetirse con celular del cliente/i,
  );
});

test("validateClienteDatos: referencia 1 repetida con referencia 2", () => {
  const r = validateClienteDatos({
    ...baseValid,
    referencias: [
      { nombre: "Ref Uno", celular: "8111111111" },
      { nombre: "Ref Dos", celular: "8111111111" },
    ],
  }, COBRO_CTX);
  assert.match(
    r.errors.referencia2Celular ?? "",
    /no puede repetirse con referencia 1/i,
  );
});

test("validateClienteDatos: teléfono empresa repetido con celular", () => {
  const r = validateClienteDatos({
    ...baseValid,
    celular: "8119087564",
    telefonoEmpresa: "(81) 1908-7564",
  }, COBRO_CTX);
  assert.match(
    r.errors.telefonoEmpresa ?? "",
    /no puede repetirse con celular del cliente/i,
  );
});

test("validateClienteDatos: correo inválido", () => {
  const r = validateClienteDatos({ ...baseValid, correo: "no-es-email" }, COBRO_CTX);
  assert.equal(r.errors.correo, "Correo no tiene formato válido.");
});

test("validateClienteDatos: CP inválido", () => {
  const r = validateClienteDatos({
    ...baseValid,
    direccionEmpresa: { ...baseValid.direccionEmpresa, cp: "640" },
  }, COBRO_CTX);
  assert.equal(r.errors.direccionCp, "CP debe tener 5 dígitos.");
});

test("validateClienteDatos: CURP minúsculas se validan tras normalizar", () => {
  const r = validateClienteDatos({
    ...baseValid,
    curp: "pegj850101hdfrRN09",
  }, COBRO_CTX);
  assert.equal(r.isValid, true);
});

test("normalizeClienteDatosForSave: CURP y RFC a mayúsculas", () => {
  const n = normalizeClienteDatosForSave({
    ...baseValid,
    curp: "pegj850101hdfrRN09",
    rfc: "pegj850101abc",
  });
  assert.equal(n.curp, "PEGJ850101HDFRRN09");
  assert.equal(n.rfc, "PEGJ850101ABC");
});

test("validateClienteDatos: payload válido sin RFC", () => {
  const r = validateClienteDatos({ ...baseValid, rfc: "" }, COBRO_CTX);
  assert.equal(r.isValid, true);
  assert.equal(r.errors.rfc, undefined);
});

test("validateClienteDatos: RFC vacío no genera error", () => {
  for (const rfc of ["", "   ", null as unknown as string, undefined as unknown as string]) {
    const data = { ...baseValid, rfc: rfc ?? "" };
    const r = validateClienteDatos(data, COBRO_CTX);
    assert.equal(r.errors.rfc, undefined, `rfc=${String(rfc)}`);
  }
});

test("validateClienteDatos: RFC válido con valor pasa", () => {
  const r = validateClienteDatos({ ...baseValid, rfc: "PEGJ850101ABC" }, COBRO_CTX);
  assert.equal(r.isValid, true);
  assert.equal(r.errors.rfc, undefined);
});

test("validateClienteDatos: RFC inválido con valor falla", () => {
  const r = validateClienteDatos({ ...baseValid, rfc: "INVALIDO" }, COBRO_CTX);
  assert.equal(r.errors.rfc, "RFC no tiene formato válido.");
});

test("validateClienteDatos: faltan campos de cobro", () => {
  const r = validateClienteDatos(
    { ...baseValid, porcentajeCobro: "", metodoPago: "" },
    COBRO_CTX,
  );
  assert.equal(r.errors.porcentajeCobro, "Porcentaje de cobro es obligatorio.");
  assert.equal(r.errors.metodoPago, "Método de pago es obligatorio.");
});

test("validateClienteDatos: porcentaje 0 rechaza", () => {
  const r = validateClienteDatos({ ...baseValid, porcentajeCobro: "0" }, COBRO_CTX);
  assert.equal(r.errors.porcentajeCobro, "Porcentaje de cobro debe ser mayor a 0.");
});

test("validateClienteDatos: porcentaje negativo rechaza", () => {
  const r = validateClienteDatos({ ...baseValid, porcentajeCobro: "-1" }, COBRO_CTX);
  assert.equal(r.errors.porcentajeCobro, "Porcentaje de cobro debe ser mayor a 0.");
});

test("validateClienteDatos: porcentaje mayor a 100 rechaza", () => {
  const r = validateClienteDatos({ ...baseValid, porcentajeCobro: "101" }, COBRO_CTX);
  assert.equal(r.errors.porcentajeCobro, "Porcentaje de cobro no puede ser mayor a 100.");
});

test("validateClienteDatos: porcentaje decimal válido acepta", () => {
  const r = validateClienteDatos({ ...baseValid, porcentajeCobro: "12.5" }, COBRO_CTX);
  assert.equal(r.isValid, true);
});

test("validateClienteDatos: sin monto calculado rechaza con mensaje P055", () => {
  const r = validateClienteDatos(
    { ...baseValid, montoCalculado: "" },
    COBRO_CTX,
  );
  assert.equal(
    r.errors.montoCalculado,
    "Captura el monto calculado o permite que se calcule automáticamente.",
  );
});

test("validateClienteDatos: sin monto aprobado rechaza monto calculado", () => {
  const r = validateClienteDatos(
    { ...baseValid, montoCalculado: "" },
    { montoAprobado: null },
  );
  assert.equal(r.errors.montoCalculado, "No hay monto aprobado para calcular el cobro.");
});

test("validateClienteDatos: monto calculado se deriva con base fija", () => {
  assert.equal(calcMontoCalculadoCobro(166_100.12, 10, "compro_tu_casa"), 19_610.01);
  assert.equal(calcMontoCalculadoCobro(100_000, 12.5, "subcuenta"), 15_500);
  assert.equal(
    calcMontoCalculadoCobro(200_000, 10, {
      programaDb: "mejoravit",
      montoMejoravitForm: "150000",
    }),
    18_000,
  );
});
