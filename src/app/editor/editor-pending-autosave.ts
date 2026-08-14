import { parseMontoAprobado } from "@/lib/monto";
import {
  buildReprecalResolutionPayload,
  createEditorReprecalSaveGuard,
  type RowSaveState,
} from "./editor-decision";
import type { EditorDecision } from "@/domain/expedientes";

export const EDITOR_PENDING_DRAFT_DEBOUNCE_MS = 750;

export type EditorRowContainsEl = { contains: (node: Node) => boolean };

export type EditorDocumentFocusSnapshot = {
  visibilityState: string;
  documentHasFocus: boolean;
  activeElement: EventTarget | Node | null;
};

function isLikelyDomNode(value: EventTarget | Node | null): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    typeof (value as Node).nodeType === "number"
  );
}

export function isEditorAppDocumentActive(
  snapshot: Pick<
    EditorDocumentFocusSnapshot,
    "visibilityState" | "documentHasFocus"
  >,
): boolean {
  return (
    snapshot.visibilityState === "visible" && snapshot.documentHasFocus === true
  );
}

/** relatedTarget dentro del mismo <tr> → no es salida de fila. null no cuenta como salida. */
export function isRelatedTargetInsideEditorRow(
  rowEl: EditorRowContainsEl | null,
  relatedTarget: EventTarget | null,
): boolean {
  if (!rowEl || !isLikelyDomNode(relatedTarget)) return false;
  return rowEl.contains(relatedTarget);
}

export function isFocusLeavingEditorRow(
  rowEl: EditorRowContainsEl | null,
  relatedTarget: EventTarget | null,
): boolean {
  if (!rowEl || !isLikelyDomNode(relatedTarget)) return false;
  return !rowEl.contains(relatedTarget);
}

/**
 * Decisión síncrona con snapshot ya conocido (tras settle si relatedTarget era null).
 * Pérdida de foco externa (hidden / !hasFocus) → nunca resolve.
 */
export function shouldFinalizePendingRowBlur(input: {
  rowContains: (node: Node) => boolean;
  relatedTarget: EventTarget | null;
  visibilityState: string;
  documentHasFocus: boolean;
  activeElement: EventTarget | Node | null;
}): boolean {
  if (
    !isEditorAppDocumentActive({
      visibilityState: input.visibilityState,
      documentHasFocus: input.documentHasFocus,
    })
  ) {
    return false;
  }
  if (isLikelyDomNode(input.relatedTarget)) {
    return !input.rowContains(input.relatedTarget);
  }
  const active = input.activeElement;
  if (isLikelyDomNode(active) && input.rowContains(active)) {
    return false;
  }
  return true;
}

export function defaultGetEditorDocumentFocus(): EditorDocumentFocusSnapshot {
  if (typeof document === "undefined") {
    return {
      visibilityState: "visible",
      documentHasFocus: true,
      activeElement: null,
    };
  }
  return {
    visibilityState: document.visibilityState,
    documentHasFocus:
      typeof document.hasFocus === "function" ? document.hasFocus() : true,
    activeElement: document.activeElement,
  };
}

export function defaultWaitForEditorFocusSettle(): Promise<void> {
  return new Promise((resolveSettle) => {
    queueMicrotask(() => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => resolveSettle());
        return;
      }
      resolveSettle();
    });
  });
}

export function parseEditorPendingDraftPayload(
  montoStr: string,
  notasStr: string,
): { monto: number | null; notas: string } {
  const trimmed = (montoStr ?? "").trim();
  const num = trimmed === "" ? null : parseMontoAprobado(trimmed);
  if (trimmed !== "" && num === null) {
    throw new Error("Formato de monto aprobado inválido.");
  }
  if (num !== null && num < 0) {
    throw new Error("El monto aprobado no puede ser negativo.");
  }
  return { monto: num, notas: notasStr ?? "" };
}

export function tryPendingResolutionPayload(
  montoStr: string,
  notasStr: string,
): {
  decision: EditorDecision;
  monto_aprobado: number | null;
  notas_revision: string;
} | null {
  try {
    return buildReprecalResolutionPayload(montoStr, notasStr);
  } catch {
    return null;
  }
}

function createSerialQueue() {
  const tails = new Map<string, Promise<void>>();
  return {
    enqueue(id: string, task: () => Promise<void>): Promise<void> {
      const prev = tails.get(id) ?? Promise.resolve();
      const next = prev.then(task);
      tails.set(
        id,
        next.then(
          () => undefined,
          () => undefined,
        ),
      );
      return next;
    },
  };
}

