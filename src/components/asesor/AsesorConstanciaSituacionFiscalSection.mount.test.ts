import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  asesorPuedeEditarConstanciaSituacionFiscal,
  shouldMountAsesorConstanciaSituacionFiscalSection,
} from "@/domain/expediente-archivos/cliente-constancia-situacion-fiscal";

function extractJsxBlock(src: string, componentName: string): string {
  const re = new RegExp(
    `<${componentName}\\b[\\s\\S]*?<\\/${componentName}>|<${componentName}\\b[\\s\\S]*?/>`,
  );
  const m = src.match(re);
  assert.ok(m, `No se encontró JSX de <${componentName}>`);
  return m[0];
}

describe("AsesorConstanciaSituacionFiscalSection montaje en página asesor", () => {
  const pagePath = join(
    process.cwd(),
    "src/app/asesor/expediente/[id]/page.tsx",
  );
  const componentPath = join(
    process.cwd(),
    "src/components/asesor/AsesorConstanciaSituacionFiscalSection.tsx",
  );
  const pageSrc = readFileSync(pagePath, "utf8");
  const componentSrc = readFileSync(componentPath, "utf8");

  it("la página monta AsesorConstanciaSituacionFiscalSection en modo Supabase (oculto si actorPaqueteExternos)", () => {
    assert.match(pageSrc, /import\s+\{\s*AsesorConstanciaSituacionFiscalSection\s*\}/);
    assert.match(
      pageSrc,
      /dataSupabase\s*&&\s*precal\?\.id\s*&&\s*!actorPaqueteExternos\s*\?\s*\(\s*<AsesorConstanciaSituacionFiscalSection/,
    );
  });

  it("canUpload usa puedeEditarConstanciaSituacionFiscal, no puedeIntegrarAsesor (monto)", () => {
    assert.match(pageSrc, /asesorPuedeEditarConstanciaSituacionFiscal/);
    assert.match(
      pageSrc,
      /const puedeEditarConstanciaSituacionFiscal = asesorPuedeEditarConstanciaSituacionFiscal\(\s*operativo\?\.cicloEstado,\s*\)/,
    );
    const vigenciaJsx = extractJsxBlock(pageSrc, "AsesorConstanciaSituacionFiscalSection");
    assert.match(vigenciaJsx, /canUpload=\{puedeEditarConstanciaSituacionFiscal\}/);
    assert.doesNotMatch(vigenciaJsx, /puedeIntegrarAsesor/);
    assert.doesNotMatch(vigenciaJsx, /hasMontoAprobado|monto_aprobado/i);
  });

  it("sin monto aprobado (ciclo activo) → canUpload true → Subir Constancia SAT", () => {
    assert.equal(asesorPuedeEditarConstanciaSituacionFiscal("activo"), true);
    assert.match(componentSrc, /Subir Constancia SAT/);
    assert.match(componentSrc, /\{canUpload \?/);
  });

  it("con ciclo activo también permite subir (independiente de monto)", () => {
    assert.equal(asesorPuedeEditarConstanciaSituacionFiscal("activo"), true);
    assert.match(componentSrc, /Reemplazar Constancia SAT/);
  });

  it("expediente bloqueado → canUpload false → mensaje solo lectura", () => {
    assert.equal(asesorPuedeEditarConstanciaSituacionFiscal("cancelado"), false);
    assert.match(componentSrc, /solo lectura/);
    assert.match(componentSrc, /puedes ver o descargar Constancia SAT/);
  });

  it("Pagaré no recibe canUpload de Constancia SAT ni cambia su montaje", () => {
    assert.match(
      pageSrc,
      /dataSupabase\s*&&\s*precal\?\.id\s*\?\s*\(\s*<AsesorPagareSection/,
    );
    const pagareJsx = extractJsxBlock(pageSrc, "AsesorPagareSection");
    assert.doesNotMatch(pagareJsx, /canUpload|puedeEditarConstanciaSituacionFiscal/);
    assert.match(pagareJsx, /etapaActual=\{operativo\?\.etapaActual/);
  });

  it("puedeIntegrarAsesor (monto) permanece para otros flujos, no para Constancia SAT", () => {
    assert.match(
      pageSrc,
      /const puedeIntegrarAsesor =\s*hasMontoAprobado && !expedienteCancelado/,
    );
    assert.match(pageSrc, /puedeIntegrar=\{puedeIntegrarAsesor\}/);
    const vigenciaJsx = extractJsxBlock(pageSrc, "AsesorConstanciaSituacionFiscalSection");
    assert.doesNotMatch(vigenciaJsx, /puedeIntegrarAsesor/);
  });

  it("shouldMountAsesorConstanciaSituacionFiscalSection no depende de documento previo", () => {
    assert.equal(shouldMountAsesorConstanciaSituacionFiscalSection("exp-1"), true);
    assert.equal(shouldMountAsesorConstanciaSituacionFiscalSection("  "), false);
    assert.equal(shouldMountAsesorConstanciaSituacionFiscalSection(null), false);
    assert.equal(shouldMountAsesorConstanciaSituacionFiscalSection(undefined), false);
  });
});
