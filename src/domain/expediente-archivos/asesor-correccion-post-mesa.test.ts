import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asesorDebeUsarCorreccionClienteDatos,
  asesorDebeUsarCorreccionDocumento,
  asesorDocumentoUploadMode,
  asesorEsCorreccionRechazoClienteDatos,
  asesorPuedeActualizarDocReingreso,
  asesorPuedeCorregirDocumentoRechazado,
  asesorPuedeEditarClienteDatos,
  asesorPuedeMostrarUploadDocumento,
  asesorPuedeReemplazarDocumentoExistentePostMesa,
  asesorPuedeSubirDocumentoPreMesa,
  asesorPuedeSubirDocumentoNuevoReingreso,
  asesorPuedeSubirOpcionalFaltantePostMesa,
  asesorPuedeSubirOCorregirDocumento,
  esReingresoDatosEditables,
  esReingresoDocumentosEditables,
  REINGRESO_DOC_TIPOS_ACTUALIZABLES,
} from "./asesor-correccion-post-mesa";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD,
  integrationDocsCompletos,
} from "./integration-docs-completos";
import {
  validateExpedienteDocumentoUploadFile,
} from "@/lib/fileUploadValidation";

describe("asesor corrección post-Mesa (helpers UI)", () => {
  it("pre-Mesa permite upload normal de cualquier documento", () => {
    assert.equal(asesorPuedeSubirDocumentoPreMesa(false), true);
    assert.equal(asesorDocumentoUploadMode(false, "subido"), "normal");
    assert.equal(asesorPuedeSubirOCorregirDocumento(false, "validado"), true);
    assert.equal(asesorDebeUsarCorreccionDocumento(false, "rechazado"), false);
  });

  it("post-envío permite corrección en documentos rechazados", () => {
    assert.equal(asesorPuedeSubirDocumentoPreMesa(true), false);
    assert.equal(asesorPuedeCorregirDocumentoRechazado(true, "rechazado"), true);
    assert.equal(asesorPuedeCorregirDocumentoRechazado(true, "validado"), false);
    assert.equal(asesorPuedeSubirOCorregirDocumento(true, "rechazado"), true);
    assert.equal(asesorDocumentoUploadMode(true, "rechazado"), "correccion");
  });

  it("post-envío permite reemplazo de documento existente (obligatorio u opcional)", () => {
    assert.equal(asesorPuedeReemplazarDocumentoExistentePostMesa(true, "subido"), true);
    assert.equal(asesorPuedeReemplazarDocumentoExistentePostMesa(true, "validado"), true);
    assert.equal(asesorPuedeReemplazarDocumentoExistentePostMesa(true, "resubido"), true);
    assert.equal(asesorPuedeReemplazarDocumentoExistentePostMesa(true, "faltante"), false);
    assert.equal(asesorPuedeReemplazarDocumentoExistentePostMesa(true, "rechazado"), false);
    assert.equal(asesorPuedeSubirOCorregirDocumento(true, "subido", "cliente_ine_frente"), true);
    assert.equal(
      asesorPuedeSubirOCorregirDocumento(true, "validado", "cliente_comprobante_domicilio"),
      true,
    );
    assert.equal(
      asesorPuedeSubirOCorregirDocumento(true, "subido", "cliente_carta_empresa"),
      true,
    );
    assert.equal(asesorDocumentoUploadMode(true, "subido", "cliente_ine_frente"), "normal");
  });

  it("post-envío bloquea creación de obligatorio faltante fuera de reingreso", () => {
    assert.equal(
      asesorPuedeSubirOCorregirDocumento(true, "faltante", "cliente_ine_frente"),
      false,
    );
    assert.equal(
      asesorPuedeSubirOCorregirDocumento(true, "faltante", "cliente_comprobante_domicilio"),
      false,
    );
    assert.equal(asesorDocumentoUploadMode(true, "faltante", "cliente_ine_frente"), null);
  });

  it("reingreso activo abre todos los docs asesor (manual etapa 1 o P072 etapa 6)", () => {
    assert.equal(
      esReingresoDocumentosEditables({
        tieneReingresoPostBiometricos: true,
        etapaActual: 6,
      }),
      true,
    );
    assert.equal(
      esReingresoDocumentosEditables({
        tieneReingresoPostBiometricos: true,
        etapaActual: 5,
      }),
      false,
    );
    assert.equal(
      esReingresoDocumentosEditables({
        tieneReingresoPostBiometricos: false,
        etapaActual: 1,
        reingresoManualCount: 1,
      }),
      true,
    );
    assert.equal(
      esReingresoDocumentosEditables({
        tieneReingresoPostBiometricos: false,
        etapaActual: 3,
        reingresoManualCount: 2,
      }),
      false,
      "manual cerrado al salir de etapa 1",
    );
    assert.equal(
      esReingresoDatosEditables({
        tieneReingresoPostBiometricos: false,
        etapaActual: 1,
        reingresoManualCount: 1,
      }),
      true,
    );

    assert.deepEqual(
      [...REINGRESO_DOC_TIPOS_ACTUALIZABLES],
      [...INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD],
    );

    for (const tipo of INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD) {
      assert.equal(asesorPuedeActualizarDocReingreso(true, tipo, true), true);
      assert.equal(
        asesorPuedeSubirDocumentoNuevoReingreso(true, "faltante", tipo, true),
        true,
      );
      assert.equal(
        asesorPuedeSubirOCorregirDocumento(true, "faltante", tipo, true),
        true,
      );
      assert.equal(
        asesorPuedeMostrarUploadDocumento({
          puedeIntegrar: false,
          submittedToMesa: true,
          estatusRevision: "validado",
          tipoDocumento: tipo,
          esReingresoActivo: true,
        }),
        true,
      );
    }

    assert.equal(
      asesorPuedeSubirOCorregirDocumento(
        true,
        "faltante",
        "cliente_ine_frente",
        false,
      ),
      false,
    );
  });

  it("post-Mesa muestra upload de reemplazo aunque puedeIntegrar sea false", () => {
    assert.equal(
      asesorPuedeMostrarUploadDocumento({
        puedeIntegrar: false,
        submittedToMesa: true,
        estatusRevision: "validado",
        tipoDocumento: "cliente_comprobante_domicilio",
        esReingresoActivo: false,
      }),
      true,
    );
    assert.equal(
      asesorPuedeMostrarUploadDocumento({
        puedeIntegrar: false,
        submittedToMesa: false,
        estatusRevision: "faltante",
        tipoDocumento: "cliente_comprobante_domicilio",
      }),
      false,
    );
  });

  it("post-envío permite primer upload de opcional faltante", () => {
    assert.equal(
      asesorPuedeSubirOpcionalFaltantePostMesa(
        true,
        "faltante",
        "cliente_carta_empresa",
      ),
      true,
    );
    assert.equal(
      asesorPuedeSubirOpcionalFaltantePostMesa(
        true,
        "faltante",
        "cliente_semanas_cotizadas",
      ),
      true,
    );
    assert.equal(
      asesorPuedeSubirOpcionalFaltantePostMesa(
        true,
        "faltante",
        "cliente_acta_nacimiento_digital",
      ),
      true,
    );
    assert.equal(
      asesorPuedeSubirOpcionalFaltantePostMesa(
        true,
        "faltante",
        "cliente_ine_frente",
      ),
      false,
    );
    assert.equal(
      asesorPuedeSubirOCorregirDocumento(true, "faltante", "cliente_carta_empresa"),
      true,
    );
    assert.equal(
      asesorDocumentoUploadMode(true, "faltante", "cliente_carta_empresa"),
      "normal",
    );
  });

  it("reemplazo post-Mesa respeta formatos por tipo", () => {
    const pdf = { name: "ine.pdf", type: "application/pdf", size: 1000 } as File;
    const jpg = { name: "ine.jpg", type: "image/jpeg", size: 1000 } as File;
    const cartaJpg = { name: "carta.jpg", type: "image/jpeg", size: 1000 } as File;
    const comprobanteJpg = { name: "foto.jpg", type: "image/jpeg", size: 1000 } as File;

    assert.deepEqual(validateExpedienteDocumentoUploadFile(pdf, "cliente_ine_frente"), {
      ok: true,
    });
    assert.deepEqual(validateExpedienteDocumentoUploadFile(jpg, "cliente_ine_frente"), {
      ok: true,
    });
    assert.deepEqual(
      validateExpedienteDocumentoUploadFile(cartaJpg, "cliente_carta_empresa"),
      { ok: true },
    );
    assert.deepEqual(
      validateExpedienteDocumentoUploadFile(cartaJpg, "cliente_acta_nacimiento_digital"),
      { ok: true },
    );
    assert.equal(
      validateExpedienteDocumentoUploadFile(comprobanteJpg, "cliente_comprobante_domicilio")
        .ok,
      false,
    );
  });

  it("obligatorios siguen siendo 4 y envío no cambia gate", () => {
    assert.equal(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.length, 4);
    const resumen = INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.map((tipo) => ({
      tipo_documento: tipo,
      estatus_revision: "subido" as const,
    }));
    assert.equal(integrationDocsCompletos(resumen), true);
  });

  it("datos generales: puedeIntegrar o reingreso activo", () => {
    assert.equal(asesorPuedeEditarClienteDatos(false, "completo"), true);
    assert.equal(asesorPuedeEditarClienteDatos(true, "completo"), true);
    assert.equal(
      asesorPuedeEditarClienteDatos(true, "validado", {
        puedeIntegrar: false,
        esReingresoActivo: false,
      }),
      false,
    );
    assert.equal(
      asesorPuedeEditarClienteDatos(true, "validado", {
        puedeIntegrar: false,
        esReingresoActivo: true,
      }),
      true,
    );
    assert.equal(asesorDebeUsarCorreccionClienteDatos(true, true), true);
    assert.equal(asesorDebeUsarCorreccionClienteDatos(true, false), false);
    assert.equal(asesorDebeUsarCorreccionClienteDatos(false, true), false);
    assert.equal(asesorEsCorreccionRechazoClienteDatos(true, "rechazado"), true);
    assert.equal(asesorEsCorreccionRechazoClienteDatos(true, "completo"), false);
  });
});
