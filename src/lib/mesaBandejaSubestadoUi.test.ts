import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMesaAsesorCambiosCardModel } from "./mesaAsesorCambiosCardUi";
import {
  mesaBandejaMuestraBadgeRechazado,
  mesaRevisionEpisodioActivo,
  resolveMesaBandejaSubestadoBadge,
} from "./mesaBandejaSubestadoUi";

describe("mesaBandejaSubestadoUi", () => {
  it("U1: corrección pendiente oculta badge Rechazado", () => {
    const badge = resolveMesaBandejaSubestadoBadge(
      "rechazado",
      "CORRECTION_PENDING_REVIEW",
    );
    assert.equal(badge.kind, "none");
    assert.equal(
      mesaBandejaMuestraBadgeRechazado("rechazado", "CORRECTION_PENDING_REVIEW"),
      false,
    );
  });

  it("U2: esperando asesor no compite con Rechazado", () => {
    assert.equal(
      resolveMesaBandejaSubestadoBadge("rechazado", "WAITING_ADVISOR").kind,
      "none",
    );
    assert.equal(mesaRevisionEpisodioActivo("WAITING_ADVISOR"), true);
  });

  it("U3: CLOSED + rechazado conserva badge Rechazado", () => {
    assert.equal(
      resolveMesaBandejaSubestadoBadge("rechazado", "CLOSED").kind,
      "rechazado",
    );
    assert.equal(resolveMesaBandejaSubestadoBadge("rechazado", null).kind, "rechazado");
  });

  it("U4: en_proceso + corrección pendiente sigue En proceso", () => {
    const badge = resolveMesaBandejaSubestadoBadge(
      "en_proceso",
      "CORRECTION_PENDING_REVIEW",
    );
    assert.equal(badge.kind, "operativo");
    assert.equal(badge.subestado, "en_proceso");
  });

  it("U5: tarjeta CORRECTION_PENDING_REVIEW sigue visible con CTA", () => {
    const card = buildMesaAsesorCambiosCardModel({
      revisionEstado: "CORRECTION_PENDING_REVIEW",
      origin: "REQUESTED_CORRECTION",
      advisorChangeBatchId: "00000000-0000-4000-8000-000000000001",
      advisorChangesCount: 1,
      advisorChangesPreview: [
        {
          tipo: "campo_actualizado",
          campo: "notaMesa",
          documentKind: null,
          label: "Notas para Mesa actualizadas",
          hasOld: true,
          hasNew: true,
          source: "P130",
        },
      ],
      resumenDocumental: "faltantes",
    });
    assert.equal(card.showBlock, true);
    assert.match(card.header, /Corrección por revisar|Corrección recibida/);
    assert.equal(card.showRevisarCambios, true);
  });

  it("U6: ocultar badge no cambia el episodio (membresía P198 intacta)", () => {
    const estado = "CORRECTION_PENDING_REVIEW";
    resolveMesaBandejaSubestadoBadge("rechazado", estado);
    assert.equal(estado, "CORRECTION_PENDING_REVIEW");
    assert.equal(mesaRevisionEpisodioActivo(estado), true);
  });
});
