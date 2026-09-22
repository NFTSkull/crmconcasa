import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("nombres canónicos en mayúsculas", () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260922190500_normalize_client_advisor_names_uppercase.sql",
    ),
    "utf8",
  );

  it("blinda futuras escrituras de cliente, generales y asesor", () => {
    assert.match(migration, /expedientes_cliente_nombre_upper_biu/);
    assert.match(migration, /cliente_datos_nombre_upper_biu/);
    assert.match(migration, /profiles_asesor_full_name_upper_biu/);
    assert.match(migration, /upper\(/i);
  });

  it("el backfill histórico solo toca perfiles asesor", () => {
    assert.match(migration, /UPDATE public\.profiles/);
    assert.match(migration, /app_role = 'asesor'/);
    assert.doesNotMatch(migration, /UPDATE public\.expedientes/);
    assert.doesNotMatch(migration, /UPDATE public\.cliente_datos/);
  });
});
