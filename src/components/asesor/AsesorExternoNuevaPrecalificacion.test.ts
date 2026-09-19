import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("asesor externo /asesor/nueva NSS-only", () => {
  const component = readFileSync(
    join(
      process.cwd(),
      "src/components/asesor/AsesorExternoNuevaPrecalificacion.tsx",
    ),
    "utf8",
  );
  const page = readFileSync(
    join(process.cwd(), "src/app/asesor/nueva/page.tsx"),
    "utf8",
  );
  const job = readFileSync(
    join(process.cwd(), "src/domain/expedientes/auto-precalificar-job.ts"),
    "utf8",
  );

  it("el formulario externo monta únicamente NSS", () => {
    assert.match(component, /name="nss"/);
    assert.match(component, /Precalificar con NSS/);
    assert.doesNotMatch(component, /name="programa"/);
    assert.doesNotMatch(component, /name="cliente_nombre"/);
    assert.doesNotMatch(component, /name="telefono_cliente"/);
    assert.doesNotMatch(component, /name="direccion_opcional"/);
    assert.doesNotMatch(component, /Asesor titular/);
  });

  it("la página selecciona NSS-only por origen de sesión y deja internos intactos", () => {
    assert.match(page, /isAsesorExternoOrigin\(currentUser\.tipoAsesorOrigen\)/);
    assert.match(page, /return <AsesorExternoNuevaPrecalificacion \/>/);
    assert.match(page, /validateCreatePrecalificacion\(input\)/);
    assert.match(page, /name="programa"/);
    assert.match(page, /name="cliente_nombre"/);
    assert.match(page, /name="telefono_cliente"/);
  });

  it("la precalificación automática sigue enviando solo NSS al scraper", () => {
    assert.match(job, /JSON\.stringify\(\{ nss, workerIndex: 0 \}\)/);
    assert.doesNotMatch(job, /JSON\.stringify\(\{[^}]*cliente_nombre/);
    assert.doesNotMatch(job, /JSON\.stringify\(\{[^}]*telefono_cliente/);
  });

  it("exige ack 2xx antes de mostrar éxito", () => {
    assert.match(component, /if \(!res\.ok\)/);
    assert.match(component, /ack\.status < 200/);
    assert.match(component, /ack\.status >= 300/);
    assert.match(component, /NSS enviado correctamente/);
  });
});
