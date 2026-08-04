import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENTE_NOTIFICACION_APODACA_DOCUMENT_CONTRACT,
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

  it("catálogo: opcional, label Notificación, cualquier etapa", () => {
    const item = DOCUMENTO_CATALOGO_MAP.cliente_notificacion_apodaca;
    assert.equal(item.obligatorio, "opcional");
    assert.equal(item.ownerRole, "cliente");
    assert.equal(item.label, "Notificación");
    assert.doesNotMatch(item.label, /Apodaca/i);
    assert.deepEqual(item.etapasRequeridas, []);
    assert.equal(CLIENTE_NOTIFICACION_APODACA_DOCUMENT_CONTRACT.label, "Notificación");
    assert.equal(CLIENTE_NOTIFICACION_APODACA_DOCUMENT_CONTRACT.etapaMinima, 0);
    assert.equal(CLIENTE_NOTIFICACION_APODACA_DOCUMENT_CONTRACT.esGateAvance, false);
    assert.equal(CLIENTE_NOTIFICACION_APODACA_DOCUMENT_CONTRACT.origen, "Asesor|Mesa");
  });

  it("allowlist asesor opcionales / upload; Mesa register P136; no complementarios UI", () => {
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
      !(INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES_SOLO_ASESOR as readonly string[]).includes(
        "cliente_notificacion_apodaca",
      ),
      "Apodaca tiene sección Mesa dedicada (P136)",
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[]).includes(
        "cliente_notificacion_apodaca",
      ),
    );
    assert.ok(
      (INTEGRATION_DOC_TIPOS_MESA_REGISTER as readonly string[]).includes(
        "cliente_notificacion_apodaca",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes(
        "cliente_notificacion_apodaca",
      ),
    );
    assert.equal(INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES.length, 7);
    assert.equal(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD.length, 11);
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
    assert.equal(item!.label, "Notificación");
    assert.doesNotMatch(item!.label, /Apodaca/i);

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
    assert.equal(view, undefined, "P136: Apodaca sale de lista RO genérica; sección Mesa dedicada");
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

  it("MIME/tamaño: PDF/JPEG/PNG ≤15 MiB; rechaza WEBP", () => {
    assert.equal(EXPEDIENTE_DOCUMENTO_MAX_BYTES, 15 * 1024 * 1024);
    assert.equal(
      getExpedienteDocumentoAcceptAttr("cliente_notificacion_apodaca"),
      ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png",
    );
    const pdf = new File([new Uint8Array([1])], "apodaca.pdf", {
      type: "application/pdf",
    });
    assert.equal(validateExpedienteDocumentoUploadFile(pdf, "cliente_notificacion_apodaca").ok, true);
    assert.equal(resolveExpedienteDocumentoUploadMime(pdf, "cliente_notificacion_apodaca"), "application/pdf");

    const jpg = new File([new Uint8Array([1])], "apodaca.jpg", { type: "image/jpeg" });
    assert.equal(validateExpedienteDocumentoUploadFile(jpg, "cliente_notificacion_apodaca").ok, true);
    assert.equal(resolveExpedienteDocumentoUploadMime(jpg, "cliente_notificacion_apodaca"), "image/jpeg");

    const jpeg = new File([new Uint8Array([1])], "apodaca.jpeg", { type: "image/jpeg" });
    assert.equal(validateExpedienteDocumentoUploadFile(jpeg, "cliente_notificacion_apodaca").ok, true);

    const png = new File([new Uint8Array([1])], "apodaca.png", { type: "image/png" });
    assert.equal(validateExpedienteDocumentoUploadFile(png, "cliente_notificacion_apodaca").ok, true);
    assert.equal(resolveExpedienteDocumentoUploadMime(png, "cliente_notificacion_apodaca"), "image/png");

    const webp = new File([new Uint8Array([1])], "apodaca.webp", { type: "image/webp" });
    assert.equal(validateExpedienteDocumentoUploadFile(webp, "cliente_notificacion_apodaca").ok, false);

    const gif = new File([new Uint8Array([1])], "apodaca.gif", { type: "image/gif" });
    assert.equal(validateExpedienteDocumentoUploadFile(gif, "cliente_notificacion_apodaca").ok, false);
  });
});
