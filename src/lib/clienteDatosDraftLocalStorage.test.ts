import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClienteDatosDraftKey,
  isDraftNewerThanOfficial,
  parseClienteDatosDraft,
} from "./clienteDatosDraftLocalStorage";

test("buildClienteDatosDraftKey: incluye user y expediente normalizados", () => {
  assert.equal(
    buildClienteDatosDraftKey(" Asesor@Mail.COM ", "exp-42"),
    "crmconcasa:cliente-datos-draft:asesor@mail.com:exp-42",
  );
});

test("parseClienteDatosDraft: shape válido", () => {
  const raw = JSON.stringify({
    expedienteId: "exp-1",
    updatedAt: "2026-07-06T12:00:00.000Z",
    draftVersion: 1,
    clienteDatos: {
      nombreCliente: "Ana",
      nss: "123",
      curp: "CURP",
      rfc: "RFC",
      celular: "5512345678",
      correo: "a@b.co",
      empresa: "ACME",
      registroPatronal: "RP",
      telefonoEmpresa: "5587654321",
      referencias: [{ nombre: "R1", celular: "5511111111" }],
      beneficiario: { nombre: "B", parentesco: "Hermana" },
      direccionEmpresa: {
        calle: "C1",
        colonia: "Col",
        municipio: "Mun",
        cp: "01000",
      },
    },
  });
  const draft = parseClienteDatosDraft(raw);
  assert.ok(draft);
  assert.equal(draft?.expedienteId, "exp-1");
  assert.equal(draft?.clienteDatos.nombreCliente, "Ana");
});

test("isDraftNewerThanOfficial: sin oficial → true", () => {
  assert.equal(
    isDraftNewerThanOfficial("2026-07-06T12:00:00.000Z", null),
    true,
  );
});

test("isDraftNewerThanOfficial: borrador más reciente → true", () => {
  assert.equal(
    isDraftNewerThanOfficial(
      "2026-07-06T13:00:00.000Z",
      "2026-07-06T12:00:00.000Z",
    ),
    true,
  );
});

test("isDraftNewerThanOfficial: oficial más reciente → false", () => {
  assert.equal(
    isDraftNewerThanOfficial(
      "2026-07-06T12:00:00.000Z",
      "2026-07-06T13:00:00.000Z",
    ),
    false,
  );
});
