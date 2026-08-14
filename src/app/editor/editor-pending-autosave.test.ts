import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  createEditorPendingAutosave,
  isFocusLeavingEditorRow,
  isRelatedTargetInsideEditorRow,
  parseEditorPendingDraftPayload,
  shouldFinalizePendingRowBlur,
  tryPendingResolutionPayload,
} from "./editor-pending-autosave";
import { shouldSkipEditorFocusRefresh } from "@/domain/expedientes/editor-inbox-rpc";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("P186 pending autosave", () => {
  it("L/M/N) debounce latest; 12 no resuelve", async () => {
    const drafts: Array<{ monto: number | null; notas: string }> = [];
    const resolves: string[] = [];
    const latest: Record<string, { montoStr: string; notasStr: string }> = {
      e1: { montoStr: "1", notasStr: "" },
    };
    const machine = createEditorPendingAutosave({
      debounceMs: 20,
      getLatestValues: (id) => latest[id] ?? null,
      saveDraft: async (_id, monto, notas) => {
        drafts.push({ monto, notas });
      },
      resolveDecision: async () => {
        resolves.push("x");
      },
      onStatus: () => undefined,
    });
    machine.scheduleDraft("e1");
    latest.e1 = { montoStr: "12", notasStr: "" };
    machine.scheduleDraft("e1");
    latest.e1 = { montoStr: "120000", notasStr: "" };
    machine.scheduleDraft("e1");
    await wait(50);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.monto, 120000);
    assert.equal(resolves.length, 0);

    latest.e1 = { montoStr: "12", notasStr: "" };
    machine.scheduleDraft("e1");
    await wait(50);
    assert.equal(drafts.at(-1)?.monto, 12);
    assert.equal(resolves.length, 0);
  });

  it("O) relatedTarget en fila no sale; null no es salida automática", () => {
    const monto = { nodeType: 1 } as unknown as Node;
    const notas = { nodeType: 1 } as unknown as Node;
    const row = {
      contains: (n: Node) => n === monto || n === notas,
    };
    assert.equal(isRelatedTargetInsideEditorRow(row, monto), true);
    assert.equal(isFocusLeavingEditorRow(row, monto), false);
    assert.equal(isFocusLeavingEditorRow(row, null), false);
    const src = readFileSync(resolve("src/app/editor/page.tsx"), "utf8");
    assert.match(src, /handleRowBlur/);
    assert.doesNotMatch(src, /window\.addEventListener\("blur"/);
    assert.match(src, /visibilityState === "hidden"/);
    assert.match(src, /flushPendingDrafts/);
  });

  it("P/Q/R) blur: approved / no_cumple / vacío", async () => {
    const resolves: Array<{ decision: string; monto: number | null }> = [];
    const latest: Record<string, { montoStr: string; notasStr: string }> = {
      e1: { montoStr: "120000", notasStr: "" },
    };
    const machine = createEditorPendingAutosave({
      debounceMs: 5,
      getLatestValues: (id) => latest[id] ?? null,
      saveDraft: async () => undefined,
      resolveDecision: async (_id, payload) => {
        resolves.push({
          decision: payload.decision,
          monto: payload.monto_aprobado,
        });
      },
      onStatus: () => undefined,
    });
    await machine.finalizeRow("e1");
    assert.equal(resolves.length, 1);
    assert.equal(resolves[0]?.decision, "aprobado");
    assert.equal(resolves[0]?.monto, 120000);

    latest.e1 = { montoStr: "", notasStr: "NO CUMPLE CRITERIO ACTUAL" };
    await machine.finalizeRow("e1");
    assert.equal(resolves.at(-1)?.decision, "no_cumple");

    latest.e1 = { montoStr: "", notasStr: "" };
    const before = resolves.length;
    await machine.finalizeRow("e1");
    assert.equal(resolves.length, before);
  });

  it("S) doble blur → 1 resolve", async () => {
    let resolves = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const machine = createEditorPendingAutosave({
      debounceMs: 5,
      getLatestValues: () => ({ montoStr: "120000", notasStr: "" }),
      saveDraft: async () => undefined,
      resolveDecision: async () => {
        resolves += 1;
        await gate;
      },
      onStatus: () => undefined,
    });
    const a = machine.finalizeRow("e1");
    const b = machine.finalizeRow("e1");
    await wait(10);
    release();
    await Promise.all([a, b]);
    assert.equal(resolves, 1);
  });

  it("T) draft in-flight termina antes de resolve", async () => {
    const order: string[] = [];
    let releaseDraft!: () => void;
    const draftGate = new Promise<void>((r) => {
      releaseDraft = r;
    });
    const latest = { e1: { montoStr: "120000", notasStr: "" } };
    const machine = createEditorPendingAutosave({
      debounceMs: 5,
      getLatestValues: () => latest.e1,
      saveDraft: async () => {
        order.push("draft-start");
        await draftGate;
        order.push("draft-end");
      },
      resolveDecision: async () => {
        order.push("resolve");
      },
      onStatus: () => undefined,
    });
    machine.scheduleDraft("e1");
    await wait(10);
    const fin = machine.finalizeRow("e1");
    await wait(5);
    assert.ok(!order.includes("resolve"));
    releaseDraft();
    await fin;
    assert.deepEqual(order, [
      "draft-start",
      "draft-end",
      "draft-start",
      "draft-end",
      "resolve",
    ]);
  });

  it("U) draft failure no resuelve", async () => {
    let resolves = 0;
    const machine = createEditorPendingAutosave({
      debounceMs: 5,
      getLatestValues: () => ({ montoStr: "120000", notasStr: "" }),
      saveDraft: async () => {
        throw new Error("boom draft");
      },
      resolveDecision: async () => {
        resolves += 1;
      },
      onStatus: () => undefined,
    });
    await machine.finalizeRow("e1");
    assert.equal(resolves, 0);
  });

  it("parse draft / resolution helpers", () => {
    assert.deepEqual(parseEditorPendingDraftPayload("12", "x"), {
      monto: 12,
      notas: "x",
    });
    assert.equal(tryPendingResolutionPayload("", ""), null);
    assert.equal(tryPendingResolutionPayload("120000", "")?.decision, "aprobado");
  });
});

