import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("P182 AdminSearchResultadosSection montaje", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/admin/AdminSearchResultadosSection.tsx"),
    "utf8",
  );
  const panel = readFileSync(
    join(process.cwd(), "src/components/admin/AdminSearchExpedientePanel.tsx"),
    "utf8",
  );

  it("estados loading / vacío / coincidencias / truncado / CTA", () => {
    assert.match(src, /Buscando…/);
    assert.match(src, /No encontramos coincidencias/);
    assert.match(src, /Busca por nombre o NSS/);
    assert.match(src, /formatAdminSearchCoincidencias/);
    assert.match(src, /Mostrando los primeros/);
    assert.match(src, /Refina la búsqueda/);
    assert.match(src, /Abrir expediente/);
    assert.match(src, /Precalificación/);
    assert.match(src, /Re-precalificación en revisión/);
    assert.match(src, /No enviado a Mesa|labelAdminSearchMesa/);
  });

  it("CTA no usa drawer Mesa", () => {
    assert.doesNotMatch(src, /AdminExpedienteDrawer/);
    assert.match(panel, /No reutiliza AdminExpedienteDrawer/);
  });
});
