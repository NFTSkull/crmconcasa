import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  EDITOR_LIST_PAGE_INCOMPLETE_MSG,
  editorListExpedienteIdsPageResultSchema,
  reorderEditorRowsByRpcIds,
} from "./editor-inbox-rpc";

describe("P186 editor list RPC wiring", () => {
  it("A) reconstruye orden del RPC aunque SELECT llegue desordenado", () => {
    const ordered = reorderEditorRowsByRpcIds(
      ["idC", "idA", "idB"],
      [{ id: "idA" }, { id: "idB" }, { id: "idC" }],
    );
    assert.deepEqual(
      ordered.map((r) => r.id),
      ["idC", "idA", "idB"],
    );
  });

  it("B) 50 ids → 50 filas en el mismo orden", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `id-${String(i).padStart(2, "0")}`);
    const shuffled = [...ids].reverse().map((id) => ({ id }));
    const ordered = reorderEditorRowsByRpcIds(ids, shuffled);
    assert.equal(ordered.length, 50);
    assert.deepEqual(
      ordered.map((r) => r.id),
      ids,
    );
  });

  it("C) fila faltante → error seguro", () => {
    assert.throws(
      () => reorderEditorRowsByRpcIds(["a", "b"], [{ id: "a" }]),
      (err: unknown) =>
        err instanceof Error &&
        err.message === EDITOR_LIST_PAGE_INCOMPLETE_MSG,
    );
  });

  it("D/E) schema 0 ids conserva total_count", () => {
    const parsed = editorListExpedienteIdsPageResultSchema.parse({
      items: [],
      total_count: 0,
      page: 1,
      page_size: 50,
    });
    assert.equal(parsed.items.length, 0);
    assert.equal(parsed.total_count, 0);
  });

  it("F/G) fetchEditor usa RPC search y no order updated_at", () => {
    const src = readFileSync(
      resolve("src/domain/expedientes/supabase.repo.ts"),
      "utf8",
    );
    const fnStart = src.indexOf("async function fetchExpedientesListForEditor");
    const fnEnd = src.indexOf(
      "async function fetchEditorReprecalSidecarBundle",
      fnStart,
    );
    const fn = src.slice(fnStart, fnEnd);
    assert.match(fn, /editor_list_expediente_ids_page/);
    assert.match(fn, /p_search/);
    assert.match(fn, /reorderEditorRowsByRpcIds/);
    assert.doesNotMatch(fn, /\.order\(["']updated_at["']/);
    assert.doesNotMatch(fn, /\.or\(/);
    assert.match(fn, /orderedIds\.length === 0/);
  });
});
