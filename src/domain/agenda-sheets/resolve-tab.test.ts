import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseTabMapJson,
  resolveSheetTabForDate,
} from "./resolve-tab";

describe("resolveSheetTabForDate", () => {
  const live = [
    { sheetId: 1, title: "07 AGOSTO" },
    { sheetId: 2, title: "10 AGOSTO " },
    { sheetId: 3, title: "FORMATO" },
    { sheetId: 4, title: "03 SEPTIEMBRE" },
  ];

  it("usa TAB_MAP preferente con título exacto", () => {
    const r = resolveSheetTabForDate({
      bookingDate: "2026-08-07",
      tabMap: { "2026-08-07": { sheetId: 99, title: "07 AGOSTO" } },
      liveTabs: live,
    });
    assert.equal(r.status, "resolved_from_tab_map");
    if (r.status === "resolved_from_tab_map") {
      assert.equal(r.sheetId, 99);
      assert.equal(r.title, "07 AGOSTO");
    }
  });

  it("fallback live para fecha posterior a 07 AGOSTO (espacio final exacto)", () => {
    const r = resolveSheetTabForDate({
      bookingDate: "2026-08-10",
      tabMap: {},
      liveTabs: live,
    });
    assert.equal(r.status, "resolved_from_live_metadata");
    if (r.status === "resolved_from_live_metadata") {
      assert.equal(r.sheetId, 2);
      assert.equal(r.title, "10 AGOSTO ");
    }
  });

  it("fallback live reconoce 03 SEPTIEMBRE", () => {
    const r = resolveSheetTabForDate({
      bookingDate: "2026-09-03",
      tabMap: {},
      liveTabs: live,
    });
    assert.equal(r.status, "resolved_from_live_metadata");
    if (r.status === "resolved_from_live_metadata") {
      assert.equal(r.title, "03 SEPTIEMBRE");
    }
  });

  it("excluye FORMATO y reporta missing", () => {
    const r = resolveSheetTabForDate({
      bookingDate: "2026-01-01",
      tabMap: {},
      liveTabs: live,
    });
    assert.equal(r.status, "missing_sheet_for_date");
  });

  it("ambiguous si dos títulos parsean a la misma fecha", () => {
    const r = resolveSheetTabForDate({
      bookingDate: "2026-08-10",
      tabMap: {},
      liveTabs: [
        { sheetId: 2, title: "10 AGOSTO " },
        { sheetId: 5, title: "10 AGOSTO" },
      ],
    });
    assert.equal(r.status, "ambiguous_sheet_for_date");
  });

  it("parseTabMapJson inválido → {}", () => {
    assert.deepEqual(parseTabMapJson("nope"), {});
  });
});
