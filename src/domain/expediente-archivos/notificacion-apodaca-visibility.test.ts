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

function archivoNotificacion(
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
  it("Monterrey + etapa 8: muestra Notificación y permite subir", () => {
    assert.equal(NOTIFICACION_APODACA_UPLOAD_ETAPA, 8);
    assert.equal(
      shouldShowNotificacionApodacaUpload({
        etapaActual: 8,
        locationId: "monterrey",
      }),
      true,
    );
    assert.equal(
      shouldShowNotificacionApodacaUpload({
        etapaActual: 8,
        locationId: "mty-centro",
      }),
      true,
    );
  });

  it("Apodaca + etapa 8: muestra Notificación y permite subir", () => {
    assert.equal(
      shouldShowNotificacionApodacaUpload({
        etapaActual: 8,
        locationId: "apodaca",
      }),
      true,
    );
  });

  it("cualquier sede válida + etapa 8: permite subir", () => {
    for (const locationId of ["monterrey", "apodaca", "san-nicolas", "otra-sede", null, ""]) {
      assert.equal(
        shouldShowNotificacionApodacaUpload({ etapaActual: 8, locationId }),
        true,
        `locationId=${String(locationId)}`,
      );
    }
  });

  it("etapa distinta de 8: no muestra carga editable", () => {
    for (const etapa of [1, 7, 9, 10]) {
      for (const locationId of ["apodaca", "monterrey"]) {
        assert.equal(
          shouldShowNotificacionApodacaUpload({ etapaActual: etapa, locationId }),
          false,
          `etapa ${etapa} sede ${locationId}`,
        );
      }
    }
    assert.equal(
      shouldShowNotificacionApodacaHistorico({
        hasArchivoActivo: true,
        canUpload: false,
      }),
      true,
    );
  });

  it("filtra checklist: etapa 8 cualquier sede; histórico RO en etapa posterior", () => {
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
      mty8.some((c) => c.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO),
    );

    const apo8 = filterChecklistOpcionalesNotificacionApodaca(base, {
      etapaActual: 8,
      locationId: "apodaca",
      hasArchivoActivo: false,
    });
    assert.ok(
      apo8.some((c) => c.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO),
    );

    const etapa7 = filterChecklistOpcionalesNotificacionApodaca(base, {
      etapaActual: 7,
      locationId: "monterrey",
      hasArchivoActivo: false,
    });
    assert.ok(
      !etapa7.some((c) => c.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO),
    );

    const hist = filterChecklistOpcionalesNotificacionApodaca(base, {
      etapaActual: 9,
      locationId: "monterrey",
      hasArchivoActivo: true,
    });
    assert.ok(
      hist.some((c) => c.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO),
    );
    assert.equal(
      shouldShowNotificacionApodacaUpload({
        etapaActual: 9,
        locationId: "monterrey",
      }),
      false,
    );
  });

  it("UI muestra Notificación; sin Apodaca en el nombre; upload no depende de sede", () => {
    assert.equal(RETENCION_DOC_LABEL.retencion_acuse_con_sello, "Acuse");
    assert.equal(
      DOCUMENTO_CATALOGO_MAP.cliente_notificacion_apodaca.label,
      "Notificación",
    );
    assert.doesNotMatch(
      DOCUMENTO_CATALOGO_MAP.cliente_notificacion_apodaca.label,
      /Apodaca/i,
    );
    assert.doesNotMatch(
      DOCUMENTO_CATALOGO_MAP.cliente_notificacion_apodaca.label,
      /Notificación Apodaca|Notificación solo Apodaca/i,
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
      true,
    );
    assert.ok(hasNotificacionApodacaArchivoActivo([archivoNotificacion()]));
    assert.equal(hasNotificacionApodacaArchivoActivo([]), false);
  });

  it("resolveExpedienteSedeFromLocationId sigue resolviendo sede (sin gate de upload)", () => {
    assert.equal(resolveExpedienteSedeFromLocationId("apodaca"), "apodaca");
    assert.equal(resolveExpedienteSedeFromLocationId("monterrey"), "monterrey");
    assert.equal(resolveExpedienteSedeFromLocationId(""), null);
    assert.equal(resolveExpedienteSedeFromLocationId(null), null);
  });
});
