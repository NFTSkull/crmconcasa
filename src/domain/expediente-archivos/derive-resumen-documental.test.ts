import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOCUMENTO_CATALOGO_MAP,
  deriveResumenDocumental,
  filterItemsPorOwnerRoleCatalogo,
  listDocumentosCatalogoForStage,
  ordenarPorTipoDocumentoCatalogo,
  rowMasRecientePorTipoDocumento,
  type TipoDocumentoCatalogo,
  type ExpedienteArchivoResumen,
} from "./types";
import {
  buildClienteItemsRevisionDocumental,
  deriveChecklistDocumentosFromResumen,
} from "./checklist";

function row(
  tipo: ExpedienteArchivoResumen["tipo_documento"],
  estatus: ExpedienteArchivoResumen["estatus_revision"],
): ExpedienteArchivoResumen {
  return {
    expediente_id: "exp-1",
    tipo_documento: tipo,
    id: `${estatus}-${tipo}`,
    nombre_original: "x",
    mime_type: "application/pdf",
    size_bytes: 1,
    created_at: new Date().toISOString(),
    uploaded_by_role: "asesor",
    uploaded_by_email: "a@b.c",
    estatus_revision: estatus,
    comentario_mesa: null,
  };
}

describe("deriveResumenDocumental", () => {
  it("detecta faltantes primero", () => {
    const r = [
      row("ine", "validado"),
      row("estado_cuenta", "faltante"),
      row("nss", "subido"),
      row("direccion", "subido"),
    ];
    assert.equal(deriveResumenDocumental(r), "faltantes");
  });

  it("prioriza corrección requerida sobre resubido y subido", () => {
    const r = [
      row("ine", "rechazado"),
      row("estado_cuenta", "resubido"),
      row("nss", "validado"),
      row("direccion", "validado"),
    ];
    assert.equal(deriveResumenDocumental(r), "correccion_requerida");
  });

  it("corrección enviada sin rechazados", () => {
    const r = [
      row("ine", "resubido"),
      row("estado_cuenta", "validado"),
      row("nss", "validado"),
      row("direccion", "validado"),
    ];
    assert.equal(deriveResumenDocumental(r), "correccion_enviada");
  });

  it("pendiente revisión si hay subido y no resubido/rechazado", () => {
    const r = [
      row("ine", "subido"),
      row("estado_cuenta", "validado"),
      row("nss", "validado"),
      row("direccion", "validado"),
    ];
    assert.equal(deriveResumenDocumental(r), "pendiente_revision_documental");
  });

  it("documentos validados cuando los 4 están validado", () => {
    const r = [
      row("ine", "validado"),
      row("estado_cuenta", "validado"),
      row("nss", "validado"),
      row("direccion", "validado"),
    ];
    assert.equal(deriveResumenDocumental(r), "documentos_validados");
  });

  it("filas extra del catálogo (p. ej. cliente_*) no alteran la categoría del paquete de 4", () => {
    const r = [
      row("ine", "validado"),
      row("estado_cuenta", "validado"),
      row("nss", "validado"),
      row("direccion", "validado"),
      row("cliente_ine_frente", "subido"),
      row("cliente_estado_cuenta", "rechazado"),
    ];
    assert.equal(deriveResumenDocumental(r), "documentos_validados");
  });
});

