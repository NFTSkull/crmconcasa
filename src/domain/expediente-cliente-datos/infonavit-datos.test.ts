import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatInfonavitDwellingAddress,
  hasCapturedInfonavitV1,
  joinNombreCompletoInfonavit,
  mapDatosInfonavitFromUnknown,
  emptyInfonavitClienteDatosV1,
} from "./infonavit-datos";
import { fixtureInfonavitCompleto } from "./infonavit-datos.fixtures";
import {
  combineLadaTelefonoMexico,
  findDuplicateTelefonosIntraExpediente,
} from "./infonavit-telefonos";
import {
  buildSaveClienteDatosRpcPayload,
  mapSupabaseRowToExpedienteClienteDatos,
} from "./map-supabase-cliente-datos";
import type { ExpedienteClienteDatos } from "./types";

describe("P189 B2 infonavit-datos", () => {
  it("joinNombreCompleto no parsea: solo concatena", () => {
    assert.equal(
      joinNombreCompletoInfonavit({
        nombres: "ANGELA",
        apellidoPaterno: "MUNOZ",
        apellidoMaterno: "PENA",
      }),
      "ANGELA MUNOZ PENA",
    );
  });

  it("formatInfonavitDwellingAddress determinista", () => {
    const f = fixtureInfonavitCompleto();
    const addr = formatInfonavitDwellingAddress(f.vivienda);
    assert.match(addr, /AV NIÑOS HEROES 123/);
    assert.match(addr, /Col\. PENASCO/);
    assert.match(addr, /CP 66450/);
  });

  it("mapper legacy sin infonavit → defaults seguros", () => {
    const m = mapDatosInfonavitFromUnknown(undefined);
    assert.equal(m.schemaVersion, 1);
    assert.equal(m.titular.nombres, "");
    assert.equal(m.referencias.length, 2);
  });

  it("mapper malformado no throw", () => {
    const m = mapDatosInfonavitFromUnknown({
      schemaVersion: 99,
      titular: "x",
    });
    assert.equal(m.titular.nombres, "");
  });

  it("casado→soltero limpia regimen en serialize vía map", () => {
    const m = mapDatosInfonavitFromUnknown({
      schemaVersion: 1,
      titular: {
        estadoCivil: "soltero",
        regimenMatrimonial: "sociedad_conyugal",
      },
    });
    assert.equal(m.titular.regimenMatrimonial, "");
  });
});

describe("P189 B2 teléfonos LADA + unicidad", () => {
  it("combineLadaTelefonoMexico 81+12345678 → 8112345678", () => {
    const r = combineLadaTelefonoMexico("81", "12345678");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.phone, "8112345678");
  });

  it("rechaza LADA 52 (código país)", () => {
    const r = combineLadaTelefonoMexico("52", "8112345678");
    assert.equal(r.ok, false);
  });

  it("detecta duplicados normalizados +52 vs 10 dígitos", () => {
    const dups = findDuplicateTelefonosIntraExpediente([
      { slot: "cliente.celular", raw: "+52 81 1234 5678" },
      { slot: "empresa.telefono", raw: "8112345678" },
    ]);
    assert.equal(dups.length, 1);
    assert.equal(dups[0]?.slot, "empresa.telefono");
  });

  it("LADA+tel vs celular mismo número → duplicate", () => {
    const fijo = combineLadaTelefonoMexico("81", "12345678");
    assert.ok(fijo.ok);
    if (!fijo.ok) return;
    const dups = findDuplicateTelefonosIntraExpediente([
      { slot: "cliente.celular", raw: "8112345678" },
      { slot: "ref1.telefonoCompleto", raw: fijo.phone },
    ]);
    assert.equal(dups.length, 1);
  });

  it("matriz: todos distintos → sin dups", () => {
    const dups = findDuplicateTelefonosIntraExpediente([
      { slot: "cliente.celular", raw: "8100000001" },
      { slot: "empresa.telefono", raw: "8100000002" },
      { slot: "ref1.telefonoCompleto", raw: "8100000003" },
      { slot: "ref1.celular", raw: "8100000004" },
      { slot: "ref2.telefonoCompleto", raw: "8100000005" },
      { slot: "ref2.celular", raw: "8100000006" },
    ]);
    assert.equal(dups.length, 0);
  });

  const pairs: Array<[string, string]> = [
    ["cliente.celular", "empresa.telefono"],
    ["cliente.celular", "ref1.celular"],
    ["cliente.celular", "ref1.telefonoCompleto"],
    ["cliente.celular", "ref2.celular"],
    ["cliente.celular", "ref2.telefonoCompleto"],
    ["empresa.telefono", "ref1.telefonoCompleto"],
    ["empresa.telefono", "ref1.celular"],
    ["empresa.telefono", "ref2.telefonoCompleto"],
    ["empresa.telefono", "ref2.celular"],
    ["ref1.celular", "ref1.telefonoCompleto"],
    ["ref1.celular", "ref2.celular"],
    ["ref1.celular", "ref2.telefonoCompleto"],
    ["ref1.telefonoCompleto", "ref2.telefonoCompleto"],
    ["ref1.telefonoCompleto", "ref2.celular"],
    ["ref2.telefonoCompleto", "ref2.celular"],
  ];
  for (const [a, b] of pairs) {
    it(`dup ${a} vs ${b}`, () => {
      const dups = findDuplicateTelefonosIntraExpediente([
        { slot: a as never, raw: "8112345678" },
        { slot: b as never, raw: "8112345678" },
      ]);
      assert.equal(dups.length, 1);
    });
  }
});

