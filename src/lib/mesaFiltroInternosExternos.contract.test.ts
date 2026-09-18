import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const page = readFileSync(
  join(root, "src/app/mesa-control/page.tsx"),
  "utf8",
);
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20260918190254_mesa_filtro_internos_externos_sara_kass.sql",
  ),
  "utf8",
);

describe("Mesa — filtro Internos / Externos Sara/Kass", () => {
  it("la UI obtiene el gate desde backend y muestra los tres tabs", () => {
    assert.match(page, /mesa_puede_filtrar_internos_externos/);
    assert.match(page, /puedeFiltrarOrigenOperativo/);
    assert.match(page, /label: "Todos"/);
    assert.match(page, /label: "Internos"/);
    assert.match(page, /label: "Externos"/);
  });

  it("el filtro viaja al servidor y participa en la identidad de paginación/counts", () => {
    assert.match(page, /adminOrigenTab: showOrigenTabs \? adminOrigenTab : ""/);
    assert.match(page, /showOrigenTabs \? adminOrigenTab : "todos"/);
    assert.match(page, /repo\.getMesaBandejaCounts/);
    assert.match(page, /origen: baseQuery\.origen \?\? "todos"/);
  });

  it("Externos usa exactamente Orlando + Silvia/equipo + Anette", () => {
    assert.match(migration, /orlando\.solis@concasa\.mx/);
    assert.match(migration, /silvia\.reyes@concasa\.mx/);
    assert.match(migration, /anette\.perez@concasa\.mx/);
    assert.match(migration, /asesor_equipo_miembros/);
    assert.match(migration, /m\.active = true/);
    assert.match(migration, /t\.active = true/);
  });

  it("Sara/Kass clasifican por grupo asesor, otros roles conservan origen_mesa", () => {
    assert.match(migration, /v_can_externos/);
    assert.match(migration, /p_origen = 'externo'/);
    assert.match(migration, /mesa_asesor_es_grupo_externo\(e\.asesor_id\)/);
    assert.match(
      migration,
      /NOT public\.mesa_asesor_es_grupo_externo\(e\.asesor_id\)/,
    );
    assert.match(migration, /NOT v_can_externos/);
    assert.match(migration, /e\.origen_mesa::text = 'externo'/);
  });

  it("no toca writers ni agenda/citas/Sheets", () => {
    assert.doesNotMatch(migration, /UPDATE\s+public\.expedientes/i);
    assert.doesNotMatch(migration, /DELETE\s+FROM/i);
    assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.expedientes/i);
    assert.doesNotMatch(migration, /agenda_bookings/i);
    assert.doesNotMatch(migration, /sheet_sync/i);
  });
});
