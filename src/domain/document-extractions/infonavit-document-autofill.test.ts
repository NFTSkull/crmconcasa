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

  it("Número identificación usa OCR explícito o T7 MRZ después de <<", () => {
    const explicit = buildInfonavitDocumentAutofillPatch({
      ineReverso: "CIC 123456789 OCR 0852070785064 IDMEX123",
    });
    assert.equal(
      explicit.cliente.identificacionNumero?.value,
      "0852070785064",
    );

    const mrz = buildInfonavitDocumentAutofillPatch({
      ineReverso: [
        "IDMEX2840877688<<2653076233570",
        "8801030M2512311MEX<02<<<<<<<<<<",
        "CARRASCO<MIJANGOS<<ANAHI<<<<<<",
      ].join("\n"),
    });
    assert.equal(
      mrz.cliente.identificacionNumero?.value,
      "2653076233570",
    );
    assert.equal(
      mrz.cliente.identificacionNumero?.rule,
      "ine_mrz_t7",
    );
    assert.equal(
      mrz.cliente.identificacionVigencia?.value,
      "31/12/2025",
    );

    const noLabelOrMrz = buildInfonavitDocumentAutofillPatch({
      ineReverso: "2653076233570",
    });
    assert.equal(noLabelOrMrz.cliente.identificacionNumero, undefined);
  });


  it("INE no reemplaza nombre correcto con ruido OCR", () => {
    const patch = buildInfonavitDocumentAutofillPatch(
      {
        ineFrente: [
          "INSTITUTO NACIONAL ELECTORAL",
          "NOMBRE",
          "AD",
          "EC",
          "DITE BERD",
          "CURP SARC970707HNLNMR03",
          "SEXO H",
          "VIGENCIA 2026",
        ].join("\n"),
      },
      { expectedClienteNombre: "CARLOS GUADALUPE SANTIAGO RAMOS" },
    );

    assert.equal(patch.cliente.nombres, undefined);
    assert.equal(patch.cliente.apellidoPaterno, undefined);
    assert.equal(patch.cliente.apellidoMaterno, undefined);
    assert.equal(patch.cliente.curp?.value, "SARC970707HNLNMR03");
    assert.equal(patch.cliente.genero?.value, "M");
    assert.equal(
      patch.cliente.identificacionVigencia?.value,
      "31/12/2026",
    );
    assert.equal(patch.issues?.[0]?.code, "low_confidence");
    assert.equal(patch.issues?.[0]?.source, "cliente_ine_frente");
  });

  it("INE reverso MRZ recupera nombre, sexo y vigencia", () => {
    const patch = buildInfonavitDocumentAutofillPatch(
      {
        ineReverso: [
          "IDMEX2565181189<<2588067552701",
          "8410308H3312315MEX<04<<26018<7",
          "ZAMUDIO<CAMPOS<<GERARDO<<<<<<",
        ].join("\n"),
      },
      { expectedClienteNombre: "GERARDO ZAMUDIO CAMPOS" },
    );

    assert.equal(patch.cliente.apellidoPaterno?.value, "ZAMUDIO");
    assert.equal(patch.cliente.apellidoMaterno?.value, "CAMPOS");
    assert.equal(patch.cliente.nombres?.value, "GERARDO");
    assert.equal(patch.cliente.genero?.value, "M");
    assert.equal(
      patch.cliente.identificacionVigencia?.value,
      "31/12/2033",
    );
  });

  it("comprobante cargado manda en vivienda aunque el titular sea otra persona", () => {
    const patch = buildInfonavitDocumentAutofillPatch(
      {
        comprobanteDomicilio: [
          "SIGALA ALEMAN MARIA DE LA PAZ",
          "POLIGONO 9196 CP 64106",
          "AV PASEO DE LA REFORMA 164",
          "JUAREZ CP 06600",
        ].join("\n"),
      },
      { expectedClienteNombre: "GERARDO ZAMUDIO CAMPOS" },
    );

    assert.equal(patch.vivienda.calle?.value, "POLIGONO");
    assert.equal(patch.vivienda.noExt?.value, "9196");
    assert.equal(patch.vivienda.cp?.value, "64106");
    assert.equal(patch.issues?.[0]?.code, "subject_mismatch");
  });

  it("estado de cuenta cargado manda en CLABE aunque el titular difiera", () => {
    const patch = buildInfonavitDocumentAutofillPatch(
      {
        estadoCuenta: [
          "TITULAR MARIA SIGALA ALEMAN",
          "CLABE INTERBANCARIA 032180000118359719",
        ].join("\n"),
      },
      { expectedClienteNombre: "GERARDO ZAMUDIO CAMPOS" },
    );

    assert.equal(
      patch.clabeDerechohabiente?.value,
      "032180000118359719",
    );
    assert.equal(patch.issues?.[0]?.source, "cliente_estado_cuenta");
  });

  it("INE vigencia tolera O/0 y OCR reverso con separadores", () => {
    const patch = buildInfonavitDocumentAutofillPatch({
      ineFrente: [
        "INSTITUTO NACIONAL ELECTORAL",
        "NOMBRE",
        "AYALA",
        "CAMARILLO",
        "JUAN PABLO",
        "CURP AACJ801018HNLYMN02",
        "SEXO H",
        "VIGENCIA 2O25 - 2O35",
      ].join("\n"),
      ineReverso: "CIC 123456789\nOCR: 0852 0707 8506 4\nIDMEX123456789",
    });

    assert.equal(patch.cliente.identificacionVigencia?.value, "31/12/2035");
    assert.equal(patch.cliente.identificacionNumero?.value, "0852070785064");
  });

  it("CFE CP.0000 no se confunde con número exterior", () => {
    const patch = buildInfonavitDocumentAutofillPatch({
      comprobanteDomicilio: [
        "CFE Comisión Federal de Electricidad",
        "TORRES JARAMILLO ALBERTO",
        "MIRADOR DEL PUERTO 868 CP.0000",
        "M JARDIN Y M LAGO",
        "REAL DE PALMAS ZUAZUA C.P.65760",
        "GRAL. ZUAZUA N.L.,N.L.",
        "NO. DE SERVICIO:371080902938",
        "RMU:65760 08-09-18 XAXX-010101 005 CFE",
      ].join("\n"),
    });

    assert.equal(patch.vivienda.calle?.value, "MIRADOR DEL PUERTO");
    assert.equal(patch.vivienda.noExt?.value, "868");
    assert.equal(patch.vivienda.cp?.value, "65760");
    assert.equal(patch.vivienda.municipio?.value, "ZUAZUA");
    assert.equal(patch.vivienda.entidad?.value, "NUEVO LEÓN");
  });

  it("CFE CALLE 9 52 conserva 9 en calle y usa 52 como exterior", () => {
    const patch = buildInfonavitDocumentAutofillPatch({
      comprobanteDomicilio: [
        "CFE Comisión Federal de Electricidad",
        "AYALA CAMARILLO JUAN PABLO",
        "CALLE 9 52 C.P. 66460",
        "RICARDO CARRILLO ENRIQUE",
        "LAS PUENTES RESID C.P. 66460",
        "SAN NICOLAS DE LOS G., N.L.",
        "NO. DE SERVICIO: 377160604197",
        "RMU: 66460 16-07-02 AACJ-801018 001 CFE",
      ].join("\n"),
    });

    assert.equal(patch.vivienda.calle?.value, "CALLE 9");
    assert.equal(patch.vivienda.noExt?.value, "52");
    assert.equal(patch.vivienda.colonia?.value, "LAS PUENTES RESID");
    assert.equal(patch.vivienda.cp?.value, "66460");
    assert.equal(
      patch.vivienda.municipio?.value,
      "SAN NICOLÁS DE LOS GARZA",
    );
    assert.equal(patch.vivienda.entidad?.value, "NUEVO LEÓN");
  });

  it("CFE prioriza domicilio del cliente y excluye Paseo de la Reforma corporativo", () => {
    const patch = buildInfonavitDocumentAutofillPatch({
      comprobanteDomicilio: [
        "CFE Comisión Federal de Electricidad",
        "AV. PASEO DE LA REFORMA 164",
        "ALCALDIA CUAUHTEMOC, 06600 CIUDAD DE MEXICO",
        "MENDOZA GUERRERO JORGE ARMANDO",
        "INDEPENDENCIA 1719 CP 00000",
        "PALMAS Y LAUREL",
        "MONTERREY C.P.64530",
        "MONTERREY N.L.,N.L.",
        "NO. DE SERVICIO: 374180802409",
        "RMU: 64530 18-08-29 MEGJ-790516 005 CFE",
      ].join("\n"),
    });

    assert.equal(patch.vivienda.calle?.value, "INDEPENDENCIA");
    assert.equal(patch.vivienda.noExt?.value, "1719");
    assert.equal(patch.vivienda.cp?.value, "64530");
    assert.equal(patch.vivienda.municipio?.value, "MONTERREY");
    assert.equal(patch.vivienda.entidad?.value, "NUEVO LEÓN");
    assert.equal(patch.vivienda.colonia, undefined);
    assert.doesNotMatch(
      patch.vivienda.direccionCompleta?.value ?? "",
      /PASEO DE LA REFORMA|06600|CUAUHTEMOC/i,
    );
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
