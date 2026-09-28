import {
  fiscalRetryCooldownMs,
  fiscalRetryReady,
  isAuthorizedCron,
  isTechnicalRetryCode,
} from "@/app/api/cron/reintentar-fiscal-sat/route";

describe("cron reintentar-fiscal-sat", () => {
  const original = process.env.CRON_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("rechaza cuando CRON_SECRET no está configurado", () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCron(new Request("https://example.test"))).toBe(false);
  });

  it("acepta Authorization Bearer con CRON_SECRET", () => {
    process.env.CRON_SECRET = "secret-test";
    const request = new Request("https://example.test", {
      headers: { Authorization: "Bearer secret-test" },
    });
    expect(isAuthorizedCron(request)).toBe(true);
  });

  it("espacia los auto-reintentos para no quemar ancho de banda", () => {
    expect(fiscalRetryCooldownMs({ auto_retry: false })).toBe(2 * 60 * 1000);
    expect(fiscalRetryCooldownMs({ auto_retry: true })).toBe(15 * 60 * 1000);

    const now = Date.parse("2026-09-28T20:00:00Z");
    expect(
      fiscalRetryReady(
        "2026-09-28T19:57:00Z",
        { auto_retry: false },
        now,
      ),
    ).toBe(true);
    expect(
      fiscalRetryReady(
        "2026-09-28T19:50:00Z",
        { auto_retry: true },
        now,
      ),
    ).toBe(false);
    expect(
      fiscalRetryReady(
        "2026-09-28T19:44:00Z",
        { auto_retry: true },
        now,
      ),
    ).toBe(true);
  });

  it("solo reintenta fallas técnicas y no RFC inválido", () => {
    expect(isTechnicalRetryCode("TECHNICAL_FAILURE")).toBe(true);
    expect(isTechnicalRetryCode("SAT_WORKER_EXCEPTION")).toBe(true);
    expect(isTechnicalRetryCode("AUTO_RETRY_IN_PROGRESS")).toBe(true);
    expect(isTechnicalRetryCode("502")).toBe(true);
    expect(isTechnicalRetryCode("503")).toBe(true);
    expect(isTechnicalRetryCode("429")).toBe(true);
    expect(isTechnicalRetryCode("408")).toBe(true);
    expect(isTechnicalRetryCode("400")).toBe(false);
    expect(isTechnicalRetryCode("RFC_INVALIDO_SAT")).toBe(false);
    expect(isTechnicalRetryCode("CURP_INVALIDA_SAT")).toBe(false);
  });
});
