import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO,
  deriveIntegrationDocsChecklistOpcionales,
} from "./integration-docs-completos";
import { RETENCION_DOC_LABEL } from "./retencion-acuse-aviso";
import {
  filterChecklistOpcionalesNotificacionApodaca,
  hasNotificacionApodacaArchivoActivo,
  NOTIFICACION_APODACA_UPLOAD_ETAPA,
  resolveExpedienteSedeFromLocationId,
  shouldShowNotificacionApodacaHistorico,
  shouldShowNotificacionApodacaUpload,
} from "./notificacion-apodaca-visibility";
import { DOCUMENTO_CATALOGO_MAP, type ExpedienteArchivoResumen } from "./types";

function archivoApodaca(
  estatus: ExpedienteArchivoResumen["estatus_revision"] = "subido",
): ExpedienteArchivoResumen {
  return {
    expediente_id: "e1",
    tipo_documento: CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO,
    id: "d1",
    nombre_original: "notif.pdf",
    mime_type: "application/pdf",
    size_bytes: 10,
    created_at: "2026-07-31T12:00:00Z",
    uploaded_by_role: "asesor",
    uploaded_by_email: "a@concasa.mx",
    estatus_revision: estatus,
    comentario_mesa: null,
  };
}

describe("notificacion-apodaca-visibility", () => {
  it("Apodaca + etapa 8: upload visible", () => {
    assert.equal(NOTIFICACION_APODACA_UPLOAD_ETAPA, 8);
    assert.equal(
      shouldShowNotificacionApodacaUpload({
        etapaActual: 8,
        locationId: "apodaca",
      }),
      true,
    );
    assert.equal(
      shouldShowNotificacionApodacaUpload({
        etapaActual: 8,
        locationId: "san-nicolas",
      }),
      true,
    );
  });

  it("Apodaca + etapa distinta: no upload editable", () => {
    for (const etapa of [1, 7, 9, 10]) {
      assert.equal(
        shouldShowNotificacionApodacaUpload({
          etapaActual: etapa,
          locationId: "apodaca",
        }),
        false,
        `etapa ${etapa}`,
      );
    }
    assert.equal(
      shouldShowNotificacionApodacaHistorico({
        hasArchivoActivo: true,
        canUpload: false,
      }),
      true,
    );
  });

  it("Monterrey + etapa 8: no aparece", () => {
    assert.equal(
      shouldShowNotificacionApodacaUpload({
        etapaActual: 8,
        locationId: "monterrey",
      }),
      false,
    );
    assert.equal(
      shouldShowNotificacionApodacaUpload({
        etapaActual: 8,
        locationId: "mty-centro",
      }),
      false,
    );
    assert.equal(resolveExpedienteSedeFromLocationId("monterrey"), "monterrey");
  });

  it("filtra checklist: solo Apodaca+8 o histórico con archivo", () => {
    const base = deriveIntegrationDocsChecklistOpcionales([]);
    assert.ok(
      base.some((c) => c.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO),
    );

    const mty8 = filterChecklistOpcionalesNotificacionApodaca(base, {
      etapaActual: 8,
      locationId: "monterrey",
      hasArchivoActivo: false,
    });
    assert.ok(
      !mty8.some((c) => c.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO),
    );

    const apo7 = filterChecklistOpcionalesNotificacionApodaca(base, {
      etapaActual: 7,
      locationId: "apodaca",
      hasArchivoActivo: false,
    });
    assert.ok(
      !apo7.some((c) => c.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO),
    );

    const apo8 = filterChecklistOpcionalesNotificacionApodaca(base, {
      etapaActual: 8,
      locationId: "apodaca",
      hasArchivoActivo: false,
    });
    assert.ok(
      apo8.some((c) => c.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO),
    );

    const hist = filterChecklistOpcionalesNotificacionApodaca(base, {
      etapaActual: 9,
      locationId: "apodaca",
      hasArchivoActivo: true,
    });
    assert.ok(
      hist.some((c) => c.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO),
    );
  });

  it("UI muestra Notificación; sin Apodaca en el nombre del documento; sede Apodaca intacta", () => {
    assert.equal(RETENCION_DOC_LABEL.retencion_acuse_con_sello, "Acuse");
    assert.equal(
      DOCUMENTO_CATALOGO_MAP.cliente_notificacion_apodaca.label,
      "Notificación",
    );
    assert.doesNotMatch(
      DOCUMENTO_CATALOGO_MAP.cliente_notificacion_apodaca.label,
      /Apodaca/i,
    );
    assert.equal(
      shouldShowNotificacionApodacaUpload({
        etapaActual: 8,
        locationId: "apodaca",
      }),
      true,
    );
    assert.equal(
      shouldShowNotificacionApodacaUpload({
        etapaActual: 8,
        locationId: "monterrey",
      }),
      false,
    );
    assert.ok(hasNotificacionApodacaArchivoActivo([archivoApodaca()]));
    assert.equal(hasNotificacionApodacaArchivoActivo([]), false);
  });

  it("usa location_id canónico, no texto visible", () => {
    assert.equal(resolveExpedienteSedeFromLocationId("apodaca"), "apodaca");
    assert.equal(resolveExpedienteSedeFromLocationId(""), null);
    assert.equal(resolveExpedienteSedeFromLocationId(null), null);
  });
});
