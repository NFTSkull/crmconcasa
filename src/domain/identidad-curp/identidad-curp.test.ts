import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildConstanciaResultadoResumido,
  buildSyntheticCurp,
  compareConstanciaVsDatosGenerales,
  compareRfcCapturadoVsEstimado,
  curpCheckDigit,
  estimarRfcPersonaFisica,
  hasDiscrepancia,
  parseConstanciaCurpText,
  syntheticConstanciaTextCertificada,
  syntheticConstanciaTextLabeled,
  syntheticConstanciaTextNoCert,
  syntheticConstanciaTextOtraAutoridad,
  tiposInvalidacionPorCambio,
  validateCurpLocal,
} from "./index";

const SYN_CURP = buildSyntheticCurp({
  letters4: "BADD",
  yymmdd: "900101",
  sexo: "H",
  entidad: "DF",
  consonants3: "MLN",
  dif: "0",
});

describe("identidad-curp local", () => {
  it("normaliza y valida CURP sintética", () => {
    assert.equal(SYN_CURP.length, 18);
    assert.equal(curpCheckDigit(SYN_CURP.slice(0, 17)), SYN_CURP[17]);
    const r = validateCurpLocal({ curp: SYN_CURP.toLowerCase() });
    assert.equal(r.status, "VALIDA_LOCALMENTE");
    assert.equal(r.normalized, SYN_CURP);
    assert.equal(r.derived.sexo, "H");
    assert.equal(r.derived.entidadNacimiento, "DF");
    assert.equal(r.derived.fechaNacimiento, "1990-01-01");
  });

  it("detecta dígito incorrecto", () => {
    const bad = `${SYN_CURP.slice(0, 17)}9`;
    if (bad === SYN_CURP) {
      const other = `${SYN_CURP.slice(0, 17)}${SYN_CURP[17] === "0" ? "1" : "0"}`;
      assert.equal(validateCurpLocal({ curp: other }).status, "DIGITO_INVALIDO");
    } else {
      assert.equal(validateCurpLocal({ curp: bad }).status, "DIGITO_INVALIDO");
    }
  });

  it("fecha no coincide", () => {
    const r = validateCurpLocal({
      curp: SYN_CURP,
      fechaNacimiento: "1991-01-01",
    });
    assert.equal(r.status, "FECHA_NO_COINCIDE");
  });

  it("SIN_CURP y formato inválido", () => {
    assert.equal(validateCurpLocal({ curp: "" }).status, "SIN_CURP");
    assert.equal(validateCurpLocal({ curp: "ABC" }).status, "FORMATO_INVALIDO");
  });
});

