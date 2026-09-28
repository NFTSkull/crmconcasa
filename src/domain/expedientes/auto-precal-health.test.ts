import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveAutoPrecalHealth } from "./auto-precal-health";

describe("resolveAutoPrecalHealth", () => {
  const now = Date.parse("2026-09-28T06:45:00.000Z");

  it("prende de inmediato con akamai_access_denied reciente", () => {
    const state = resolveAutoPrecalHealth(
      [
        {
          intentado_en: "2026-09-28T06:44:20.000Z",
          resultado: "pending_error",
          razon: "akamai_access_denied",
        },
      ],
      now,
    );

    assert.deepEqual(state, {
      blockedByAkamai: true,
      portalUnavailable: true,
      detectedAt: "2026-09-28T06:44:20.000Z",
      reason: "akamai_access_denied",
    });
  });

  it("job_started posterior no tapa el bloqueo", () => {
    const state = resolveAutoPrecalHealth(
      [
        {
          intentado_en: "2026-09-28T06:44:50.000Z",
          resultado: "pending_error",
          razon: "job_started",
        },
        {
          intentado_en: "2026-09-28T06:44:20.000Z",
          resultado: "pending_error",
          razon: "akamai_access_denied",
        },
      ],
      now,
    );

    assert.equal(state.portalUnavailable, true);
    assert.equal(state.blockedByAkamai, true);
  });

  it("infonavit_system_error reciente enciende la alerta", () => {
    const state = resolveAutoPrecalHealth(
      [
        {
          intentado_en: "2026-09-28T06:44:20.000Z",
          resultado: "pending_error",
          razon: "infonavit_system_error",
        },
      ],
      now,
    );

    assert.equal(state.portalUnavailable, true);
    assert.equal(state.reason, "infonavit_system_error");
  });

  it("tres scraper_failed consecutivos recientes marcan caída del portal", () => {
    const state = resolveAutoPrecalHealth(
      [
        {
          intentado_en: "2026-09-28T06:44:40.000Z",
          resultado: "pending_error",
          razon: "scraper_failed",
        },
        {
          intentado_en: "2026-09-28T06:43:40.000Z",
          resultado: "pending_error",
          razon: "scraper_failed",
        },
        {
          intentado_en: "2026-09-28T06:42:40.000Z",
          resultado: "pending_error",
          razon: "scraper_failed",
        },
      ],
      now,
    );

    assert.equal(state.portalUnavailable, true);
    assert.equal(state.blockedByAkamai, false);
    assert.equal(state.reason, "sustained_scraper_failure");
  });

  it("un scraper_failed aislado no muestra caída", () => {
    const state = resolveAutoPrecalHealth(
      [
        {
          intentado_en: "2026-09-28T06:44:40.000Z",
          resultado: "pending_error",
          razon: "scraper_failed",
        },
      ],
      now,
    );

    assert.equal(state.portalUnavailable, false);
  });

  it("resultado automático terminal posterior apaga la alerta", () => {
    const state = resolveAutoPrecalHealth(
      [
        {
          intentado_en: "2026-09-28T06:44:50.000Z",
          resultado: "aprobado",
          razon: null,
        },
        {
          intentado_en: "2026-09-28T06:44:20.000Z",
          resultado: "pending_error",
          razon: "scraper_failed",
        },
        {
          intentado_en: "2026-09-28T06:43:20.000Z",
          resultado: "pending_error",
          razon: "scraper_failed",
        },
        {
          intentado_en: "2026-09-28T06:42:20.000Z",
          resultado: "pending_error",
          razon: "scraper_failed",
        },
      ],
      now,
    );

    assert.deepEqual(state, {
      blockedByAkamai: false,
      portalUnavailable: false,
      detectedAt: null,
      reason: null,
    });
  });

  it("proxy_unavailable no se presenta como caída de Bansefi", () => {
    const state = resolveAutoPrecalHealth(
      [
        {
          intentado_en: "2026-09-28T06:44:20.000Z",
          resultado: "pending_error",
          razon: "proxy_unavailable",
        },
      ],
      now,
    );

    assert.equal(state.portalUnavailable, false);
  });

  it("un bloqueo viejo no deja la alerta pegada", () => {
    const state = resolveAutoPrecalHealth(
      [
        {
          intentado_en: "2026-09-28T06:30:00.000Z",
          resultado: "pending_error",
          razon: "akamai_access_denied",
        },
      ],
      now,
    );

    assert.equal(state.portalUnavailable, false);
  });
});
