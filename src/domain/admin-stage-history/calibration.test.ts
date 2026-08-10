import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addOneCalendarDayYmd,
  adminStageHistoryCoverageWarning,
  describeAdminStageHistoryMovimiento,
  durationInRangeMs,
  isAvanzaron,
  isEntraron,
  isEstuvieron,
  matchesMovimiento,
  monterreyDateRangeToHalfOpenUtcMs,
  stillInStageAtRangeEnd,
  summarizeMovementsVsUniques,
  ymdMonterreyMidnightToUtcMs,
  type StageVisitInterval,
} from "./calibration";
import { etapasInternasParaPasoVisual } from "@/domain/expedientes/asesor-seguimiento-operativo";

function visit(
  partial: Partial<StageVisitInterval> & Pick<StageVisitInterval, "enteredAtMs" | "paso">,
): StageVisitInterval {
  return {
    exitedAtMs: null,
    nextPaso: null,
    ...partial,
  };
}

describe("admin-stage-history calibration P163", () => {
  const range = monterreyDateRangeToHalfOpenUtcMs("2026-08-01", "2026-08-05");

  it("1. entra dentro del rango → Entraron sí", () => {
    const v = visit({
      enteredAtMs: Date.parse("2026-08-02T15:00:00.000Z"),
      paso: 4,
    });
    assert.equal(isEntraron(v, range), true);
  });

  it("2. entra antes → no en Entraron", () => {
    const v = visit({
      enteredAtMs: Date.parse("2026-07-31T12:00:00.000Z"),
      paso: 4,
    });
    assert.equal(isEntraron(v, range), false);
  });

  it("3. entra después → no", () => {
    const v = visit({
      enteredAtMs: Date.parse("2026-08-06T12:00:00.000Z"),
      paso: 4,
    });
    assert.equal(isEntraron(v, range), false);
  });

  it("4. avance dentro → sí", () => {
    const v = visit({
      enteredAtMs: Date.parse("2026-07-30T12:00:00.000Z"),
      exitedAtMs: Date.parse("2026-08-03T18:00:00.000Z"),
      paso: 4,
      nextPaso: 5,
    });
    assert.equal(isAvanzaron(v, range), true);
  });

  it("5. avance fuera → no", () => {
    const v = visit({
      enteredAtMs: Date.parse("2026-07-20T12:00:00.000Z"),
      exitedAtMs: Date.parse("2026-07-25T12:00:00.000Z"),
      paso: 4,
      nextPaso: 5,
    });
    assert.equal(isAvanzaron(v, range), false);
  });

  it("6. etapa actual distinta no afecta histórico", () => {
    const v = visit({
      enteredAtMs: Date.parse("2026-08-02T12:00:00.000Z"),
      paso: 4,
    });
    assert.equal(matchesMovimiento("entrada", v, range), true);
    // El snapshot "estado_actual" no usa el rango de visitas.
    assert.equal(matchesMovimiento("estado_actual", v, null), true);
  });

  it("7. estancia cruza inicio del rango", () => {
    const v = visit({
      enteredAtMs: Date.parse("2026-07-30T12:00:00.000Z"),
      exitedAtMs: Date.parse("2026-08-03T12:00:00.000Z"),
      paso: 4,
    });
    assert.equal(isEstuvieron(v, range), true);
  });

  it("8. estancia cruza fin del rango", () => {
    const v = visit({
      enteredAtMs: Date.parse("2026-08-04T12:00:00.000Z"),
      exitedAtMs: Date.parse("2026-08-10T12:00:00.000Z"),
      paso: 4,
    });
    assert.equal(isEstuvieron(v, range), true);
  });

  it("9. estancia cubre todo el rango", () => {
    const v = visit({
      enteredAtMs: Date.parse("2026-07-01T12:00:00.000Z"),
      exitedAtMs: Date.parse("2026-08-20T12:00:00.000Z"),
      paso: 4,
    });
    assert.equal(isEstuvieron(v, range), true);
  });

  it("10. no hubo intersección → no", () => {
    const v = visit({
      enteredAtMs: Date.parse("2026-07-01T12:00:00.000Z"),
      exitedAtMs: Date.parse("2026-07-15T12:00:00.000Z"),
      paso: 4,
    });
    assert.equal(isEstuvieron(v, range), false);
  });

  it("11–12. reingreso / dos entradas mismo expediente", () => {
    const ids = ["e1", "e1"];
    const s = summarizeMovementsVsUniques(ids);
    assert.equal(s.movimientos, 2);
    assert.equal(s.expedientesUnicos, 1);
    assert.equal(s.reingresos, 1);
  });

  it("13. retroceso no cuenta como Avanzaron", () => {
    const v = visit({
      enteredAtMs: Date.parse("2026-08-01T12:00:00.000Z"),
      exitedAtMs: Date.parse("2026-08-03T12:00:00.000Z"),
      paso: 4,
      nextPaso: 3,
    });
    assert.equal(isAvanzaron(v, range), false);
  });

  it("14. agrupación etapas internas Paso 3 → 3 y 4", () => {
    assert.deepEqual(etapasInternasParaPasoVisual(3), [3, 4]);
    assert.deepEqual(etapasInternasParaPasoVisual(4), [5]);
  });

  it("15. día final incluido (semiabierto hasta+1)", () => {
    // 05/08 23:00 Monterrey = 06/08 05:00Z — aún < 06/08 06:00Z
    const late = visit({
      enteredAtMs: Date.parse("2026-08-06T05:30:00.000Z"),
      paso: 4,
    });
    assert.equal(isEntraron(late, range), true);
    const after = visit({
      enteredAtMs: Date.parse("2026-08-06T06:00:00.000Z"),
      paso: 4,
    });
    assert.equal(isEntraron(after, range), false);
  });

  it("16. medianoche America/Monterrey", () => {
    assert.equal(ymdMonterreyMidnightToUtcMs("2026-08-01"), Date.parse("2026-08-01T06:00:00.000Z"));
    assert.equal(range.fromMs, Date.parse("2026-08-01T06:00:00.000Z"));
    assert.equal(range.toExclusiveMs, Date.parse("2026-08-06T06:00:00.000Z"));
  });

  it("17. DST/timezone Monterrey offset fijo −6", () => {
    // Misma regla en enero y agosto (sin DST).
    assert.equal(ymdMonterreyMidnightToUtcMs("2026-01-15"), Date.parse("2026-01-15T06:00:00.000Z"));
    assert.equal(addOneCalendarDayYmd("2026-08-05"), "2026-08-06");
  });

  it("18–21. definiciones UI y estado actual separado", () => {
    assert.match(describeAdminStageHistoryMovimiento("entrada").definition, /entrada/i);
    assert.match(describeAdminStageHistoryMovimiento("avance").definition, /salida|avance/i);
    assert.match(describeAdminStageHistoryMovimiento("estuvieron").definition, /estuvieron|periodo/i);
    const snap = describeAdminStageHistoryMovimiento("estado_actual");
    assert.equal(snap.datesApply, false);
    assert.match(snap.definition, /no representa movimientos históricos/i);
  });

  it("cobertura: advertencia si rango inicia antes de 2026-07-23", () => {
    assert.equal(adminStageHistoryCoverageWarning("2026-07-23"), null);
    assert.equal(adminStageHistoryCoverageWarning("2026-08-01"), null);
    const w = adminStageHistoryCoverageWarning("2026-07-01");
    assert.ok(w);
    assert.match(String(w), /23\/07\/2026/);
    assert.match(String(w), /no tiene cobertura histórica completa/);
  });

  it("still_in_stage_at_range_end + duration_in_range", () => {
    const v = visit({
      enteredAtMs: Date.parse("2026-07-30T12:00:00.000Z"),
      exitedAtMs: Date.parse("2026-08-10T12:00:00.000Z"),
      paso: 4,
    });
    assert.equal(stillInStageAtRangeEnd(v, range), true);
    const dur = durationInRangeMs(v, range);
    assert.ok(dur > 0);
    assert.equal(dur, range.toExclusiveMs - range.fromMs);
  });
});
