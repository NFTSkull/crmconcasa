import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClienteDatosDraftKey,
  clienteDatosDraftDiffersFromOfficial,
  isDraftNewerThanOfficial,
  parseClienteDatosDraft,
  shouldOfferClienteDatosDraftRestore,
  type ClienteDatosDraft,
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

test("parseClienteDatosDraft: incluye direccionOpcional opcional", () => {
  const raw = JSON.stringify({
    expedienteId: "exp-2",
    updatedAt: "2026-07-07T10:00:00.000Z",
    draftVersion: 1,
    clienteDatos: { nombreCliente: "Luis" },
    direccionOpcional: "Calle 123",
  });
  const draft = parseClienteDatosDraft(raw);
  assert.equal(draft?.direccionOpcional, "Calle 123");
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

test("clienteDatosDraftDiffersFromOfficial: detecta domicilio distinto", () => {
  const base = {
    expedienteId: "exp-2",
    updatedAt: "2026-07-07T11:00:00.000Z",
    draftVersion: 1,
    clienteDatos: {
      nombreCliente: "Ana",
    } as ClienteDatosDraft["clienteDatos"],
    direccionOpcional: "Calle nueva 456",
  };
  const official = { ...base.clienteDatos };
  assert.equal(
    shouldOfferClienteDatosDraftRestore(base, official, ""),
    true,
  );
  assert.equal(
    shouldOfferClienteDatosDraftRestore(base, official, "Calle nueva 456"),
    false,
  );
});

test("clienteDatosDraftDiffersFromOfficial: detecta montoMejoravit distinto", () => {
  const base = {
    expedienteId: "exp-1",
    updatedAt: "2026-07-07T10:00:00.000Z",
    draftVersion: 1,
    clienteDatos: {
      nombreCliente: "Ana",
      montoMejoravit: "150000",
      plazo: "12",
      porcentajeCobro: "",
      montoCalculado: "",
      metodoPago: "",
    } as ClienteDatosDraft["clienteDatos"],
    direccionOpcional: "Calle 1",
  };
  const official = {
    ...base.clienteDatos,
    montoMejoravit: "",
  };
  assert.equal(
    clienteDatosDraftDiffersFromOfficial(base, official, "Calle 1"),
    true,
  );
  assert.equal(
    shouldOfferClienteDatosDraftRestore(base, official, "Calle 1"),
    true,
  );
  assert.equal(
    shouldOfferClienteDatosDraftRestore(
      base,
      { ...official, montoMejoravit: "150000" },
      "Calle 1",
    ),
    false,
  );
});
