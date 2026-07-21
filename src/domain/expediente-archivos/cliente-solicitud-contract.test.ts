import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENTE_SOLICITUD_DOCUMENT_CONTRACT,
  CLIENTE_SOLICITUD_DOCUMENT_TIPO,
  CLIENTE_PAGARE_DOCUMENT_CONTRACT,
  CLIENTE_PAGARE_DOCUMENT_TIPO,
  INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD,
  INTEGRATION_DOC_TIPOS_MESA_REGISTER,
  INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
} from "./integration-docs-completos";
import { DOCUMENTO_CATALOGO_MAP } from "./types";

describe("contrato preparatorio Solicitud documento (P096)", () => {
  it("tipo técnico exacto cliente_solicitud (nunca solicitud)", () => {
    assert.equal(CLIENTE_SOLICITUD_DOCUMENT_TIPO, "cliente_solicitud");
    assert.notEqual(CLIENTE_SOLICITUD_DOCUMENT_TIPO, "solicitud");
    assert.equal(CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.tipo, "cliente_solicitud");
    assert.notEqual(
      CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.tipo as string,
      "solicitud",
    );
  });

  it("label, etapa, MIME PDF/JPEG/PNG y tamaño 15 MiB", () => {
    assert.equal(CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.label, "Solicitud");
    assert.equal(CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.origen, "Mesa");
    assert.equal(CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.etapaMinima, 7);
    assert.equal(CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.obligatorio, false);
    assert.equal(CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.esGateAvance, false);
    assert.equal(CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.maxBytes, 15_728_640);
    assert.equal(CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.maxBytes, 15 * 1024 * 1024);
    assert.deepEqual([...CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.mimePermitidos], [
      "application/pdf",
      "image/jpeg",
      "image/png",
    ]);
    assert.ok(
      !CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.mimePermitidos.includes(
        "image/gif" as never,
      ),
    );
    assert.ok(
      !CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.mimePermitidos.includes(
        "image/webp" as never,
      ),
    );
    assert.deepEqual([...CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.formatos], [
      "PDF",
      "JPG",
      "JPEG",
      "PNG",
    ]);
  });

  it("está en allowlist register Mesa pero no en UI complementarios", () => {
    assert.ok(
      (INTEGRATION_DOC_TIPOS_MESA_REGISTER as readonly string[]).includes(
        "cliente_solicitud",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes(
        "cliente_solicitud",
      ),
    );
  });

  it("no es obligatorio ni upload asesor", () => {
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_VALIDACION_MESA as readonly string[]).includes(
        "cliente_solicitud",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes(
        "cliente_solicitud",
      ),
    );
  });

  it("catálogo tipado", () => {
    const item = DOCUMENTO_CATALOGO_MAP.cliente_solicitud;
    assert.equal(item.label, "Solicitud");
    assert.equal(item.ownerRole, "mesa");
    assert.equal(item.obligatorio, "opcional");
    assert.deepEqual([...item.etapasRequeridas], []);
  });

  it("contrato independiente de Pagaré y Notificación; mutar uno no altera los otros", () => {
    assert.notEqual(
      CLIENTE_SOLICITUD_DOCUMENT_CONTRACT,
      CLIENTE_PAGARE_DOCUMENT_CONTRACT,
    );
    assert.notEqual(
      CLIENTE_SOLICITUD_DOCUMENT_TIPO,
      CLIENTE_PAGARE_DOCUMENT_TIPO,
    );
    assert.equal(CLIENTE_PAGARE_DOCUMENT_TIPO, "cliente_pagare");
    assert.equal(CLIENTE_PAGARE_DOCUMENT_CONTRACT.label, "Pagaré");
    assert.equal(CLIENTE_PAGARE_DOCUMENT_CONTRACT.etapaMinima, 7);
    assert.equal(CLIENTE_PAGARE_DOCUMENT_CONTRACT.maxBytes, 15 * 1024 * 1024);
    assert.deepEqual([...CLIENTE_PAGARE_DOCUMENT_CONTRACT.mimePermitidos], [
      "application/pdf",
      "image/jpeg",
      "image/png",
    ]);

    const frozenSol = CLIENTE_SOLICITUD_DOCUMENT_CONTRACT as {
      label?: string;
    };
    assert.throws(() => {
      frozenSol.label = "Hack";
    });
    assert.equal(CLIENTE_SOLICITUD_DOCUMENT_CONTRACT.label, "Solicitud");
    assert.equal(CLIENTE_PAGARE_DOCUMENT_CONTRACT.label, "Pagaré");
  });
});
