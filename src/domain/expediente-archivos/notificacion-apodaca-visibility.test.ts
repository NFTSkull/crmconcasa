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

describe("notificacion-apodaca-visibility (compartida Asesor|Mesa)", () => {
  it("cualquier etapa + cualquier sede: permite subir", () => {
    for (const etapa of [1, 4, 7, 8, 9, 10, 11, null]) {
      for (const locationId of ["monterrey", "apodaca", "san-nicolas", null, ""]) {
        assert.equal(
          shouldShowNotificacionApodacaUpload({ etapaActual: etapa, locationId }),
          true,
          `etapa=${String(etapa)} sede=${String(locationId)}`,
        );
      }
    }
    assert.equal(shouldShowNotificacionApodacaUpload(), true);
  });

  it("checklist siempre incluye Notificación (sin filtrar por etapa/sede)", () => {
    const base = deriveIntegrationDocsChecklistOpcionales([]);
    assert.ok(
      base.some((c) => c.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO),
    );

    for (const etapa of [4, 8, 9, 11]) {
      for (const locationId of ["monterrey", "apodaca"]) {
        const filtered = filterChecklistOpcionalesNotificacionApodaca(base, {
          etapaActual: etapa,
          locationId,
          hasArchivoActivo: false,
        });
        assert.ok(
          filtered.some((c) => c.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO),
          `etapa ${etapa} ${locationId}`,
        );
      }
    }

    const hist = filterChecklistOpcionalesNotificacionApodaca(base, {
      etapaActual: 11,
      locationId: "monterrey",
      hasArchivoActivo: true,
    });
    assert.ok(
      hist.some((c) => c.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO),
    );
  });

  it("sigue siendo opcional; label Notificación sin Apodaca; Acuse intacto", () => {
    assert.equal(RETENCION_DOC_LABEL.retencion_acuse_con_sello, "Acuse");
    const item = DOCUMENTO_CATALOGO_MAP.cliente_notificacion_apodaca;
    assert.equal(item.label, "Notificación");
    assert.equal(item.obligatorio, "opcional");
    assert.deepEqual([...item.etapasRequeridas], []);
    assert.doesNotMatch(item.label, /Apodaca/i);
    assert.doesNotMatch(item.label, /Notificación Apodaca|Notificación solo Apodaca/i);
    assert.ok(hasNotificacionApodacaArchivoActivo([archivoNotificacion()]));
    assert.equal(hasNotificacionApodacaArchivoActivo([]), false);
    assert.equal(
      shouldShowNotificacionApodacaHistorico({ hasArchivoActivo: true, canUpload: true }),
      false,
    );
  });

  it("resolveExpedienteSedeFromLocationId no gatea upload", () => {
    assert.equal(resolveExpedienteSedeFromLocationId("apodaca"), "apodaca");
    assert.equal(resolveExpedienteSedeFromLocationId("monterrey"), "monterrey");
    assert.equal(resolveExpedienteSedeFromLocationId(""), null);
  });
});
