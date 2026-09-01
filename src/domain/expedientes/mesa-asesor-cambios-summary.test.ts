import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mesaAsesorCambiosSummaryError,
  mesaAsesorCambiosSummarySuccess,
} from "./mesa-asesor-cambios";

describe("mesa-asesor-cambios summary result P207.4", () => {
  it("SUCCESS_EMPTY ≠ RPC_ERROR", () => {
    const empty = mesaAsesorCambiosSummarySuccess(new Map());
    const rpcError = mesaAsesorCambiosSummaryError("rpc");
    assert.equal(empty.status, "success");
    assert.equal(empty.items.size, 0);
    assert.equal(rpcError.status, "error");
    assert.equal(rpcError.errorReason, "rpc");
  });

  it("SUCCESS_WITH_DATA conserva items", () => {
    const item = {
      expedienteId: "54fca03f-c834-4fcb-acf7-8324f4183968",
      batchId: "a8348100-28ec-419e-bd0e-bdfdde211a39",
      status: "pendiente_revision" as const,
      submittedAt: "2026-08-12T21:27:15.983Z",
      changesCount: 1,
      summary: ["Estado de cuenta reemplazado"],
      previewChanges: [],
      historyConfidence: null,
      historySource: null,
      historyNote: null,
    };
    const result = mesaAsesorCambiosSummarySuccess(
      new Map([[item.expedienteId, item]]),
    );
    assert.equal(result.status, "success");
    assert.equal(result.items.get(item.expedienteId)?.summary[0], item.summary[0]);
  });

  it("PARSE_ERROR es distinguible de SUCCESS_EMPTY", () => {
    const parseError = mesaAsesorCambiosSummaryError("parse");
    const empty = mesaAsesorCambiosSummarySuccess(new Map());
    assert.notEqual(parseError.status, empty.status);
    assert.equal(parseError.errorReason, "parse");
  });
});
