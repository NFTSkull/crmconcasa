import { expect, test } from "@playwright/test";

type LoginSmokeCase = {
  role: string;
  expectedPath: string;
};

const LOGIN_SMOKE_CASES: LoginSmokeCase[] = [
  { role: "asesor", expectedPath: "/asesor" },
  { role: "editor", expectedPath: "/editor" },
  { role: "mesa_control_admin", expectedPath: "/mesa-control" },
  { role: "super_admin", expectedPath: "/admin" },
  { role: "revisor", expectedPath: "/revisor" },
];

async function tryClearMockData(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.evaluate(async () => {
    if (typeof window.clearMockData === "function") {
      await window.clearMockData();
    }
  });
}

async function loginWithRole(
  page: import("@playwright/test").Page,
  role: string,
): Promise<void> {
  await page.goto("/login");
  const uniqueEmail = `e2e-${role}-${Date.now()}@mock.local`;
  await page.getByLabel("Correo (opcional)").fill(uniqueEmail);
  await page.getByLabel("Perfil (mock)").selectOption(role);
  await page.getByRole("button", { name: "Entrar" }).click();
}

for (const { role, expectedPath } of LOGIN_SMOKE_CASES) {
  test(`login ${role} redirects to ${expectedPath}`, async ({ page }) => {
    await tryClearMockData(page);
    await loginWithRole(page, role);
    await expect(page).toHaveURL(new RegExp(`${expectedPath.replace("/", "\\/")}$`));
  });
}
