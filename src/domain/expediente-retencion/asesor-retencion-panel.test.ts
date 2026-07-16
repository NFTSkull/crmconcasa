import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asesorRetencionBloqueEstadoLabel,
  canShowAsesorRetencionSupabasePanel,
  deriveAsesorRetencionPanelView,
  retencionDocEstatusLabelAsesor,
  retencionOpcionDraftStorageKey,
} from "./asesor-retencion-panel";
import type { ExpedienteRetencionEnvioMesa } from "./types";

const envioEnviado: ExpedienteRetencionEnvioMesa = {
  expedienteId: "exp-1",
  enviado: true,
  fechaEnvioMesa: "2026-06-25T12:00:00.000Z",
  opcion: "con_sello",
  estado: "enviado",
};

describe("canShowAsesorRetencionSupabasePanel", () => {
  it("visible solo supabase + etapa 8 + enviado a Mesa", () => {
    assert.equal(
      canShowAsesorRetencionSupabasePanel({
        dataModeSupabase: true,
        etapaActual: 8,
        submittedToMesa: true,
      }),
      true,
    );
    assert.equal(
      canShowAsesorRetencionSupabasePanel({
        dataModeSupabase: false,
        etapaActual: 8,
        submittedToMesa: true,
      }),
      false,
    );
    assert.equal(
      canShowAsesorRetencionSupabasePanel({
        dataModeSupabase: true,
        etapaActual: 7,
        submittedToMesa: true,
      }),
      false,
    );
    assert.equal(
      canShowAsesorRetencionSupabasePanel({
        dataModeSupabase: true,
        etapaActual: 8,
        submittedToMesa: false,
      }),
      false,
    );
  });
});