export function createEditorPendingAutosave(opts: {
  debounceMs?: number;
  saveDraft: (
    expedienteId: string,
    monto: number | null,
    notas: string,
  ) => Promise<void>;
  resolveDecision: (
    expedienteId: string,
    payload: {
      decision: EditorDecision;
      monto_aprobado: number | null;
      notas_revision: string;
    },
  ) => Promise<void>;
  getLatestValues: (
    expedienteId: string,
  ) => { montoStr: string; notasStr: string } | null;
  onStatus: (expedienteId: string, state: RowSaveState) => void;
  onResolved?: (
    expedienteId: string,
    payload: {
      decision: EditorDecision;
      monto_aprobado: number | null;
      notas_revision: string;
    },
  ) => void;
  shouldAbort?: () => boolean;
  getDocumentFocus?: () => EditorDocumentFocusSnapshot;
  waitForFocusSettle?: () => Promise<void>;
}): {
  scheduleDraft: (expedienteId: string) => void;
  finalizeRow: (expedienteId: string) => Promise<void>;
  handleRowBlur: (args: {
    expedienteId: string;
    rowEl: EditorRowContainsEl;
    relatedTarget: EventTarget | null;
  }) => Promise<void>;
  flushPendingDrafts: () => void;
  cancel: (expedienteId: string) => void;
  hasLocalWork: () => boolean;
  inFlightDraftCount: () => number;
} {
  const debounceMs = opts.debounceMs ?? EDITOR_PENDING_DRAFT_DEBOUNCE_MS;
  const getDocumentFocus =
    opts.getDocumentFocus ?? defaultGetEditorDocumentFocus;
  const waitForFocusSettle =
    opts.waitForFocusSettle ?? defaultWaitForEditorFocusSettle;
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};
  const queue = createSerialQueue();
  const resolveGuard = createEditorReprecalSaveGuard();
  const dirtyIds = new Set<string>();
  let draftInFlight = 0;
  let resolveInFlight = 0;

  const persistLatestDraft = async (expedienteId: string) => {
    if (opts.shouldAbort?.()) return;
    const latest = opts.getLatestValues(expedienteId);
    if (!latest) return;
    const parsed = parseEditorPendingDraftPayload(
      latest.montoStr,
      latest.notasStr,
    );
    opts.onStatus(expedienteId, { status: "saving" });
    draftInFlight += 1;
    try {
      await opts.saveDraft(expedienteId, parsed.monto, parsed.notas);
      if (opts.shouldAbort?.()) return;
      opts.onStatus(expedienteId, { status: "saved" });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Error al guardar el borrador.";
      opts.onStatus(expedienteId, { status: "error", error: msg });
      throw err;
    } finally {
      draftInFlight -= 1;
    }
  };

  const finalizeRow = async (expedienteId: string) => {
    const existing = timers[expedienteId];
    if (existing) {
      clearTimeout(existing);
      delete timers[expedienteId];
    }
    if (!resolveGuard.tryBegin(expedienteId)) return;
    resolveInFlight += 1;
    try {
      await queue.enqueue(expedienteId, () => persistLatestDraft(expedienteId));
      if (opts.shouldAbort?.()) return;
      const latest = opts.getLatestValues(expedienteId);
      if (!latest) return;
      const payload = tryPendingResolutionPayload(
        latest.montoStr,
        latest.notasStr,
      );
      if (!payload) return;
      opts.onStatus(expedienteId, { status: "saving" });
      await opts.resolveDecision(expedienteId, payload);
      if (opts.shouldAbort?.()) return;
      opts.onResolved?.(expedienteId, payload);
      dirtyIds.delete(expedienteId);
      opts.onStatus(expedienteId, { status: "saved" });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Error al guardar la decisión.";
      opts.onStatus(expedienteId, { status: "error", error: msg });
    } finally {
      resolveGuard.end(expedienteId);
      resolveInFlight -= 1;
    }
  };

  return {
    scheduleDraft(expedienteId: string) {
      dirtyIds.add(expedienteId);
      const existing = timers[expedienteId];
      if (existing) clearTimeout(existing);
      opts.onStatus(expedienteId, { status: "pending" });
      timers[expedienteId] = setTimeout(() => {
        delete timers[expedienteId];
        void queue.enqueue(expedienteId, () => persistLatestDraft(expedienteId));
      }, debounceMs);
    },
    finalizeRow,
    async handleRowBlur(args: {
      expedienteId: string;
      rowEl: EditorRowContainsEl;
      relatedTarget: EventTarget | null;
    }) {
      const rowContains = (node: Node) => args.rowEl.contains(node);
      if (isLikelyDomNode(args.relatedTarget)) {
        if (rowContains(args.relatedTarget)) return;
        const snap = getDocumentFocus();
        if (
          !shouldFinalizePendingRowBlur({
            rowContains,
            relatedTarget: args.relatedTarget,
            ...snap,
          })
        ) {
          return;
        }
        await finalizeRow(args.expedienteId);
        return;
      }
      await waitForFocusSettle();
      const snap = getDocumentFocus();
      if (
        !shouldFinalizePendingRowBlur({
          rowContains,
          relatedTarget: null,
          ...snap,
        })
      ) {
        return;
      }
      await finalizeRow(args.expedienteId);
    },
    flushPendingDrafts() {
      for (const expedienteId of Object.keys(timers)) {
        const existing = timers[expedienteId];
        if (existing) {
          clearTimeout(existing);
          delete timers[expedienteId];
        }
        void queue.enqueue(expedienteId, () => persistLatestDraft(expedienteId));
      }
    },
    cancel(expedienteId: string) {
      const existing = timers[expedienteId];
      if (existing) {
        clearTimeout(existing);
        delete timers[expedienteId];
      }
    },
    hasLocalWork() {
      return (
        Object.keys(timers).length > 0 ||
        draftInFlight > 0 ||
        resolveInFlight > 0 ||
        dirtyIds.size > 0
      );
    },
    inFlightDraftCount() {
      return draftInFlight;
    },
  };
}