import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseAsesorTiposDocumentoVisibles,
  shouldMountAsesorScopedEquipoDocumentoSection,
} from "@/domain/expediente-archivos/asesor-tipos-documento-visibles";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_SCOPED_POR_EQUIPO,
  CLIENTE_LISTA_NOMINAL_DOCUMENT_TIPO,
  CLIENTE_SOLICITUD_CREDITO_DOCUMENT_TIPO,
} from "@/domain/expediente-archivos/integration-docs-completos";
import {
  asesorPuedeEditarScopedEquipoDocumento,
  validateScopedEquipoPdfFile,
} from "@/domain/expediente-archivos/cliente-scoped-equipo-documento";

describe("parseAsesorTiposDocumentoVisibles (fail-closed)", () => {
  it("array con los 4 tipos → los conserva", () => {
    assert.deepEqual(
      parseAsesorTiposDocumentoVisibles([...INTEGRATION_DOC_TIPOS_ASESOR_SCOPED_POR_EQUIPO]),
      [...INTEGRATION_DOC_TIPOS_ASESOR_SCOPED_POR_EQUIPO],
    );
  });

  it("null / undefined / no-array → []", () => {
    assert.deepEqual(parseAsesorTiposDocumentoVisibles(null), []);
    assert.deepEqual(parseAsesorTiposDocumentoVisibles(undefined), []);
    assert.deepEqual(parseAsesorTiposDocumentoVisibles({}), []);
    assert.deepEqual(parseAsesorTiposDocumentoVisibles("x"), []);
  });

  it("ignora tipos no scoped y duplicados", () => {
    assert.deepEqual(
      parseAsesorTiposDocumentoVisibles([
        CLIENTE_LISTA_NOMINAL_DOCUMENT_TIPO,
        "cliente_vigencia_derechos",
        CLIENTE_LISTA_NOMINAL_DOCUMENT_TIPO,
      ]),
      [CLIENTE_LISTA_NOMINAL_DOCUMENT_TIPO],
    );
  });
});

describe("shouldMountAsesorScopedEquipoDocumentoSection", () => {
  it("monta solo si expediente + tipo en visibles", () => {
    assert.equal(
      shouldMountAsesorScopedEquipoDocumentoSection({
        expedienteId: "exp-1",
        tipo: CLIENTE_LISTA_NOMINAL_DOCUMENT_TIPO,
        tiposVisibles: [CLIENTE_LISTA_NOMINAL_DOCUMENT_TIPO],
      }),
      true,
    );
    assert.equal(
      shouldMountAsesorScopedEquipoDocumentoSection({
        expedienteId: "exp-1",
        tipo: CLIENTE_SOLICITUD_CREDITO_DOCUMENT_TIPO,
        tiposVisibles: [CLIENTE_LISTA_NOMINAL_DOCUMENT_TIPO],
      }),
      false,
    );
    assert.equal(
      shouldMountAsesorScopedEquipoDocumentoSection({
        expedienteId: "exp-1",
        tipo: CLIENTE_LISTA_NOMINAL_DOCUMENT_TIPO,
        tiposVisibles: [],
      }),
      false,
    );
    assert.equal(
      shouldMountAsesorScopedEquipoDocumentoSection({
        expedienteId: "",
        tipo: CLIENTE_LISTA_NOMINAL_DOCUMENT_TIPO,
        tiposVisibles: [CLIENTE_LISTA_NOMINAL_DOCUMENT_TIPO],
      }),
      false,
    );
  });
});

describe("asesorPuedeEditarScopedEquipoDocumento", () => {
  it("ciclo activo permite; cancelado no", () => {
    assert.equal(asesorPuedeEditarScopedEquipoDocumento("activo"), true);
    assert.equal(asesorPuedeEditarScopedEquipoDocumento("cancelado"), false);
  });
});

describe("validateScopedEquipoPdfFile", () => {
  it("acepta PDF pequeño", () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf", {
      type: "application/pdf",
    });
    assert.equal(validateScopedEquipoPdfFile(pdf, "Lista Nominal", 15 * 1024 * 1024).ok, true);
  });
});

describe("AsesorScopedEquipoDocumentoSection montaje en página asesor", () => {
  const pagePath = join(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx");
  const pageSrc = readFileSync(pagePath, "utf8");

  it("página llama fetchAsesorTiposDocumentoVisibles y guarda tiposDocumentoVisibles", () => {
    assert.match(pageSrc, /fetchAsesorTiposDocumentoVisibles/);
    assert.match(pageSrc, /tiposDocumentoVisibles/);
    assert.match(pageSrc, /shouldMountAsesorScopedEquipoDocumentoSection/);
    assert.match(pageSrc, /AsesorScopedEquipoDocumentoSection/);
  });

  it("montaje gated por shouldMount + tiposVisibles (no monta a ciegas)", () => {
    assert.match(
      pageSrc,
      /shouldMountAsesorScopedEquipoDocumentoSection\(\{[\s\S]*tiposVisibles:\s*tiposDocumentoVisibles/,
    );
    assert.match(pageSrc, /SCOPED_EQUIPO_DOCUMENTO_UI\.map/);
  });

  it("canUpload usa ciclo activo scoped, no puedeIntegrarAsesor", () => {
    assert.match(pageSrc, /puedeEditarScopedEquipoDocumento/);
    assert.match(
      pageSrc,
      /canUpload=\{puedeEditarScopedEquipoDocumento\}/,
    );
  });

  it("badge Obligatorio/Opcional vía esObligatorio + tiposEnvioObligatorios", () => {
    const section = readFileSync(
      join(process.cwd(), "src/components/asesor/AsesorScopedEquipoDocumentoSection.tsx"),
      "utf8",
    );
    assert.match(section, /esObligatorio\?: boolean/);
    assert.match(section, /esObligatorio \? "Obligatorio" : "Opcional"/);
    assert.match(pageSrc, /esObligatorio=\{tiposEnvioObligatorios\.includes\(doc\.tipo\)\}/);
  });
});

describe("Mesa scoped equipo documentos RO", () => {
  const mesaPath = join(
    process.cwd(),
    "src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx",
  );
  const mesaSrc = readFileSync(mesaPath, "utf8");

  it("Mesa monta las 4 secciones RO sin gate de equipo", () => {
    assert.match(mesaSrc, /MesaScopedEquipoDocumentoSection/);
    assert.match(mesaSrc, /SCOPED_EQUIPO_DOCUMENTO_UI\.map/);
    assert.doesNotMatch(mesaSrc, /tiposDocumentoVisibles|asesor_tipos_documento_visibles/);
  });
});
