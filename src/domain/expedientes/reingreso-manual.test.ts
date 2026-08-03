import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatReingresoBadgeLabel,
  hasReingresoVisible,
  mapAsesorEnviarReingresoRpcError,
} from "./reingreso-manual";
import { ExpedientesSupabaseError } from "./supabase.error";

describe("reingreso-manual helpers", () => {
  it("hasReingresoVisible: manual count", () => {
    assert.equal(
      hasReingresoVisible({
        reingresoManual: { count: 1, at: "2026-08-03T12:00:00Z", by: "a" },
      }),
      true,
    );
  });

  it("hasReingresoVisible: P072", () => {
    assert.equal(
      hasReingresoVisible({
        reingreso: {
          expedienteAnteriorId: "p",
          rechazoId: "r",
          rechazoEtapa: 5,
          rechazoMotivo: "x",
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

  it("mapAsesorEnviarReingresoRpcError: nunca enviado", () => {
    const err = mapAsesorEnviarReingresoRpcError({
      message: "asesor_enviar_reingreso_a_mesa: el expediente nunca fue enviado a Mesa",
    });
    assert.ok(err instanceof ExpedientesSupabaseError);
    assert.match(err.message, /ya fue enviado/i);
  });

  it("mapAsesorEnviarReingresoRpcError: asesor ajeno", () => {
    const err = mapAsesorEnviarReingresoRpcError({
      message: "asesor_enviar_reingreso_a_mesa: solo el asesor dueño puede reingresar a Mesa",
    });
    assert.match(err.message, /permiso/i);
  });
});
