import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const MIG = join(
  process.cwd(),
  "supabase/migrations/20260917162500_orlando_lider_submit_guard.sql",
);

const sql = readFileSync(MIG, "utf8");

describe("Enviar a Mesa — líder Orlando en guard DG", () => {
  it("usa el helper canónico que incluye líder + miembros", () => {
    assert.match(sql, /asesor_pertenece_equipo_activo\(t\.id, NEW\.asesor_id\)/);
    assert.match(sql, /orlando\.solis@concasa\.mx/);
    assert.match(sql, /silvia\.reyes@concasa\.mx/);
  });

  it("mantiene la excepción del rollout nuevo de Silvia", () => {
    assert.match(sql, /v_es_silvia_nuevo := public\.asesor_es_equipo_silvia/);
    assert.match(sql, /v_es_externo := NOT v_es_silvia_nuevo AND/);
  });

  it("no modifica datos operativos", () => {
    assert.doesNotMatch(sql, /\bUPDATE\s+public\.expedientes\b/i);
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+public\.expedientes\b/i);
    assert.doesNotMatch(sql, /\bINSERT\s+INTO\s+public\.expedientes\b/i);
    assert.doesNotMatch(sql, /agenda_|booking|sheet/i);
  });
});
