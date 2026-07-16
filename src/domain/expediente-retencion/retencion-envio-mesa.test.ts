import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  puedeEnviarRetencionAcuseAvisoAMesa,
  rechazoRetencionMesaPermitido,
  retencionEnvioEstadoEfectivo,
  retencionDocPuedeRechazarMesa,
  retencionDocPuedeReemplazarAsesor,
  retencionOpcionAsesorEditable,
  retencionOpcionMesaEfectiva,
  retencionOpcionParaPanelAsesor,
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
          tipo_documento: "retencion_acuse_con_sello",
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

  it("A1: opción asesor bloqueada tras envío en revisión", () => {
    assert.equal(retencionOpcionAsesorEditable("enviado"), false);
    assert.equal(retencionOpcionAsesorEditable("correccion_requerida"), true);
    assert.equal(retencionOpcionAsesorEditable("no_enviado"), true);
  });

  it("A1: panel asesor fija opción enviada mientras Mesa revisa", () => {
    assert.equal(
      retencionOpcionParaPanelAsesor(envioBase, "sin_sello", "enviado"),
      "con_sello",
    );
    assert.equal(
      retencionOpcionParaPanelAsesor(envioBase, "sin_sello", "correccion_requerida"),
      "sin_sello",
    );
    assert.equal(retencionOpcionParaPanelAsesor(null, "con_sello", "no_enviado"), "con_sello");
  });

  it("mesa puede rechazar documento validado (corrección por error)", () => {
    assert.equal(retencionDocPuedeRechazarMesa("validado"), true);
    assert.equal(retencionDocPuedeRechazarMesa("subido"), true);
    assert.equal(retencionDocPuedeRechazarMesa("faltante"), false);
  });

  it("asesor puede reemplazar subido/resubido antes de enviar; bloqueado tras envío o si validado", () => {
    assert.equal(retencionDocPuedeReemplazarAsesor("faltante", false, "no_enviado"), true);
    assert.equal(retencionDocPuedeReemplazarAsesor("subido", true, "no_enviado"), true);
    assert.equal(retencionDocPuedeReemplazarAsesor("resubido", true, "no_enviado"), true);
    assert.equal(retencionDocPuedeReemplazarAsesor("rechazado", true, "no_enviado"), true);
    assert.equal(retencionDocPuedeReemplazarAsesor("validado", true, "no_enviado"), false);

    assert.equal(retencionDocPuedeReemplazarAsesor("subido", true, "enviado"), false);
    assert.equal(retencionDocPuedeReemplazarAsesor("rechazado", true, "enviado"), false);

    assert.equal(
      retencionDocPuedeReemplazarAsesor("rechazado", true, "correccion_requerida"),
      true,
    );
    assert.equal(
      retencionDocPuedeReemplazarAsesor("subido", true, "correccion_requerida"),
      false,
    );
    assert.equal(
      retencionDocPuedeReemplazarAsesor("validado", true, "correccion_requerida"),
      false,
    );
  });

  it("rechazo post-validación activa correccion_requerida y bloquea 8→9", () => {
    const archivosValidados = [
      { tipo_documento: "retencion_acuse_con_sello" as const, estatus_revision: "rechazado", id: "a1" },
    ];
    assert.equal(
      retencionEnvioEstadoEfectivo(envioBase, archivosValidados, "con_sello"),
      "correccion_requerida",
    );
    const bloqueos = getBloqueosRetencionAvanceEtapa8Mesa({
      retencion_opcion: "con_sello",
      archivos: archivosValidados,
      retencion_enviado_a_mesa: true,
    });
    assert.ok(bloqueos.some((b) => b.includes("rechazado")));
  });
});
