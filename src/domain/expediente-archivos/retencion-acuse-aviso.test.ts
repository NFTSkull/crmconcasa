import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveRetencionAcuseAvisoFaltantes,
  getBloqueosRetencionAvanceEtapa8,
  getBloqueosRetencionAvanceEtapa8Mesa,
  listRetencionUploadsForOpcion,
  MSG_BLOQUEO_RETENCION_SIN_ENVIO_ASESOR,
  MSG_BLOQUEO_RETENCION_SIN_OPCION,
  RETENCION_TIPOS_DOCUMENTO,
  retencionAcuseAvisoCompleto,
  retencionListoParaAvanceMesa,
  tiposRequeridosRetencion,
} from "./retencion-acuse-aviso";
import {
  DOCUMENTO_CATALOGO_MAP,
  listDocumentosCatalogoForStage,
  type TipoDocumentoCatalogo,
} from "./types";

function archivo(
  tipo: TipoDocumentoCatalogo,
  conArchivo: boolean,
): { tipo_documento: TipoDocumentoCatalogo; id: string | null; estatus_revision: string } {
  return {
    tipo_documento: tipo,
    id: conArchivo ? `id-${tipo}` : null,
    estatus_revision: conArchivo ? "subido" : "faltante",
  };
}

describe("B0D3A: catálogo retención", () => {
  it("tipos retención existen en catálogo con etapa 8", () => {
    for (const tipo of RETENCION_TIPOS_DOCUMENTO) {
      const item = DOCUMENTO_CATALOGO_MAP[tipo];
      assert.ok(item);
      assert.equal(item.obligatorio, "obligatorio");
      assert.ok(item.etapasRequeridas.includes(8));
    }
  });

  it("Integración etapa 1 sigue con exactamente 6 obligatorios cliente", () => {
    const req = listDocumentosCatalogoForStage({
      etapaId: 1,
      ownerRole: "cliente",
      soloObligatorios: true,
    }).map((x) => x.tipo);
    assert.equal(req.length, 6);
    for (const t of RETENCION_TIPOS_DOCUMENTO) {
      assert.ok(!req.includes(t));
    }
  });

  it("Semanas Cotizadas e Historial Laboral siguen opcionales en etapa 1", () => {
    const opc = listDocumentosCatalogoForStage({
      etapaId: 1,
      ownerRole: "cliente",
      soloObligatorios: false,
    }).filter((d) => d.obligatorio === "opcional");
    const tipos = opc.map((d) => d.tipo);
    assert.ok(tipos.includes("cliente_semanas_cotizadas"));
    assert.ok(tipos.includes("cliente_historial_laboral"));
  });
});

describe("B0D3A: deriveRetencionAcuseAvisoFaltantes", () => {
  it("sin opción: falta selección", () => {
    const f = deriveRetencionAcuseAvisoFaltantes({
      retencion_opcion: null,
      archivos: [],
    });
    assert.equal(f.length, 1);
    assert.equal(f[0].kind, "opcion");
  });

  it("opción A requiere exactamente 4 documentos", () => {
    const tipos = tiposRequeridosRetencion("con_sello");
    assert.deepEqual(tipos, [
      "retencion_acuse_con_sello",
      "retencion_aviso_retencion",
      "retencion_ine_frente",
      "retencion_ine_reverso",
    ]);
    const uploads = listRetencionUploadsForOpcion("con_sello");
    assert.equal(uploads.length, 4);
  });

  it("opción B requiere exactamente 4 documentos (carta + comunes)", () => {
    const tipos = tiposRequeridosRetencion("sin_sello");
    assert.deepEqual(tipos, [
      "retencion_carta_sin_sello",
      "retencion_aviso_retencion",
      "retencion_ine_frente",
      "retencion_ine_reverso",
    ]);
  });

  it("opción A incompleta lista documentos faltantes", () => {
    const archivos = [
      archivo("retencion_acuse_con_sello", true),
      archivo("retencion_aviso_retencion", false),
      archivo("retencion_ine_frente", false),
      archivo("retencion_ine_reverso", false),
    ];
    const f = deriveRetencionAcuseAvisoFaltantes({
      retencion_opcion: "con_sello",
      archivos,
    });
    assert.equal(f.length, 3);
    assert.ok(f.every((x) => x.kind === "documento"));
  });

  it("opción B completa no tiene faltantes", () => {
    const archivos = [
      archivo("retencion_carta_sin_sello", true),
      archivo("retencion_aviso_retencion", true),
      archivo("retencion_ine_frente", true),
      archivo("retencion_ine_reverso", true),
    ];
    assert.ok(
      retencionAcuseAvisoCompleto({
        retencion_opcion: "sin_sello",
        archivos,
      }),
    );
  });
});

