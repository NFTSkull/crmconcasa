import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveEstadoDocumentacionColumnaAsesor } from "./checklist";
import { listDocumentosCatalogoForStage, type ExpedienteArchivoResumen } from "./types";

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

describe("deriveEstadoDocumentacionColumnaAsesor", () => {
  const etapa1Obligatorios = listDocumentosCatalogoForStage({
    etapaId: 1,
    soloObligatorios: true,
  });

  it("etapa 1: todo subido → pendiente_aprobacion", () => {
    const resumen = etapa1Obligatorios.map((d) =>
      row(d.tipo as ExpedienteArchivoResumen["tipo_documento"], "subido"),
    );
    assert.equal(deriveEstadoDocumentacionColumnaAsesor(resumen, 1), "pendiente_aprobacion");
  });

  it("etapa 1: todo validado → completos", () => {
    const resumen = etapa1Obligatorios.map((d) =>
      row(d.tipo as ExpedienteArchivoResumen["tipo_documento"], "validado"),
    );
    assert.equal(deriveEstadoDocumentacionColumnaAsesor(resumen, 1), "completos");
  });

  it("etapa 1: un obligatorio sin equivalencias en faltante y el resto subido → faltantes", () => {
    const resumen = etapa1Obligatorios
      .filter((d) => d.ownerRole !== "mesa")
      .map((d) => {
      const t = d.tipo as ExpedienteArchivoResumen["tipo_documento"];
      const faltante =
        t === "direccion" || t === "cliente_comprobante_domicilio";
      return row(t, faltante ? "faltante" : "subido");
    });
    assert.equal(deriveEstadoDocumentacionColumnaAsesor(resumen, 1), "faltantes");
  });

  it("solo filas cliente_* subidas (sin nss en resumen): NSS no bloquea → pendiente_aprobacion", () => {
    const resumen = etapa1Obligatorios
      .filter((d) => String(d.tipo).startsWith("cliente_"))
      .map((d) => row(d.tipo as ExpedienteArchivoResumen["tipo_documento"], "subido"));
    assert.equal(deriveEstadoDocumentacionColumnaAsesor(resumen, 1), "pendiente_aprobacion");
  });

  it("NSS en faltante no bloquea: demás bloqueantes subidos → pendiente_aprobacion", () => {
    const resumen = etapa1Obligatorios.map((d) => {
      const t = d.tipo as ExpedienteArchivoResumen["tipo_documento"];
      return row(t, t === "nss" ? "faltante" : "subido");
    });
    assert.equal(deriveEstadoDocumentacionColumnaAsesor(resumen, 1), "pendiente_aprobacion");
  });

  it("paquete base cubierto solo por cliente_* + nss → pendiente_aprobacion", () => {
    const resumen = [
      row("cliente_ine_frente", "subido"),
      row("cliente_ine_reverso", "subido"),
      row("cliente_estado_cuenta", "subido"),
      row("cliente_comprobante_domicilio", "subido"),
      row("nss", "subido"),
    ];
    assert.equal(deriveEstadoDocumentacionColumnaAsesor(resumen, 1), "pendiente_aprobacion");
  });

  it("ine base subido cubre el grupo aunque cliente_ine_* estén faltante", () => {
    const resumen = etapa1Obligatorios.map((d) => {
      const t = d.tipo as ExpedienteArchivoResumen["tipo_documento"];
      if (t === "ine") return row(t, "subido");
      if (t === "cliente_ine_frente" || t === "cliente_ine_reverso") return row(t, "faltante");
      return row(t, "subido");
    });
    assert.equal(deriveEstadoDocumentacionColumnaAsesor(resumen, 1), "pendiente_aprobacion");
  });

  it("rechazado en grupo sin otra fila mejor cuenta como faltante para la columna", () => {
    const resumen = etapa1Obligatorios
      .filter((d) => d.ownerRole !== "mesa")
      .map((d) => {
      const t = d.tipo as ExpedienteArchivoResumen["tipo_documento"];
      if (t === "direccion") return row(t, "rechazado");
      if (t === "cliente_comprobante_domicilio") return row(t, "faltante");
      return row(t, "subido");
    });
    assert.equal(deriveEstadoDocumentacionColumnaAsesor(resumen, 1), "faltantes");
  });

  it("etapaActual null usa etapa 1", () => {
    const resumen = etapa1Obligatorios.map((d) =>
      row(d.tipo as ExpedienteArchivoResumen["tipo_documento"], "subido"),
    );
    assert.equal(deriveEstadoDocumentacionColumnaAsesor(resumen, null), "pendiente_aprobacion");
  });
});
