import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Mesa — búsqueda global incluye cancelados", () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260923152000_mesa_search_includes_cancelled.sql",
    ),
    "utf8",
  );

  it("combina activos y cancelados solo cuando hay búsqueda explícita", () => {
    assert.match(
      migration,
      /v_search_global :=[\s\S]*p_buscar[\s\S]*p_quick_filter[\s\S]*= 'todos'/,
    );
    assert.match(
      migration,
      /p_quick_filter => 'todos'[\s\S]*p_quick_filter => 'rechazos_cancelaciones'/,
    );
    assert.match(migration, /p_rechazos_sub => 'cancelados'/);
  });

  it("no reactiva ni muta expedientes", () => {
    assert.doesNotMatch(migration, /UPDATE\s+public\.expedientes/i);
    assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.expedientes/i);
    assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.expedientes/i);
  });

  it("la búsqueda no se estrecha a sin_asignar para Mesa con externos", () => {
    assert.match(migration, /IF NOT v_search_global[\s\S]*v_ops_effective := 'sin_asignar'/);
  });
});