describe("deriveChecklistDocumentosFromResumen", () => {
  it("etapa 1: completos si todos los obligatorios del catálogo están validados", () => {
    const expId = "exp-1";
    const base = (
      tipo: TipoDocumentoCatalogo,
    ): ExpedienteArchivoResumen => ({
      expediente_id: expId,
      tipo_documento: tipo,
      id: `${expId}::${tipo}`,
      nombre_original: "x",
      mime_type: "application/pdf",
      size_bytes: 1,
      created_at: new Date().toISOString(),
      uploaded_by_role: "asesor",
      uploaded_by_email: "a@b.com",
      estatus_revision: "validado",
      comentario_mesa: null,
    });

    const r = deriveChecklistDocumentosFromResumen({
      resumen: [
        base("ine"),
        base("estado_cuenta"),
        base("nss"),
        base("direccion"),
        base("cliente_ine_frente"),
        base("cliente_ine_reverso"),
        base("cliente_comprobante_domicilio"),
        base("cliente_estado_cuenta"),
        base("cliente_acta_nacimiento"),
        base("cliente_constancia_sat"),
      ],
      etapaActual: 1,
    });
    assert.equal(r.completos, true);
    assert.deepEqual(r.faltantes, []);
    assert.equal(r.completosLista.length, 10);
  });

  it("etapa 1: faltante si un doc base no está validado", () => {
    const expId = "exp-2";
    const mk = (
      tipo: "ine" | "estado_cuenta" | "nss" | "direccion",
      estatus: ExpedienteArchivoResumen["estatus_revision"],
    ): ExpedienteArchivoResumen => ({
      expediente_id: expId,
      tipo_documento: tipo,
      id: `${expId}::${tipo}`,
      nombre_original: "x",
      mime_type: "application/pdf",
      size_bytes: 1,
      created_at: new Date().toISOString(),
      uploaded_by_role: "asesor",
      uploaded_by_email: "a@b.com",
      estatus_revision: estatus,
      comentario_mesa: null,
    });

    const r = deriveChecklistDocumentosFromResumen({
      resumen: [
        mk("ine", "validado"),
        mk("estado_cuenta", "subido"),
        mk("nss", "validado"),
        mk("direccion", "validado"),
      ],
      etapaActual: 1,
    });
    assert.equal(r.completos, false);
    assert.ok(r.faltantes.some((x) => x.label === "Estado de cuenta"));
  });

  it("etapa 1: con pendienteRevisionCuentaComoCompleto, subido/resubido cuentan como presente", () => {
    const expId = "exp-subido";
    const mk = (
      tipo: TipoDocumentoCatalogo,
      estatus: ExpedienteArchivoResumen["estatus_revision"],
    ): ExpedienteArchivoResumen => ({
      expediente_id: expId,
      tipo_documento: tipo,
      id: `${expId}::${tipo}`,
      nombre_original: "x",
      mime_type: "application/pdf",
      size_bytes: 1,
      created_at: new Date().toISOString(),
      uploaded_by_role: "asesor",
      uploaded_by_email: "a@b.com",
      estatus_revision: estatus,
      comentario_mesa: null,
    });

    const tipos: TipoDocumentoCatalogo[] = [
      "ine",
      "estado_cuenta",
      "nss",
      "direccion",
      "cliente_ine_frente",
      "cliente_ine_reverso",
      "cliente_comprobante_domicilio",
      "cliente_estado_cuenta",
      "cliente_acta_nacimiento",
      "cliente_constancia_sat",
    ];
    const r = deriveChecklistDocumentosFromResumen({
      resumen: tipos.map((t) => mk(t, "subido")),
      etapaActual: 1,
      pendienteRevisionCuentaComoCompleto: true,
    });
    assert.equal(r.completos, true);
    assert.deepEqual(r.faltantes, []);
  });

  it("etapa 2: incluye los 6 documentos del cliente y cuenta subido como presente en mesa", () => {
    const expId = "exp-etapa-2";
    const mk = (
      tipo: TipoDocumentoCatalogo,
      estatus: ExpedienteArchivoResumen["estatus_revision"],
    ): ExpedienteArchivoResumen => ({
      expediente_id: expId,
      tipo_documento: tipo,
      id: `${expId}::${tipo}`,
      nombre_original: "x",
      mime_type: "application/pdf",
      size_bytes: 1,
      created_at: new Date().toISOString(),
      uploaded_by_role: "asesor",
      uploaded_by_email: "a@b.com",
      estatus_revision: estatus,
      comentario_mesa: null,
    });
    const tipos: TipoDocumentoCatalogo[] = [
      "ine",
      "estado_cuenta",
      "nss",
      "direccion",
      "cliente_ine_frente",
      "cliente_ine_reverso",
      "cliente_comprobante_domicilio",
      "cliente_estado_cuenta",
      "cliente_acta_nacimiento",
      "cliente_constancia_sat",
    ];
    const r = deriveChecklistDocumentosFromResumen({
      resumen: tipos.map((t) => mk(t, "subido")),
      etapaActual: 2,
      pendienteRevisionCuentaComoCompleto: true,
    });
    assert.equal(r.completos, true);
    assert.equal(r.completosLista.length, 10);
    const soloCliente = r.completosLista.filter((x) =>
      String(x.tipo_documento).startsWith("cliente_"),
    );
    assert.equal(soloCliente.length, 6);
  });

  it("etapa documental cliente base (2): mantiene 4 documentos del asesor aunque la etapa operativa sea final", () => {
    const expId = "exp-etapa-final";
    const mk = (
      tipo: TipoDocumentoCatalogo,
      estatus: ExpedienteArchivoResumen["estatus_revision"],
    ): ExpedienteArchivoResumen => ({
      expediente_id: expId,
      tipo_documento: tipo,
      id: `${expId}::${tipo}`,
      nombre_original: "x",
      mime_type: "application/pdf",
      size_bytes: 1,
      created_at: new Date().toISOString(),
      uploaded_by_role: "asesor",
      uploaded_by_email: "a@b.com",
      estatus_revision: estatus,
      comentario_mesa: null,
    });

    const r = deriveChecklistDocumentosFromResumen({
      resumen: [
        mk("cliente_ine_frente", "validado"),
        mk("cliente_ine_reverso", "validado"),
        mk("cliente_comprobante_domicilio", "validado"),
        mk("cliente_estado_cuenta", "validado"),
      ],
      etapaActual: 2,
      ownerRole: "cliente",
      pendienteRevisionCuentaComoCompleto: true,
    });
    assert.equal(r.completos, true);
    assert.equal(r.completosLista.length, 4);
    assert.equal(r.faltantes.length, 0);
  });
});

