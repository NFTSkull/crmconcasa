import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  asesorPuedeEditarEvidencia,
  shouldMountAsesorEvidenciaSection,
} from "@/domain/expediente-archivos/asesor-evidencia";

function extractJsxBlock(src: string, componentName: string): string {
  const re = new RegExp(
    `<${componentName}\\b[\\s\\S]*?<\\/${componentName}>|<${componentName}\\b[\\s\\S]*?/>`,
  );
  const m = src.match(re);
  assert.ok(m, `No se encontró JSX de <${componentName}>`);
  return m[0];
}

describe("AsesorEvidenciaSection montaje en página asesor", () => {
  const pagePath = join(
    process.cwd(),
    "src/app/asesor/expediente/[id]/page.tsx",
  );
  const componentPath = join(
    process.cwd(),
    "src/components/asesor/AsesorEvidenciaSection.tsx",
  );
  const pageSrc = readFileSync(pagePath, "utf8");
  const componentSrc = readFileSync(componentPath, "utf8");

  it("la página monta AsesorEvidenciaSection en modo Supabase (oculto si paquete externos)", () => {
    assert.match(pageSrc, /import\s+\{\s*AsesorEvidenciaSection\s*\}/);
    assert.match(pageSrc, /shouldMountAsesorIntegracionOpcionalDedicado/);
    assert.match(
      pageSrc,
      /shouldMountAsesorIntegracionOpcionalDedicado\([\s\S]*?\)\s*\?\s*\([\s\S]*?<AsesorEvidenciaSection/,
    );
  });

  it("canUpload usa puedeEditarEvidencia, no puedeIntegrarAsesor (monto)", () => {
    assert.match(pageSrc, /asesorPuedeEditarEvidencia/);
    assert.match(
      pageSrc,
      /const puedeEditarEvidencia = asesorPuedeEditarEvidencia\(\s*operativo\?\.cicloEstado,\s*\)/,
    );
    const evidenciaJsx = extractJsxBlock(pageSrc, "AsesorEvidenciaSection");
    assert.match(evidenciaJsx, /canUpload=\{puedeEditarEvidencia\}/);
    assert.doesNotMatch(evidenciaJsx, /puedeIntegrarAsesor/);
    assert.doesNotMatch(evidenciaJsx, /hasMontoAprobado|monto_aprobado/i);
  });

  it("sin monto aprobado (ciclo activo) → canUpload true → Subir evidencia", () => {
    assert.equal(asesorPuedeEditarEvidencia("activo"), true);
    assert.match(componentSrc, /Subir evidencia/);
    assert.match(componentSrc, /\{canUpload \?/);
  });

  it("con ciclo activo también permite subir (independiente de monto)", () => {
    assert.equal(asesorPuedeEditarEvidencia("activo"), true);
    assert.match(componentSrc, /Reemplazar evidencia/);
  });

  it("expediente bloqueado → canUpload false → mensaje solo lectura", () => {
    assert.equal(asesorPuedeEditarEvidencia("cancelado"), false);
    assert.match(componentSrc, /solo lectura/);
    assert.match(componentSrc, /puedes ver o descargar la evidencia/);
  });

  it("Pagaré no recibe canUpload de Evidencia ni cambia su montaje", () => {
    assert.match(
      pageSrc,
      /dataSupabase\s*&&\s*precal\?\.id\s*\?\s*\(\s*<AsesorPagareSection/,
    );
    const pagareJsx = extractJsxBlock(pageSrc, "AsesorPagareSection");
    assert.doesNotMatch(pagareJsx, /canUpload|puedeEditarEvidencia/);
    assert.match(pagareJsx, /etapaActual=\{operativo\?\.etapaActual/);
  });

  it("puedeIntegrarAsesor (monto) permanece para otros flujos, no para Evidencia", () => {
    assert.match(
      pageSrc,
      /const puedeIntegrarAsesor =\s*hasMontoAprobado && !expedienteCancelado/,
    );
    assert.match(pageSrc, /puedeIntegrar=\{puedeIntegrarAsesor\}/);
    const evidenciaJsx = extractJsxBlock(pageSrc, "AsesorEvidenciaSection");
    assert.doesNotMatch(evidenciaJsx, /puedeIntegrarAsesor/);
  });

  it("shouldMountAsesorEvidenciaSection no depende de evidencia previa", () => {
    assert.equal(shouldMountAsesorEvidenciaSection("exp-1"), true);
    assert.equal(shouldMountAsesorEvidenciaSection("  "), false);
    assert.equal(shouldMountAsesorEvidenciaSection(null), false);
    assert.equal(shouldMountAsesorEvidenciaSection(undefined), false);
  });
});