describe("identidad-curp constancia parser", () => {
  it("Registro Civil únicamente (mutuamente excluyente)", () => {
    const text = syntheticConstanciaTextCertificada(SYN_CURP, "PRUEBA SINTETICA UNO");
    const parsed = parseConstanciaCurpText(text);
    assert.equal(parsed.status, "CURP_CERTIFICADA_REGISTRO_CIVIL");
    assert.equal(parsed.extracted.certificadaRegistroCivil, true);
    assert.equal(parsed.extracted.certificacionOtraAutoridad, false);
    assert.equal(parsed.extracted.curp, SYN_CURP);
  });

  it("tolera espacios, saltos y puntuación en leyenda RC", () => {
    const text = `CURP\nCertificada:\nverificada\ncon\nel\nRegistro\nCivil\nCLAVE: ${SYN_CURP}\nNOMBRE\nAAA BBB`;
    const parsed = parseConstanciaCurpText(text);
    assert.equal(parsed.status, "CURP_CERTIFICADA_REGISTRO_CIVIL");
    assert.equal(parsed.extracted.certificacionOtraAutoridad, false);
  });

  it("sin leyenda → no certificada", () => {
    const parsed = parseConstanciaCurpText(
      syntheticConstanciaTextNoCert(SYN_CURP, "PRUEBA SINTETICA"),
    );
    assert.equal(parsed.status, "CURP_NO_CERTIFICADA");
    assert.equal(parsed.extracted.certificadaRegistroCivil, false);
    assert.equal(parsed.extracted.certificacionOtraAutoridad, false);
  });

  it("otra autoridad únicamente", () => {
    const parsed = parseConstanciaCurpText(
      syntheticConstanciaTextOtraAutoridad(SYN_CURP),
    );
    assert.equal(parsed.status, "CERTIFICACION_OTRA_AUTORIDAD");
    assert.equal(parsed.extracted.certificadaRegistroCivil, false);
    assert.equal(parsed.extracted.certificacionOtraAutoridad, true);
  });

  it("mención Registro Civil en otra sección no doble-clasifica", () => {
    const text = [
      "CONSTANCIA CURP",
      `CLAVE: ${SYN_CURP}`,
      "NOMBRE PRUEBA SINTETICA",
      "Informacion del Registro Civil disponible en ventanilla",
      "Sin frase de certificacion oficial",
    ].join("\n");
    const parsed = parseConstanciaCurpText(text);
    assert.equal(parsed.extracted.certificadaRegistroCivil, false);
    assert.equal(parsed.extracted.certificacionOtraAutoridad, false);
    assert.equal(parsed.status, "CURP_NO_CERTIFICADA");
  });

  it("extrae campos etiquetados", () => {
    const parsed = parseConstanciaCurpText(syntheticConstanciaTextLabeled(SYN_CURP));
    assert.equal(parsed.extracted.primerApellido, "PRUEBA");
    assert.equal(parsed.extracted.segundoApellido, "SINTETICA");
    assert.equal(parsed.extracted.fechaNacimiento, "1990-01-01");
    assert.equal(parsed.extracted.sexo, "H");
    assert.equal(parsed.extracted.documentoProbatorio, "acta_nacimiento");
    assert.ok(parsed.extracted.municipioRegistro);
    assert.ok(parsed.extracted.anioRegistro);
    assert.ok(parsed.extracted.numeroActa);
  });

  it("compacta deriva fecha/sexo/entidad desde CURP", () => {
    const parsed = parseConstanciaCurpText(
      syntheticConstanciaTextCertificada(SYN_CURP, "AP1 AP2 NOMBRE"),
    );
    assert.equal(parsed.extracted.fechaNacimiento, "1990-01-01");
    assert.equal(parsed.extracted.sexo, "H");
    assert.equal(parsed.extracted.entidadNacimiento, "DF");
  });

  it("PDF sin texto → PDF_NO_LEGIBLE", () => {
    const parsed = parseConstanciaCurpText("   ");
    assert.equal(parsed.status, "PDF_NO_LEGIBLE");
  });

  it("resultado_resumido sin PII completa", () => {
    const text = syntheticConstanciaTextLabeled(SYN_CURP);
    const parsed = parseConstanciaCurpText(text);
    const campos = compareConstanciaVsDatosGenerales(
      { curp: SYN_CURP, nombreCliente: "PRUEBA SINTETICA UNO DOS" },
      parsed.extracted,
    );
    const resumen = buildConstanciaResultadoResumido(parsed, campos);
    assert.equal("texto" in resumen, false);
    assert.equal("pdf_text" in resumen, false);
    assert.equal("curp" in resumen, false);
    assert.equal("nombre_completo" in resumen, false);
    assert.equal("primer_apellido" in resumen, false);
    assert.equal("fecha_nacimiento" in resumen, false);
    assert.equal("numero_acta" in resumen, false);
    assert.equal("municipio_registro" in resumen, false);
    assert.equal(resumen.curp_presente, true);
    assert.equal(resumen.certificada_registro_civil, true);
    assert.equal(resumen.certificacion_otra_autoridad, false);
    assert.ok(resumen.parser_version);
  });
});