describe("rowMasRecientePorTipoDocumento", () => {
  it("elige la fila con created_at más reciente para el mismo tipo", () => {
    const older: ExpedienteArchivoResumen = {
      ...row("cliente_ine_frente", "validado"),
      id: "a",
      created_at: "2020-01-01T00:00:00.000Z",
    };
    const newer: ExpedienteArchivoResumen = {
      ...row("cliente_ine_frente", "subido"),
      id: "b",
      created_at: "2099-01-01T00:00:00.000Z",
    };
    const pick = rowMasRecientePorTipoDocumento([older, newer], "cliente_ine_frente");
    assert.equal(pick?.id, "b");
  });
});

describe("filterItemsPorOwnerRoleCatalogo", () => {
  it("excluye sistema y asesor cuando se pide solo cliente", () => {
    const items = [
      { tipo_documento: "ine" as const, label: "a" },
      { tipo_documento: "cliente_ine_frente" as const, label: "b" },
      { tipo_documento: "asesor_ine_frente" as const, label: "c" },
    ];
    const soloCliente = filterItemsPorOwnerRoleCatalogo(items, "cliente");
    assert.equal(soloCliente.length, 1);
    assert.equal(soloCliente[0].tipo_documento, "cliente_ine_frente");
  });
});

describe("ordenarPorTipoDocumentoCatalogo", () => {
  it("prioriza el orden del catálogo, no el alfabético", () => {
    const items = [
      { tipo_documento: "cliente_estado_cuenta" as const, label: "x" },
      { tipo_documento: "cliente_ine_frente" as const, label: "y" },
    ];
    const sorted = ordenarPorTipoDocumentoCatalogo(items);
    assert.equal(sorted[0].tipo_documento, "cliente_ine_frente");
    assert.equal(sorted[1].tipo_documento, "cliente_estado_cuenta");
  });
});

