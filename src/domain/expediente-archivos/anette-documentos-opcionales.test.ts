import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_SCOPED_POR_EQUIPO,
  CLIENTE_SOLICITUD_INSCRIPCION_DOCUMENT_TIPO,
  CLIENTE_VALIDACION_INE_60_DOCUMENT_TIPO,
} from "./integration-docs-completos";
import { INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS } from "./asesor-documentos-obligatorios-envio";
import { SCOPED_EQUIPO_DOCUMENTO_UI } from "./cliente-scoped-equipo-documento";
import { parseAsesorTiposDocumentoVisibles } from "./asesor-tipos-documento-visibles";

describe("Anette documentos opcionales", () => {
  it("Solicitud inscripción y Validación INE 60% están en UI scoped", () => {
    const tipos = SCOPED_EQUIPO_DOCUMENTO_UI.map((d) => d.tipo);
    assert.ok(tipos.includes(CLIENTE_SOLICITUD_INSCRIPCION_DOCUMENT_TIPO));
    assert.ok(tipos.includes(CLIENTE_VALIDACION_INE_60_DOCUMENT_TIPO));
  });

  it("siguen fuera del paquete obligatorio de envío externo", () => {
    const obligatorios = INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS as readonly string[];
    assert.ok(!obligatorios.includes(CLIENTE_SOLICITUD_INSCRIPCION_DOCUMENT_TIPO));
    assert.ok(!obligatorios.includes(CLIENTE_VALIDACION_INE_60_DOCUMENT_TIPO));
  });

  it("parser acepta ambos cuando backend los autoriza", () => {
    assert.deepEqual(
      parseAsesorTiposDocumentoVisibles([
        CLIENTE_SOLICITUD_INSCRIPCION_DOCUMENT_TIPO,
        CLIENTE_VALIDACION_INE_60_DOCUMENT_TIPO,
      ]),
      [CLIENTE_SOLICITUD_INSCRIPCION_DOCUMENT_TIPO, CLIENTE_VALIDACION_INE_60_DOCUMENT_TIPO],
    );
    assert.ok(INTEGRATION_DOC_TIPOS_ASESOR_SCOPED_POR_EQUIPO.includes(CLIENTE_SOLICITUD_INSCRIPCION_DOCUMENT_TIPO));
    assert.ok(INTEGRATION_DOC_TIPOS_ASESOR_SCOPED_POR_EQUIPO.includes(CLIENTE_VALIDACION_INE_60_DOCUMENT_TIPO));
  });
});