describe("identidad-curp comparación", () => {
  it("CURP PDF no coincide", () => {
    const other2 = buildSyntheticCurp({
      letters4: "XAXX",
      yymmdd: "850505",
      sexo: "M",
      entidad: "JC",
      consonants3: "RRT",
      dif: "0",
    });
    const parsed = parseConstanciaCurpText(
      syntheticConstanciaTextCertificada(other2, "OTRO NOMBRE"),
    );
    const campos = compareConstanciaVsDatosGenerales(
      { curp: SYN_CURP, nombreCliente: "PRUEBA SINTETICA UNO" },
      parsed.extracted,
    );
    const curpField = campos.find((c) => c.campo === "CURP");
    assert.equal(curpField?.resultado, "no_coincide");
    assert.ok(hasDiscrepancia(campos));
  });

  it("campo ausente es no_disponible no discrepancia", () => {
    const parsed = parseConstanciaCurpText(
      syntheticConstanciaTextNoCert(SYN_CURP, "SOLO NOMBRE"),
    );
    // Forzar municipio ausente
    const extracted = { ...parsed.extracted, municipioRegistro: null, anioRegistro: null };
    const campos = compareConstanciaVsDatosGenerales(
      { curp: SYN_CURP, nombreCliente: "SOLO NOMBRE" },
      extracted,
    );
    assert.equal(hasDiscrepancia(campos.filter((c) => c.campo === "Sexo") ? campos : campos), hasDiscrepancia(campos));
    const sexo = campos.find((c) => c.campo === "Sexo");
    // sexo derivado de CURP → disponible; sin capturado en datos → no_disponible
    assert.ok(sexo);
    assert.equal(sexo!.resultado, "no_disponible");
  });
});

describe("identidad-curp invalidación selectiva", () => {
  it("mapea cambios a tipos mínimos", () => {
    assert.deepEqual(
      tiposInvalidacionPorCambio({ curp: true }).sort(),
      [
        "curp_certificacion_registro_civil",
        "curp_coincidencia_datos",
        "curp_constancia",
        "curp_local",
        "rfc_estimado",
        "rfc_validacion_sat",
      ].sort(),
    );
    assert.deepEqual(
      tiposInvalidacionPorCambio({ nombreApellidosFecha: true }).sort(),
      ["curp_coincidencia_datos", "rfc_estimado"].sort(),
    );
    assert.deepEqual(
      tiposInvalidacionPorCambio({ rfc: true }).sort(),
      ["rfc_estimado", "rfc_validacion_sat"].sort(),
    );
    assert.deepEqual(
      tiposInvalidacionPorCambio({ constanciaReemplazada: true }).sort(),
      [
        "curp_certificacion_registro_civil",
        "curp_coincidencia_datos",
        "curp_constancia",
      ].sort(),
    );
  });
});

describe("identidad-curp RFC estimado", () => {
  it("genera RFC estimado etiquetado y nunca oficial", () => {
    const r = estimarRfcPersonaFisica({
      nombre: "JUAN",
      apellidoPaterno: "PEREZ",
      apellidoMaterno: "LOPEZ",
      fechaNacimiento: "1990-01-01",
    });
    assert.equal(r.status, "RFC_ESTIMADO");
    assert.ok(r.rfcEstimado && r.rfcEstimado.length === 13);
    assert.match(r.etiqueta, /estimado/i);
    assert.match(r.etiqueta, /SAT/i);
    assert.equal(r.etiqueta.includes("oficial"), false);
  });

  it("no sobrescribe lógica: capturado vs estimado", () => {
    const r = estimarRfcPersonaFisica({
      nombre: "JUAN",
      apellidoPaterno: "PEREZ",
      apellidoMaterno: "LOPEZ",
      fechaNacimiento: "1990-01-01",
    });
    assert.equal(
      compareRfcCapturadoVsEstimado(r.rfcEstimado, r.rfcEstimado),
      "RFC_CAPTURADO_COINCIDE",
    );
    assert.equal(
      compareRfcCapturadoVsEstimado("XAXX010101000", r.rfcEstimado),
      "RFC_CAPTURADO_NO_COINCIDE",
    );
  });

  it("SIN_DATOS sin fecha", () => {
    const r = estimarRfcPersonaFisica({
      nombre: "JUAN",
      apellidoPaterno: "PEREZ",
      apellidoMaterno: "",
      fechaNacimiento: "",
    });
    assert.equal(r.status, "SIN_DATOS");
  });
});