describe("P189 B2 mapper/save persistence", () => {
  it("map carga infonavit schemaVersion 1", () => {
    const domain = mapSupabaseRowToExpedienteClienteDatos({
      expediente_id: "exp-inf",
      estado: "completo",
      updated_at: "2026-08-17T12:00:00.000Z",
      datos: {
        nombreCliente: "ANGELA MUNOZ PENA",
        infonavit: fixtureInfonavitCompleto(),
      },
    });
    assert.equal(domain.datos.infonavit?.titular.nombres, "ANGELA");
    assert.equal(domain.datos.infonavit?.mejora.presupuestoEstimado, "98000");
  });

  it("map legacy sin infonavit no crash", () => {
    const domain = mapSupabaseRowToExpedienteClienteDatos({
      expediente_id: "exp-leg",
      estado: "completo",
      updated_at: "2026-08-17T12:00:00.000Z",
      datos: { nombreCliente: "Legacy Nombre" },
    });
    assert.equal(domain.datos.nombreCliente, "Legacy Nombre");
    assert.equal(domain.datos.infonavit?.schemaVersion, 1);
    assert.equal(domain.datos.infonavit?.titular.nombres, "");
  });

  it("buildSave incluye datos.infonavit en Mejoravit", () => {
    const datos: ExpedienteClienteDatos["datos"] = {
      nombreCliente: "ANGELA MUNOZ PENA",
      nss: "12345678901",
      curp: "MUXA900203MNLRNN08",
      rfc: "",
      celular: "8112345678",
      correo: "a@example.com",
      empresa: "EMP",
      registroPatronal: "Y1",
      telefonoEmpresa: "8187654321",
      referencias: [
        { nombre: "ANA PEREZ DIAZ", celular: "8111111111" },
        { nombre: "LUIS RAMIREZ SOTO", celular: "8222222222" },
      ],
      beneficiario: { nombre: "ROCIO", parentesco: "MADRE" },
      direccionEmpresa: {
        calle: "C",
        colonia: "Col",
        municipio: "Mty",
        cp: "64000",
      },
      montoMejoravit: "150000",
      plazo: "24",
      porcentajeCobro: "10",
      montoCalculado: "15000",
      metodoPago: "transferencia",
      notaMesa: "",
      infonavit: fixtureInfonavitCompleto(),
    };
    const payload = buildSaveClienteDatosRpcPayload(
      "exp-1",
      datos,
      "AV 1",
      "mejoravit",
    );
    assert.ok(payload.p_datos.infonavit);
    const inf = payload.p_datos.infonavit as { schemaVersion: number };
    assert.equal(inf.schemaVersion, 1);
  });

  it("buildSave no incluye infonavit en compro_tu_casa", () => {
    const datos: ExpedienteClienteDatos["datos"] = {
      nombreCliente: "X",
      nss: "12345678901",
      curp: "PEGJ850101HDFRRN09",
      rfc: "",
      celular: "8112345678",
      correo: "a@example.com",
      empresa: "EMP",
      registroPatronal: "Y1",
      telefonoEmpresa: "8187654321",
      referencias: [
        { nombre: "R1", celular: "8111111111" },
        { nombre: "R2", celular: "8222222222" },
      ],
      beneficiario: { nombre: "B", parentesco: "Hijo" },
      direccionEmpresa: {
        calle: "C",
        colonia: "Col",
        municipio: "Mty",
        cp: "64000",
      },
      montoMejoravit: "",
      plazo: "",
      porcentajeCobro: "10",
      montoCalculado: "1000",
      metodoPago: "transferencia",
      notaMesa: "nota",
      infonavit: fixtureInfonavitCompleto(),
    };
    const payload = buildSaveClienteDatosRpcPayload(
      "exp-2",
      datos,
      "Calle 1",
      "compro_tu_casa",
    );
    assert.equal(payload.p_datos.infonavit, undefined);
    assert.equal(payload.p_datos.notaMesa, "nota");
  });
});

