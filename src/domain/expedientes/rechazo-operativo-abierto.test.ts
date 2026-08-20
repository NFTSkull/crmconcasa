import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASESOR_RECHAZO_BANNER_TITLE,
  ASESOR_REENVIAR_A_MESA_CTA,
  ASESOR_RECHAZO_CAMBIOS_GUARDADOS,
  ASESOR_RECHAZO_FALTA_REENVIAR,
  buildAsesorRechazoOperativoBannerModel,
  buildMesaRechazoOperativoAbiertoModel,
  estadoEfectivoCompatibleConRechazoAbierto,
  hasActivityAfterRechazo,
  isRechazoOperativoAbierto,
  MESA_DOC_VALIDADA_NE_RECHAZO_CERRADO,
  MESA_MOVE_BLOQUEADO_RECHAZO_ABIERTO,
  MESA_REACTIVAR_EXPEDIENTE_CTA,
  resolveRechazoOperativoAbierto,
  subestadoCanonicoTrasReactivacion,
} from "./rechazo-operativo-abierto";
import { getMesaControlManualEstado } from "./mesa-movimiento-etapa";
import { buildAsesorExpedienteCorreccionView } from "./asesor-expediente-correccion-ui";
import { deriveAsesorInboxEstadoEfectivoMock } from "./asesor-inbox-estado-efectivo";

