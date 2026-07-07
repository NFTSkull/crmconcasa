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

  it("semanas cotizadas es opcional del asesor pero Mesa también la sube", () => {
    assert.ok(
      (INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes("cliente_semanas_cotizadas"),
    );
    assert.ok(
      (INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes("cliente_semanas_cotizadas"),
    );
  });
});
