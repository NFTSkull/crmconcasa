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

  it("muestra el aviso por fallas sostenidas y nunca lo fuerza permanentemente", () => {
    assert.match(component, /portal_unavailable === true/);
    assert.match(component, /blocked_by_akamai === true/);
    assert.match(component, /if \(!unavailable\) return null/);
    assert.doesNotMatch(component, /FORCE_BANSEFI_TEMPORARY_OUTAGE_NOTICE/);
    assert.match(component, /Aviso importante: el portal de Infonavit \/ Bansefi presenta fallas/);
    assert.match(component, /La precalificación automática está temporalmente afectada/);
    assert.match(component, /quedarán pendientes/);
    assert.match(component, /se quitará automáticamente/);
    assert.match(component, /No necesitas volver a capturar ni enviar varias veces el mismo NSS/);
  });

  it("está montada en ambas pantallas de captura", () => {
    assert.match(nueva, /AutoPrecalAvailabilityAlert/);
    assert.match(nssOnly, /AutoPrecalAvailabilityAlert/);
  });
});
