import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatReingresoBadgeLabel,
  hasReingresoVisible,
  mapAsesorEnviarReingresoRpcError,
  puedeMostrarReingresoManualCard,
} from "./reingreso-manual";

describe("reingreso-manual helpers", () => {
  it("hasReingresoVisible: manual count", () => {
    assert.equal(
      hasReingresoVisible({
        reingresoManual: { count: 1, at: null, by: null },
      }),
      true,
    );
  });

  it("hasReingresoVisible: P072", () => {
    assert.equal(
      hasReingresoVisible({
        reingreso: {
          expedienteAnteriorId: "a",
          rechazoId: "b",
          rechazoEtapa: null,
          rechazoMotivo: null,
          rechazoComentario: null,
          biometricosCondicion: null,
          biometricosRazon: null,
        },
      }),
      true,
    );
  });

  it("hasReingresoVisible: sin marca", () => {
    assert.equal(hasReingresoVisible({}), false);
  });

  it("formatReingresoBadgeLabel", () => {
    assert.equal(formatReingresoBadgeLabel(1), "REINGRESO");
    assert.equal(formatReingresoBadgeLabel(2), "REINGRESO · 2");
  });

  it("puedeMostrarReingresoManualCard: activo asesor", () => {
    assert.equal(
      puedeMostrarReingresoManualCard({
        expedienteCancelado: false,
        role: "asesor",
      }),
      true,
    );
  });

  it("puedeMostrarReingresoManualCard: sin importar etapa/checklist (solo cancelado)", () => {
    assert.equal(
      puedeMostrarReingresoManualCard({ expedienteCancelado: false }),
      true,
    );
    assert.equal(
      puedeMostrarReingresoManualCard({ expedienteCancelado: true }),
      false,
    );
  });

  it("puedeMostrarReingresoManualCard: rol no asesor", () => {
    assert.equal(
      puedeMostrarReingresoManualCard({
        expedienteCancelado: false,
        role: "editor",
      }),
      false,
    );
  });

  it("mapAsesorEnviarReingresoRpcError: asesor ajeno", () => {
    const err = mapAsesorEnviarReingresoRpcError({
      message: "asesor_enviar_reingreso_a_mesa: solo el asesor dueño puede reingresar a Mesa",
    });
    assert.match(err.message, /permiso/i);
  });

  it("mapAsesorEnviarReingresoRpcError: cancelado", () => {
    const err = mapAsesorEnviarReingresoRpcError({
      message: "asesor_enviar_reingreso_a_mesa: el expediente está cancelado y no se puede reingresar",
    });
    assert.match(err.message, /cancelado/i);
  });
});
