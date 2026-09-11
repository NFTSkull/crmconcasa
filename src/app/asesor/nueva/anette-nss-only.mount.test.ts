import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Anette NSS-only montaje /asesor/nueva", () => {
  const layout = readFileSync(
    join(process.cwd(), "src/app/asesor/nueva/layout.tsx"),
    "utf8",
  );
  const page = readFileSync(
    join(process.cwd(), "src/app/asesor/nueva/anette-nss-only-page.tsx"),
    "utf8",
  );
  const general = readFileSync(
    join(process.cwd(), "src/app/asesor/nueva/page.tsx"),
    "utf8",
  );

  it("aísla el flujo por identidad exacta y deja el formulario general como children", () => {
    assert.match(layout, /isAnetteNssOnlyEmail\(currentUser\.email\)/);
    assert.match(layout, /return <AnetteNssOnlyPrecalPage \/>/);
    assert.match(layout, /return <>\{children\}<\/>/);
  });

  it("la vista de Anette captura solo NSS", () => {
    assert.match(page, /name="nss"/);
    assert.doesNotMatch(page, /name="cliente_nombre"/);
    assert.doesNotMatch(page, /name="telefono_cliente"/);
    assert.doesNotMatch(page, /name="direccion_opcional"/);
    assert.doesNotMatch(page, /name="programa"/);
  });

  it("usa el RPC NSS-only existente y dispara auto-precal/reprecal", () => {
    assert.match(page, /asesor_preparar_precalificacion_externo_nss/);
    assert.match(page, /\/auto-precalificar/);
    assert.match(page, /fireAutoReprecalificarAck/);
  });

  it("no reemplaza ni modifica el contrato visual general", () => {
    assert.match(general, /name="cliente_nombre"/);
    assert.match(general, /name="telefono_cliente"/);
    assert.match(general, /name="direccion_opcional"/);
    assert.match(general, /name="programa"/);
  });
});
