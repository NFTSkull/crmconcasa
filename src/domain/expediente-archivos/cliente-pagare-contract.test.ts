import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENTE_PAGARE_DOCUMENT_CONTRACT,
  CLIENTE_PAGARE_DOCUMENT_TIPO,
  INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD,
  INTEGRATION_DOC_TIPOS_MESA_REGISTER,
  INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
} from "./integration-docs-completos";
import { DOCUMENTO_CATALOGO_MAP } from "./types";

describe("contrato preparatorio Pagaré (P090 B3)", () => {
  it("tipo técnico y label", () => {
    assert.equal(CLIENTE_PAGARE_DOCUMENT_TIPO, "cliente_pagare");
    assert.equal(CLIENTE_PAGARE_DOCUMENT_CONTRACT.label, "Pagaré");
    assert.equal(CLIENTE_PAGARE_DOCUMENT_CONTRACT.origen, "Mesa");
    assert.equal(CLIENTE_PAGARE_DOCUMENT_CONTRACT.etapaMinima, 7);
    assert.equal(CLIENTE_PAGARE_DOCUMENT_CONTRACT.obligatorio, false);
    assert.equal(CLIENTE_PAGARE_DOCUMENT_CONTRACT.esGateAvance, false);
    assert.equal(CLIENTE_PAGARE_DOCUMENT_CONTRACT.maxBytes, 15 * 1024 * 1024);
    assert.deepEqual([...CLIENTE_PAGARE_DOCUMENT_CONTRACT.mimePermitidos], [
      "application/pdf",
      "image/jpeg",
      "image/png",
    ]);
  });

  it("está en allowlist register Mesa pero no en UI complementarios", () => {
    assert.ok(
      (INTEGRATION_DOC_TIPOS_MESA_REGISTER as readonly string[]).includes(
        "cliente_pagare",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes(
        "cliente_pagare",
      ),
    );
  });

  it("no es obligatorio ni upload asesor", () => {
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_VALIDACION_MESA as readonly string[]).includes(
        "cliente_pagare",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes(
        "cliente_pagare",
      ),
    );
  });

  it("catálogo tipado", () => {
    const item = DOCUMENTO_CATALOGO_MAP.cliente_pagare;
    assert.equal(item.label, "Pagaré");
    assert.equal(item.ownerRole, "mesa");
    assert.equal(item.obligatorio, "opcional");
    assert.deepEqual([...item.etapasRequeridas], []);
  });
});
