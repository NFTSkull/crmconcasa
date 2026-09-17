import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  friendlyDocLabel,
  isCurrentDocumentoRow,
  missingDocMessage,
  pickInitialIneSide,
  primaryDocKindsForContext,
  resolveActiveDocKind,
  resolveInfonavitSourcePreviewContext,
  type InfonavitSourceFieldKey,
} from "./infonavit-source-preview";

describe("P4A infonavit-source-preview mapping", () => {
  it("1. Nombre → identidad / INE", () => {
    assert.equal(resolveInfonavitSourcePreviewContext("nombres"), "identidad");
    assert.deepEqual(primaryDocKindsForContext("identidad"), [
      "cliente_ine_frente",
      "cliente_ine_reverso",
    ]);
  });

  it("2. Apellido → identidad / INE", () => {
    assert.equal(
      resolveInfonavitSourcePreviewContext("apellidoPaterno"),
      "identidad",
    );
    assert.equal(
      resolveInfonavitSourcePreviewContext("apellidoMaterno"),
      "identidad",
    );
  });

  it("3. CURP / identificación → identidad / INE", () => {
    const fields: InfonavitSourceFieldKey[] = [
      "curp",
      "identificacionTipo",
      "identificacionNumero",
      "identificacionVigencia",
    ];
    for (const f of fields) {
      assert.equal(resolveInfonavitSourcePreviewContext(f), "identidad");
    }
  });

  it("4. RFC → estado de cuenta", () => {
    assert.equal(resolveInfonavitSourcePreviewContext("rfc"), "rfc");
    assert.deepEqual(primaryDocKindsForContext("rfc"), [
      "cliente_estado_cuenta",
    ]);
    assert.equal(friendlyDocLabel("cliente_estado_cuenta"), "Estado de cuenta");
  });

  it("5. CLABE → estado de cuenta", () => {
    assert.equal(
      resolveInfonavitSourcePreviewContext("clabeDerechohabiente"),
      "clabe",
    );
    assert.deepEqual(primaryDocKindsForContext("clabe"), [
      "cliente_estado_cuenta",
    ]);
  });

  it("6. Vivienda → comprobante domicilio (no INE)", () => {
    const fields: InfonavitSourceFieldKey[] = [
      "viviendaCalle",
      "viviendaNoExt",
      "viviendaNoInt",
      "viviendaLote",
      "viviendaManzana",
      "viviendaColonia",
      "viviendaCp",
      "viviendaEntidad",
      "viviendaMunicipio",
      "viviendaTipoPropiedad",
    ];
    for (const f of fields) {
      assert.equal(resolveInfonavitSourcePreviewContext(f), "vivienda");
    }
    assert.deepEqual(primaryDocKindsForContext("vivienda"), [
      "cliente_comprobante_domicilio",
    ]);
    assert.equal(
      resolveActiveDocKind({
        context: "vivienda",
        ineSide: "frente",
        hasFrente: true,
        hasReverso: true,
        hasEstadoCuenta: true,
        hasComprobante: true,
      }),
      "cliente_comprobante_domicilio",
    );
  });

  it("7. INE Frente/Reverso: preferir Frente; respetar selección", () => {
    assert.equal(
      pickInitialIneSide({ frente: true, reverso: true }),
      "frente",
    );
    assert.equal(
      pickInitialIneSide({ frente: false, reverso: true }),
      "reverso",
    );
    assert.equal(
      resolveActiveDocKind({
        context: "identidad",
        ineSide: "reverso",
        hasFrente: true,
        hasReverso: true,
        hasEstadoCuenta: false,
        hasComprobante: false,
      }),
      "cliente_ine_reverso",
    );
    assert.equal(
      resolveActiveDocKind({
        context: "identidad",
        ineSide: null,
        hasFrente: true,
        hasReverso: true,
        hasEstadoCuenta: false,
        hasComprobante: false,
      }),
      "cliente_ine_frente",
    );
  });

  it("8. falta documento → null + mensaje disponible", () => {
    assert.equal(
      resolveActiveDocKind({
        context: "identidad",
        ineSide: null,
        hasFrente: false,
        hasReverso: false,
        hasEstadoCuenta: true,
        hasComprobante: true,
      }),
      null,
    );
    assert.match(missingDocMessage("identidad"), /INE/);
    assert.match(missingDocMessage("rfc"), /estado de cuenta/i);
    assert.match(missingDocMessage("vivienda"), /comprobante/i);
  });

  it("9–10. solo current document (deleted_at null)", () => {
    assert.equal(isCurrentDocumentoRow({ deleted_at: null }), true);
    assert.equal(isCurrentDocumentoRow({}), true);
    assert.equal(
      isCurrentDocumentoRow({ deleted_at: "2026-01-01T00:00:00Z" }),
      false,
    );
  });

  it("other fields → none (no cambio de preview por tecla genérica)", () => {
    assert.equal(resolveInfonavitSourcePreviewContext("other"), "none");
    assert.deepEqual(primaryDocKindsForContext("none"), []);
  });
});
