import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLegacyReferenciaNombre } from "./parse-legacy-referencia-nombre";
import {
  REFERENCIAS_ESTRUCTURADAS_KEY,
  buildReferenciasEstructuradasForSave,
  clienteDatosSavedPreservesCapture,
} from "./referencias-estructuradas";
import {
  buildSaveClienteDatosRpcPayload,
  mapSupabaseRowToExpedienteClienteDatos,
} from "./map-supabase-cliente-datos";
import { normalizeClienteDatosForSave } from "@/lib/clienteDatosValidation";
import type { ExpedienteClienteDatos } from "./types";
import { emptyInfonavitClienteDatosV1 } from "./infonavit-datos";

function baseDatos(
  partial: Partial<ExpedienteClienteDatos["datos"]> = {},
): ExpedienteClienteDatos["datos"] {
  return {
    nombreCliente: "CLIENTE DEMO",
    nss: "12345678901",
    curp: "AAAA900101HDFRRN09",
    rfc: "AAAA900101AAA",
    celular: "8111111111",
    correo: "a@b.co",
    empresa: "ACME",
    registroPatronal: "RP123",
    telefonoEmpresa: "8188888888",
    referencias: [
      {
        nombre: "JUAN CARLOS PEREZ LOPEZ",
        nombres: "JUAN CARLOS",
        apellidoPaterno: "PEREZ",
        apellidoMaterno: "LOPEZ",
        celular: "8111111111",
      },
      {
        nombre: "MARIA ELENA GARCIA RAMIREZ",
        nombres: "MARIA ELENA",
        apellidoPaterno: "GARCIA",
        apellidoMaterno: "RAMIREZ",
        celular: "8222222222",
      },
    ],
    beneficiario: { nombre: "BENEFICIO", parentesco: "HIJO" },
    direccionEmpresa: {
      calle: "CALLE 1",
      colonia: "COL",
      municipio: "MTY",
      cp: "64000",
    },
    montoMejoravit: "150000",
    plazo: "12",
    porcentajeCobro: "12.5",
    montoCalculado: "21750",
    metodoPago: "transferencia",
    notaMesa: "nota",
    infonavit: emptyInfonavitClienteDatosV1(),
    ...partial,
  };
}

/** Espejo mínimo del merge Cloud: p_datos || { referencias: norm }. */
function simulateCloudDatosAfterSave(params: {
  p_datos: Record<string, unknown>;
  p_referencias: { nombre: string; telefono: string }[];
  p_telefono: string;
}): { datos: Record<string, unknown>; referenciasCol: unknown } {
  const v_referencias_norm = params.p_referencias.map((r) => ({
    nombre: r.nombre,
    telefono: r.telefono,
    celular: r.telefono,
  }));
  const datos = {
    ...params.p_datos,
    celular: params.p_telefono,
    telefono: params.p_telefono,
    referencias: v_referencias_norm,
  };
  return { datos, referenciasCol: v_referencias_norm };
}

describe("parseLegacyReferenciaNombre", () => {
  it("CASO K — JOSE LUIS HERRERA RAMIREZ → partes", () => {
    const p = parseLegacyReferenciaNombre("JOSE LUIS HERRERA RAMIREZ");
    assert.equal(p.parsed, true);
    assert.equal(p.nombres, "JOSE LUIS");
    assert.equal(p.apellidoPaterno, "HERRERA");
    assert.equal(p.apellidoMaterno, "RAMIREZ");
    assert.equal(p.nombre, "JOSE LUIS HERRERA RAMIREZ");
  });

  it("partícula DE LA en 5 tokens → high", () => {
    const p = parseLegacyReferenciaNombre("JUAN DE LA CRUZ PEREZ");
    assert.equal(p.parsed, true);
    assert.equal(p.nombres, "JUAN");
    assert.equal(p.apellidoPaterno, "DE LA CRUZ");
    assert.equal(p.apellidoMaterno, "PEREZ");
  });

  it("CASO L — MARIA DEL CARMEN LOPEZ ambiguo: conserva nombre, sin inventar", () => {
    const p = parseLegacyReferenciaNombre("MARIA DEL CARMEN LOPEZ");
    assert.equal(p.parsed, false);
    assert.equal(p.nombre, "MARIA DEL CARMEN LOPEZ");
    assert.equal(p.nombres, "");
    assert.equal(p.apellidoPaterno, "");
    assert.equal(p.apellidoMaterno, "");
  });

  it("2 tokens: no parsea, conserva nombre", () => {
    const p = parseLegacyReferenciaNombre("JOSE PEREZ");
    assert.equal(p.parsed, false);
    assert.equal(p.nombre, "JOSE PEREZ");
  });
});

