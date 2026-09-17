import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyAutoPrecalImmediateRetry } from "./auto-precal-immediate-retry";

describe("classifyAutoPrecalImmediateRetry", () => {
  it("reintenta rechazo transitorio de login observado en Production", () => {
    assert.equal(
      classifyAutoPrecalImmediateRetry({
        error: "Login fallido después de 3 intentos",
      }),
      "login_rejected",
    );
  });

  it("reintenta fallos de ciclo de vida de Chromium/Playwright", () => {
    for (const error of [
      "browserType.launch: Target page, context or browser has been closed",
      "Target closed",
      "TargetCloseError: page closed",
      "Session closed. Most likely the page has been closed.",
      "browser has disconnected",
      "browser disconnected",
    ]) {
      assert.equal(
        classifyAutoPrecalImmediateRetry({ error }),
        "browser_lifecycle",
        error,
      );
    }
  });

  it("no reintenta errores no incluidos en la allowlist", () => {
    for (const error of [
      "akamai_access_denied",
      "PROXY_TUNNEL_FAILED_AGOTADO",
      "Trabajo cancelado por límite de tiempo interno (110s)",
      "Unauthorized",
      "error desconocido",
    ]) {
      assert.equal(classifyAutoPrecalImmediateRetry({ error }), null, error);
    }
  });

  it("no reintenta una respuesta crediticia normal ni payload sin error", () => {
    assert.equal(
      classifyAutoPrecalImmediateRetry({
        califica: false,
        mensaje: "SIN RELACION LABORAL VIGENTE",
      }),
      null,
    );
    assert.equal(classifyAutoPrecalImmediateRetry({ error: "" }), null);
  });
});
