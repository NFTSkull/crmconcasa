import {
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

  it("solo reintenta fallas técnicas y no RFC inválido", () => {
    expect(isTechnicalRetryCode("TECHNICAL_FAILURE")).toBe(true);
    expect(isTechnicalRetryCode("SAT_WORKER_EXCEPTION")).toBe(true);
    expect(isTechnicalRetryCode("AUTO_RETRY_IN_PROGRESS")).toBe(true);
    expect(isTechnicalRetryCode("RFC_INVALIDO_SAT")).toBe(false);
    expect(isTechnicalRetryCode("CURP_INVALIDA_SAT")).toBe(false);
  });
});
