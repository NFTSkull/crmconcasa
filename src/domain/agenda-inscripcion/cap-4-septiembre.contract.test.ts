import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const migration = readFileSync(
  join(ROOT, "supabase/migrations/20260918190000_inscripcion_cap_4_septiembre.sql"),
  "utf8",
);
const repoSource = readFileSync(
  join(ROOT, "src/domain/agenda-inscripcion/supabase.repo.ts"),
  "utf8",
);

describe("Inscripción — hard cap 4 septiembre 2026", () => {
  it("limita solo inscripción Monterrey durante septiembre", () => {
    assert.match(migration, /v_kind = 'inscripcion'/);
    assert.match(migration, /v_location = 'monterrey'/);
    assert.match(
      migration,
      /p_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-30'/,
    );
    assert.match(migration, /v_hard_cap := 4/);
  });

  it("serializa altas concurrentes antes del insert", () => {
    assert.match(
      migration,
      /v_kind NOT IN \('biometricos', 'inscripcion'\)/,
    );
    assert.match(migration, /agenda_advisory_lock_daily_capacity/);
    assert.match(migration, /IF v_occ >= v_cap THEN/);
  });

  it("cuenta ocupación CRM + manual y conserva defensa post-insert", () => {
    assert.match(migration, /agenda_daily_active_occupancy/);
    assert.match(migration, /agenda_crm_manual_daily_count/);
    assert.match(migration, /agenda_sheet_inventory_claim_ai/);
    assert.match(migration, /máximo % personas/);
  });

  it("reclama primero filas físicas canónicas de inscripción", () => {
    assert.match(migration, /NEW\.kind::TEXT = 'inscripcion'/);
    assert.match(migration, /ORDER BY i\.sheet_row ASC NULLS LAST, i\.id/);
  });

  it("UI usa daily_remaining además del conteo físico", () => {
    assert.match(repoSource, /daily_capacity\?: number \| null/);
    assert.match(repoSource, /daily_occupancy\?: number \| null/);
    assert.match(repoSource, /daily_remaining\?: number \| null/);
    assert.match(
      repoSource,
      /Math\.min\(physicalAvailable, dailyRemaining\)/,
    );
  });
});
