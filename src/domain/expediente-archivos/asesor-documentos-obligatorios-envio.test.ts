import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_ANETTE,
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS,
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS_LEGACY_7,
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_SILVIA,
  parseAsesorDocumentosObligatoriosEnvio,
  tryParseAsesorDocumentosObligatoriosEnvio,
} from "./asesor-documentos-obligatorios-envio";
import { INTEGRATION_DOC_TIPOS_ASESOR_ENVIO } from "./integration-docs-completos";

describe("parseAsesorDocumentosObligatoriosEnvio (fail-closed)", () => {
  it("payload exacto Silvia 6 (Cloud) → 6 canónicos (no fallback genérico)", () => {
    const shuffled = [
      "cliente_constancia_situacion_fiscal",
      "cliente_ine_reverso",
      "cliente_semanas_o_vigencia_derechos",
      "cliente_ine_frente",
      "cliente_acta_nacimiento_digital",
      "cliente_comprobante_domicilio",
    ];
    assert.equal(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_SILVIA.length, 6);
    assert.deepEqual(
      parseAsesorDocumentosObligatoriosEnvio(shuffled),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_SILVIA],
    );
    assert.deepEqual(
      tryParseAsesorDocumentosObligatoriosEnvio(shuffled),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_SILVIA],
    );
  });

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

  it("payload exacto Anette 7 con CURP y sin Presupuesto → 7 obligatorios", () => {
    const shuffled = [
      "cliente_lista_nominal",
      "cliente_constancia_curp",
      "cliente_ine_frente",
      "cliente_bajo_protesta",
      "cliente_estado_cuenta",
      "cliente_solicitud_credito",
      "cliente_comprobante_domicilio",
    ];
    assert.deepEqual(
      parseAsesorDocumentosObligatoriosEnvio(shuffled),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_ANETTE],
    );
    assert.equal(
      INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_ANETTE.includes("cliente_presupuesto" as never),
      false,
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

  it("tipo desconocido → 4 (no parcial) y loguea el tipo ofensor", () => {
    const errors: unknown[][] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
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
      assert.equal(tryParseAsesorDocumentosObligatoriosEnvio([
        "cliente_ine_frente",
        "cliente_fantasma",
      ]), null);
      assert.ok(errors.length >= 1);
      const joined = errors.map((a) => String(a[0])).join("\n");
      assert.match(joined, /tipo no reconocido/);
      const meta = errors.find((a) => a[1] && typeof a[1] === "object")?.[1] as {
        tipo?: string;
      };
      assert.equal(meta?.tipo, "cliente_fantasma");
    } finally {
      console.error = orig;
    }
  });

  it("parcial 6 de 7 Anette → 4", () => {
    assert.deepEqual(
      parseAsesorDocumentosObligatoriosEnvio(
        INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_ANETTE.slice(0, 6),
      ),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO],
    );
  });
});

describe("tryParseAsesorDocumentosObligatoriosEnvio (Mesa strict)", () => {
  it("basura → null (no fingir 4)", () => {
    assert.equal(tryParseAsesorDocumentosObligatoriosEnvio(null), null);
    assert.equal(tryParseAsesorDocumentosObligatoriosEnvio(["cliente_fantasma"]), null);
    assert.equal(
      tryParseAsesorDocumentosObligatoriosEnvio(
        INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_ANETTE.slice(0, 6),
      ),
      null,
    );
  });

  it("sets exactos → ok", () => {
    assert.deepEqual(
      tryParseAsesorDocumentosObligatoriosEnvio([...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO]),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO],
    );
    assert.deepEqual(
      tryParseAsesorDocumentosObligatoriosEnvio([...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS]),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_EXTERNOS],
    );
    assert.deepEqual(
      tryParseAsesorDocumentosObligatoriosEnvio([...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_ANETTE]),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_ANETTE],
    );
    assert.deepEqual(
      tryParseAsesorDocumentosObligatoriosEnvio([...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_SILVIA]),
      [...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_SILVIA],
    );
  });
});
