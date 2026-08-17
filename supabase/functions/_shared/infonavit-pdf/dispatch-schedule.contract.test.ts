/**
 * P189 B4.1 — contrato estático del scheduler (migration 186).
 * No lee Vault values. No HTTP. No Cloud.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");

function sha256File(rel: string): string {
  const buf = readFileSync(join(ROOT, rel));
  return createHash("sha256").update(buf).digest("hex");
}

function readMig(name: string): string {
  return readFileSync(join(ROOT, "supabase/migrations", name), "utf8");
}

describe("P189 B4.1 dispatch schedule contract", () => {
  it("183/185 intactas; 184 B7 SHA deliberado", () => {
    assert.equal(
      sha256File("supabase/migrations/183_cliente_datos_telefonos_unicos.sql"),
      "94258a2980e1ae8a89d0b60e0522d47f0753764c50331c3ae43a69b0e2b998ef",
    );
    assert.equal(
      sha256File("supabase/migrations/184_infonavit_submission_snapshot_outbox.sql"),
      "879754726aa6a771e3671cd11e07990e404abfa6a39b80322895484a85c11d0b",
    );
    assert.equal(
      sha256File("supabase/migrations/185_infonavit_pdf_worker_contract.sql"),
      "511f8a74029395ec46e61edc1c5dcec66391ea1d639208218db233a62a495113",
    );
  });

  it("186: job/helper/Vault P189 independientes y fail-closed", () => {
    const sql = readMig("186_infonavit_pdf_worker_schedule.sql");
    const executable = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    assert.match(sql, /infonavit_pdf_dispatch_worker/);
    assert.match(sql, /infonavit-pdf-worker-dispatch/);
    assert.match(sql, /'\* \* \* \* \*'/);
    assert.match(sql, /infonavit_pdf_worker_url/);
    assert.match(sql, /infonavit_pdf_worker_secret/);
    assert.match(sql, /x-concasa-worker-secret/);
    assert.match(sql, /body := '\{\}'::jsonb/);
    assert.match(sql, /timeout_milliseconds := 25000/);
    assert.match(sql, /missing_configuration/);
    assert.match(sql, /no_work/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.infonavit_pdf_dispatch_worker\(\) FROM authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.infonavit_pdf_dispatch_worker\(\) TO service_role/);
    assert.doesNotMatch(executable, /vault\.create_secret/);
    assert.doesNotMatch(executable, /agenda_sheet_sync_outbox/);
    assert.doesNotMatch(executable, /agenda-sheet-live-sync/);
    assert.doesNotMatch(executable, /agenda_sheet_worker_secret/);
    assert.doesNotMatch(executable, /agenda-sheet-availability-refresh-every-2h/);
    assert.doesNotMatch(executable, /eyJ/);
    assert.doesNotMatch(executable, /GOOGLE_SHEETS/);
    assert.doesNotMatch(executable, /fvtqbxukqlajezyyvwzy/);
    assert.doesNotMatch(executable, /enviar_a_mesa/);
    assert.doesNotMatch(executable, /infonavit_pdf_claim_outbox/);
  });
});