describe("DOCUMENTO_CATALOGO: cliente_* obligatorios en etapa 1", () => {
  it("incluye 4 documentos personales del cliente que sube el asesor", () => {
    const req = listDocumentosCatalogoForStage({
      etapaId: 1,
      ownerRole: "cliente",
      soloObligatorios: true,
    }).map((x) => x.tipo);

    const expected = [
      "cliente_ine_frente",
      "cliente_ine_reverso",
      "cliente_comprobante_domicilio",
      "cliente_estado_cuenta",
    ] as const;

    for (const t of expected) {
      assert.ok(req.includes(t), `Falta requerido: ${t}`);
    }
    assert.equal(req.length, 4);
  });
});

describe("B0D2: documentos cliente opcionales (Semanas Cotizadas, Carta empresa)", () => {
  const opcionales = ["cliente_semanas_cotizadas", "cliente_carta_empresa"] as const;

  it("existen en catálogo como cliente opcionales", () => {
    for (const tipo of opcionales) {
      const item = DOCUMENTO_CATALOGO_MAP[tipo];
      assert.equal(item.ownerRole, "cliente");
      assert.equal(item.obligatorio, "opcional");
    }
  });

  it("no aparecen en faltantes requeridos cuando no están subidos", () => {
    const resumen = [
      row("cliente_ine_frente", "validado"),
      row("cliente_ine_reverso", "validado"),
      row("cliente_comprobante_domicilio", "validado"),
      row("cliente_estado_cuenta", "validado"),
    ];
    const checklist = deriveChecklistDocumentosFromResumen({
      resumen,
      etapaActual: 1,
      ownerRole: "cliente",
      pendienteRevisionCuentaComoCompleto: true,
    });
    assert.equal(checklist.faltantes.length, 0);
    for (const tipo of opcionales) {
      assert.ok(
        !checklist.faltantes.some((f) => f.tipo_documento === tipo),
        `No debe faltar: ${tipo}`,
      );
    }
  });

  it("el checklist obligatorio cliente etapa 1 espera 4 documentos del asesor", () => {
    const req = listDocumentosCatalogoForStage({
      etapaId: 1,
      ownerRole: "cliente",
      soloObligatorios: true,
    });
    assert.equal(req.length, 4);
    for (const tipo of opcionales) {
      assert.ok(!req.some((d) => d.tipo === tipo));
    }
    assert.ok(!req.some((d) => d.tipo === "cliente_historial_laboral"));
  });

  it("opcionales subidos aparecen en revisión documental sin bloquear checklist", () => {
    const resumen = [
      row("cliente_ine_frente", "validado"),
      row("cliente_ine_reverso", "validado"),
      row("cliente_comprobante_domicilio", "validado"),
      row("cliente_estado_cuenta", "validado"),
      row("cliente_semanas_cotizadas", "subido"),
    ];
    const checklist = deriveChecklistDocumentosFromResumen({
      resumen,
      etapaActual: 1,
      ownerRole: "cliente",
      pendienteRevisionCuentaComoCompleto: true,
    });
    const revision = buildClienteItemsRevisionDocumental({
      checklist,
      resumen,
      etapaId: 1,
    });
    assert.ok(
      revision.some((it) => it.tipo_documento === "cliente_semanas_cotizadas"),
    );
    assert.equal(checklist.faltantes.length, 0);
  });
});

describe("DOCUMENTO_CATALOGO: cliente_* obligatorios en etapa 2", () => {
  it("incluye los 4 documentos del cliente que sube el asesor", () => {
    const req = listDocumentosCatalogoForStage({
      etapaId: 2,
      ownerRole: "cliente",
      soloObligatorios: true,
    }).map((x) => x.tipo);

    const expected = [
      "cliente_ine_frente",
      "cliente_ine_reverso",
      "cliente_comprobante_domicilio",
      "cliente_estado_cuenta",
    ] as const;

    for (const t of expected) {
      assert.ok(req.includes(t), `Falta requerido: ${t}`);
    }
    assert.equal(req.length, 4);
  });

  it("acta y constancia SAT son obligatorios Mesa en etapa 2", () => {
    const req = listDocumentosCatalogoForStage({
      etapaId: 2,
      ownerRole: "mesa",
      soloObligatorios: true,
    }).map((x) => x.tipo);

    assert.deepEqual(req, ["cliente_acta_nacimiento", "cliente_constancia_sat"]);
  });
});
