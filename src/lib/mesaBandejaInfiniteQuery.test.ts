import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendMesaBandejaItemsUnique } from "@/domain/expedientes";
import {
  beginMesaBandejaAppend,
  beginMesaBandejaFirstPage,
  canAppendMesaBandejaPage,
  invalidateMesaBandejaPagination,
  mergeMesaBandejaAppendClamped,
  mesaBandejaAttemptIsCurrent,
  mesaBandejaQueryIdentity,
  type MesaBandejaCursorLike,
  type MesaBandejaQueryAttempt,
} from "./mesaBandejaInfiniteQuery";

type Item = {
  id: string;
  origen?: "REQUESTED_CORRECTION" | "ADVISOR_UPDATE" | "OTRO";
};

type Page = {
  items: Item[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: MesaBandejaCursorLike | null;
  counts: { n: number } | null;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function queryKey(label: string): string {
  const cambios =
    label === "correcciones"
      ? "solicitadas"
      : label === "actualizaciones"
        ? "otras"
        : label === "cambios"
          ? "todos"
          : "todos";
  const quick = label === "todos" ? "todos" : "correccion_enviada";
  return mesaBandejaQueryIdentity({
    quickFilter: quick,
    mesaOpsFilter: "todo_mesa",
    buscar: "",
    etapaFilter: "todas",
    subestadoFilter: "todas",
    soloCitasHoy: false,
    rechazosCancelacionesSubfiltro: "rechazados",
    cambiosSubfiltro: cambios,
    adminOrigenTab: "",
  });
}

class Harness {
  genRef = { current: 0 };
  activeQueryKeyRef = { current: "" };
  cursorRef: { current: MesaBandejaCursorLike | null } = { current: null };
  cursorQueryKeyRef: { current: string | null } = { current: null };
  hasMore = false;
  totalCount = 0;
  items: Item[] = [];
  counts: { n: number } | null = null;
  rpcCalls: Array<{
    queryKey: string;
    cursor: MesaBandejaCursorLike | null;
    append: boolean;
  }> = [];
  mutations = 0;

  invalidate(nextKey: string) {
    invalidateMesaBandejaPagination({
      genRef: this.genRef,
      activeQueryKeyRef: this.activeQueryKeyRef,
      cursorRef: this.cursorRef,
      cursorQueryKeyRef: this.cursorQueryKeyRef,
      nextQueryKey: nextKey,
    });
    this.hasMore = false;
  }

  canLoadMore(requestQueryKey: string): boolean {
    return canAppendMesaBandejaPage({
      requestQueryKey,
      activeQueryKey: this.activeQueryKeyRef.current,
      serverHasMore: this.hasMore,
      serverTotalCount: this.totalCount,
      loadedCount: this.items.length,
      cursor: this.cursorRef.current,
      cursorQueryKey: this.cursorQueryKeyRef.current,
    });
  }

  /**
   * Copia el protocolo de `loadServerBandeja`:
   * guard de gen+queryKey después de cada await, antes de mutar.
   */
  async load(opts: {
    queryKey: string;
    append: boolean;
    fetchPage: (cursor: MesaBandejaCursorLike | null) => Promise<Page>;
    enrich: (items: Item[]) => Promise<Item[]>;
    /** Si true, omite el guard post-enrich (regresión). */
    skipPostEnrichGuard?: boolean;
  }): Promise<"skipped" | "stale" | "committed"> {
    let attempt: MesaBandejaQueryAttempt;
    if (opts.append) {
      if (!this.canLoadMore(opts.queryKey)) return "skipped";
      attempt = beginMesaBandejaAppend(
        this.genRef,
        this.activeQueryKeyRef,
        opts.queryKey,
      );
    } else {
      attempt = beginMesaBandejaFirstPage(
        this.genRef,
        this.activeQueryKeyRef,
        this.cursorRef,
        this.cursorQueryKeyRef,
        opts.queryKey,
      );
      this.hasMore = false;
    }

    const cursor = opts.append ? this.cursorRef.current : null;
    this.rpcCalls.push({
      queryKey: opts.queryKey,
      cursor,
      append: opts.append,
    });

    const page = await opts.fetchPage(cursor);
    if (
      !mesaBandejaAttemptIsCurrent(attempt, {
        gen: this.genRef.current,
        queryKey: this.activeQueryKeyRef.current,
      })
    ) {
      return "stale";
    }

    const enriched = await opts.enrich(page.items);
    if (
      !opts.skipPostEnrichGuard &&
      !mesaBandejaAttemptIsCurrent(attempt, {
        gen: this.genRef.current,
        queryKey: this.activeQueryKeyRef.current,
      })
    ) {
      return "stale";
    }

    this.mutations += 1;
    if (opts.append) {
      this.items = mergeMesaBandejaAppendClamped(
        this.items,
        enriched,
        page.totalCount,
      );
    } else {
      this.items = enriched;
      if (page.counts) this.counts = page.counts;
    }
    this.totalCount = page.totalCount;
    this.hasMore = Boolean(page.hasMore) && this.items.length < page.totalCount;
    this.cursorRef.current = page.nextCursor;
    this.cursorQueryKeyRef.current = page.nextCursor ? opts.queryKey : null;
    return "committed";
  }
}

function ids(n: number, prefix: string): Item[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    origen:
      prefix === "corr"
        ? "REQUESTED_CORRECTION"
        : prefix === "upd"
          ? "ADVISOR_UPDATE"
          : "OTRO",
  }));
}

