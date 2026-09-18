import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeInfonavitDocumentAutofill } from "./infonavit-autofill-merge";
import type {
  AutofillFieldSource,
  InfonavitDocumentAutofillPatch,
} from "./infonavit-document-autofill";

function draft() {
  return {
    cliente: {
      nombres: "JUAN CARLOS",
      apellidoPaterno: "PEREZ",
      apellidoMaterno: "LOPEZ",
      curp: "",
      genero: "",
      identificacion: { tipo: "", numero: "", vigencia: "" },
    },
    vivienda: {
      calle: "",
      noExt: "",
      noInt: "",
      lote: "",
      manzana: "",
      colonia: "",
      entidad: "",
      municipio: "",
      cp: "",
    },
    destinoRecursos: { clabeDerechohabiente: "" },
    untouched: "ok",
  };
}

const high = (value: string, source: AutofillFieldSource) => ({
  value,
  source,
  confidence: "high" as const,
  rule: "test",
});

describe("P4C autofill merge", () => {
  it("llena campos detectados y marca origen", () => {
    const patch: InfonavitDocumentAutofillPatch = {
      cliente: {
        curp: high("PEPL900101HNLRPN09", "cliente_ine_frente"),
        identificacionTipo: high("INE", "cliente_ine_frente"),
        identificacionVigencia: high("31/12/2033", "cliente_ine_frente"),
      },
      vivienda: {
        cp: high("66600", "cliente_comprobante_domicilio"),
      },
      clabeDerechohabiente: high(
        "032180000118359719",
        "cliente_estado_cuenta",
      ),
    };
    const out = mergeInfonavitDocumentAutofill(draft(), patch);
    assert.equal(out.draft.cliente.curp, "PEPL900101HNLRPN09");
    assert.equal(out.draft.cliente.identificacion.tipo, "INE");
    assert.equal(out.draft.vivienda.cp, "66600");
    assert.equal(
      out.draft.destinoRecursos.clabeDerechohabiente,
      "032180000118359719",
    );
    assert.equal(out.draft.untouched, "ok");
    assert.equal(
      out.sourceByField["vivienda.cp"],
      "Comprobante · automático",
    );
  });

  it("confirma coincidencia sin reescribir", () => {
    const patch: InfonavitDocumentAutofillPatch = {
      cliente: {
        nombres: high("Juan Carlos", "cliente_ine_frente"),
      },
      vivienda: {},
    };
    const out = mergeInfonavitDocumentAutofill(draft(), patch);
    assert.deepEqual(out.applied, []);
    assert.deepEqual(out.confirmed, ["cliente.nombres"]);
    assert.equal(out.conflicts.length, 0);
  });

  it("mismatch aplica documento fuente y conserva diferencia para revisión", () => {
    const patch: InfonavitDocumentAutofillPatch = {
      cliente: {
        apellidoPaterno: high("RAMIREZ", "cliente_ine_frente"),
      },
      vivienda: {},
    };
    const out = mergeInfonavitDocumentAutofill(draft(), patch);
    assert.equal(out.draft.cliente.apellidoPaterno, "RAMIREZ");
    assert.equal(out.conflicts.length, 1);
    assert.equal(out.conflicts[0]?.current, "PEREZ");
    assert.equal(out.conflicts[0]?.detected, "RAMIREZ");
    assert.ok(out.applied.includes("cliente.apellidoPaterno"));
    assert.equal(
      out.sourceByField["cliente.apellidoPaterno"],
      "INE · automático",
    );
  });

  it("comprobante y estado de cuenta sustituyen valores previos de Generales", () => {
    const base = draft();
    base.vivienda.cp = "64000";
    base.destinoRecursos.clabeDerechohabiente = "012345678901234567";

    const patch: InfonavitDocumentAutofillPatch = {
      cliente: {},
      vivienda: {
        cp: high("66600", "cliente_comprobante_domicilio"),
      },
      clabeDerechohabiente: high(
        "032180000118359719",
        "cliente_estado_cuenta",
      ),
    };

    const out = mergeInfonavitDocumentAutofill(base, patch);
    assert.equal(out.draft.vivienda.cp, "66600");
    assert.equal(
      out.draft.destinoRecursos.clabeDerechohabiente,
      "032180000118359719",
    );
    assert.equal(out.conflicts.length, 2);
  });
});
