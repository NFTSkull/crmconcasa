import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS,
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS_LEGACY_7,
  parseAsesorDocumentosObligatoriosEnvio,
} from "./asesor-documentos-obligatorios-envio";
import { INTEGRATION_DOC_TIPOS_ASESOR_ENVIO } from "./integration-docs-completos";

describe("parseAsesorDocumentosObligatoriosEnvio (fail-closed)", () => {
  it("payload exacto 8 (+CURP) → 8 canónicos", () => {
    const shuffled = [
      "cliente_presupuesto",
      "cliente_ine_frente",
      "cliente_lista_nominal",
      "cliente_comprobante_domicilio",
      "cliente_bajo_protesta",
      "cliente_estado_cuenta",
      "cliente_solicitud_credito",
      "cliente_constancia_curp",
    ];
    assert.deepEqual(
      parseAsesorDocumentosObligatoriosEnvio(shuffled),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS],
    );
  });

  it("payload exacto legacy 7 → 7", () => {
    assert.deepEqual(
      parseAsesorDocumentosObligatoriosEnvio([
        ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS_LEGACY_7,
      ]),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS_LEGACY_7],
    );
  });

  it("payload exacto 4 → retorna 4 canónicos", () => {
    assert.deepEqual(
      parseAsesorDocumentosObligatoriosEnvio([...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO]),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO],
    );
  });

  it("null / undefined / string / objeto → 4", () => {
    assert.deepEqual(parseAsesorDocumentosObligatoriosEnvio(null), [
      ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
    ]);
    assert.deepEqual(parseAsesorDocumentosObligatoriosEnvio(undefined), [
      ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
    ]);
    assert.deepEqual(parseAsesorDocumentosObligatoriosEnvio("x"), [
      ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
    ]);
    assert.deepEqual(parseAsesorDocumentosObligatoriosEnvio({}), [
      ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
    ]);
  });

  it("array vacío → 4", () => {
    assert.deepEqual(parseAsesorDocumentosObligatoriosEnvio([]), [
      ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
    ]);
  });

  it("tipo desconocido → 4 (no parcial)", () => {
    assert.deepEqual(
      parseAsesorDocumentosObligatoriosEnvio([
        "cliente_ine_frente",
        "cliente_ine_reverso",
        "cliente_comprobante_domicilio",
        "cliente_estado_cuenta",
        "cliente_fantasma",
      ]),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO],
    );
  });

  it("parcial 7 de 8 → 4", () => {
    assert.deepEqual(
      parseAsesorDocumentosObligatoriosEnvio(
        INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS.slice(0, 7),
      ),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO],
    );
  });
});