describe("referenciasEstructuradas round-trip", () => {
  it("CASO D — save/read conserva nombres/apellidos y celulares exactos", () => {
    const form = baseDatos();
    const normalized = normalizeClienteDatosForSave(form);
    const payload = buildSaveClienteDatosRpcPayload(
      "exp-1",
      normalized,
      "DOMICILIO 1",
      "mejoravit",
    );

    assert.ok(Array.isArray(payload.p_datos[REFERENCIAS_ESTRUCTURADAS_KEY]));
    assert.deepEqual(payload.p_referencias[0], {
      nombre: "JUAN CARLOS PEREZ LOPEZ",
      telefono: "8111111111",
    });

    const cloud = simulateCloudDatosAfterSave(payload);
    // Confirm SQL overwrite of referencias (solo nombre/tel).
    assert.equal(
      (cloud.referenciasCol as { nombre: string }[])[0].nombre,
      "JUAN CARLOS PEREZ LOPEZ",
    );
    assert.equal(
      (cloud.referenciasCol as { nombres?: string }[])[0].nombres,
      undefined,
    );
    // Pero estructuradas sobreviven en datos.
    assert.ok(cloud.datos[REFERENCIAS_ESTRUCTURADAS_KEY]);

    const mapped = mapSupabaseRowToExpedienteClienteDatos({
      expediente_id: "exp-1",
      datos: cloud.datos,
      estado: "completo",
      updated_at: "2026-09-07T00:00:00.000Z",
      referencias: cloud.referenciasCol,
      porcentaje_cobro: 12.5,
      monto_calculado: 21750,
      metodo_pago: "transferencia",
    });

    assert.equal(mapped.datos.referencias[0].nombres, "JUAN CARLOS");
    assert.equal(mapped.datos.referencias[0].apellidoPaterno, "PEREZ");
    assert.equal(mapped.datos.referencias[0].apellidoMaterno, "LOPEZ");
    assert.equal(mapped.datos.referencias[0].celular, "8111111111");
    assert.equal(mapped.datos.referencias[1].nombres, "MARIA ELENA");
    assert.equal(mapped.datos.referencias[1].apellidoPaterno, "GARCIA");
    assert.equal(mapped.datos.referencias[1].apellidoMaterno, "RAMIREZ");
    assert.equal(mapped.datos.referencias[1].celular, "8222222222");
    assert.equal(mapped.datos.celular, "8111111111");
    assert.equal(mapped.datos.telefonoEmpresa, "8188888888");
    assert.equal(mapped.datos.nss, "12345678901");
  });

  it("CASO E — segunda save/read idéntica (no degrada)", () => {
    let datos = baseDatos();
    for (let i = 0; i < 2; i += 1) {
      const normalized = normalizeClienteDatosForSave(datos);
      const payload = buildSaveClienteDatosRpcPayload(
        "exp-1",
        normalized,
        "DOM",
        "mejoravit",
      );
      const cloud = simulateCloudDatosAfterSave(payload);
      const mapped = mapSupabaseRowToExpedienteClienteDatos({
        expediente_id: "exp-1",
        datos: cloud.datos,
        estado: "completo",
        updated_at: "2026-09-07T00:00:00.000Z",
        referencias: cloud.referenciasCol,
        porcentaje_cobro: 12.5,
        monto_calculado: 21750,
        metodo_pago: "transferencia",
      });
      datos = mapped.datos;
    }
    assert.equal(datos.referencias[0].nombres, "JUAN CARLOS");
    assert.equal(datos.referencias[0].apellidoPaterno, "PEREZ");
    assert.equal(datos.referencias[1].apellidoMaterno, "RAMIREZ");
  });

  it("CASO J — legacy {nombre,telefono} no aparece vacío", () => {
    const mapped = mapSupabaseRowToExpedienteClienteDatos({
      expediente_id: "exp-leg",
      datos: {
        nombreCliente: "X",
        nss: "1",
        curp: "C",
        rfc: "R",
        celular: "8111111111",
      },
      estado: "completo",
      updated_at: "2026-09-07T00:00:00.000Z",
      referencias: [
        { nombre: "JOSE LUIS HERRERA RAMIREZ", telefono: "8133333333" },
        { nombre: "ANA", telefono: "8144444444" },
      ],
    });
    assert.equal(mapped.datos.referencias[0].nombre, "JOSE LUIS HERRERA RAMIREZ");
    assert.equal(mapped.datos.referencias[0].nombres, "JOSE LUIS");
    assert.equal(mapped.datos.referencias[0].apellidoPaterno, "HERRERA");
    assert.equal(mapped.datos.referencias[0].apellidoMaterno, "RAMIREZ");
    assert.equal(mapped.datos.referencias[0].celular, "8133333333");
    assert.equal(mapped.datos.referencias[0].legacyGrandfathered, true);
    // Ambiguo / corto: conserva nombre, no inventa.
    assert.equal(mapped.datos.referencias[1].nombre, "ANA");
    assert.equal(mapped.datos.referencias[1].celular, "8144444444");
    assert.equal(mapped.datos.referencias[1].legacyGrandfathered, true);
  });

  it("CASO M — externo/silvia: sin referenciasEstructuradas en payload", () => {
    const payload = buildSaveClienteDatosRpcPayload(
      "exp-ext",
      baseDatos({ referencias: [] }),
      "DOM",
      "mejoravit",
      { perfilCaptura: "asesor_equipo_silvia_simplificado" },
    );
    assert.deepEqual(payload.p_referencias, []);
    assert.equal(payload.p_datos[REFERENCIAS_ESTRUCTURADAS_KEY], undefined);
  });

  it("teléfono canónico SQL gana sobre estructuradas viejas", () => {
    const mapped = mapSupabaseRowToExpedienteClienteDatos({
      expediente_id: "exp-tel",
      datos: {
        [REFERENCIAS_ESTRUCTURADAS_KEY]: [
          {
            nombre: "A",
            nombres: "A",
            apellidoPaterno: "B",
            apellidoMaterno: "C",
            celular: "8111111111",
          },
          {
            nombre: "D",
            nombres: "D",
            apellidoPaterno: "E",
            apellidoMaterno: "F",
            celular: "8222222222",
          },
        ],
      },
      estado: "completo",
      updated_at: "2026-09-07T00:00:00.000Z",
      referencias: [
        { nombre: "A B C", telefono: "8199999999" },
        { nombre: "D E F", telefono: "8188888888" },
      ],
    });
    assert.equal(mapped.datos.referencias[0].celular, "8199999999");
    assert.equal(mapped.datos.referencias[0].nombres, "A");
    assert.equal(mapped.datos.referencias[1].celular, "8188888888");
  });
});

describe("clienteDatosSavedPreservesCapture", () => {
  it("PASS cuando saved conserva refs estructuradas", () => {
    const sent = baseDatos();
    assert.equal(
      clienteDatosSavedPreservesCapture({
        sent,
        saved: sent,
        sentDireccionOpcional: "DOM",
        savedDireccionOpcional: "DOM",
        requireReferenciasEstructuradas: true,
      }),
      true,
    );
  });

  it("FAIL si saved pierde apellidos de refs", () => {
    const sent = baseDatos();
    const saved = baseDatos({
      referencias: [
        { nombre: "JUAN CARLOS PEREZ LOPEZ", celular: "8111111111" },
        { nombre: "MARIA ELENA GARCIA RAMIREZ", celular: "8222222222" },
      ],
    });
    assert.equal(
      clienteDatosSavedPreservesCapture({
        sent,
        saved,
        sentDireccionOpcional: "DOM",
        requireReferenciasEstructuradas: true,
      }),
      false,
    );
  });

  it("buildReferenciasEstructuradasForSave length 2", () => {
    const built = buildReferenciasEstructuradasForSave(baseDatos().referencias);
    assert.equal(built.length, 2);
    assert.equal(built[0].nombres, "JUAN CARLOS");
  });
});
