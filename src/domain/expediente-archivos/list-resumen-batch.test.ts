import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunkExpedienteIds,
  groupResumenByExpedienteId,
  LIST_RESUMEN_BATCH_CHUNK_SIZE,
  normalizeExpedienteIdsForBatch,
} from "./list-resumen-batch";
import type { ExpedienteArchivoResumen } from "./types";

describe("list-resumen-batch helpers", () => {
  it("normaliza ids únicos y vacíos", () => {
    assert.deepEqual(normalizeExpedienteIdsForBatch([" a ", "", "a", "b"]), ["a", "b"]);
    assert.deepEqual(normalizeExpedienteIdsForBatch([]), []);
  });

  it("chunk respeta tamaño fijo", () => {
    const ids = Array.from({ length: 45 }, (_, i) => `id-${i}`);
    const chunks = chunkExpedienteIds(ids, LIST_RESUMEN_BATCH_CHUNK_SIZE);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0]?.length, LIST_RESUMEN_BATCH_CHUNK_SIZE);
    assert.equal(chunks[1]?.length, 5);
  });

  it("groupResumenByExpedienteId agrupa sin mutar semántica", () => {
    const rows: ExpedienteArchivoResumen[] = [
      {
        expediente_id: "e1",
        tipo_documento: "ine",
        id: "1",
        nombre_original: "a.pdf",
        mime_type: "application/pdf",
        size_bytes: 1,
        created_at: "t",
        uploaded_by_role: "asesor",
        uploaded_by_email: "a@b.c",
        estatus_revision: "subido",
        comentario_mesa: null,
      },
      {
        expediente_id: "e2",
        tipo_documento: "nss",
        id: "2",
        nombre_original: "b.pdf",
        mime_type: "application/pdf",
        size_bytes: 1,
        created_at: "t",
        uploaded_by_role: "asesor",
        uploaded_by_email: "a@b.c",
        estatus_revision: "validado",
        comentario_mesa: null,
      },
    ];
    const grouped = groupResumenByExpedienteId(rows);
    assert.equal(grouped.e1?.length, 1);
    assert.equal(grouped.e2?.[0]?.tipo_documento, "nss");
  });
});