describe("P186 editor focus refresh", () => {
  it("X/Z/AA) throttle 8s y skip con trabajo local", () => {
    assert.equal(
      shouldSkipEditorFocusRefresh({
        now: 10_000,
        lastRefreshAt: 9_000,
        minMs: 8_000,
        hasLocalWork: false,
      }),
      true,
    );
    assert.equal(
      shouldSkipEditorFocusRefresh({
        now: 20_000,
        lastRefreshAt: 9_000,
        minMs: 8_000,
        hasLocalWork: false,
      }),
      false,
    );
    assert.equal(
      shouldSkipEditorFocusRefresh({
        now: 20_000,
        lastRefreshAt: 9_000,
        minMs: 8_000,
        hasLocalWork: true,
      }),
      true,
    );
  });
});

function fakeNode(): Node {
  return { nodeType: 1 } as unknown as Node;
}

describe("P186 B1B.1 blur/focus hardening", () => {
  it("shouldFinalize: relatedTarget en fila / hidden / !hasFocus", () => {
    const inside = fakeNode();
    const outside = fakeNode();
    const rowContains = (n: Node) => n === inside;
    assert.equal(
      shouldFinalizePendingRowBlur({
        rowContains,
        relatedTarget: inside,
        visibilityState: "visible",
        documentHasFocus: true,
        activeElement: inside,
      }),
      false,
    );
    assert.equal(
      shouldFinalizePendingRowBlur({
        rowContains,
        relatedTarget: outside,
        visibilityState: "visible",
        documentHasFocus: true,
        activeElement: outside,
      }),
      true,
    );
    assert.equal(
      shouldFinalizePendingRowBlur({
        rowContains,
        relatedTarget: outside,
        visibilityState: "hidden",
        documentHasFocus: true,
        activeElement: outside,
      }),
      false,
    );
    assert.equal(
      shouldFinalizePendingRowBlur({
        rowContains,
        relatedTarget: null,
        visibilityState: "visible",
        documentHasFocus: false,
        activeElement: null,
      }),
      false,
    );
    assert.equal(
      shouldFinalizePendingRowBlur({
        rowContains,
        relatedTarget: null,
        visibilityState: "visible",
        documentHasFocus: true,
        activeElement: outside,
      }),
      true,
    );
    assert.equal(
      shouldFinalizePendingRowBlur({
        rowContains,
        relatedTarget: null,
        visibilityState: "visible",
        documentHasFocus: true,
        activeElement: inside,
      }),
      false,
    );
  });

  it("11) monto parcial 12 + window blur: draft 12, 0 resolve", async () => {
    const drafts: Array<number | null> = [];
    const resolves: string[] = [];
    const latest = { e1: { montoStr: "1", notasStr: "" } };
    let documentHasFocus = true;
    let visibilityState = "visible";
    const monto = fakeNode();
    const row = { contains: (n: Node) => n === monto };
    const machine = createEditorPendingAutosave({
      debounceMs: 20,
      getLatestValues: (id) => latest[id as "e1"] ?? null,
      saveDraft: async (_id, montoVal) => {
        drafts.push(montoVal);
      },
      resolveDecision: async () => {
        resolves.push("x");
      },
      onStatus: () => undefined,
      waitForFocusSettle: () => Promise.resolve(),
      getDocumentFocus: () => ({
        visibilityState,
        documentHasFocus,
        activeElement: null,
      }),
    });
    machine.scheduleDraft("e1");
    latest.e1 = { montoStr: "12", notasStr: "" };
    machine.scheduleDraft("e1");
    await wait(50);
    assert.equal(drafts.at(-1), 12);
    assert.equal(resolves.length, 0);

    documentHasFocus = false;
    visibilityState = "hidden";
    await machine.handleRowBlur({
      expedienteId: "e1",
      rowEl: row,
      relatedTarget: null,
    });
    assert.equal(resolves.length, 0);
    assert.equal(machine.hasLocalWork(), true);
  });

  it("12) volver y continuar 120000 + blur interno: 1 approved", async () => {
    const drafts: Array<number | null> = [];
    const resolves: Array<{ decision: string; monto: number | null }> = [];
    const latest = { e1: { montoStr: "12", notasStr: "" } };
    let documentHasFocus = false;
    let visibilityState = "hidden";
    const monto = fakeNode();
    const outside = fakeNode();
    const row = { contains: (n: Node) => n === monto };
    const machine = createEditorPendingAutosave({
      debounceMs: 20,
      getLatestValues: (id) => latest[id as "e1"] ?? null,
      saveDraft: async (_id, montoVal) => {
        drafts.push(montoVal);
      },
      resolveDecision: async (_id, payload) => {
        resolves.push({
          decision: payload.decision,
          monto: payload.monto_aprobado,
        });
      },
      onStatus: () => undefined,
      waitForFocusSettle: () => Promise.resolve(),
      getDocumentFocus: () => ({
        visibilityState,
        documentHasFocus,
        activeElement: outside,
      }),
    });
    await machine.handleRowBlur({
      expedienteId: "e1",
      rowEl: row,
      relatedTarget: null,
    });
    assert.equal(resolves.length, 0);

    documentHasFocus = true;
    visibilityState = "visible";
    latest.e1 = { montoStr: "120000", notasStr: "" };
    machine.scheduleDraft("e1");
    await wait(50);
    assert.equal(drafts.at(-1), 120000);

    await machine.handleRowBlur({
      expedienteId: "e1",
      rowEl: row,
      relatedTarget: outside,
    });
    assert.equal(resolves.length, 1);
    assert.equal(resolves[0]?.decision, "aprobado");
    assert.equal(resolves[0]?.monto, 120000);
  });

  it("13) notas + blur externo 0 resolve; salir de fila → no_cumple", async () => {
    const resolves: string[] = [];
    const latest = {
      e1: { montoStr: "", notasStr: "NO CUMPLE CRITERIO NUEVO" },
    };
    let documentHasFocus = true;
    let visibilityState = "visible";
    const notas = fakeNode();
    const outside = fakeNode();
    const row = { contains: (n: Node) => n === notas };
    const machine = createEditorPendingAutosave({
      debounceMs: 20,
      getLatestValues: (id) => latest[id as "e1"] ?? null,
      saveDraft: async () => undefined,
      resolveDecision: async (_id, payload) => {
        resolves.push(payload.decision);
      },
      onStatus: () => undefined,
      waitForFocusSettle: () => Promise.resolve(),
      getDocumentFocus: () => ({
        visibilityState,
        documentHasFocus,
        activeElement: null,
      }),
    });
    machine.scheduleDraft("e1");
    await wait(50);
    documentHasFocus = false;
    visibilityState = "hidden";
    await machine.handleRowBlur({
      expedienteId: "e1",
      rowEl: row,
      relatedTarget: null,
    });
    assert.equal(resolves.length, 0);

    documentHasFocus = true;
    visibilityState = "visible";
    await machine.handleRowBlur({
      expedienteId: "e1",
      rowEl: row,
      relatedTarget: outside,
    });
    assert.equal(resolves.length, 1);
    assert.equal(resolves[0], "no_cumple");
  });

  it("14) relatedTarget null interno + activeElement fuera → finalize", async () => {
    const resolves: number[] = [];
    const outside = fakeNode();
    const inside = fakeNode();
    const row = { contains: (n: Node) => n === inside };
    const machine = createEditorPendingAutosave({
      debounceMs: 5,
      getLatestValues: () => ({ montoStr: "120000", notasStr: "" }),
      saveDraft: async () => undefined,
      resolveDecision: async () => {
        resolves.push(1);
      },
      onStatus: () => undefined,
      waitForFocusSettle: () => Promise.resolve(),
      getDocumentFocus: () => ({
        visibilityState: "visible",
        documentHasFocus: true,
        activeElement: outside,
      }),
    });
    await machine.handleRowBlur({
      expedienteId: "e1",
      rowEl: row,
      relatedTarget: null,
    });
    assert.equal(resolves.length, 1);
  });

  it("15) Monto → Notas 0 resolve; Tab fuera 1 resolve", async () => {
    const resolves: number[] = [];
    const monto = fakeNode();
    const notas = fakeNode();
    const outside = fakeNode();
    const row = { contains: (n: Node) => n === monto || n === notas };
    const machine = createEditorPendingAutosave({
      debounceMs: 5,
      getLatestValues: () => ({ montoStr: "120000", notasStr: "" }),
      saveDraft: async () => undefined,
      resolveDecision: async () => {
        resolves.push(1);
      },
      onStatus: () => undefined,
      waitForFocusSettle: () => Promise.resolve(),
      getDocumentFocus: () => ({
        visibilityState: "visible",
        documentHasFocus: true,
        activeElement: notas,
      }),
    });
    await machine.handleRowBlur({
      expedienteId: "e1",
      rowEl: row,
      relatedTarget: notas,
    });
    assert.equal(resolves.length, 0);
    await machine.handleRowBlur({
      expedienteId: "e1",
      rowEl: row,
      relatedTarget: outside,
    });
    assert.equal(resolves.length, 1);
  });

  it("visibility hidden flush: draft sí, resolve no", async () => {
    const drafts: Array<number | null> = [];
    let resolves = 0;
    const latest = { e1: { montoStr: "12", notasStr: "" } };
    const machine = createEditorPendingAutosave({
      debounceMs: 500,
      getLatestValues: (id) => latest[id as "e1"] ?? null,
      saveDraft: async (_id, montoVal) => {
        drafts.push(montoVal);
      },
      resolveDecision: async () => {
        resolves += 1;
      },
      onStatus: () => undefined,
    });
    machine.scheduleDraft("e1");
    machine.flushPendingDrafts();
    await wait(30);
    assert.equal(drafts.at(-1), 12);
    assert.equal(resolves, 0);
  });
});
