import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  filterIntegracionChecklistOpcionalesParaActor,
  resolveAsesorIntegracionOpcionalesVisibility,
  shouldMountAsesorConstanciaSituacionFiscalForActor,
  shouldMountAsesorIntegracionOpcionalDedicado,
  shouldMountAsesorVigenciaDerechosForActor,
} from "./asesor-integracion-opcionales-visibility";
import { deriveIntegrationDocsChecklistOpcionales } from "@/domain/expediente-archivos/integration-docs-completos";

describe("resolveAsesorIntegracionOpcionalesVisibility", () => {
  it("unresolved → hide (no flash de opcionales prohibidos)", () => {
    assert.equal(resolveAsesorIntegracionOpcionalesVisibility(false, false), "hide");
    assert.equal(resolveAsesorIntegracionOpcionalesVisibility(true, false), "hide");
    assert.equal(resolveAsesorIntegracionOpcionalesVisibility(null, false), "hide");
  });

  it("externo confirmado → checklist externos (acta + semanas)", () => {
    assert.equal(
      resolveAsesorIntegracionOpcionalesVisibility(true, true),
      "show_externos_checklist",
    );
  });

  it("interno confirmado → show_internos", () => {
    assert.equal(
      resolveAsesorIntegracionOpcionalesVisibility(false, true),
      "show_internos",
    );
  });
});

describe("opcionales integración: externo vs interno", () => {
  const base = deriveIntegrationDocsChecklistOpcionales([]);

  it("EXTERNO: Acta digital + Semanas; sin carta/apodaca; sin vigencia en checklist", () => {
    const filtered = filterIntegracionChecklistOpcionalesParaActor(base, {
      actorPaqueteExternos: true,
      actorPaqueteResolved: true,
    });
    assert.deepEqual(
      filtered.map((i) => i.tipo_documento).sort(),
      ["cliente_acta_nacimiento_digital", "cliente_semanas_cotizadas"].sort(),
    );
    assert.ok(!filtered.some((i) => i.tipo_documento === "cliente_carta_empresa"));
    assert.ok(!filtered.some((i) => i.tipo_documento === "cliente_vigencia_derechos"));
    assert.ok(filtered.every((i) => i.opcional === true));
  });

  it("INTERNO: conserva opcionales históricos (acta, carta, semanas, apodaca)", () => {
    const filtered = filterIntegracionChecklistOpcionalesParaActor(base, {
      actorPaqueteExternos: false,
      actorPaqueteResolved: true,
    });
    assert.equal(filtered.length, base.length);
    assert.ok(filtered.some((i) => i.tipo_documento === "cliente_acta_nacimiento_digital"));
    assert.ok(filtered.some((i) => i.tipo_documento === "cliente_carta_empresa"));
    assert.ok(filtered.some((i) => i.tipo_documento === "cliente_semanas_cotizadas"));
    assert.ok(filtered.every((i) => i.opcional === true));
  });

  it("EXTERNO: Evidencia OFF; Vigencia ON (helper específico)", () => {
    assert.equal(
      shouldMountAsesorIntegracionOpcionalDedicado({
        actorPaqueteExternos: true,
        actorPaqueteResolved: true,
      }),
      false,
    );
    assert.equal(
      shouldMountAsesorVigenciaDerechosForActor({
        actorPaqueteExternos: true,
        actorPaqueteResolved: true,
      }),
      true,
    );
  });

  it("INTERNO: Evidencia ON; Vigencia ON", () => {
    assert.equal(
      shouldMountAsesorIntegracionOpcionalDedicado({
        actorPaqueteExternos: false,
        actorPaqueteResolved: true,
      }),
      true,
    );
    assert.equal(
      shouldMountAsesorVigenciaDerechosForActor({
        actorPaqueteExternos: false,
        actorPaqueteResolved: true,
      }),
      true,
    );
  });

  it("unresolved: Vigencia OFF (fail-safe)", () => {
    assert.equal(
      shouldMountAsesorVigenciaDerechosForActor({
        actorPaqueteExternos: true,
        actorPaqueteResolved: false,
      }),
      false,
    );
  });
});