function archivoEstatus(
  tipo: TipoDocumentoCatalogo,
  estatus: string,
  conId = true,
): {
  tipo_documento: TipoDocumentoCatalogo;
  id: string | null;
  estatus_revision: string;
} {
  return {
    tipo_documento: tipo,
    id: conId ? `id-${tipo}` : null,
    estatus_revision: estatus,
  };
}

describe("B0D3B: bloqueo mesa avance etapa 8 → 9", () => {
  it("sin opción elegida bloquea avance", () => {
    assert.deepEqual(
      getBloqueosRetencionAvanceEtapa8Mesa({
        retencion_opcion: null,
        archivos: [],
        retencion_enviado_a_mesa: false,
      }),
      [MSG_BLOQUEO_RETENCION_SIN_OPCION],
    );
    assert.ok(getBloqueosRetencionAvanceEtapa8({ retencion_opcion: null, archivos: [] }).length > 0);
  });

  it("opción A sin todos los documentos subidos bloquea avance mesa", () => {
    const archivos = [archivoEstatus("retencion_acuse_con_sello", "subido")];
    const bloqueos = getBloqueosRetencionAvanceEtapa8Mesa({
      retencion_opcion: "con_sello",
      archivos,
      retencion_enviado_a_mesa: true,
    });
    assert.ok(bloqueos.length > 0);
    assert.ok(bloqueos.some((b) => b.includes("pendiente de validar") || b.includes("falta documento")));
  });

  it("opción B sin documentos bloquea avance mesa", () => {
    const bloqueos = getBloqueosRetencionAvanceEtapa8Mesa({
      retencion_opcion: "sin_sello",
      archivos: [],
      retencion_enviado_a_mesa: true,
    });
    assert.equal(bloqueos.length, 4);
  });

  it("opción A con los 4 documentos validados y envío asesor permite avance mesa", () => {
    const archivos = [
      archivoEstatus("retencion_acuse_con_sello", "validado"),
      archivoEstatus("retencion_aviso_retencion", "validado"),
      archivoEstatus("retencion_ine_frente", "validado"),
      archivoEstatus("retencion_ine_reverso", "validado"),
    ];
    assert.deepEqual(
      getBloqueosRetencionAvanceEtapa8Mesa({
        retencion_opcion: "con_sello",
        archivos,
        retencion_enviado_a_mesa: true,
      }),
      [],
    );
    assert.ok(
      retencionListoParaAvanceMesa({
        retencion_opcion: "con_sello",
        archivos,
        retencion_enviado_a_mesa: true,
      }),
    );
  });

  it("opción B con los 4 documentos validados y envío asesor permite avance mesa", () => {
    const archivos = [
      archivoEstatus("retencion_carta_sin_sello", "validado"),
      archivoEstatus("retencion_aviso_retencion", "validado"),
      archivoEstatus("retencion_ine_frente", "validado"),
      archivoEstatus("retencion_ine_reverso", "validado"),
    ];
    assert.deepEqual(
      getBloqueosRetencionAvanceEtapa8Mesa({
        retencion_opcion: "sin_sello",
        archivos,
        retencion_enviado_a_mesa: true,
      }),
      [],
    );
  });

  it("B0D6.1: opción A + 4 validados sin envío asesor bloquea 8→9", () => {
    const archivos = [
      archivoEstatus("retencion_acuse_con_sello", "validado"),
      archivoEstatus("retencion_aviso_retencion", "validado"),
      archivoEstatus("retencion_ine_frente", "validado"),
      archivoEstatus("retencion_ine_reverso", "validado"),
    ];
    const bloqueos = getBloqueosRetencionAvanceEtapa8Mesa({
      retencion_opcion: "con_sello",
      archivos,
      retencion_enviado_a_mesa: false,
    });
    assert.ok(bloqueos.includes(MSG_BLOQUEO_RETENCION_SIN_ENVIO_ASESOR));
    assert.ok(!retencionListoParaAvanceMesa({
      retencion_opcion: "con_sello",
      archivos,
      retencion_enviado_a_mesa: false,
    }));
  });

  it("B0D6.1: envío asesor pero documentos no validados bloquea", () => {
    const archivos = [archivoEstatus("retencion_acuse_con_sello", "subido")];
    const bloqueos = getBloqueosRetencionAvanceEtapa8Mesa({
      retencion_opcion: "con_sello",
      archivos,
      retencion_enviado_a_mesa: true,
    });
    assert.ok(!bloqueos.includes(MSG_BLOQUEO_RETENCION_SIN_ENVIO_ASESOR));
    assert.ok(bloqueos.some((b) => b.includes("pendiente de validar")));
  });

  it("retencion_* no alteran checklist integración (6 obligatorios etapa 1)", () => {
    const req = listDocumentosCatalogoForStage({
      etapaId: 1,
      ownerRole: "cliente",
      soloObligatorios: true,
    });
    assert.equal(req.length, 6);
    for (const t of RETENCION_TIPOS_DOCUMENTO) {
      assert.ok(!req.some((d) => d.tipo === t));
    }
  });
});
