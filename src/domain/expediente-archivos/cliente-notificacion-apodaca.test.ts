import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO,
  CLIENTE_NOTIFICACION_DOCUMENT_TIPO,
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES,
  INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES_SOLO_ASESOR,
  INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD,
  INTEGRATION_DOC_TIPOS_MESA_REGISTER,
  INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
  asesorPuedeSubirOCorregirDocumento,
  buildMesaIntegrationDocViews,
  countIntegrationDocsPresentes,
  deriveIntegrationDocsChecklistOpcionales,
  integrationDocsCompletos,
} from "./index";
import { DOCUMENTO_CATALOGO_MAP } from "./types";
import { EXPEDIENTE_DOCUMENTO_MAX_BYTES } from "./upload-constraints";
import {
  getExpedienteDocumentoAcceptAttr,
  resolveExpedienteDocumentoUploadMime,
  validateExpedienteDocumentoUploadFile,
} from "@/lib/fileUploadValidation";

describe("P104 cliente_notificacion_apodaca", () => {
  it("tipo técnico distinto de cliente_notificacion y de agenda notificacion", () => {
    assert.equal(CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO, "cliente_notificacion_apodaca");
    assert.notEqual(
      CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO,
      CLIENTE_NOTIFICACION_DOCUMENT_TIPO,
    );
    assert.notEqual(CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO, "notificacion");
  });

  it("catálogo: opcional, label canónico, sin etapa mínima", () => {
    const item = DOCUMENTO_CATALOGO_MAP.cliente_notificacion_apodaca;
    assert.equal(item.obligatorio, "opcional");
    assert.equal(item.ownerRole, "cliente");
    assert.equal(item.label, "Notificación solo Apodaca (opcional)");
    assert.deepEqual(item.etapasRequeridas, []);
  });

  it("allowlist asesor opcionales / upload; no mesa upload ni register", () => {
    assert.ok(
      (INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES as readonly string[]).includes(
        "cliente_notificacion_apodaca",
      ),
    );
    assert.ok(
      (INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes(
        "cliente_notificacion_apodaca",
      ),
    );
    assert.ok(
      (INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES_SOLO_ASESOR as readonly string[]).includes(
        "cliente_notificacion_apodaca",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes(
        "cliente_notificacion_apodaca",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_MESA_REGISTER as readonly string[]).includes(
        "cliente_notificacion_apodaca",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes(
        "cliente_notificacion_apodaca",
      ),
    );
    assert.equal(INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES.length, 4);
    assert.equal(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD.length, 8);
  });

  it("no bloquea gate enviar_a_mesa", () => {
    const resumen = [
      ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.map((tipo) => ({
        tipo_documento: tipo,
        estatus_revision: "subido" as const,
      })),
      {
        tipo_documento: "cliente_notificacion_apodaca" as const,
        estatus_revision: "subido" as const,
      },
    ];
    assert.equal(countIntegrationDocsPresentes(resumen), 4);
    assert.equal(integrationDocsCompletos(resumen), true);
  });

  it("checklist opcionales incluye el label y Mesa lo refleja", () => {
    const checklist = deriveIntegrationDocsChecklistOpcionales([]);
    const item = checklist.find(
      (c) => c.tipo_documento === "cliente_notificacion_apodaca",
    );
    assert.ok(item);
    assert.equal(item!.opcional, true);
    assert.equal(item!.label, "Notificación solo Apodaca (opcional)");

    const views = buildMesaIntegrationDocViews(
      [
        {
          expediente_id: "e1",
          tipo_documento: "cliente_notificacion_apodaca",
          id: "doc-apodaca",
          nombre_original: "apodaca.pdf",
          mime_type: "application/pdf",
          size_bytes: 100,
          created_at: "2026-07-22T00:00:00.000Z",
          uploaded_by_role: "asesor",
          uploaded_by_email: "a@x.com",
          estatus_revision: "subido",
          comentario_mesa: null,
        },
      ],
      [],
    );
    const view = views.find((v) => v.tipo_documento === "cliente_notificacion_apodaca");
    assert.ok(view);
    assert.equal(view!.archivo?.id, "doc-apodaca");
    assert.equal(view!.opcional, true);
  });

  it("asesor puede subir pre y post Mesa (faltante / reemplazo)", () => {
    assert.equal(
      asesorPuedeSubirOCorregirDocumento(false, "faltante", "cliente_notificacion_apodaca"),
      true,
    );
    assert.equal(
      asesorPuedeSubirOCorregirDocumento(true, "faltante", "cliente_notificacion_apodaca"),
      true,
    );
    assert.equal(
      asesorPuedeSubirOCorregirDocumento(true, "subido", "cliente_notificacion_apodaca"),
      true,
    );
  });

  it("MIME/tamaño heredados (PDF + 15 MiB); no inventa formatos", () => {
    assert.equal(EXPEDIENTE_DOCUMENTO_MAX_BYTES, 15 * 1024 * 1024);
    assert.equal(
      getExpedienteDocumentoAcceptAttr("cliente_notificacion_apodaca"),
      "application/pdf,.pdf",
    );
    const pdf = new File([new Uint8Array([1])], "apodaca.pdf", {
      type: "application/pdf",
    });
    assert.equal(validateExpedienteDocumentoUploadFile(pdf, "cliente_notificacion_apodaca").ok, true);
    assert.equal(resolveExpedienteDocumentoUploadMime(pdf, "cliente_notificacion_apodaca"), "application/pdf");

    const jpg = new File([new Uint8Array([1])], "apodaca.jpg", { type: "image/jpeg" });
    assert.equal(validateExpedienteDocumentoUploadFile(jpg, "cliente_notificacion_apodaca").ok, false);
  });
});
