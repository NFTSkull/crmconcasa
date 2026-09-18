import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260918181500_inscripcion_cupo_4_septiembre.sql"),
  "utf8",
);
const repoSource = readFileSync(
  join(root, "src/domain/agenda-inscripcion/supabase.repo.ts"),
  "utf8",
);

describe("Inscripción — cupo 4 septiembre 2026", () => {
  it("configura máximo 4 para septiembre sin tocar bookings existentes", () => {
    assert.match(migration, /DATE '2026-09-01'/);
    assert.match(migration, /DATE '2026-09-30'/);
    assert.match(migration, /'inscripcion'/);
    assert.match(migration, /'monterrey'/);
    assert.match(migration, /\n\s*4,\n/);
    assert.doesNotMatch(migration, /DELETE FROM public\.agenda_bookings/i);
    assert.doesNotMatch(migration, /UPDATE public\.agenda_bookings/i);
  });

  it("serializa el último lugar y exige inventario físico de Sheet", () => {
    assert.match(migration, /agenda_advisory_lock_daily_capacity/);
    assert.match(migration, /agenda_sheet_assert_inventory_allows_booking/);
    assert.match(migration, /agenda_daily_remaining/);
    assert.match(migration, /CUPO_INSCRIPCION_AGOTADO/);
  });

  it("instala trigger sobre altas o cambios de booking", () => {
    assert.match(migration, /CREATE TRIGGER agenda_inscripcion_guard_daily_capacity_biu/);
    assert.match(migration, /BEFORE INSERT OR UPDATE OF kind, status, booking_date, booking_time, location_id/);
  });

  it("book refresca Sheet en vivo con la hora fija 11:00", () => {
    assert.match(repoSource, /refreshInscripcionInventoryBeforeMutation/);
    assert.match(repoSource, /mode: "book_gate"/);
    assert.match(repoSource, /slotTime:[\s\S]{0,120}INSCRIPCION_FIXED_TIME/);
  });

  it("availability nunca expone más que daily_capacity/daily_remaining", () => {
    assert.match(repoSource, /daily_capacity/);
    assert.match(repoSource, /daily_remaining/);
    assert.match(repoSource, /Math\.min\(physicalCapacity, dailyCapacity\)/);
    assert.match(repoSource, /Math\.min\([\s\S]{0,160}physicalAvailable[\s\S]{0,160}dailyRemaining/);
  });
});
