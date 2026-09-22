import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("alerta visible de disponibilidad auto-precal", () => {
  const component = readFileSync(
    join(
      process.cwd(),
      "src/components/asesor/AutoPrecalAvailabilityAlert.tsx",
    ),
    "utf8",
  );
  const nueva = readFileSync(
    join(process.cwd(), "src/app/asesor/nueva/page.tsx"),
    "utf8",
  );
  const nssOnly = readFileSync(
    join(process.cwd(), "src/app/asesor/nueva/anette-nss-only-page.tsx"),
    "utf8",
  );

  it("solo muestra copy de caída cuando blocked_by_akamai=true", () => {
    assert.match(component, /blocked_by_akamai === true/);
    assert.match(component, /if \(!blocked\) return null/);
    assert.match(
      component,
      /La página de Infonavit está temporalmente no disponible/,
    );
    assert.match(component, /se guardará como pendiente/);
  });

  it("está montada en ambas pantallas de captura", () => {
    assert.match(nueva, /AutoPrecalAvailabilityAlert/);
    assert.match(nssOnly, /AutoPrecalAvailabilityAlert/);
  });
});
