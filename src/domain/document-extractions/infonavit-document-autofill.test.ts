import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInfonavitDocumentAutofillPatch,
  comparableAutofillValue,
} from "./infonavit-document-autofill";

const CLABE = "032180000118359719";

describe("P4C document autofill parser", () => {
  it("INE frente extrae nombre, CURP, sexo y vigencia", () => {
    const patch = buildInfonavitDocumentAutofillPatch({
      ineFrente: [
        "INSTITUTO NACIONAL ELECTORAL",
        "NOMBRE",
        "PEREZ",
        "LOPEZ",
        "JUAN CARLOS",
        "DOMICILIO",
        "CALLE PRUEBA 123",
        "CURP PEPL900101HNLRPN09",
        "SEXO H",
        "VIGENCIA 2023 - 2033",
      ].join("\n"),
    });
    assert.equal(patch.cliente.apellidoPaterno?.value, "PEREZ");
    assert.equal(patch.cliente.apellidoMaterno?.value, "LOPEZ");
    assert.equal(patch.cliente.nombres?.value, "JUAN CARLOS");
    assert.equal(patch.cliente.curp?.value, "PEPL900101HNLRPN09");
    assert.equal(patch.cliente.genero?.value, "M");
    assert.equal(patch.cliente.identificacionTipo?.value, "INE");
    assert.equal(
      patch.cliente.identificacionVigencia?.value,
      "31/12/2033",
    );
  });

  it("SEXO M de INE se traduce a F del formulario", () => {
    const patch = buildInfonavitDocumentAutofillPatch({
      ineFrente:
        "NOMBRE\nRAMIREZ\nGARCIA\nMARIA\nCURP RAGM900101MNLMRR09\nSEXO M\nVIGENCIA 2031",
    });
    assert.equal(patch.cliente.genero?.value, "F");
  });


  it("vigencia tolera separador ruidoso de OCR pero exige etiqueta", () => {
    const patch = buildInfonavitDocumentAutofillPatch({
      ineFrente: "SEXO H\nVIGENCIA\n2023\" 2033--",
    });
    assert.equal(patch.cliente.genero?.value, "M");
    assert.equal(
      patch.cliente.identificacionVigencia?.value,
      "31/12/2033",
    );

    const noLabel = buildInfonavitDocumentAutofillPatch({
      ineFrente: "2023 2033",
    });
    assert.equal(noLabel.cliente.identificacionVigencia, undefined);
  });

  it("T7 solo usa OCR explícitamente etiquetado", () => {
    const explicit = buildInfonavitDocumentAutofillPatch({
      ineReverso: "CIC 123456789 OCR 0852070785064 IDMEX123",
    });
    assert.equal(
      explicit.cliente.identificacionNumero?.value,
      "0852070785064",
    );

    const noLabel = buildInfonavitDocumentAutofillPatch({
      ineReverso: "0852070785064",
    });
    assert.equal(noLabel.cliente.identificacionNumero, undefined);
  });

  it("comprobante extrae domicilio de bloque con CP", () => {
    const patch = buildInfonavitDocumentAutofillPatch({
      comprobanteDomicilio: [
        "CFE SUMINISTRADOR",
        "JUAN PEREZ LOPEZ",
        "AV LAS TORRES 145",
        "COL. PASEO REAL",
        "APODACA NUEVO LEON C.P. 66600",
        "TOTAL A PAGAR",
      ].join("\n"),
    });
    assert.equal(patch.vivienda.calle?.value, "AV LAS TORRES");
    assert.equal(patch.vivienda.noExt?.value, "145");
    assert.equal(patch.vivienda.cp?.value, "66600");
    assert.equal(patch.vivienda.entidad?.value, "NUEVO LEÓN");
    assert.equal(patch.vivienda.municipio?.value, "APODACA");
  });

  it("estado de cuenta llena CLABE solo con detección high + checksum", () => {
    const patch = buildInfonavitDocumentAutofillPatch({
      estadoCuenta: Array.from(
        { length: 3 },
        () => `CLABE INTERBANCARIA ${CLABE}\nTitular demo`,
      ).join("\n"),
    });
    assert.equal(patch.clabeDetection?.status, "detected");
    assert.equal(patch.clabeDerechohabiente?.value, CLABE);
  });

  it("cuenta sin etiqueta CLABE no se autollenna", () => {
    const patch = buildInfonavitDocumentAutofillPatch({
      estadoCuenta: Array.from(
        { length: 3 },
        () => `Cuenta bancaria ${CLABE}\nTitular demo`,
      ).join("\n"),
    });
    assert.equal(patch.clabeDerechohabiente, undefined);
  });

  it("comparación ignora acentos y separadores", () => {
    assert.equal(
      comparableAutofillValue("NUEVO LEÓN"),
      comparableAutofillValue("Nuevo Leon"),
    );
  });
});
