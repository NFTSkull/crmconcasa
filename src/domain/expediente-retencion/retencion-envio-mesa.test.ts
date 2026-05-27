import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  puedeEnviarRetencionAcuseAvisoAMesa,
  rechazoRetencionMesaPermitido,
  retencionEnvioEstadoEfectivo,
  retencionOpcionMesaEfectiva,
  retencionPuedeReenviarAMesa,
} from "./retencion-envio-mesa";
import { getBloqueosRetencionAvanceEtapa8Mesa } from "@/domain/expediente-archivos/retencion-acuse-aviso";
import type { ExpedienteRetencionEnvioMesa } from "./types";

const envioBase: ExpedienteRetencionEnvioMesa = {
  expedienteId: "exp-1",
  enviado: true,
  fechaEnvioMesa: "2026-05-27T12:00:00.000Z",
  opcion: "con_sello",
  estado: "enviado",
};

describe("B0D6: envío Acuse/Aviso retención a Mesa", () => {
  it("B0D6.4: opción mesa efectiva prioriza envío sobre selección local", () => {
    assert.equal(
      retencionOpcionMesaEfectiva(
        { ...envioBase, opcion: "sin_sello" },
        "con_sello",
      ),
      "sin_sello",
    );
    assert.equal(retencionOpcionMesaEfectiva(null, "con_sello"), "con_sello");
    assert.equal(retencionOpcionMesaEfectiva(null, null), null);
  });

  it("no permite enviar si faltan documentos u opción", () => {
    assert.equal(
      puedeEnviarRetencionAcuseAvisoAMesa([
        { kind: "documento", tipo_documento: "retencion_aviso_retencion", label: "Aviso" },
      ]),
      false,
    );
    assert.equal(puedeEnviarRetencionAcuseAvisoAMesa([]), true);
  });

  it("sin envío previo: estado no_enviado", () => {
    assert.equal(retencionEnvioEstadoEfectivo(null, [], "con_sello"), "no_enviado");
  });

  it("con envío y sin rechazos: enviado", () => {
    assert.equal(
      retencionEnvioEstadoEfectivo(envioBase, [
        {
          tipo_documento: "retencion_acuse_con_sello",
          estatus_revision: "validado",
        },
      ], "con_sello"),
      "enviado",
    );
  });

  it("con envío y doc rechazado: correccion_requerida", () => {
    assert.equal(
      retencionEnvioEstadoEfectivo(envioBase, [
        {
          tipo_documento: "retencion_aviso_retencion",
          estatus_revision: "rechazado",
        },
      ], "con_sello"),
      "correccion_requerida",
    );
  });

  it("B0D6.2: rechazo mesa exige comentario no vacío", () => {
    assert.equal(rechazoRetencionMesaPermitido(""), false);
    assert.equal(rechazoRetencionMesaPermitido("   "), false);
    assert.equal(rechazoRetencionMesaPermitido("Corregir sello"), true);
  });

  it("B0D6.2: documento rechazado bloquea 8→9 aunque haya envío asesor", () => {
    const archivos = [
      {
        tipo_documento: "retencion_acuse_con_sello" as const,
        id: "a1",
        estatus_revision: "rechazado",
      },
      {
        tipo_documento: "retencion_aviso_retencion" as const,
        id: "a2",
        estatus_revision: "validado",
      },
      {
        tipo_documento: "retencion_ine_frente" as const,
        id: "a3",
        estatus_revision: "validado",
      },
      {
        tipo_documento: "retencion_ine_reverso" as const,
        id: "a4",
        estatus_revision: "validado",
      },
    ];
    const bloqueos = getBloqueosRetencionAvanceEtapa8Mesa({
      retencion_opcion: "con_sello",
      archivos,
      retencion_enviado_a_mesa: true,
    });
    assert.ok(bloqueos.some((b) => b.includes("rechazado")));
  });

  it("puede reenviar tras corrección si ya no hay faltantes", () => {
    assert.equal(retencionPuedeReenviarAMesa("correccion_requerida", []), true);
    assert.equal(retencionPuedeReenviarAMesa("enviado", []), false);
    assert.equal(retencionPuedeReenviarAMesa("no_enviado", []), true);
    assert.equal(
      retencionPuedeReenviarAMesa("correccion_requerida", [
        { kind: "documento", tipo_documento: "retencion_ine_frente", label: "INE" },
      ]),
      false,
    );
  });
});
