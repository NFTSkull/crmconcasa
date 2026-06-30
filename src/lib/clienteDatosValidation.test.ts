import assert from "node:assert/strict";
import test from "node:test";
import type { ClienteDatosFormShape } from "@/lib/clienteDatosFormCompleteness";
import {
  normalizeClienteDatosForSave,
  normalizeTelefonoMexico,
  validateClienteDatos,
} from "@/lib/clienteDatosValidation";

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
};

test("validateClienteDatos: payload válido sin errores", () => {
  const r = validateClienteDatos(baseValid);
  assert.equal(r.isValid, true);
  assert.deepEqual(r.errors, {});
});

test("validateClienteDatos: requerido faltante", () => {
  const r = validateClienteDatos({ ...baseValid, nombreCliente: "" });
  assert.equal(r.errors.nombreCliente, "Nombre del cliente es obligatorio.");
});

test("validateClienteDatos: NSS inválido", () => {
  const r = validateClienteDatos({ ...baseValid, nss: "123" });
  assert.equal(r.errors.nss, "NSS debe tener 11 dígitos.");
});

test("normalizeTelefonoMexico: espacios y guiones", () => {
  assert.equal(normalizeTelefonoMexico("81 1908 7564"), "8119087564");
  assert.equal(normalizeTelefonoMexico("(81)1908-7564"), "8119087564");
});

test("validateClienteDatos: celular inválido", () => {
  const r = validateClienteDatos({ ...baseValid, celular: "12345" });
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
  });
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
  });
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
  });
  assert.match(
    r.errors.telefonoEmpresa ?? "",
    /no puede repetirse con celular del cliente/i,
  );
});

test("validateClienteDatos: correo inválido", () => {
  const r = validateClienteDatos({ ...baseValid, correo: "no-es-email" });
  assert.equal(r.errors.correo, "Correo no tiene formato válido.");
});

test("validateClienteDatos: CP inválido", () => {
  const r = validateClienteDatos({
    ...baseValid,
    direccionEmpresa: { ...baseValid.direccionEmpresa, cp: "640" },
  });
  assert.equal(r.errors.direccionCp, "CP debe tener 5 dígitos.");
});

test("validateClienteDatos: CURP minúsculas se validan tras normalizar", () => {
  const r = validateClienteDatos({
    ...baseValid,
    curp: "pegj850101hdfrRN09",
  });
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

test("validateClienteDatos: RFC inválido", () => {
  const r = validateClienteDatos({ ...baseValid, rfc: "INVALIDO" });
  assert.equal(r.errors.rfc, "RFC no tiene formato válido.");
});