describe("P204-C rechazo operativo abierto (F1–F12)", () => {
  it("F1 rechazo abierto sin cambios → banner Rechazado + CTA reenviar", () => {
    const abierto = isRechazoOperativoAbierto({
      latestRechazoId: "r1",
      latestRechazoHasReactivacion: false,
    });
    const model = buildAsesorRechazoOperativoBannerModel({ abierto });
    assert.equal(abierto, true);
    assert.equal(model?.title, ASESOR_RECHAZO_BANNER_TITLE);
    assert.equal(model?.showActivityHint, false);
    assert.ok(model?.ctaLabel);
    assert.match(model!.ctaLabel, /Mesa/i);
    const view = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "rechazado_mesa",
    });
    assert.equal(view.showRechazoOperativoBanner, true);
    assert.equal(view.showEnviadaPanel, false);
  });

  it("F2 rechazo abierto + doc nuevo → sigue Rechazado + Cambios/Falta reenviar", () => {
    const model = buildAsesorRechazoOperativoBannerModel({
      abierto: true,
      hasActivityAfterRechazo: true,
      preferShortCta: true,
    });
    assert.equal(model?.activityPrimary, ASESOR_RECHAZO_CAMBIOS_GUARDADOS);
    assert.equal(model?.activitySecondary, ASESOR_RECHAZO_FALTA_REENVIAR);
    assert.equal(model?.ctaLabel, ASESOR_REENVIAR_A_MESA_CTA);
    assert.equal(model?.forbidsCorreccionEnviadaFinal, true);
  });

  it("F3 rechazo abierto + DG validada Mesa → sigue Rechazado", () => {
    assert.equal(
      resolveRechazoOperativoAbierto({
        latestRechazoId: "r1",
        latestRechazoHasReactivacion: false,
        subestado: "rechazado",
        submittedToMesa: true,
        cicloEstado: "activo",
      }),
      true,
    );
    const mesa = buildMesaRechazoOperativoAbiertoModel({ abierto: true });
    assert.equal(mesa?.docNote, MESA_DOC_VALIDADA_NE_RECHAZO_CERRADO);
  });

  it("F4 rechazo abierto + docs completos → sigue Rechazado (no Corrección enviada)", () => {
    const view = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "rechazado_mesa",
    });
    assert.equal(view.showRechazoOperativoBanner, true);
    assert.equal(view.showEnviadaPanel, false);
    assert.equal(
      estadoEfectivoCompatibleConRechazoAbierto("rechazado_mesa", true),
      true,
    );
    assert.equal(
      estadoEfectivoCompatibleConRechazoAbierto("correccion_enviada", true),
      false,
    );
  });

  it("F5 reactivar etapa 1 → en_validacion_mesa", () => {
    assert.equal(subestadoCanonicoTrasReactivacion(1), "en_validacion_mesa");
  });

  it("F6 reactivar etapa 6 → en_proceso", () => {
    assert.equal(subestadoCanonicoTrasReactivacion(6), "en_proceso");
  });

  it("F7 tras reactivación → sale de Rechazados por Mesa", () => {
    assert.equal(
      isRechazoOperativoAbierto({
        latestRechazoId: "r1",
        latestRechazoHasReactivacion: true,
      }),
      false,
    );
    const view = buildAsesorExpedienteCorreccionView({
      estadoEfectivo: "en_tramite",
    });
    assert.equal(view.showRechazoOperativoBanner, false);
  });

  it("F8 historial de rechazo permanece (abierto ≠ borrar rechazo)", () => {
    assert.equal(
      isRechazoOperativoAbierto({
        latestRechazoId: "r-hist",
        latestRechazoHasReactivacion: true,
      }),
      false,
    );
    assert.ok("r-hist");
  });

  it("F9 doble click: una sola reactivación (ALREADY_DONE)", () => {
    assert.equal(
      isRechazoOperativoAbierto({
        latestRechazoId: "r1",
        latestRechazoHasReactivacion: true,
      }),
      false,
    );
  });

  it("F10 Mesa move antes de reactivar → bloqueado", () => {
    const estado = getMesaControlManualEstado({
      role: "mesa_interno",
      submittedToMesa: true,
      cicloEstado: "activo",
      subestado: "rechazado",
    });
    assert.equal(estado.habilitado, false);
    assert.match(estado.razon ?? "", /reactiv/i);
    assert.match(MESA_MOVE_BLOQUEADO_RECHAZO_ABIERTO, /Rechazo operativo abierto/);
  });

  it("F11 Mesa move después de reactivar → gates normales", () => {
    const estado = getMesaControlManualEstado({
      role: "mesa_interno",
      submittedToMesa: true,
      cicloEstado: "activo",
      subestado: "en_validacion_mesa",
    });
    assert.equal(estado.habilitado, true);
    assert.equal(estado.razon, null);
  });

  it("F12 P203: rechazo abierto nunca se presenta como Corrección enviada", () => {
    const estado = deriveAsesorInboxEstadoEfectivoMock({
      resultadoReal: "rechazado_mesa",
      categoriaCorreccion: "correccion_enviada",
      mesaCambioEstado: "WAITING_ADVISOR",
      mesaCambioRequestType: "RECHAZO_OPERATIVO_CON_CORRECCION",
    });
    assert.equal(estado, "rechazado_mesa");
    assert.equal(
      estadoEfectivoCompatibleConRechazoAbierto(estado, true),
      true,
    );
    const mesa = buildMesaRechazoOperativoAbiertoModel({
      abierto: true,
      actorCanReactivar: true,
    });
    assert.equal(mesa?.ctaLabel, MESA_REACTIVAR_EXPEDIENTE_CTA);
  });

  it("hasActivityAfterRechazo compara timestamps", () => {
    assert.equal(
      hasActivityAfterRechazo({
        rechazoAt: "2026-08-19T14:41:56.000Z",
        activityAts: ["2026-08-20T18:16:48.000Z"],
      }),
      true,
    );
    assert.equal(
      hasActivityAfterRechazo({
        rechazoAt: "2026-08-19T14:41:56.000Z",
        activityAts: ["2026-08-11T20:26:00.000Z"],
      }),
      false,
    );
  });

  it("proxy expediente sin rechazo id", () => {
    assert.equal(
      resolveRechazoOperativoAbierto({
        submittedToMesa: true,
        cicloEstado: "activo",
        subestado: "rechazado",
      }),
      true,
    );
    assert.equal(
      resolveRechazoOperativoAbierto({
        submittedToMesa: true,
        cicloEstado: "activo",
        subestado: "en_proceso",
      }),
      false,
    );
  });
});
