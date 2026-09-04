import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  filterIntegracionChecklistOpcionalesParaActor,
  resolveAsesorIntegracionOpcionalesVisibility,
  shouldMountAsesorIntegracionOpcionalDedicado,
} from "./asesor-integracion-opcionales-visibility";
import { deriveIntegrationDocsChecklistOpcionales } from "@/domain/expediente-archivos/integration-docs-completos";

describe("resolveAsesorIntegracionOpcionalesVisibility", () => {
  it("unresolved → hide (no flash de opcionales prohibidos)", () => {
    assert.equal(resolveAsesorIntegracionOpcionalesVisibility(false, false), "hide");
    assert.equal(resolveAsesorIntegracionOpcionalesVisibility(true, false), "hide");
    assert.equal(resolveAsesorIntegracionOpcionalesVisibility(null, false), "hide");
  });

  it("externo confirmado → solo Acta digital", () => {
    assert.equal(
      resolveAsesorIntegracionOpcionalesVisibility(true, true),
      "show_externos_acta_only",
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

  it("EXTERNO: solo Acta digital; sin carta/semanas", () => {
    const filtered = filterIntegracionChecklistOpcionalesParaActor(base, {
      actorPaqueteExternos: true,
      actorPaqueteResolved: true,
    });
    assert.deepEqual(
      filtered.map((i) => i.tipo_documento),
      ["cliente_acta_nacimiento_digital"],
    );
    assert.ok(!filtered.some((i) => i.tipo_documento === "cliente_carta_empresa"));
    assert.ok(!filtered.some((i) => i.tipo_documento === "cliente_semanas_cotizadas"));
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

  it("EXTERNO: no monta secciones dedicadas de integración restringida", () => {
    assert.equal(
      shouldMountAsesorIntegracionOpcionalDedicado({
        actorPaqueteExternos: true,
        actorPaqueteResolved: true,
      }),
      false,
    );
  });

  it("INTERNO: sí monta secciones dedicadas", () => {
    assert.equal(
      shouldMountAsesorIntegracionOpcionalDedicado({
        actorPaqueteExternos: false,
        actorPaqueteResolved: true,
      }),
      true,
    );
  });
});

describe("page.tsx wiring: acta digital y opcionales externos", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx"),
    "utf8",
  );

  it("usa autoridad actorPaqueteExternos + resolved (no length===7)", () => {
    assert.match(page, /actorPaqueteExternos/);
    assert.match(page, /actorPaqueteExternosResolved/);
    assert.match(page, /shouldMountAsesorIntegracionOpcionalDedicado/);
    assert.match(page, /filterIntegracionChecklistOpcionalesParaActor|resolveAsesorIntegracionOpcionalesVisibility/);
    assert.doesNotMatch(page, /tiposEnvioObligatorios\.length\s*===\s*7/);
    assert.doesNotMatch(page, /tiposEnvio\.length\s*===\s*7/);
  });

  it("dedupe scoped + autoridad actorPaqueteExternos", () => {
    assert.match(page, /tiposYaEnChecklistObligatorios:\s*tiposEnvioObligatorios/);
    assert.match(page, /resolveScopedEquipoUploadHint/);
    assert.match(page, /tiposEnvioResolved/);
    assert.match(page, /tiposEnvioCoherentesConDueno/);
    assert.doesNotMatch(page, /tiposEnvioObligatorios\.length\s*===\s*7/);
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
