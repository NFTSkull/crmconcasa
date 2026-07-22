import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendMesaBandejaItemsUnique,
  mapAdminOrigenTabToRpc,
  MESA_BANDEJA_PAGE_SIZE,
  normalizeMesaBandejaPageLimit,
  paginateMesaBandejaKeyset,
  mesaListBandejaPageRpcSchema,
} from "./list-for-mesa-control-paginated";

describe("P102 list-for-mesa-control-paginated", () => {
  it("page size canónico 25 y clamp 1–100", () => {
    assert.equal(MESA_BANDEJA_PAGE_SIZE, 25);
    assert.equal(normalizeMesaBandejaPageLimit(undefined), 25);
    assert.equal(normalizeMesaBandejaPageLimit(0), 25);
    assert.equal(normalizeMesaBandejaPageLimit(200), 100);
    assert.equal(normalizeMesaBandejaPageLimit(10), 10);
  });

  it("keyset: primera página 25, load more siguientes 25 sin duplicados", () => {
    const sorted = Array.from({ length: 160 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      sortTs: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
    }));
    // Orden real: sortTs ASC, id ASC — forzar sort estable
    sorted.sort((a, b) =>
      a.sortTs === b.sortTs
        ? a.id < b.id
          ? -1
          : 1
        : a.sortTs < b.sortTs
          ? -1
          : 1,
    );

    const page1 = paginateMesaBandejaKeyset(sorted, { limit: 25 });
    assert.equal(page1.items.length, 25);
    assert.equal(page1.hasMore, true);
    assert.ok(page1.nextCursor);

    const page2 = paginateMesaBandejaKeyset(sorted, {
      limit: 25,
      cursor: page1.nextCursor,
    });
    assert.equal(page2.items.length, 25);
    const ids = [...page1.items, ...page2.items].map((x) => x.id);
    assert.equal(new Set(ids).size, 50);
    assert.deepEqual(
      ids,
      sorted.slice(0, 50).map((x) => x.id),
    );
  });

  it("append único no pierde lo cargado ni repite", () => {
    const a = [{ id: "1" }, { id: "2" }];
    const b = [{ id: "2" }, { id: "3" }];
    assert.deepEqual(
      appendMesaBandejaItemsUnique(a, b).map((x) => x.id),
      ["1", "2", "3"],
    );
  });

  it("mapAdminOrigenTabToRpc", () => {
    assert.equal(mapAdminOrigenTabToRpc("internos"), "interno");
    assert.equal(mapAdminOrigenTabToRpc("externos"), "externo");
    assert.equal(mapAdminOrigenTabToRpc("todos"), "todos");
  });

  it("Zod RPC payload mínimo", () => {
    const parsed = mesaListBandejaPageRpcSchema.parse({
      items: [],
      total_count: 160,
      has_more: false,
      next_cursor: null,
      counts: { totalBandeja: 160, correccionesEnviadas: 3 },
    });
    assert.equal(parsed.total_count, 160);
    assert.equal(parsed.counts?.totalBandeja, 160);
  });

  it("búsqueda conceptual: filtrar universo antes de paginar (no slice→filtro)", () => {
    const all = Array.from({ length: 80 }, (_, i) => ({
      id: String(i + 1),
      sortTs: `2026-02-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      nombre: i === 60 ? "Needle Fuera" : `Cliente ${i + 1}`,
    }));
    const filtered = all
      .filter((x) => x.nombre.includes("Needle"))
      .sort((a, b) => (a.sortTs < b.sortTs ? -1 : 1));
    const page = paginateMesaBandejaKeyset(filtered, { limit: 25 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.nombre, "Needle Fuera");
    // Incorrecto: slice primero pierde el needle
    assert.equal(
      all.slice(0, 25).filter((x) => x.nombre.includes("Needle")).length,
      0,
    );
  });
});
