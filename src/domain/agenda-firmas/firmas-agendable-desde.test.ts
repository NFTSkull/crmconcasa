import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  firmasTieneGateFuturo,
  resolveFirmasPickerMinDateYmd,
} from "./firmas-agendable-desde";

describe("firmas sin mínimo 5 días hábiles", () => {
  it("firma para hoy se acepta si existe disponibilidad (minDate = hoy)", () => {
    assert.equal(
      resolveFirmasPickerMinDateYmd({
        todayYmd: "2026-07-31",
        firmaAgendableDesde: "2026-07-31",
      }),
      "2026-07-31",
    );
    assert.equal(
      resolveFirmasPickerMinDateYmd({
        todayYmd: "2026-07-31",
        firmaAgendableDesde: null,
      }),
      "2026-07-31",
    );
  });

  it("firma para mañana se acepta (minDate no empuja +5)", () => {
    assert.equal(
      resolveFirmasPickerMinDateYmd({
        todayYmd: "2026-07-31",
        firmaAgendableDesde: "2026-08-01",
      }),
      "2026-08-01",
    );
    assert.equal(
      firmasTieneGateFuturo({
        todayYmd: "2026-07-31",
        firmaAgendableDesde: "2026-08-01",
      }),
      true,
    );
  });

  it("ya no se exige +5 días hábiles en el setter SQL nuevo", () => {
    const mig = readFileSync(
      join(process.cwd(), "supabase/migrations/139_firmas_sin_minimo_5_dias_habiles.sql"),
      "utf8",
    );
    assert.match(mig, /v_firma_desde := v_fecha_local/);
    assert.doesNotMatch(mig, /add_business_days_monterrey\(v_fecha_local,\s*5\)/);
    assert.match(mig, /sin mínimo de 5 hábiles|sin mínimo 5 hábiles/);
  });

  it("fecha pasada sigue bloqueada (minDate >= hoy)", () => {
    assert.equal(
      resolveFirmasPickerMinDateYmd({
        todayYmd: "2026-07-31",
        firmaAgendableDesde: "2026-07-01",
      }),
      "2026-07-31",
    );
  });

  it("biométricos no cambian (migración no toca book_biometricos)", () => {
    const mig = readFileSync(
      join(process.cwd(), "supabase/migrations/139_firmas_sin_minimo_5_dias_habiles.sql"),
      "utf8",
    );
    assert.doesNotMatch(mig, /book_biometricos/);
    assert.doesNotMatch(mig, /reagendar_biometricos/);
    assert.match(mig, /No toca biométricos/);
  });
});
