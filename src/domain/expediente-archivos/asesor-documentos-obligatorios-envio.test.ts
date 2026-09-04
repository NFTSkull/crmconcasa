import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS,
  parseAsesorDocumentosObligatoriosEnvio,
} from "./asesor-documentos-obligatorios-envio";
import { INTEGRATION_DOC_TIPOS_ASESOR_ENVIO } from "./integration-docs-completos";

describe("parseAsesorDocumentosObligatoriosEnvio (fail-closed)", () => {
  it("payload exacto 7 → retorna 7 canónicos", () => {
    const shuffled = [
      "cliente_presupuesto",
      "cliente_ine_frente",
      "cliente_lista_nominal",
      "cliente_comprobante_domicilio",
      "cliente_bajo_protesta",
      "cliente_estado_cuenta",
      "cliente_solicitud_credito",
    ];
    assert.deepEqual(
      parseAsesorDocumentosObligatoriosEnvio(shuffled),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS],
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

  it("duplicados inválidos → 4", () => {
    assert.deepEqual(
      parseAsesorDocumentosObligatoriosEnvio([
        "cliente_ine_frente",
        "cliente_ine_frente",
        "cliente_comprobante_domicilio",
        "cliente_estado_cuenta",
        "cliente_solicitud_credito",
        "cliente_lista_nominal",
        "cliente_bajo_protesta",
      ]),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO],
    );
  });

  it("combinación inválida (7 + reverso) → 4", () => {
    assert.deepEqual(
      parseAsesorDocumentosObligatoriosEnvio([
        ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS,
        "cliente_ine_reverso",
      ]),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO],
    );
  });

  it("parcial 6 de 7 → 4", () => {
    assert.deepEqual(
      parseAsesorDocumentosObligatoriosEnvio(
        INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS.slice(0, 6),
      ),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO],
    );
  });
});
