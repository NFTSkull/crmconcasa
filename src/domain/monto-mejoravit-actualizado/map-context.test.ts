import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapActualizarMontoMejoravitResult,
  mapExpedienteMontoMejoravitContext,
  MontoMejoravitContextParseError,
} from "./map-context";
import {
  calculateMontoDifference,
  calculateUpdatedCobro,
  describeMontoDifference,
  parseMontoInput,
  roundMoney,
  validateMontoMejoravitUpdate,
} from "./helpers";
import {
  mapMontoMejoravitRpcError,
  MONTO_MEJORAVIT_CONCURRENCY_MESSAGE,
} from "./rpc-error";

function sampleContext(overrides: Record<string, unknown> = {}) {
  return {
    expediente_id: "e1111111-1111-4111-8111-111111111111",
    monto_aprobado_editor: 250000,
    monto_snapshot_primera_aprobacion: 250000,
    monto_mejoravit_datos_generales: 150000,
    monto_mejoravit_actualizado: null,
    monto_operativo_vigente: 150000,
    monto_original_operativo: 150000,
    porcentaje_cobro: 12.5,
    cargo_fijo: 3000,
    monto_calculado: 21750,
    ultima_actualizacion: null,
    historial: [],
    can_update: true,
    ...overrides,
  };
}

describe("mapExpedienteMontoMejoravitContext", () => {
  it("normaliza snake_case, nulos e historial vacío", () => {
    const ctx = mapExpedienteMontoMejoravitContext(sampleContext());
    assert.equal(ctx.expedienteId, "e1111111-1111-4111-8111-111111111111");
    assert.equal(ctx.montoMejoravitActualizado, null);
    assert.equal(ctx.montoOperativoVigente, 150000);
    assert.equal(ctx.cargoFijo, 3000);
    assert.equal(ctx.historial.length, 0);
    assert.equal(ctx.canUpdate, true);
    assert.equal(ctx.ultimaActualizacion, null);
  });

  it("parsea historial múltiple y última actualización", () => {
    const ctx = mapExpedienteMontoMejoravitContext(
      sampleContext({
        monto_mejoravit_actualizado: 200000,
        monto_operativo_vigente: 200000,
        ultima_actualizacion: {
          monto_nuevo: 200000,
          motivo: "Ajuste",
          updated_at: "2026-07-20T12:00:00Z",
          updated_by: "u1",
          updated_by_name: "Mesa Admin",
        },
        historial: [
          {
            id: "h2",
            monto_anterior: 180000,
            monto_nuevo: 200000,
            diferencia: 20000,
            porcentaje_cobro: 12.5,
            monto_cobro_anterior: 25500,
            monto_cobro_nuevo: 28000,
            motivo: "Segundo",
            created_at: "2026-07-20T13:00:00Z",
            created_by: "u1",
            created_by_name: "Mesa Admin",
          },
          {
            id: "h1",
            monto_anterior: 150000,
            monto_nuevo: 180000,
            diferencia: 30000,
            porcentaje_cobro: 12.5,
            monto_cobro_anterior: 21750,
            monto_cobro_nuevo: 25500,
            motivo: "Primero",
            created_at: "2026-07-20T12:00:00Z",
            created_by: "u2",
            created_by_name: null,
          },
        ],
      }),
    );
    assert.equal(ctx.historial.length, 2);
    assert.equal(ctx.historial[0]!.montoNuevo, 200000);
    assert.equal(ctx.historial[1]!.montoCobroAnterior, 21750);
    assert.equal(ctx.ultimaActualizacion?.updatedByName, "Mesa Admin");
  });

  it("falla si cargo_fijo != 3000", () => {
    assert.throws(
      () => mapExpedienteMontoMejoravitContext(sampleContext({ cargo_fijo: 2500 })),
      MontoMejoravitContextParseError,
    );
  });

  it("acepta números como string de Postgres", () => {
    const ctx = mapExpedienteMontoMejoravitContext(
      sampleContext({ monto_operativo_vigente: "150000.00", porcentaje_cobro: "12.50" }),
    );
    assert.equal(ctx.montoOperativoVigente, 150000);
    assert.equal(ctx.porcentajeCobro, 12.5);
  });
});