describe("P189 B7.1 no autogenerar infonavit vacío", () => {
  it("empty / missing no cuenta como capturado", () => {
    assert.equal(hasCapturedInfonavitV1(undefined), false);
    assert.equal(hasCapturedInfonavitV1(emptyInfonavitClienteDatosV1()), false);
    assert.equal(hasCapturedInfonavitV1(fixtureInfonavitCompleto()), true);
  });

  it("buildSave Mejoravit sin captura omite datos.infonavit", () => {
    const datos: ExpedienteClienteDatos["datos"] = {
      nombreCliente: "Legacy Cliente",
      nss: "12345678901",
      curp: "PEGJ850101HDFRRN09",
      rfc: "",
      celular: "8112345678",
      correo: "a@example.com",
      empresa: "EMP",
      registroPatronal: "Y1",
      telefonoEmpresa: "8187654321",
      referencias: [
        { nombre: "R1", celular: "8111111111" },
        { nombre: "R2", celular: "8222222222" },
      ],
      beneficiario: { nombre: "B", parentesco: "Hijo" },
      direccionEmpresa: {
        calle: "C",
        colonia: "Col",
        municipio: "Mty",
        cp: "64000",
      },
      montoMejoravit: "150000",
      plazo: "5",
      porcentajeCobro: "10",
      montoCalculado: "15000",
      metodoPago: "transferencia",
      notaMesa: "",
      infonavit: emptyInfonavitClienteDatosV1(),
    };
    const payload = buildSaveClienteDatosRpcPayload(
      "exp-legacy",
      datos,
      "Calle 1",
      "mejoravit",
    );
    assert.equal(payload.p_datos.infonavit, undefined);
  });

  it("buildSave Mejoravit con v1 capturado conserva el bloque", () => {
    const datos: ExpedienteClienteDatos["datos"] = {
      nombreCliente: "ANGELA MUNOZ PENA",
      nss: "12345678901",
      curp: "MUXA900203MNLRNN08",
      rfc: "",
      celular: "8112345678",
      correo: "a@example.com",
      empresa: "EMP",
      registroPatronal: "Y1",
      telefonoEmpresa: "8187654321",
      referencias: [
        { nombre: "ANA PEREZ DIAZ", celular: "8111111111" },
        { nombre: "LUIS RAMIREZ SOTO", celular: "8222222222" },
      ],
      beneficiario: { nombre: "ROCIO", parentesco: "MADRE" },
      direccionEmpresa: {
        calle: "C",
        colonia: "Col",
        municipio: "Mty",
        cp: "64000",
      },
      montoMejoravit: "150000",
      plazo: "5",
      porcentajeCobro: "10",
      montoCalculado: "15000",
      metodoPago: "transferencia",
      notaMesa: "",
      infonavit: fixtureInfonavitCompleto(),
    };
    const payload = buildSaveClienteDatosRpcPayload(
      "exp-keep",
      datos,
      "Calle 1",
      "mejoravit",
    );
    assert.ok(payload.p_datos.infonavit);
  });
});
