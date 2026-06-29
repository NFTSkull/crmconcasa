import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasAlertMessage } from "@/lib/hasAlertMessage";

describe("hasAlertMessage", () => {
  it("rechaza null, undefined y vacío", () => {
    assert.equal(hasAlertMessage(null), false);
    assert.equal(hasAlertMessage(undefined), false);
    assert.equal(hasAlertMessage(""), false);
    assert.equal(hasAlertMessage("   "), false);
  });

  it("acepta texto con contenido", () => {
    assert.equal(hasAlertMessage("Error de carga"), true);
    assert.equal(hasAlertMessage("  ok  "), true);
  });
});