describe("Mesa infinite-scroll query isolation R1–R8", () => {
  it("R1: stale enrich de Query A no anexa sobre Correcciones (6)", async () => {
    const h = new Harness();
    const keyA = queryKey("cambios");
    const keyB = queryKey("correcciones");
    assert.notEqual(keyA, keyB);

    const aPage: Page = {
      items: ids(25, "cambios"),
      totalCount: 70,
      hasMore: true,
      nextCursor: { sortTs: "a", id: "cambios-25" },
      counts: { n: 70 },
    };
    await h.load({
      queryKey: keyA,
      append: false,
      fetchPage: async () => aPage,
      enrich: async (items) => items,
    });
    assert.equal(h.items.length, 25);

    const aAppendPage: Page = {
      items: ids(25, "cambios-p2"),
      totalCount: 70,
      hasMore: true,
      nextCursor: { sortTs: "a2", id: "cambios-p2-25" },
      counts: null,
    };
    const enrichA = deferred<Item[]>();
    const staleAppend = h.load({
      queryKey: keyA,
      append: true,
      fetchPage: async () => aAppendPage,
      enrich: () => enrichA.promise,
    });

    h.invalidate(keyB);
    const bItems = ids(6, "corr");
    await h.load({
      queryKey: keyB,
      append: false,
      fetchPage: async () => ({
        items: bItems,
        totalCount: 6,
        hasMore: false,
        nextCursor: null,
        counts: { n: 6 },
      }),
      enrich: async (items) => items,
    });
    assert.equal(h.items.length, 6);
    assert.deepEqual(
      h.items.map((x) => x.id),
      bItems.map((x) => x.id),
    );

    enrichA.resolve(aAppendPage.items);
    const staleResult = await staleAppend;
    assert.equal(staleResult, "stale");
    assert.equal(h.items.length, 6);
    assert.equal(
      h.items.some((x) => x.id.startsWith("cambios")),
      false,
    );

    const mixedIfNoGuard = appendMesaBandejaItemsUnique(
      bItems,
      aAppendPage.items,
    );
    assert.ok(mixedIfNoGuard.length > 6, "sin guard post-enrich mezclaría A en B");
  });

  it("R2: 6 de 6 nunca dispara append aunque IO/hasMore viejo", () => {
    const h = new Harness();
    h.activeQueryKeyRef.current = queryKey("correcciones");
    h.items = ids(6, "corr");
    h.totalCount = 6;
    h.hasMore = true;
    h.cursorRef.current = { sortTs: "stale", id: "x" };
    h.cursorQueryKeyRef.current = queryKey("cambios");
    const before = h.rpcCalls.length;
    assert.equal(h.canLoadMore(queryKey("correcciones")), false);
    assert.equal(h.rpcCalls.length, before);
  });

  it("R3: cursor de Query A no se envía con filtros B", async () => {
    const h = new Harness();
    const keyA = queryKey("cambios");
    const keyB = queryKey("correcciones");
    await h.load({
      queryKey: keyA,
      append: false,
      fetchPage: async () => ({
        items: ids(25, "cambios"),
        totalCount: 70,
        hasMore: true,
        nextCursor: { sortTs: "cursor-a", id: "a25" },
        counts: { n: 70 },
      }),
      enrich: async (items) => items,
    });
    const cursorA = h.cursorRef.current;
    assert.ok(cursorA);

    h.invalidate(keyB);
    assert.equal(h.cursorRef.current, null);
    assert.equal(h.canLoadMore(keyB), false);

    const skipped = await h.load({
      queryKey: keyB,
      append: true,
      fetchPage: async (cursor) => {
        throw new Error(`no debía RPC con cursor ${cursor?.id ?? "null"}`);
      },
      enrich: async (items) => items,
    });
    assert.equal(skipped, "skipped");
    assert.equal(
      h.rpcCalls.some((c) => c.append && c.queryKey === keyB && c.cursor?.id === "a25"),
      false,
    );
  });

  it("R4: append legítimo 25+5 → 30 de 30", async () => {
    const h = new Harness();
    const key = queryKey("cambios");
    await h.load({
      queryKey: key,
      append: false,
      fetchPage: async () => ({
        items: ids(25, "ok"),
        totalCount: 30,
        hasMore: true,
        nextCursor: { sortTs: "c1", id: "ok-25" },
        counts: { n: 30 },
      }),
      enrich: async (items) => items,
    });
    assert.equal(h.items.length, 25);
    assert.equal(h.hasMore, true);

    await h.load({
      queryKey: key,
      append: true,
      fetchPage: async (cursor) => {
        assert.equal(cursor?.id, "ok-25");
        return {
          items: ids(5, "ok-p2"),
          totalCount: 30,
          hasMore: false,
          nextCursor: null,
          counts: null,
        };
      },
      enrich: async (items) => items,
    });
    assert.equal(h.items.length, 30);
    assert.equal(h.totalCount, 30);
    assert.equal(h.hasMore, false);
    assert.equal(h.canLoadMore(key), false);
  });

  it("R5: Cambios (70) → Correcciones (6) y scroll no suma", async () => {
    const h = new Harness();
    await h.load({
      queryKey: queryKey("cambios"),
      append: false,
      fetchPage: async () => ({
        items: ids(25, "mix"),
        totalCount: 70,
        hasMore: true,
        nextCursor: { sortTs: "x", id: "mix-25" },
        counts: { n: 70 },
      }),
      enrich: async (items) => items,
    });
    h.invalidate(queryKey("correcciones"));
    await h.load({
      queryKey: queryKey("correcciones"),
      append: false,
      fetchPage: async () => ({
        items: ids(6, "corr"),
        totalCount: 6,
        hasMore: false,
        nextCursor: null,
        counts: { n: 6 },
      }),
      enrich: async (items) => items,
    });
    assert.equal(h.items.length, 6);
    assert.ok(h.items.every((x) => x.origen === "REQUESTED_CORRECTION"));
    assert.equal(h.canLoadMore(queryKey("correcciones")), false);
    const again = await h.load({
      queryKey: queryKey("correcciones"),
      append: true,
      fetchPage: async () => {
        throw new Error("R5 no debe append");
      },
      enrich: async (items) => items,
    });
    assert.equal(again, "skipped");
    assert.equal(h.items.length, 6);
  });

  it("R6: Correcciones → Actualizaciones no conserva cursor/lista", async () => {
    const h = new Harness();
    await h.load({
      queryKey: queryKey("correcciones"),
      append: false,
      fetchPage: async () => ({
        items: ids(6, "corr"),
        totalCount: 6,
        hasMore: false,
        nextCursor: null,
        counts: { n: 6 },
      }),
      enrich: async (items) => items,
    });
    h.invalidate(queryKey("actualizaciones"));
    assert.equal(h.cursorRef.current, null);
    await h.load({
      queryKey: queryKey("actualizaciones"),
      append: false,
      fetchPage: async () => ({
        items: ids(25, "upd"),
        totalCount: 64,
        hasMore: true,
        nextCursor: { sortTs: "u", id: "upd-25" },
        counts: { n: 64 },
      }),
      enrich: async (items) => items,
    });
    assert.equal(h.items.length, 25);
    assert.ok(h.items.every((x) => x.origen === "ADVISOR_UPDATE"));
    assert.equal(h.totalCount, 64);
    assert.equal(h.hasMore, true);
    assert.equal(h.canLoadMore(queryKey("actualizaciones")), true);
    assert.equal(h.canLoadMore(queryKey("correcciones")), false);
  });

  it("R7: cambios rápidos fuera de orden — solo la última query muta", async () => {
    const h = new Harness();
    const sequence = [
      "todos",
      "cambios",
      "correcciones",
      "actualizaciones",
      "correcciones",
    ] as const;
    const pending: Array<{
      label: (typeof sequence)[number];
      enrich: ReturnType<typeof deferred<Item[]>>;
      done: Promise<"skipped" | "stale" | "committed">;
    }> = [];

    for (const label of sequence) {
      const key = queryKey(label);
      h.invalidate(key);
      const enrich = deferred<Item[]>();
      const items =
        label === "correcciones"
          ? ids(6, "corr")
          : label === "actualizaciones"
            ? ids(10, "upd")
            : ids(8, label);
      const done = h.load({
        queryKey: key,
        append: false,
        fetchPage: async () => ({
          items,
          totalCount: items.length,
          hasMore: false,
          nextCursor: null,
          counts: { n: items.length },
        }),
        enrich: () => enrich.promise,
      });
      pending.push({ label, enrich, done });
    }

    const last = pending.at(-1)!;
    const others = pending.slice(0, -1).reverse();
    for (const p of others) {
      p.enrich.resolve(
        p.label === "correcciones"
          ? ids(6, "corr")
          : p.label === "actualizaciones"
            ? ids(10, "upd")
            : ids(8, p.label),
      );
    }
    for (const p of others) {
      assert.equal(await p.done, "stale");
    }
    last.enrich.resolve(ids(6, "corr"));
    assert.equal(await last.done, "committed");
    assert.equal(h.items.length, 6);
    assert.equal(h.totalCount, 6);
    assert.equal(h.hasMore, false);
    assert.equal(h.counts?.n, 6);
    assert.ok(h.items.every((x) => x.id.startsWith("corr-")));
    assert.equal(h.mutations, 1);
  });

  it("R8: refresh silencioso usa query actual, no revive cursor anterior", async () => {
    const h = new Harness();
    const keyA = queryKey("cambios");
    const keyB = queryKey("correcciones");
    await h.load({
      queryKey: keyA,
      append: false,
      fetchPage: async () => ({
        items: ids(25, "cambios"),
        totalCount: 70,
        hasMore: true,
        nextCursor: { sortTs: "old", id: "old-25" },
        counts: { n: 70 },
      }),
      enrich: async (items) => items,
    });
    h.invalidate(keyB);
    await h.load({
      queryKey: keyB,
      append: false,
      fetchPage: async () => ({
        items: ids(6, "corr"),
        totalCount: 6,
        hasMore: false,
        nextCursor: null,
        counts: { n: 6 },
      }),
      enrich: async (items) => items,
    });

    const refresh = await h.load({
      queryKey: keyB,
      append: false,
      fetchPage: async (cursor) => {
        assert.equal(cursor, null);
        return {
          items: ids(7, "corr"),
          totalCount: 7,
          hasMore: false,
          nextCursor: null,
          counts: { n: 7 },
        };
      },
      enrich: async (items) => items,
    });
    assert.equal(refresh, "committed");
    assert.equal(h.items.length, 7);
    assert.equal(h.totalCount, 7);
    assert.equal(h.cursorRef.current, null);
    assert.equal(
      h.rpcCalls.at(-1)?.cursor,
      null,
      "refresh no reutiliza cursor A",
    );
  });
});
