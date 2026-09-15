import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DOCUMENTO_CATALOGO_MAP } from "./types";
import {
  CLIENTE_SEMANAS_O_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
  INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD,
} from "./integration-docs-completos";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_SILVIA,
  parseAsesorDocumentosObligatoriosEnvio,
} from "./asesor-documentos-obligatorios-envio";

describe("cliente_semanas_o_vigencia_derechos catálogo", () => {
  it("label canónico y obligatorio en catálogo", () => {
    const item = DOCUMENTO_CATALOGO_MAP.cliente_semanas_o_vigencia_derechos;
    assert.equal(
      item.label,
      "Semanas Cotizadas o Vigencia de Derechos",
    );
    assert.equal(item.obligatorio, "obligatorio");
    assert.equal(item.tipo, CLIENTE_SEMANAS_O_VIGENCIA_DERECHOS_DOCUMENT_TIPO);
  });

  it("está en allowlist de upload asesor", () => {
    assert.ok(
      (INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes(
        CLIENTE_SEMANAS_O_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
      ),
    );
  });

  it("parse acepta set Silvia con tipo combinado", () => {
    assert.deepEqual(
      parseAsesorDocumentosObligatoriosEnvio([
        ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_SILVIA,
      ]),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_SILVIA],
    );
  });
});
