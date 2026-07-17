import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const pagePath = join(process.cwd(), "src/app/admin/page.tsx");

describe("P086 B2.4.2 — Producción por asesor fuera del gate loading", () => {
  const source = readFileSync(pagePath, "utf8");

  it("no existe showProduccionPorAsesor ni gate por etapa", () => {
    assert.equal(source.includes("showProduccionPorAsesor"), false);
    assert.equal(/etapaFiltroActiva\s*\?\s*\(/.test(source), false);
    assert.equal(
      /showProduccionPorAsesor\s*=\s*!etapaFiltroActiva/.test(source),
      false,
    );
  });

  it("la sección no está dentro del branch sustituido por Cargando producción…", () => {
    const loadingGate = source.indexOf("{loading ? (");
    const loadingMsg = source.indexOf(">Cargando producción…<");
    const sectionMarker = source.indexOf('data-testid="admin-produccion-por-asesor"');
    const precalGate = source.indexOf("{!loading ? (");

    assert.ok(loadingGate >= 0, "gate loading presente");
    assert.ok(loadingMsg > loadingGate, "mensaje global de carga dentro del gate");
    assert.ok(sectionMarker > loadingMsg, "sección después del mensaje global");
    assert.ok(precalGate > sectionMarker, "precal sigue tras la sección");

    // El primer ternario loading cierra antes del data-testid de la sección.
    const gateClose = source.lastIndexOf(")}", sectionMarker);
    assert.ok(gateClose > loadingGate && gateClose < sectionMarker);

    // Una sola instancia de la sección (sin duplicar).
    const markers = source.match(/data-testid="admin-produccion-por-asesor"/g) ?? [];
    assert.equal(markers.length, 1);
  });

  it("estados propios visibles dentro de la sección (carga, vacío, actualización, error)", () => {
    const sectionStart = source.indexOf('data-testid="admin-produccion-por-asesor"');
    const sectionEnd = source.indexOf("{!loading ? (", sectionStart);
    assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
    const section = source.slice(sectionStart, sectionEnd);

    assert.ok(section.includes("Cargando producción por asesor…"));
    assert.ok(section.includes("Actualizando…"));
    assert.ok(section.includes("Sin resultados."));
    assert.ok(section.includes("produccionAsesorError"));
    assert.ok(section.includes("produccionAsesorLoading"));
    // No usa el mensaje global de dashboard dentro de la sección.
    assert.equal(section.includes(">Cargando producción…<"), false);
  });

  it("etapaFiltroActiva solo alimenta el banner de Mesa, no el montaje de producción", () => {
    assert.ok(source.includes('const etapaFiltroActiva = etapaActual !== "todas"'));
    const prodSection = source.slice(
      source.indexOf('data-testid="admin-produccion-por-asesor"'),
      source.indexOf("{!loading ? ("),
    );
    assert.equal(prodSection.includes("etapaFiltroActiva"), false);
  });
});
