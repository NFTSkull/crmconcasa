import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD,
  INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
} from "./integration-docs-completos";

describe("permisos upload Mesa vs asesor (contrato de tipos)", () => {
  it("Mesa puede subir semanas, acta y constancia SAT", () => {
    assert.deepEqual([...INTEGRATION_DOC_TIPOS_MESA_UPLOAD], [
      "cliente_semanas_cotizadas",
      "cliente_acta_nacimiento",
      "cliente_constancia_sat",
    ]);
  });

  it("asesor NO puede subir nss, acta ni constancia SAT", () => {
    assert.ok(!(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes("nss"));
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes(
        "cliente_acta_nacimiento",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes("cliente_constancia_sat"),
    );
  });

  it("Mesa NO puede subir nss ni documentos del asesor vía tipos Mesa", () => {
    const asesorOnly = [
      "nss",
      "cliente_ine_frente",
      "cliente_ine_reverso",
      "cliente_comprobante_domicilio",
      "cliente_estado_cuenta",
    ];
    for (const tipo of asesorOnly) {
      assert.ok(!(INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes(tipo));
    }
  });

  it("carta empresa es opcional del asesor y no la sube Mesa vía complementarios", () => {
    assert.ok(
      (INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes("cliente_carta_empresa"),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes("cliente_carta_empresa"),
    );
  });

  it("acta nacimiento digital es opcional del asesor y no la sube Mesa vía complementarios", () => {
    assert.ok(
      (INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes(
        "cliente_acta_nacimiento_digital",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes(
        "cliente_acta_nacimiento_digital",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes(
        "cliente_acta_nacimiento",
      ),
    );
    assert.ok(
      (INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes("cliente_acta_nacimiento"),
    );
  });

  it("semanas cotizadas es opcional del asesor pero Mesa también la sube", () => {
    assert.ok(
      (INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes("cliente_semanas_cotizadas"),
    );
    assert.ok(
      (INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes("cliente_semanas_cotizadas"),
    );
  });

  it("Pagaré: registrable Mesa (SQL) pero no en UI complementarios ni upload asesor", () => {
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes("cliente_pagare"),
      "UI complementarios sin botón Pagaré aún (B4)",
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes("cliente_pagare"),
    );
  });

  it("Notificación documento: registrable Mesa pero no en UI complementarios ni upload asesor", () => {
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes(
        "cliente_notificacion",
      ),
      "UI complementarios sin botón Notificación documento",
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes(
        "cliente_notificacion",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes("notificacion"),
      "nunca tipo corto notificacion en complementarios",
    );
  });
});