describe("shouldMountAsesorConstanciaSituacionFiscalForActor", () => {
  it("unresolved → false (fail-safe)", () => {
    assert.equal(
      shouldMountAsesorConstanciaSituacionFiscalForActor({
        actorPaqueteExternos: true,
        actorPaqueteResolved: false,
      }),
      false,
    );
  });

  it("externo confirmado → monta Constancia SAT", () => {
    assert.equal(
      shouldMountAsesorConstanciaSituacionFiscalForActor({
        actorPaqueteExternos: true,
        actorPaqueteResolved: true,
      }),
      true,
    );
  });

  it("interno confirmado → monta Constancia SAT", () => {
    assert.equal(
      shouldMountAsesorConstanciaSituacionFiscalForActor({
        actorPaqueteExternos: false,
        actorPaqueteResolved: true,
      }),
      true,
    );
  });

  it("externo: Evidencia OFF; Vigencia ON; SAT ON", () => {
    assert.equal(
      shouldMountAsesorIntegracionOpcionalDedicado({
        actorPaqueteExternos: true,
        actorPaqueteResolved: true,
      }),
      false,
    );
    assert.equal(
      shouldMountAsesorVigenciaDerechosForActor({
        actorPaqueteExternos: true,
        actorPaqueteResolved: true,
      }),
      true,
    );
    assert.equal(
      shouldMountAsesorConstanciaSituacionFiscalForActor({
        actorPaqueteExternos: true,
        actorPaqueteResolved: true,
      }),
      true,
    );
  });
});

describe("page.tsx wiring: opcionales externos + vigencia dedicada", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx"),
    "utf8",
  );

  it("usa autoridad actorPaqueteExternos + resolved (no length===7)", () => {
    assert.match(page, /actorPaqueteExternos/);
    assert.match(page, /actorPaqueteExternosResolved/);
    assert.match(page, /shouldMountAsesorIntegracionOpcionalDedicado/);
    assert.match(page, /shouldMountAsesorConstanciaSituacionFiscalForActor/);
    assert.match(page, /shouldMountAsesorVigenciaDerechosForActor/);
    assert.match(page, /filterIntegracionChecklistOpcionalesParaActor|resolveAsesorIntegracionOpcionalesVisibility/);
    assert.doesNotMatch(page, /tiposEnvioObligatorios\.length\s*===\s*7/);
  });

  it("Constancia SAT regla propia; Evidencia solo dedicado; Vigencia helper propio", () => {
    assert.match(
      page,
      /shouldMountAsesorConstanciaSituacionFiscalForActor\([\s\S]*?\)\s*\?\s*\([\s\S]*?<AsesorConstanciaSituacionFiscalSection/,
    );
    assert.match(
      page,
      /shouldMountAsesorIntegracionOpcionalDedicado\([\s\S]*?\)\s*\?\s*\([\s\S]*?<AsesorEvidenciaSection/,
    );
    assert.match(
      page,
      /shouldMountAsesorVigenciaDerechosForActor\(\{\s*actorPaqueteExternos,\s*actorPaqueteResolved: actorPaqueteExternosResolved,\s*\}\) \? \(\s*<AsesorVigenciaDerechosSection/,
    );
    // Evidencia sigue restringida al helper solo-internos (no el de vigencia).
    assert.match(page, /shouldMountAsesorIntegracionOpcionalDedicado/);
    assert.match(page, /shouldMountAsesorVigenciaDerechosForActor/);
  });

  it("dedupe scoped + autoridad actorPaqueteExternos", () => {
    assert.match(page, /tiposYaEnChecklistObligatorios:\s*tiposEnvioObligatorios/);
    assert.match(page, /resolveScopedEquipoUploadHint/);
    assert.match(page, /tiposEnvioResolved/);
    assert.match(page, /tiposEnvioCoherentesConDueno/);
  });

  it("NO oculta Pagaré / Mesa docs / retención por actorPaqueteExternos", () => {
    assert.match(page, /dataSupabase && precal\?\.id \? \(\s*<AsesorPagareSection/);
    assert.match(
      page,
      /dataSupabase && precal\?\.id \? \(\s*<AsesorMesaDocumentosSection/,
    );
    assert.doesNotMatch(
      page,
      /actorPaqueteExternos[\s\S]{0,40}AsesorPagareSection/,
    );
  });
});
