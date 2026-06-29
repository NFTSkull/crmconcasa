import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMesaBandejaBuildMarker } from "./mesaBandejaBuildMarker";

describe("getMesaBandejaBuildMarker", () => {
  it("incluye sha de build", () => {
    process.env.NEXT_PUBLIC_MESA_BANDEJA_BUILD_SHA = "4992759";
    assert.equal(getMesaBandejaBuildMarker(), "Fase 0 orden · commit 4992759");
  });
});
