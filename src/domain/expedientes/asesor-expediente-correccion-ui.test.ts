import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAsesorInboxEstadoEfectivoPresentation } from "./asesor-inbox-estado-efectivo";
import {
  asesorExpedienteDetalleHref,
  buildAsesorExpedienteCorreccionView,
  inboxDetalleNotificacionConsistentes,
  notificationKindMatchesEstadoEfectivo,
} from "./asesor-expediente-correccion-ui";

describe("P197-B3 detalle corrección (F1–F12)", () => {
  it("F1 DG solicitada: Necesita, CTA DG, sin enviada ni rechazo principal", () => {
    const v = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "correccion_requerida",
      clienteDatosEstado: "rechazado",
      clienteDatosComentario: "Falta RFC",
      rechazoOperativoMotivo: "Docs",
    });
    assert.equal(v.label, "Necesita corrección");
    assert.equal(v.showNecesitaPanel, true);
    assert.equal(v.showEnviadaPanel, false);
    assert.equal(v.showRechazoOperativoBanner, false);
    assert.equal(v.actions[0]?.kind, "dg");
    assert.equal(v.actions[0]?.detail, "Falta RFC");
    assert.equal(v.actions[0]?.ctaLabel, "Corregir datos");
  });

  it("F2 DG reenviada: Enviada aunque subestado/resultado sean rechazo", () => {
    const v = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "correccion_enviada",
      clienteDatosEstado: "rechazado",
      rechazoOperativoMotivo: "Docs",
    });
    assert.equal(v.showEnviadaPanel, true);
    assert.equal(v.showNecesitaPanel, false);
    assert.equal(v.showRechazoOperativoBanner, false);
    assert.equal(v.actions.length, 0);
    assert.equal(
      getAsesorInboxEstadoEfectivoPresentation(v.estadoEfectivo).label,
      "Corrección enviada",
    );
  });

  it("F3 revisada: en_tramite cierra episodio", () => {
    const v = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "en_tramite",
      clienteDatosEstado: "validado",
    });
    assert.equal(v.showNecesitaPanel, false);
    assert.equal(v.showEnviadaPanel, false);
    assert.equal(v.showRechazoOperativoBanner, false);
    assert.equal(v.label, "En trámite");
  });

  it("F4 documento solicitado: foco docs", () => {
    const v = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "correccion_requerida",
      documentosRechazados: [
        { tipo: "cliente_ine_frente", label: "INE frente", comentario: "Ilegible" },
      ],
    });
    assert.equal(v.actions[0]?.kind, "documento");
    assert.equal(v.actions[0]?.focusId, "asesor-seccion-docs");
    assert.equal(v.actions[0]?.detail, "Ilegible");
  });

  it("F5 documento enviado: no acciones de reemplazo", () => {
    const v = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "correccion_enviada",
      documentosRechazados: [{ tipo: "cliente_ine_frente", label: "INE frente" }],
    });
    assert.equal(v.showEnviadaPanel, true);
    assert.equal(v.actions.length, 0);
  });

  it("F6 ADVISOR_UPDATE: en_tramite no pinta Necesita ni Enviada", () => {
    const v = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "en_tramite",
    });
    assert.equal(v.showNecesitaPanel, false);
    assert.equal(v.showEnviadaPanel, false);
  });

  it("F7 rechazo vigente", () => {
    const v = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "rechazado_mesa",
      rechazoOperativoMotivo: "Biométricos incompletos",
    });
    assert.equal(v.showRechazoOperativoBanner, true);
    assert.equal(v.showNecesitaPanel, false);
    assert.equal(v.label, "Rechazado por mesa");
  });

  it("F8 cancelado domina", () => {
    const v = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "cancelado",
      clienteDatosEstado: "rechazado",
    });
    assert.equal(v.showCanceladoDominante, true);
    assert.equal(v.showNecesitaPanel, false);
    assert.equal(v.showEnviadaPanel, false);
    assert.equal(v.showRechazoOperativoBanner, false);
  });

  it("F9 deep link solo en necesita; sin param el path base funciona", () => {
    assert.equal(
      asesorExpedienteDetalleHref("e1", "correccion_requerida"),
      "/asesor/expediente/e1?focus=correccion",
    );
    assert.equal(
      asesorExpedienteDetalleHref("e1", "correccion_enviada"),
      "/asesor/expediente/e1",
    );
    assert.equal(asesorExpedienteDetalleHref("e1"), "/asesor/expediente/e1");
  });

  it("F10 submit: el view cambia solo si el backend cambia estado_efectivo", () => {
    const before = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "correccion_requerida",
      clienteDatosEstado: "rechazado",
    });
    const after = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "correccion_enviada",
      clienteDatosEstado: "rechazado",
    });
    assert.equal(before.showNecesitaPanel, true);
    assert.equal(after.showEnviadaPanel, true);
    assert.notEqual(before.estadoEfectivo, after.estadoEfectivo);
  });

  it("F11 mark Mesa: enviada → trámite oculta espera", () => {
    const after = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "en_tramite",
    });
    assert.equal(after.showEnviadaPanel, false);
    assert.equal(after.showNecesitaPanel, false);
  });

  it("F12 retención: ciclo propio vía categoria/docs retencion_*", () => {
    const sol = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "correccion_requerida",
      retencionCorreccionRequerida: true,
    });
    assert.equal(sol.actions[0]?.kind, "retencion");
    const docRet = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "correccion_requerida",
      documentosRechazados: [
        { tipo: "retencion_acuse_con_sello", label: "Acuse", comentario: "Sello ilegible" },
      ],
      retencionCorreccionRequerida: true,
    });
    assert.equal(docRet.actions.length, 1);
    assert.equal(docRet.actions[0]?.kind, "retencion");
    const enviada = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "correccion_enviada",
      retencionCorreccionRequerida: true,
    });
    assert.equal(enviada.actions.length, 0);
    assert.equal(enviada.showEnviadaPanel, true);
    const cerrada = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "en_tramite",
      retencionCorreccionRequerida: true,
    });
    assert.equal(cerrada.actions.length, 0);
  });

  it("inbox = detalle = notificación para fixtures", () => {
    assert.equal(
      inboxDetalleNotificacionConsistentes({
        inboxEstado: "correccion_enviada",
        detalleEstado: "correccion_enviada",
        notificationKind: "correccion_enviada",
      }),
      true,
    );
    assert.equal(
      inboxDetalleNotificacionConsistentes({
        inboxEstado: "correccion_enviada",
        detalleEstado: "rechazado_mesa",
        notificationKind: "rechazado_mesa",
      }),
      false,
    );
    assert.equal(
      notificationKindMatchesEstadoEfectivo("correccion_enviada", "correccion_requerida"),
      false,
    );
    assert.equal(
      notificationKindMatchesEstadoEfectivo("correccion_enviada", "rechazado_mesa"),
      false,
    );
  });

  it("detalle consume estado_efectivo; no recalcula P196 en page", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx"),
      "utf8",
    );
    assert.match(src, /getAsesorInboxEstadoEfectivo/);
    assert.match(src, /buildAsesorExpedienteCorreccionView/);
    assert.match(src, /AsesorExpedienteEstadoActualBanner/);
    assert.match(src, /mostrarRechazoOperativoBanner/);
    assert.doesNotMatch(src, /REQUESTED_CORRECTION/);
    assert.doesNotMatch(src, /setEstadoEfectivo\(["']correccion_enviada["']\)/);
    assert.match(src, /await loadExpediente\(\)/);
  });

  it("F9 inbox usa href con focus solo en necesita", () => {
    const src = readFileSync(resolve(process.cwd(), "src/app/asesor/page.tsx"), "utf8");
    assert.match(src, /asesorExpedienteDetalleHref/);
  });
});
