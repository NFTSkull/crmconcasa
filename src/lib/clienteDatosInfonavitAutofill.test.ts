import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  applyClienteDatosInfonavitAutofill,
  formatAdvertenciaInscripcionInfonavit,
} from "./clienteDatosInfonavitAutofill";

const baseDatos = {
  rfc: "",
  registroPatronal: "",
  empresa: "",
};

const source = {
  rfc_infonavit: "XAXX010101000",
  registro_patronal_infonavit: "A1234567890",
  empresa_infonavit: "WOLONG ELECTRIC INDUSTRIAL MOTORS S DE RL DE CV",
  advertencia_inscripcion: "Este trabajador tiene el crédito 1901000432",
};

describe("applyClienteDatosInfonavitAutofill", () => {
  it("rellena campos vacíos desde editor_decisions Infonavit", () => {
    const out = applyClienteDatosInfonavitAutofill(baseDatos, source);
    assert.equal(out.rfc, "XAXX010101000");
    assert.equal(out.registroPatronal, "A1234567890");
    assert.equal(out.empresa, "WOLONG ELECTRIC INDUSTRIAL MOTORS S DE RL DE CV");
  });

  it("no sobrescribe campos que ya tienen valor", () => {
    const out = applyClienteDatosInfonavitAutofill(
      {
        rfc: "CAPTURADO123",
        registroPatronal: "RP-MANUAL",
        empresa: "EMPRESA MANUAL SA",
      },
      source,
    );
    assert.equal(out.rfc, "CAPTURADO123");
    assert.equal(out.registroPatronal, "RP-MANUAL");
    assert.equal(out.empresa, "EMPRESA MANUAL SA");
  });

  it("solo rellena los vacíos cuando hay mezcla", () => {
    const out = applyClienteDatosInfonavitAutofill(
      { ...baseDatos, rfc: "YA-HAY-RFC" },
      source,
    );
    assert.equal(out.rfc, "YA-HAY-RFC");
    assert.equal(out.registroPatronal, "A1234567890");
    assert.equal(out.empresa, source.empresa_infonavit);
  });

  it("sin source no muta", () => {
    const datos = { ...baseDatos, rfc: "X" };
    assert.deepEqual(applyClienteDatosInfonavitAutofill(datos, null), datos);
    assert.deepEqual(applyClienteDatosInfonavitAutofill(datos, undefined), datos);
  });
});

describe("formatAdvertenciaInscripcionInfonavit", () => {
  it("formatea mensaje con prefijo", () => {
    assert.equal(
      formatAdvertenciaInscripcionInfonavit(source.advertencia_inscripcion),
      "Infonavit reporta: Este trabajador tiene el crédito 1901000432",
    );
  });

  it("null/vacío → null", () => {
    assert.equal(formatAdvertenciaInscripcionInfonavit(null), null);
    assert.equal(formatAdvertenciaInscripcionInfonavit("   "), null);
  });
});

describe("ExpedienteClienteDatosFormSection banner Infonavit", () => {
  const form = readFileSync(
    join(process.cwd(), "src/components/asesor/ExpedienteClienteDatosFormSection.tsx"),
    "utf8",
  );

  it("muestra banner de advertencia cuando advertenciaInscripcionInfonavit tiene valor", () => {
    assert.match(form, /advertenciaInscripcionInfonavit/);
    assert.match(form, /⚠️ \{advertenciaInscripcionInfonavit\}/);
    assert.match(form, /border-amber-200 bg-amber-50/);
  });
});
