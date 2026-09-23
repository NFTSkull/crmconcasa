import { chromium } from "@playwright/test";

const targets = [
  {
    label: "RFC",
    url: "https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/index.jsf",
    selector: "#captchaSession",
  },
  {
    label: "CURP",
    url: "https://agsc.siat.sat.gob.mx/PTSC/ConsultaIdCSIAT/",
    selector: 'input[name="formapp:doc"][value="CURP"]',
  },
] as const;

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--ignore-certificate-errors"],
  });

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      locale: "es-MX",
      timezoneId: "America/Monterrey",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });

    for (const target of targets) {
      const page = await context.newPage();
      const startedAt = Date.now();
      console.log(`SAT_LOCAL_${target.label}_START`);

      try {
        const response = await page.goto(target.url, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        const navigationMs = Date.now() - startedAt;
        const httpStatus = response?.status() ?? null;

        await page.locator(target.selector).first().waitFor({
          state: "visible",
          timeout: 20_000,
        });

        console.log(
          `SAT_LOCAL_${target.label}_PASS http=${httpStatus ?? "null"} navigationMs=${navigationMs} selectorVisible=true`,
        );
      } catch (error) {
        console.log(
          `SAT_LOCAL_${target.label}_FAIL type=${
            error instanceof Error ? error.name : "unknown"
          } message=${error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 240) : "unknown"}`,
        );
        process.exitCode = 1;
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(
    "SAT_LOCAL_SMOKE_FATAL",
    error instanceof Error ? error.message : "unknown",
  );
  process.exitCode = 1;
});
