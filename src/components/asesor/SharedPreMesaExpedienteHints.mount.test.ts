import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Nueva precalificación: NSS ya en Mesa y expedientes pre-Mesa compartidos", () => {
  const component = readFileSync(
    join(process.cwd(), "src/components/asesor/SharedPreMesaExpedienteHints.tsx"),
    "utf8",
  );
  const page = readFileSync(join(process.cwd(), "src/app/asesor/nueva/page.tsx"), "utf8");

  it("ofrece expedientes existentes cuando gate bloquea, no ejecuta create", () => {
    assert.match(page, /decision\.action === "blocked"/);
    assert.match(page, /setBlockedNss\(input\.nss\)/);
    assert.match(page, /SharedPreMesaExpedienteHints nss=\{blockedNss\}/);
    assert.match(page, /existingDecision\.action === "blocked"/);
  });
  it("consulta solo expedientes activos pre-Mesa y bajo RLS", () => {
    assert.match(component, /\.from\("expedientes"\)/);
    assert.match(component, /\.eq\("submitted_to_mesa", false\)/);
    assert.match(component, /\.eq\("ciclo_estado", "activo"\)/);
    assert.match(component, /\.is\("deleted_at", null\)/);
    assert.match(component, /\.limit\(20\)/);
    assert.match(component, /get_asesor_display_batch/);
  });
  it("abre el expediente existente sin cambio de titular ni escritura", () => {
    assert.match(component, /href=\{\x60\/asesor\/expediente\/\$\{item\.id\}\x60\}/);
    assert.doesNotMatch(component, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    assert.match(component, /no cambia su asesor titular/);
  });
});
