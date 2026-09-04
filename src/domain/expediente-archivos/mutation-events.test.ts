import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("P223 — refresh causal tras mutaciones documentales", () => {
  const helper = readFileSync(
    join(process.cwd(), "src/domain/expediente-archivos/mutation-events.ts"),
    "utf8",
  );
  const index = readFileSync(
    join(process.cwd(), "src/domain/expediente-archivos/index.ts"),
    "utf8",
  );

  it("emite evento documental y refresh del expediente solo después de éxito", () => {
    assert.match(helper, /EXPEDIENTE_ARCHIVOS_UPDATED_EVENT = "expediente_archivos_updated"/);
    assert.match(helper, /EXPEDIENTE_CORRECCION_REFRESH_EVENT = "mesa_control_inbox_updated"/);
    assert.match(
      helper,
      /await repo\.correctArchivoRechazado\(params\);\s*notifyMutation\(params\.expedienteId\);/s,
    );
    assert.match(
      helper,
      /await repo\.replaceArchivo\(params\);\s*notifyMutation\(params\.expedienteId\);/s,
    );
  });

  it("el repo Supabase usado por la UI queda decorado con los eventos", () => {
    assert.match(index, /withExpedienteArchivoMutationEvents/);
    assert.match(
      index,
      /return withExpedienteArchivoMutationEvents\(\s*new SupabaseExpedienteArchivosRepo\(\),\s*\);/s,
    );
  });
});
