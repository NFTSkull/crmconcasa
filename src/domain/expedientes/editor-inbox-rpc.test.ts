import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  EDITOR_INBOX_DEFAULT_PAGE_SIZE,
  EDITOR_INBOX_MAX_PAGE_SIZE,
  editorGuardarBorradorReprecalResultSchema,
  editorListExpedienteIdsPageInputSchema,
  editorListExpedienteIdsPageResultSchema,
  normalizeEditorInboxPageOptions,
} from "./editor-inbox-rpc";
import { editorPendingDraftFromIntento } from "./editor-reprecal-read-model";
import { EDITOR_LIST_PAGE_SIZE } from "./editor-list-query";

describe("editor-inbox-rpc contracts (P186 B1A)", () => {
  it("page size default 50 alineado a UI actual", () => {
    assert.equal(EDITOR_INBOX_DEFAULT_PAGE_SIZE, 50);
    assert.equal(EDITOR_LIST_PAGE_SIZE, 50);
    assert.equal(EDITOR_INBOX_MAX_PAGE_SIZE, 100);
    const n = normalizeEditorInboxPageOptions({});
    assert.equal(n.page, 1);
    assert.equal(n.page_size, 50);
    assert.equal(n.from, 0);
    assert.equal(n.to, 49);
  });

  it("página 2 size 50 usa rango 50–99", () => {
    const n = normalizeEditorInboxPageOptions({ page: 2, page_size: 50 });
    assert.equal(n.from, 50);
    assert.equal(n.to, 99);
  });

  it("input/result Zod de membership page", () => {
    const input = editorListExpedienteIdsPageInputSchema.parse({
      page: 1,
      page_size: 50,
      search: "maria",
    });
    assert.equal(input.search, "maria");
    const parsed = editorListExpedienteIdsPageResultSchema.parse({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          editor_activity_at: "2026-08-14T14:20:00.000Z",
        },
      ],
      total_count: 123,
      page: 1,
      page_size: 50,
    });
    assert.equal(parsed.total_count, 123);
    assert.equal(parsed.items.length, 1);
  });

  it("draft result exige decision pendiente", () => {
    const parsed = editorGuardarBorradorReprecalResultSchema.parse({
      ok: true,
      expediente_id: "00000000-0000-4000-8000-000000000001",
      intento_id: "00000000-0000-4000-8000-000000000002",
      decision: "pendiente",
      monto_aprobado: 12000,
      notas_revision: "",
    });
    assert.equal(parsed.decision, "pendiente");
  });

  it("SQL list: activity COALESCE pending.created_at, ORDER antes OFFSET, no updated_at", () => {
    const sql = readFileSync(
      resolve("supabase/migrations/181_editor_inbox_activity_reprecal_draft.sql"),
      "utf8",
    );
    assert.match(sql, /editor_list_expediente_ids_page/);
    assert.match(sql, /coalesce\(pend\.created_at, e\.created_at\)/);
    assert.match(sql, /ORDER BY r\.editor_activity_at DESC, r\.id DESC/);
    assert.match(sql, /OFFSET v_offset/);
    assert.doesNotMatch(sql, /ORDER BY[^;]*e\.updated_at/);
    assert.match(sql, /pend\.id = e\.reprecalificacion_pendiente_id/);
    assert.match(sql, /pend\.expediente_id = e\.id/);
    assert.match(sql, /GRANT EXECUTE[\s\S]*authenticated/);
  });

  it("SQL draft: solo monto/notas; no expedientes, decisions, resolver, action_log", () => {
    const sql = readFileSync(
      resolve("supabase/migrations/181_editor_inbox_activity_reprecal_draft.sql"),
      "utf8",
    );
    const draft = sql.slice(
      sql.indexOf(
        "CREATE OR REPLACE FUNCTION public.editor_guardar_borrador_reprecalificacion",
      ),
      sql.indexOf(
        "COMMENT ON FUNCTION public.editor_guardar_borrador_reprecalificacion",
      ),
    );
    assert.match(draft, /SET monto_aprobado = v_monto/);
    assert.match(draft, /notas_revision = v_notas/);
    assert.doesNotMatch(draft, /UPDATE public\.expedientes/);
    assert.doesNotMatch(draft, /INSERT INTO public\.editor_decisions/);
    assert.doesNotMatch(draft, /UPDATE public\.editor_decisions/);
    assert.doesNotMatch(draft, /editor_resolver_reprecalificacion/);
    assert.doesNotMatch(draft, /INSERT INTO public\.action_log/);
  });
});

describe("P186 draft restore vs P185 pending limpio", () => {
  it("pending + draft NULL/'' → form vacío", () => {
    const d = editorPendingDraftFromIntento("int-1", {
      id: "int-1",
      decision: "pendiente",
      monto_aprobado: null,
      notas_revision: "",
    });
    assert.equal(d.monto, null);
    assert.equal(d.notas, "");
  });

  it("pending + draft existente → restaurar", () => {
    const d = editorPendingDraftFromIntento("int-1", {
      id: "int-1",
      decision: "pendiente",
      monto_aprobado: 12000,
      notas_revision: "borrador",
    });
    assert.equal(d.monto, 12000);
    assert.equal(d.notas, "borrador");
  });

  it("P185 pending limpio no hereda editorDecision (draft restore B1B)", () => {
    const src = readFileSync(
      resolve("src/domain/expedientes/editor-reprecal-read-model.ts"),
      "utf8",
    );
    assert.match(src, /editorPendingDraftFromIntento/);
    assert.match(src, /decision: "pendiente"/);
    assert.doesNotMatch(
      src,
      /pendingId[\s\S]{0,200}exp\.editorDecision\.monto_aprobado/,
    );
  });
});
