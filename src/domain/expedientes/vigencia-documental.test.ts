import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatVigenciaDocumentalHeader,
  parseExpedienteVigenciaDocumentalEstado,
} from "./vigencia-documental";

describe("vigencia-documental P211", () => {
  it("parsea contrato RO mínimo", () => {
    const e = parseExpedienteVigenciaDocumentalEstado({
      applicable: true,
      vencido: false,
      dias_transcurridos: 12,
      limite_dias: 45,
      dias_restantes: 33,
      tracking_unknown: false,
      docs_frescos_completos: false,
      reingreso_requerido: false,
      listo_para_continuar: true,
      comprobante_fresco: false,
      estado_cuenta_fresco: false,
    });
    assert.ok(e);
    assert.equal(
      formatVigenciaDocumentalHeader(e!, 5),
      "Etapa 5 · Día 12 de 45",
    );
  });

  it("header vencido y tracking_unknown", () => {
    const vencido = parseExpedienteVigenciaDocumentalEstado({
      applicable: true,
      vencido: true,
      dias_transcurridos: 46,
      limite_dias: 45,
      dias_restantes: 0,
      tracking_unknown: false,
      docs_frescos_completos: false,
      reingreso_requerido: true,
      listo_para_continuar: false,
      comprobante_fresco: false,
      estado_cuenta_fresco: false,
    });
    assert.equal(
      formatVigenciaDocumentalHeader(vencido!, 8),
      "Vencido · Reingreso por vigencia",
    );

    const unknown = parseExpedienteVigenciaDocumentalEstado({
      applicable: true,
      vencido: false,
      tracking_unknown: true,
      docs_frescos_completos: false,
      reingreso_requerido: false,
      listo_para_continuar: true,
      comprobante_fresco: false,
      estado_cuenta_fresco: false,
      limite_dias: 45,
    });
    assert.equal(
      formatVigenciaDocumentalHeader(unknown!, 3),
      "Vigencia pendiente de determinar",
    );
  });

  it("no muestra en no applicable (etapa9+)", () => {
    const e = parseExpedienteVigenciaDocumentalEstado({
      applicable: false,
      reason: "already_released",
      vencido: false,
      tracking_unknown: false,
      docs_frescos_completos: false,
      reingreso_requerido: false,
      listo_para_continuar: true,
      comprobante_fresco: false,
      estado_cuenta_fresco: false,
      limite_dias: 45,
    });
    assert.equal(formatVigenciaDocumentalHeader(e!, 8), null);
  });
});
