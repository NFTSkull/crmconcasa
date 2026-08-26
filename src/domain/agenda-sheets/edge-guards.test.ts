import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  normalizeSheetNss,
  parseSheetTabDate,
  parseSheetTime,
} from "./parsers";
import {
  TECH_SOURCE_EXPLICIT_OU,
  assertTechColumnsWritable,
  isPreserveOnlyColumn1Based,
  isTechColumn1Based,
} from "./tech-columns";

describe("agenda-sheets edge-like guards", () => {
  it("rechaza spreadsheet tab inválida antes de RPC", () => {
    assert.equal(parseSheetTabDate("NO DATE", 2026).ok, false);
  });
  it("NSS canónico conserva ceros", () => {
    const n = normalizeSheetNss("'03179461821");
    assert.equal(n.ok, true);
    if (n.ok) assert.equal(n.value, "03179461821");
  });
  it("hora canónica HH:mm", () => {
    const t = parseSheetTime("8:30AM");
    assert.equal(t.ok, true);
    if (t.ok) assert.equal(t.value, "08:30");
  });
  it("update técnico O:U: mismo booking idempotente; otro booking conflicto", () => {
    const same = assertTechColumnsWritable({
      existingRowOrTech: ["SINCRONIZADO", "b1", "e", "k", "sheets", "t", "1"],
      bookingId: "b1",
      source: TECH_SOURCE_EXPLICIT_OU,
    });
    assert.equal(same.ok, true);
    if (same.ok) assert.equal(same.mode, "idempotent");
    const other = assertTechColumnsWritable({
      existingRowOrTech: ["SINCRONIZADO", "b2", "e", "k", "sheets", "t", "1"],
      bookingId: "b1",
      source: TECH_SOURCE_EXPLICIT_OU,
    });
    assert.equal(other.ok, false);
  });
  it("Apps Script ignora O:U (cols 15-21) y preserva H:N (8-14)", () => {
    assert.equal(isTechColumn1Based(15), true);
    assert.equal(isTechColumn1Based(16), true); // P booking
    assert.equal(isPreserveOnlyColumn1Based(8), true);
    assert.equal(isPreserveOnlyColumn1Based(9), true);
  });

  it("21. webhook autentica secreto y marca ocupación manual", () => {
    const src = readFileSync(
      new URL(
        "../../../supabase/functions/agenda-sheet-webhook/index.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(src, /x-concasa-webhook-secret/);
    assert.match(src, /timingSafeEqual/);
    assert.match(src, /occupied_manual|occupied_external/);
    assert.match(src, /sheet_webhook/);
    assert.match(src, /MANUAL_ENTRY_WITHOUT_SLOT/);
    assert.match(src, /applyOperationalResult|upsertAndApplyOperationalResultRow/);
  });

  it("21b. reconcile aplica ops P170 tras proyección", () => {
    const src = readFileSync(
      new URL(
        "../../../supabase/functions/agenda-sheet-reconcile/index.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(src, /agenda_sheet_ops_upsert_batch/);
    assert.match(src, /applyOperationalResult/);
    assert.match(src, /apply_outcomes/);
  });

  it("22. live-sync refresca antes de availability/book_gate", () => {
    const src = readFileSync(
      new URL(
        "../../../supabase/functions/agenda-sheet-live-sync/index.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(src, /book_gate/);
    assert.match(src, /availability/);
    assert.match(src, /agenda_sheet_inventory_upsert_batch/);
    assert.match(src, /decideBookHardGate/);
  });

  it("22b. live-sync CORS: OPTIONS + ACAO en todas las respuestas", () => {
    const src = readFileSync(
      new URL(
        "../../../supabase/functions/agenda-sheet-live-sync/index.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(src, /req\.method === "OPTIONS"/);
    assert.match(src, /Access-Control-Allow-Origin/);
    assert.match(src, /authorization, x-client-info, apikey, content-type, x-supabase-api-version/);
    assert.match(src, /POST, OPTIONS/);
    assert.match(src, /liveSyncJsonOk/);
    assert.match(src, /liveSyncJsonError/);
    assert.match(src, /liveSyncCorsPreflight/);
    assert.doesNotMatch(
      readFileSync(
        new URL(
          "../../../supabase/functions/_shared/agenda-sheets/parsers.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      /Access-Control-Allow-Origin/,
    );
  });

  it("23. worker CRM→Sheet sigue presente (outbound)", () => {
    const src = readFileSync(
      new URL(
        "../../../supabase/functions/agenda-sheet-sync-worker/index.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(src, /outbox|booking_created|GOOGLE_SHEETS_SYNC_ENABLED/);
  });
});