describe("mapActualizarMontoMejoravitResult", () => {
  it("exige ok=true", () => {
    assert.throws(
      () => mapActualizarMontoMejoravitResult({ ok: false }),
      MontoMejoravitContextParseError,
    );
  });

  it("mapea resultado exitoso", () => {
    const r = mapActualizarMontoMejoravitResult({
      ok: true,
      expediente_id: "e1",
      monto_original_operativo: 150000,
      monto_anterior: 150000,
      monto_nuevo: 200000,
      diferencia: 50000,
      porcentaje_cobro: 12.5,
      monto_cobro_anterior: 21750,
      monto_cobro_nuevo: 28000,
      motivo: "Ajuste",
      updated_by: "u1",
      updated_at: "2026-07-20T12:00:00Z",
    });
    assert.equal(r.montoCobroNuevo, 28000);
    assert.equal(r.diferencia, 50000);
  });
});

describe("helpers cobro / validación", () => {
  it("roundMoney y fórmula 200000 × 12.5% + 3000 = 28000", () => {
    assert.equal(roundMoney(1.005), 1.01);
    assert.equal(calculateUpdatedCobro(200000, 12.5, 3000), 28000);
  });

  it("centavos", () => {
    assert.equal(
      calculateUpdatedCobro(123456.78, 10.25, 3000),
      roundMoney(123456.78 * 10.25 / 100 + 3000),
    );
  });

  it("diferencia aumento y disminución", () => {
    assert.equal(calculateMontoDifference(200000, 150000), 50000);
    const up = describeMontoDifference(50000);
    assert.equal(up.kind, "aumento");
    assert.match(up.signedLabel, /^\+/);
    assert.match(up.proseLabel, /Aumento/);
    const down = describeMontoDifference(-20000);
    assert.equal(down.kind, "disminucion");
    assert.match(down.signedLabel, /^-/);
    assert.match(down.proseLabel, /Disminución/);
  });

  it("mismo monto bloqueado", () => {
    const r = validateMontoMejoravitUpdate({
      montoNuevoRaw: "150000.00",
      motivoRaw: "x",
      montoVigente: 150000,
      porcentajeCobro: 12.5,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /diferente al monto vigente/);
  });

  it("motivo vacío y >500", () => {
    const empty = validateMontoMejoravitUpdate({
      montoNuevoRaw: "160000",
      motivoRaw: "   ",
      montoVigente: 150000,
      porcentajeCobro: 12.5,
    });
    assert.equal(empty.ok, false);
    const long = validateMontoMejoravitUpdate({
      montoNuevoRaw: "160000",
      motivoRaw: "a".repeat(501),
      montoVigente: 150000,
      porcentajeCobro: 12.5,
    });
    assert.equal(long.ok, false);
  });

  it("porcentaje faltante", () => {
    const r = validateMontoMejoravitUpdate({
      montoNuevoRaw: "160000",
      motivoRaw: "ok",
      montoVigente: 150000,
      porcentajeCobro: null,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /porcentaje de cobro/);
  });

  it("parseMontoInput acepta formatos comunes", () => {
    assert.equal(parseMontoInput("200000"), 200000);
    assert.equal(parseMontoInput("200000.50"), 200000.5);
    assert.equal(parseMontoInput("200000,50"), 200000.5);
  });
});

describe("mapMontoMejoravitRpcError", () => {
  it("mismo monto", () => {
    const e = mapMontoMejoravitRpcError({
      message: "mesa_actualizar_monto_mejoravit: El monto nuevo debe ser diferente al monto vigente.",
    });
    assert.match(e.message, /diferente al monto vigente/);
  });

  it("sin permisos", () => {
    const e = mapMontoMejoravitRpcError({ code: "42501", message: "no autorizado" });
    assert.match(e.message, /permiso/);
  });

  it("concurrencia", () => {
    const e = mapMontoMejoravitRpcError({ message: "deadlock detected" });
    assert.equal(e.message, MONTO_MEJORAVIT_CONCURRENCY_MESSAGE);
  });
});
