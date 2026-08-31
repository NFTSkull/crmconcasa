import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ASESOR_LIDER_DEFAULT_PAGE_SIZE,
  ASESOR_LIDER_MAX_PAGE_SIZE,
  asesorLiderContextSchema,
  asesorLiderDashboardSchema,
  asesorLiderTotalPages,
  clampAsesorLiderPage,
  hasCapability,
  isAsesorLiderDashboardMode,
  normalizeAsesorLiderPageOptions,
} from "./rpc";
import { AsesorLiderMockRepo } from "./mock.repo";

function listTsFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFilesRecursive(full));
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("asesor-lider domain", () => {
  it("context true → leader mode", async () => {
    const repo = new AsesorLiderMockRepo({ leaderMode: true });
    const ctx = await repo.getContext();
    assert.equal(ctx.team_dashboard_read, true);
    assert.ok(ctx.team);
    assert.equal(isAsesorLiderDashboardMode(ctx), true);
    assert.equal(hasCapability(ctx, "team_dashboard_read"), true);
  });

  it("context false → normal", async () => {
    const repo = new AsesorLiderMockRepo({ leaderMode: false });
    const ctx = await repo.getContext();
    assert.equal(ctx.team_dashboard_read, false);
    assert.equal(ctx.team, null);
    assert.equal(isAsesorLiderDashboardMode(ctx), false);
  });

  it("no email hardcode de líder en domain (solo seed SQL)", () => {
    const dir = join(process.cwd(), "src/domain/asesor-lider");
    const files = listTsFilesRecursive(dir).filter(
      (f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"),
    );
    assert.ok(files.length > 0);
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(
        src,
        /silvia\.reyes/i,
        `no hardcode email en ${file}`,
      );
      assert.doesNotMatch(src, /@concasa\.mx/i, `no hardcode email en ${file}`);
    }
  });

  it("zod acepta sample dashboard payload", () => {
    const sample = {
      activos: 10,
      cerrados: 2,
      total: 12,
      monto_total_aprobado: "85000.50",
      by_etapa: [
        { etapa: 1, nombre: "Integración", count: "3", monto: "0" },
        { etapa: 2, nombre: "Registro", count: 1, monto: 169000 },
      ],
      filters: {
        asesor_id: null,
        fecha_desde: null,
        fecha_hasta: "2026-08-31",
      },
    };
    const parsed = asesorLiderDashboardSchema.parse(sample);
    assert.equal(parsed.activos, 10);
    assert.equal(parsed.monto_total_aprobado, 85000.5);
    assert.equal(parsed.by_etapa[0]?.count, 3);
    assert.equal(parsed.by_etapa[1]?.monto, 169000);
  });

  it("zod context: team_dashboard_read false sin team", () => {
    const parsed = asesorLiderContextSchema.parse({
      team_dashboard_read: false,
      capabilities: ["create_for_any_advisor"],
      team: null,
    });
    assert.equal(isAsesorLiderDashboardMode(parsed), false);
    assert.equal(hasCapability(parsed, "create_for_any_advisor"), true);
  });

  it("pagination helpers", () => {
    const n = normalizeAsesorLiderPageOptions({ page: 0, pageSize: 999 });
    assert.equal(n.page, 1);
    assert.equal(n.pageSize, ASESOR_LIDER_MAX_PAGE_SIZE);
    assert.equal(n.from, 0);

    const def = normalizeAsesorLiderPageOptions({});
    assert.equal(def.pageSize, ASESOR_LIDER_DEFAULT_PAGE_SIZE);

    assert.equal(asesorLiderTotalPages(0, 25), 1);
    assert.equal(asesorLiderTotalPages(26, 25), 2);
    assert.equal(clampAsesorLiderPage(99, 26, 25), 2);
    assert.equal(clampAsesorLiderPage(0, 26, 25), 1);
  });
});
