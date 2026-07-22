import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeMesaBandejaServerWindow,
  describeMesaBandejaVisibleWindow,
  isIntersectionObserverAvailable,
  mesaBandejaHasMore,
  mesaBandejaInfiniteResetKey,
  MESA_BANDEJA_INITIAL_VISIBLE,
  MESA_BANDEJA_LOAD_MORE_STEP,
  nextMesaBandejaVisibleCount,
  resetMesaBandejaVisibleCount,
  shouldShowMesaBandejaLoadMoreFallback,
  sliceMesaBandejaVisible,
} from "./mesaBandejaInfiniteScroll";
import {
  aplicarFiltrosBandejaMesa,
  type MesaBandejaFiltroItem,
  type MesaBandejaFiltrosState,
} from "./mesaBandejaFiltros";
import { applyMesaOpsFilterSorted, DEFAULT_MESA_OPS_FILTER } from "./mesaOpsUi";
import { sortMesaBandejaPorAntiguedad } from "./mesaBandejaOrden";

type Caso = MesaBandejaFiltroItem & {
  id: string;
  fechaEnvioMesa?: string | null;
  createdAt: string;
  mesaOps?: null;
};

function caso(
  id: string,
  partial?: Partial<Caso> & { cliente_nombre?: string },
): Caso {
  const n = Number(id.replace(/\D/g, "")) || 0;
  return {
    id,
    cliente_nombre: partial?.cliente_nombre ?? `Cliente ${id}`,
    telefono_cliente: partial?.telefono_cliente ?? `55${String(n).padStart(8, "0")}`,
    etapaActual: partial?.etapaActual ?? 5,
    subestado: partial?.subestado ?? "en_proceso",
    cicloEstado: partial?.cicloEstado ?? "activo",
    fechaCita: partial?.fechaCita ?? null,
    resumenDocumental: partial?.resumenDocumental ?? null,
    fechaEnvioMesa:
      partial?.fechaEnvioMesa ??
      `2026-01-${String((n % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
    createdAt: partial?.createdAt ?? "2026-01-01T00:00:00.000Z",
    mesaOps: null,
    ...partial,
  };
}

function filtroState(
  partial?: Partial<MesaBandejaFiltrosState>,
): MesaBandejaFiltrosState {
  return {
    quickFilter: "todos",
    rechazosCancelacionesSubfiltro: "rechazados",
    buscar: "",
    etapa: "todas",
    subestado: "todas",
    soloCitasHoy: false,
    ...partial,
  };
}

/** Flujo P101: full → filtros → orden → slice. */
function pipeline(
  all: Caso[],
  state: MesaBandejaFiltrosState,
  visibleCount: number,
  todayYMD = "2026-07-22",
) {
  const filtered = aplicarFiltrosBandejaMesa(all, state, todayYMD);
  const sorted = applyMesaOpsFilterSorted(
    sortMesaBandejaPorAntiguedad(filtered),
    DEFAULT_MESA_OPS_FILTER,
    null,
  );
  const visible = sliceMesaBandejaVisible(sorted, visibleCount);
  return { filtered: sorted, visible };
}

describe("P101 mesa bandeja infinite scroll", () => {
  it("constantes: inicial 25 y bloque 25", () => {
    assert.equal(MESA_BANDEJA_INITIAL_VISIBLE, 25);
    assert.equal(MESA_BANDEJA_LOAD_MORE_STEP, 25);
  });

  it("160 resultados → inicialmente renderiza 25", () => {
    const all = Array.from({ length: 160 }, (_, i) => caso(String(i + 1)));
    const { filtered, visible } = pipeline(all, filtroState(), 25);
    assert.equal(filtered.length, 160);
    assert.equal(visible.length, 25);
    assert.deepEqual(
      visible.map((c) => c.id),
      filtered.slice(0, 25).map((c) => c.id),
    );
  });

  it("sentinel: 25 → 50 → 75 … hasta 160; nunca supera el total", () => {
    let visible = MESA_BANDEJA_INITIAL_VISIBLE;
    const total = 160;
    const steps: number[] = [visible];
    while (mesaBandejaHasMore(visible, total)) {
      visible = nextMesaBandejaVisibleCount(visible, total);
      steps.push(visible);
      assert.ok(visible <= total);
    }
    assert.deepEqual(steps.slice(0, 4), [25, 50, 75, 100]);
    assert.equal(steps.at(-1), 160);
    assert.equal(nextMesaBandejaVisibleCount(160, 160), 160);
    assert.equal(nextMesaBandejaVisibleCount(150, 160), 160);
  });

  it("búsqueda encuentra un caso fuera de los primeros 25 y reinicia a ≤25", () => {
    const all = Array.from({ length: 160 }, (_, i) => caso(String(i + 1)));
    all[99] = caso("100", { cliente_nombre: "Zeta Único Objetivo" });

    const before = pipeline(all, filtroState(), 25);
    assert.equal(
      before.visible.some((c) => c.cliente_nombre.includes("Zeta")),
      false,
    );

    const afterFilter = pipeline(
      all,
      filtroState({ buscar: "Zeta Único" }),
      resetMesaBandejaVisibleCount(),
    );
    assert.equal(afterFilter.filtered.length, 1);
    assert.equal(afterFilter.visible.length, 1);
    assert.equal(afterFilter.visible[0]?.cliente_nombre, "Zeta Único Objetivo");
    assert.ok(afterFilter.visible.length <= 25);
  });

  it("cambiar cualquier filtro reinicia el límite a 25", () => {
    const keyA = mesaBandejaInfiniteResetKey({
      quickFilter: "todos",
      mesaOpsFilter: "todo_mesa",
      buscar: "",
      etapaFilter: "todas",
      subestadoFilter: "todas",
      soloCitasHoy: false,
    });
    const keyB = mesaBandejaInfiniteResetKey({
      quickFilter: "en_proceso",
      mesaOpsFilter: "todo_mesa",
      buscar: "",
      etapaFilter: "todas",
      subestadoFilter: "todas",
      soloCitasHoy: false,
    });
    assert.notEqual(keyA, keyB);
    assert.equal(resetMesaBandejaVisibleCount(), 25);

    const criteria = [
      { buscar: "ana" },
      { etapaFilter: "5" },
      { subestadoFilter: "pendiente" },
      { soloCitasHoy: true },
      { mesaOpsFilter: "mi_bandeja" },
    ] as const;
    for (const patch of criteria) {
      const next = mesaBandejaInfiniteResetKey({
        quickFilter: "todos",
        mesaOpsFilter: "todo_mesa",
        buscar: "",
        etapaFilter: "todas",
        subestadoFilter: "todas",
        soloCitasHoy: false,
        ...patch,
      });
      assert.notEqual(keyA, next, JSON.stringify(patch));
    }
  });

  it("contador conserva el total filtrado; slice no lo reduce", () => {
    const all = Array.from({ length: 160 }, (_, i) => caso(String(i + 1)));
    const { filtered, visible } = pipeline(all, filtroState(), 25);
    const window = describeMesaBandejaVisibleWindow(25, filtered.length);
    assert.equal(window.totalFiltered, 160);
    assert.equal(window.visibleLength, 25);
    assert.equal(window.showingLabel, "Mostrando 25 de 160");
    assert.equal(visible.length, 25);
    assert.equal(filtered.length, 160);
  });

  it("orden global intacto antes del slice (antigüedad)", () => {
    const all = [
      caso("new", { fechaEnvioMesa: "2026-06-01T00:00:00.000Z" }),
      caso("old", { fechaEnvioMesa: "2026-01-01T00:00:00.000Z" }),
      caso("mid", { fechaEnvioMesa: "2026-03-01T00:00:00.000Z" }),
    ];
    const { filtered, visible } = pipeline(all, filtroState(), 2);
    assert.deepEqual(
      filtered.map((c) => c.id),
      ["old", "mid", "new"],
    );
    assert.deepEqual(
      visible.map((c) => c.id),
      ["old", "mid"],
    );
  });

  it("cero resultados funciona; <25 no muestra Cargar más", () => {
    const empty = describeMesaBandejaVisibleWindow(25, 0);
    assert.equal(empty.totalFiltered, 0);
    assert.equal(empty.visibleLength, 0);
    assert.equal(empty.hasMore, false);
    assert.equal(empty.showingLabel, null);
    assert.equal(
      shouldShowMesaBandejaLoadMoreFallback({
        hasMore: false,
        intersectionObserverAvailable: false,
      }),
      false,
    );

    const few = pipeline(
      Array.from({ length: 10 }, (_, i) => caso(String(i + 1))),
      filtroState(),
      25,
    );
    assert.equal(few.visible.length, 10);
    assert.equal(mesaBandejaHasMore(25, 10), false);
    assert.equal(
      shouldShowMesaBandejaLoadMoreFallback({
        hasMore: mesaBandejaHasMore(few.visible.length, few.filtered.length),
        intersectionObserverAvailable: false,
      }),
      false,
    );
  });

  it("fallback Cargar más solo si hay más y no hay IntersectionObserver", () => {
    assert.equal(
      shouldShowMesaBandejaLoadMoreFallback({
        hasMore: true,
        intersectionObserverAvailable: true,
      }),
      false,
    );
    assert.equal(
      shouldShowMesaBandejaLoadMoreFallback({
        hasMore: true,
        intersectionObserverAvailable: false,
      }),
      true,
    );
    assert.equal(isIntersectionObserverAvailable({}), false);
    assert.equal(
      isIntersectionObserverAvailable({ IntersectionObserver: class {} }),
      true,
    );
  });

  it("cargar más no implica refetch: solo crece el slice sobre la misma colección", () => {
    let fetchCalls = 0;
    const loadAll = () => {
      fetchCalls += 1;
      return Array.from({ length: 160 }, (_, i) => caso(String(i + 1)));
    };
    const all = loadAll();
    assert.equal(fetchCalls, 1);

    let visibleCount = 25;
    let { filtered, visible } = pipeline(all, filtroState(), visibleCount);
    assert.equal(visible.length, 25);

    visibleCount = nextMesaBandejaVisibleCount(visibleCount, filtered.length);
    ({ filtered, visible } = pipeline(all, filtroState(), visibleCount));
    assert.equal(visible.length, 50);
    assert.equal(fetchCalls, 1, "no hay segundo fetch/RPC al cargar más");
  });

  it("P102 server window: loaded 25 / total 160 / hasMore", () => {
    const w = describeMesaBandejaServerWindow({
      loadedCount: 25,
      totalFiltered: 160,
      hasMore: true,
    });
    assert.equal(w.visibleLength, 25);
    assert.equal(w.totalFiltered, 160);
    assert.equal(w.hasMore, true);
    assert.equal(w.showingLabel, "Mostrando 25 de 160");
  });

  it("P102: sentinel pide siguiente página (RPC), no amplía slice de set descargado", () => {
    let rpcCalls = 0;
    const pages: string[][] = [];
    const fetchPage = (cursor: string | null) => {
      rpcCalls += 1;
      const start = cursor ? Number(cursor) : 0;
      const ids = Array.from({ length: 25 }, (_, i) => String(start + i + 1));
      pages.push(ids);
      return {
        ids,
        nextCursor: String(start + 25),
        hasMore: start + 25 < 160,
        total: 160,
      };
    };
    const p1 = fetchPage(null);
    assert.equal(p1.ids.length, 25);
    assert.equal(rpcCalls, 1);
    const p2 = fetchPage(p1.nextCursor);
    assert.equal(p2.ids.length, 25);
    assert.equal(rpcCalls, 2);
    assert.equal(new Set([...p1.ids, ...p2.ids]).size, 50);
    assert.notEqual(p1.ids[0], p2.ids[0]);
  });

  it("NUNCA slice → filtros (regresión de orden)", () => {
    const all = Array.from({ length: 40 }, (_, i) =>
      caso(String(i + 1), {
        cliente_nombre: i === 30 ? "Needle" : `Cliente ${i + 1}`,
      }),
    );
    // Incorrecto: slice primero pierde el needle.
    const wrong = all.slice(0, 25).filter((c) => c.cliente_nombre === "Needle");
    assert.equal(wrong.length, 0);
    // Correcto: filtrar completo luego slice.
    const right = pipeline(all, filtroState({ buscar: "Needle" }), 25);
    assert.equal(right.filtered.length, 1);
    assert.equal(right.visible.length, 1);
  });
});
