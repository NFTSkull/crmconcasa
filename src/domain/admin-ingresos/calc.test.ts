import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calcCumplimientoPct,
  calcIngresoProyectadoSqlRound,
  calcPendientePorCobrar,
  formatIngresosCalculoLabel,
  resolveMontoBaseIngresos,
} from "./calc";

describe("admin-ingresos calc P134", () => {
  it("actualizado 160000 × 17% → 27200", () => {
    assert.equal(calcIngresoProyectadoSqlRound(160_000, 17), 27_200);
  });

  it("general 160000 × 20% → 32000", () => {
    assert.equal(calcIngresoProyectadoSqlRound(160_000, 20), 32_000);
  });

  it("actualizado tiene prioridad sobre general", () => {
    const r = resolveMontoBaseIngresos({
      montoActualizado: 160_000,
      montoGeneral: 150_000,
    });
    assert.equal(r?.fuente, "mesa_actualizado");
    assert.equal(r?.montoBase, 160_000);
  });

  it("fallback a datos generales", () => {
    const r = resolveMontoBaseIngresos({
      montoActualizado: null,
      montoGeneral: 160_000,
    });
    assert.equal(r?.fuente, "datos_generales");
  });

  it("sin monto no inventa 0", () => {
    assert.equal(
      resolveMontoBaseIngresos({ montoActualizado: null, montoGeneral: null }),
      null,
    );
  });

  it("no aplica cap 169000 (usa monto real > 169k)", () => {
    assert.equal(calcIngresoProyectadoSqlRound(200_000, 10), 20_000);
  });

  it("redondeo a 2 decimales", () => {
    assert.equal(calcIngresoProyectadoSqlRound(100_000, 17.5), 17_500);
    assert.equal(calcIngresoProyectadoSqlRound(123_456.78, 12.5), 15_432.1);
  });

  it("pendiente y cumplimiento sin NaN", () => {
    assert.equal(calcPendientePorCobrar(27_200, 10_000), 17_200);
    assert.equal(calcCumplimientoPct(0, 100), 0);
    assert.equal(calcCumplimientoPct(27_200, 13_600), 50);
  });

  it("label de cálculo visible", () => {
    assert.match(
      formatIngresosCalculoLabel(160_000, 17, 27_200),
      /160[,.]?000.*17%.*27[,.]?200/,
    );
  });
});