describe("deriveAsesorRetencionPanelView", () => {
  it("sin opción: botón visible deshabilitado y lista vacía de uploads", () => {
    const view = deriveAsesorRetencionPanelView({
      opcionDraft: null,
      opcionPersistida: null,
      envio: null,
      archivos: [],
    });
    assert.equal(view.opcionPanel, null);
    assert.equal(view.mostrarBotonEnviar, true);
    assert.equal(view.puedeEnviarAMesa, false);
    assert.equal(view.motivoDeshabilitar?.kind, "opcion");
    assert.equal(view.botonEnviarLabel, "Enviar a Mesa Control");
    assert.equal(view.uploads.length, 0);
    assert.equal(view.uiEstado, "no_enviado");
  });

  it("sin draft ni DB: restaura opción A desde acuse persistido tras reload", () => {
    const view = deriveAsesorRetencionPanelView({
      opcionDraft: null,
      opcionPersistida: null,
      envio: null,
      archivos: [
        {
          tipo_documento: "retencion_acuse_con_sello",
          id: "1",
          estatus_revision: "subido",
        },
        {
          tipo_documento: "retencion_aviso_retencion",
          id: "2",
          estatus_revision: "subido",
        },
      ],
    });
    assert.equal(view.opcionPanel, "con_sello");
    assert.equal(view.opcionAmbigua, false);
    assert.equal(view.uploads.length, 1);
    assert.ok(
      view.uploads.some((u) => u.tipo === "retencion_acuse_con_sello"),
    );
    assert.equal(view.uiEstado, "no_enviado");
    assert.equal(view.mostrarBotonEnviar, true);
    assert.equal(view.puedeEnviarAMesa, true);
    assert.equal(view.motivoDeshabilitar, null);
  });

  it("inferencia desde docs activos prevalece sobre sessionStorage del expediente", () => {
    const view = deriveAsesorRetencionPanelView({
      opcionDraft: null,
      opcionSessionDraft: "sin_sello",
      opcionPersistida: null,
      envio: null,
      archivos: [
        {
          tipo_documento: "retencion_acuse_con_sello",
          id: "1",
          estatus_revision: "subido",
        },
      ],
    });
    assert.equal(view.opcionPanel, "con_sello");
  });

  it("sessionStorage solo aplica cuando no hay DB ni inferencia", () => {
    const view = deriveAsesorRetencionPanelView({
      opcionDraft: null,
      opcionSessionDraft: "sin_sello",
      opcionPersistida: null,
      envio: null,
      archivos: [],
    });
    assert.equal(view.opcionPanel, "sin_sello");
  });

  it("ambigüedad A+B sin selección explícita: botón visible y deshabilitado", () => {
    const view = deriveAsesorRetencionPanelView({
      opcionDraft: null,
      opcionSessionDraft: "con_sello",
      opcionPersistida: null,
      envio: null,
      archivos: [
        {
          tipo_documento: "retencion_acuse_con_sello",
          id: "1",
          estatus_revision: "subido",
        },
        {
          tipo_documento: "retencion_carta_sin_sello",
          id: "2",
          estatus_revision: "subido",
        },
      ],
    });
    assert.equal(view.opcionAmbigua, true);
    assert.equal(view.opcionExplicita, false);
    assert.equal(view.opcionPanel, "con_sello");
    assert.equal(view.mostrarBotonEnviar, true);
    assert.equal(view.puedeEnviarAMesa, false);
    assert.equal(view.motivoDeshabilitar?.kind, "ambigua");
  });

  it("ambigüedad A+B con radio explícito y docs A listos: puede enviar", () => {
    const view = deriveAsesorRetencionPanelView({
      opcionDraft: "con_sello",
      opcionSessionDraft: null,
      opcionPersistida: null,
      envio: null,
      archivos: [
        { tipo_documento: "retencion_acuse_con_sello", id: "1", estatus_revision: "subido" },
        { tipo_documento: "retencion_carta_sin_sello", id: "2", estatus_revision: "subido" },
      ],
    });
    assert.equal(view.opcionAmbigua, true);
    assert.equal(view.opcionExplicita, true);
    assert.equal(view.puedeEnviarAMesa, true);
    assert.equal(view.motivoDeshabilitar, null);
  });

  it("opción A con docs completos: puede enviar", () => {
    const view = deriveAsesorRetencionPanelView({
      opcionDraft: "con_sello",
      opcionPersistida: null,
      envio: null,
      archivos: [
        { tipo_documento: "retencion_acuse_con_sello", id: "1", estatus_revision: "subido" },
      ],
    });
    assert.equal(view.puedeEnviarAMesa, true);
    assert.equal(view.mostrarBotonEnviar, true);
    assert.equal(view.botonEnviarLabel, "Enviar a Mesa Control");
    assert.equal(view.uploads.length, 1);
  });

  it("rechazado no cuenta como listo para envío", () => {
    const view = deriveAsesorRetencionPanelView({
      opcionDraft: "con_sello",
      opcionPersistida: null,
      envio: null,
      archivos: [
        { tipo_documento: "retencion_acuse_con_sello", id: "1", estatus_revision: "rechazado" },
      ],
    });
    assert.equal(view.puedeEnviarAMesa, false);
    assert.equal(view.mostrarBotonEnviar, true);
    assert.equal(view.motivoDeshabilitar?.kind, "documentos");
  });

  it("enviado oculta botón de envío", () => {
    const view = deriveAsesorRetencionPanelView({
      opcionDraft: "sin_sello",
      opcionPersistida: null,
      envio: envioEnviado,
      archivos: [
        { tipo_documento: "retencion_acuse_con_sello", id: "1", estatus_revision: "subido" },
      ],
    });
    assert.equal(view.opcionEditable, false);
    assert.equal(view.opcionPanel, "con_sello");
    assert.equal(view.puedeEnviarAMesa, false);
    assert.equal(view.mostrarBotonEnviar, false);
    assert.equal(view.uiEstado, "enviado");
  });

  it("corrección requerida permite reenviar con docs listos", () => {
    const view = deriveAsesorRetencionPanelView({
      opcionDraft: "con_sello",
      opcionPersistida: {
        expedienteId: "exp-1",
        retencion_opcion: "con_sello",
        updatedAt: "",
      },
      envio: { ...envioEnviado, estado: "correccion_requerida" },
      archivos: [
        { tipo_documento: "retencion_acuse_con_sello", id: "1", estatus_revision: "resubido" },
      ],
    });
    assert.equal(view.uiEstado, "correccion_requerida");
    assert.equal(view.puedeEnviarAMesa, true);
    assert.equal(view.mostrarBotonEnviar, true);
    assert.equal(view.botonEnviarLabel, "Reenviar a Mesa Control");
    assert.equal(view.opcionEditable, true);
  });
});

describe("copy asesor retención", () => {
  it("clave sessionStorage incluye expedienteId", () => {
    assert.equal(
      retencionOpcionDraftStorageKey("exp-42"),
      "retencion-opcion:exp-42",
    );
  });

  it("estatus documento evita afirmar validación Mesa salvo validado", () => {
    assert.match(retencionDocEstatusLabelAsesor("subido"), /Mesa revisará/i);
    assert.match(retencionDocEstatusLabelAsesor("validado"), /Aceptado por Mesa/i);
  });

  it("bloque estado operativo", () => {
    assert.match(asesorRetencionBloqueEstadoLabel("no_enviado"), /Pendiente de envío/i);
    assert.match(asesorRetencionBloqueEstadoLabel("enviado"), /pendiente de revisión/i);
    assert.match(asesorRetencionBloqueEstadoLabel("correccion_requerida"), /Corrección/i);
  });
});
