import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("cron auto-precal rescate cero-intentos", () => {
  const route = readFileSync(
    join(
      process.cwd(),
      "src/app/api/cron/reintentar-pendientes/route.ts",
    ),
    "utf8",
  );

  it("revalida que la decisión siga pendiente justo antes del job", () => {
    const recheck = route.indexOf('.eq("decision", "pendiente")');
    const runJob = route.indexOf("await runAutoPrecalificarJob({");

    assert.ok(recheck >= 0, "falta recheck final de decision=pendiente");
    assert.ok(runJob > recheck, "el recheck debe ocurrir antes del job");
    assert.match(route, /if \(!stillPending\)[\s\S]*?continue;/);
  });

  it("no cambia la ejecución secuencial ni el lease global", () => {
    assert.match(route, /SECUENCIAL: nunca Promise\.all/);
    assert.doesNotMatch(route, /Promise\.all\([^)]*runAutoPrecalificarJob/);
  });
});
