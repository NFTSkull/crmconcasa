import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  asesorPuedeEditarVigenciaDerechos,
  shouldMountAsesorVigenciaDerechosSection,
} from "@/domain/expediente-archivos/cliente-vigencia-derechos";

function extractJsxBlock(src: string, componentName: string): string {
  const re = new RegExp(
    `<${componentName}\\b[\\s\\S]*?<\\/${componentName}>|<${componentName}\\b[\\s\\S]*?/>`,
  );
  const m = src.match(re);
  assert.ok(m, `No se encontró JSX de <${componentName}>`);
  return m[0];
}

describe("AsesorVigenciaDerechosSection montaje en página asesor", () => {
  const pagePath = join(
    process.cwd(),
    "src/app/asesor/expediente/[id]/page.tsx",
  );
  const componentPath = join(
    process.cwd(),
    "src/components/asesor/AsesorVigenciaDerechosSection.tsx",
  );
  const pageSrc = readFileSync(pagePath, "utf8");
  const componentSrc = readFileSync(componentPath, "utf8");

  it("la página monta AsesorVigenciaDerechosSection en modo Supabase (oculto si paquete externos)", () => {
    assert.match(pageSrc, /import\s+\{\s*AsesorVigenciaDerechosSection\s*\}/);
    assert.match(pageSrc, /shouldMountAsesorIntegracionOpcionalDedicado/);
    assert.match(
      pageSrc,
      /shouldMountAsesorIntegracionOpcionalDedicado\([\s\S]*?\)\s*\?\s*\([\s\S]*?<AsesorVigenciaDerechosSection/,
    );
  });

  it("canUpload usa puedeEditarVigenciaDerechos, no puedeIntegrarAsesor (monto)", () => {
    assert.match(pageSrc, /asesorPuedeEditarVigenciaDerechos/);
    assert.match(
      pageSrc,
      /const puedeEditarVigenciaDerechos = asesorPuedeEditarVigenciaDerechos\(\s*operativo\?\.cicloEstado,\s*\)/,
    );
    const vigenciaJsx = extractJsxBlock(pageSrc, "AsesorVigenciaDerechosSection");
    assert.match(vigenciaJsx, /canUpload=\{puedeEditarVigenciaDerechos\}/);
    assert.doesNotMatch(vigenciaJsx, /puedeIntegrarAsesor/);
    assert.doesNotMatch(vigenciaJsx, /hasMontoAprobado|monto_aprobado/i);
  });

  it("sin monto aprobado (ciclo activo) → canUpload true → Subir vigencia de derechos", () => {
    assert.equal(asesorPuedeEditarVigenciaDerechos("activo"), true);
    assert.match(componentSrc, /Subir vigencia de derechos/);
    assert.match(componentSrc, /\{canUpload \?/);
  });

  it("con ciclo activo también permite subir (independiente de monto)", () => {
    assert.equal(asesorPuedeEditarVigenciaDerechos("activo"), true);
    assert.match(componentSrc, /Reemplazar vigencia de derechos/);
  });

  it("expediente bloqueado → canUpload false → mensaje solo lectura", () => {
    assert.equal(asesorPuedeEditarVigenciaDerechos("cancelado"), false);
    assert.match(componentSrc, /solo lectura/);
    assert.match(componentSrc, /puedes ver o descargar vigencia de derechos/);
  });

  it("Pagaré no recibe canUpload de Vigencia de derechos ni cambia su montaje", () => {
    assert.match(
      pageSrc,
      /dataSupabase\s*&&\s*precal\?\.id\s*\?\s*\(\s*<AsesorPagareSection/,
    );
    const pagareJsx = extractJsxBlock(pageSrc, "AsesorPagareSection");
    assert.doesNotMatch(pagareJsx, /canUpload|puedeEditarVigenciaDerechos/);
    assert.match(pagareJsx, /etapaActual=\{operativo\?\.etapaActual/);
  });

  it("puedeIntegrarAsesor (monto) permanece para otros flujos, no para Vigencia de derechos", () => {
    assert.match(
      pageSrc,
      /const puedeIntegrarAsesor =\s*hasMontoAprobado && !expedienteCancelado/,
    );
    assert.match(pageSrc, /puedeIntegrar=\{puedeIntegrarAsesor\}/);
    const vigenciaJsx = extractJsxBlock(pageSrc, "AsesorVigenciaDerechosSection");
    assert.doesNotMatch(vigenciaJsx, /puedeIntegrarAsesor/);
  });

  it("shouldMountAsesorVigenciaDerechosSection no depende de documento previo", () => {
    assert.equal(shouldMountAsesorVigenciaDerechosSection("exp-1"), true);
    assert.equal(shouldMountAsesorVigenciaDerechosSection("  "), false);
    assert.equal(shouldMountAsesorVigenciaDerechosSection(null), false);
    assert.equal(shouldMountAsesorVigenciaDerechosSection(undefined), false);
  });
});
