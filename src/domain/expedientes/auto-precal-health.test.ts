import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveAutoPrecalHealth } from "./auto-precal-health";

describe("resolveAutoPrecalHealth", () => {
  const now = Date.parse("2026-09-22T17:40:00.000Z");

  it("prende solo con akamai_access_denied reciente como último evento real", () => {
    const state = resolveAutoPrecalHealth(
      [
        {
          intentado_en: "2026-09-22T17:39:20.000Z",
          resultado: "pending_error",
          razon: "akamai_access_denied",
        },
      ],
      now,
    );

    assert.deepEqual(state, {
      blockedByAkamai: true,
      detectedAt: "2026-09-22T17:39:20.000Z",
    });
  });

  it("job_started posterior no tapa el bloqueo", () => {
    const state = resolveAutoPrecalHealth(
      [
        {
          intentado_en: "2026-09-22T17:39:50.000Z",
          resultado: "pending_error",
          razon: "job_started",
        },
        {
          intentado_en: "2026-09-22T17:39:20.000Z",
          resultado: "pending_error",
          razon: "akamai_access_denied",
        },
      ],
      now,
    );

    assert.equal(state.blockedByAkamai, true);
  });

  it("resultado automático terminal posterior apaga la alerta", () => {
    const state = resolveAutoPrecalHealth(
      [
        {
          intentado_en: "2026-09-22T17:39:50.000Z",
          resultado: "aprobado",
          razon: null,
        },
        {
          intentado_en: "2026-09-22T17:39:20.000Z",
          resultado: "pending_error",
          razon: "akamai_access_denied",
        },
      ],
      now,
    );

    assert.deepEqual(state, { blockedByAkamai: false, detectedAt: null });
  });

  it("otros errores no muestran alerta de página caída", () => {
    for (const razon of [
      "scraper_failed",
      "proxy_unavailable",
      "infonavit_system_error",
      "ambiguous_payload",
    ]) {
      const state = resolveAutoPrecalHealth(
        [
          {
            intentado_en: "2026-09-22T17:39:20.000Z",
            resultado: "pending_error",
            razon,
          },
        ],
        now,
      );
      assert.equal(state.blockedByAkamai, false, razon);
    }
  });

  it("un bloqueo viejo no deja la alerta pegada", () => {
    const state = resolveAutoPrecalHealth(
      [
        {
          intentado_en: "2026-09-22T17:30:00.000Z",
          resultado: "pending_error",
          razon: "akamai_access_denied",
        },
      ],
      now,
    );

    assert.equal(state.blockedByAkamai, false);
  });
});
