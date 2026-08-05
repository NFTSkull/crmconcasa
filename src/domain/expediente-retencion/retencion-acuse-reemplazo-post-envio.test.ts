import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMesaRetencionDocViews } from "./mesa-retencion-docs";
import { mapRegisterRetencionDocRpcError } from "./register-retencion-doc-rpc-error";
import { retencionDocPuedeReemplazarAsesor } from "./retencion-envio-mesa";
import type { ExpedienteArchivoListItem } from "@/domain/expediente-archivos/map-supabase-expediente-documentos";

/**
 * Hotfix Acuse: reemplazo post-envío por asesor dueño.
 * Cubre reglas FE + vista Mesa + mapeo de error de asesor ajeno.
 * (La atomicidad soft-delete / etapa intacta se valida en SQL
 * `rpc_retencion_acuse_reemplazo_post_envio.sql`.)
 */
describe("hotfix Acuse — reemplazo post-envío", () => {
  it("reemplazo exitoso permitido con bloque enviado (subido o validado)", () => {
    assert.equal(retencionDocPuedeReemplazarAsesor("subido", true, "enviado"), true);
    assert.equal(retencionDocPuedeReemplazarAsesor("validado", true, "enviado"), true);
  });

  it("una sola versión activa en la vista Mesa: lista activa gana sobre catálogo viejo", () => {
    const tipo = "retencion_acuse_con_sello" as const;
    const listaActiva: ExpedienteArchivoListItem[] = [
      {
        id: "doc-nuevo",
        expediente_id: "exp-1",
        tipo_documento: tipo,
        nombre_original: "acuse-v2.pdf",
        mime_type: "application/pdf",
        size_bytes: 1200,
        created_at: "2026-08-05T20:00:00.000Z",
        uploaded_by_role: "asesor",
        uploaded_by_email: "asesor@test.local",
        uploaded_by_name: "Asesor",
        estatus_revision: "subido",
        comentario_mesa: null,
        version: 2,
      },
    ];
    const catalogViejo = [
      {
        expediente_id: "exp-1",
        tipo_documento: tipo,
        id: "doc-viejo",
        nombre_original: "acuse-v1.pdf",
        mime_type: "application/pdf",
        size_bytes: 900,
        created_at: "2026-08-05T10:00:00.000Z",
        uploaded_by_role: "asesor" as const,
        uploaded_by_email: "asesor@test.local",
        estatus_revision: "validado" as const,
        comentario_mesa: null,
      },
    ];

    const views = buildMesaRetencionDocViews("con_sello", catalogViejo, listaActiva);
    assert.equal(views.length, 1);
    assert.equal(views[0]?.archivo?.id, "doc-nuevo");
    assert.equal(views[0]?.archivo?.nombre_original, "acuse-v2.pdf");
    assert.equal(views[0]?.estatus_revision, "subido");
    assert.equal(views[0]?.puedeAbrir, true);
  });

  it("etapa/subestado no se modelan en el helper de reemplazo (solo permiso de archivo)", () => {
    // El helper FE no muta etapa; solo autoriza UI. Contrato RPC: avance solo si etapa=8.
    assert.equal(retencionDocPuedeReemplazarAsesor("subido", true, "enviado"), true);
  });

  it("Mesa ve el archivo nuevo (nombre activo más reciente)", () => {
    const tipo = "retencion_acuse_con_sello" as const;
    const lista: ExpedienteArchivoListItem[] = [
      {
        id: "activo",
        expediente_id: "exp-1",
        tipo_documento: tipo,
        nombre_original: "nuevo-acuse.png",
        mime_type: "image/png",
        size_bytes: 2048,
        created_at: "2026-08-05T21:00:00.000Z",
        uploaded_by_role: "asesor",
        uploaded_by_email: "asesor@test.local",
        uploaded_by_name: "Asesor",
        estatus_revision: "subido",
        comentario_mesa: null,
        version: 3,
      },
    ];
    const [view] = buildMesaRetencionDocViews("con_sello", [], lista);
    assert.equal(view?.archivo?.nombre_original, "nuevo-acuse.png");
    assert.equal(view?.puedeAbrir, true);
  });

  it("asesor ajeno bloqueado (mensaje canónico del RPC)", () => {
    const err = mapRegisterRetencionDocRpcError({
      code: "42501",
      message:
        "register_expediente_documento_retencion: solo el asesor dueño puede registrar documentos de retención",
    });
    assert.match(err.message, /No tienes permiso/i);
  });
});
