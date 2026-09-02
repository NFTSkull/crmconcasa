import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mapAppRoleToMockRole,
  mapMockRoleToSessionRole,
  SupabaseSessionError,
} from "@/domain/session/supabase.repo";

test("mapAppRoleToMockRole: mapea roles productivos a mock UI", () => {
  assert.equal(mapAppRoleToMockRole("asesor"), "asesor");
  assert.equal(mapAppRoleToMockRole("editor"), "editor");
  assert.equal(mapAppRoleToMockRole("super_admin"), "super_admin");
  assert.equal(mapAppRoleToMockRole("mesa_admin"), "mesa_control_admin");
  assert.equal(mapAppRoleToMockRole("mesa_interno"), "mesa_control_interno");
  assert.equal(mapAppRoleToMockRole("mesa_externo"), "mesa_control_externo");
});

test("mapAppRoleToMockRole: rechaza rol desconocido (sin revisor)", () => {
  assert.throws(
    () => mapAppRoleToMockRole("revisor"),
    (err: unknown) =>
      err instanceof SupabaseSessionError &&
      (err as Error).message.includes("no soportado"),
  );
});

test("mapMockRoleToSessionRole: colapsa mesa_control_* a mesa_control", () => {
  assert.equal(mapMockRoleToSessionRole("mesa_control_admin"), "mesa_control");
  assert.equal(mapMockRoleToSessionRole("mesa_control_interno"), "mesa_control");
  assert.equal(mapMockRoleToSessionRole("mesa_control_externo"), "mesa_control");
  assert.equal(mapMockRoleToSessionRole("mesa_control"), "mesa_control");
});

test("mapMockRoleToSessionRole: conserva roles directos", () => {
  assert.equal(mapMockRoleToSessionRole("asesor"), "asesor");
  assert.equal(mapMockRoleToSessionRole("editor"), "editor");
  assert.equal(mapMockRoleToSessionRole("super_admin"), "super_admin");
});

test("admin stage history: valida sesión antes de cada RPC protegida", () => {
  const src = readFileSync(
    join(process.cwd(), "src/domain/admin-stage-history/supabase.repo.ts"),
    "utf8",
  );

  assert.match(src, /auth\.getSession\(\)/);
  assert.match(src, /permission denied for function/i);
  assert.match(src, /Tu sesión de Super Admin expiró/);

  const guard = "await requireAdminStageHistorySession();";
  assert.equal(src.split(guard).length - 1, 4);

  for (const rpcName of [
    "admin_stage_history_report_summary",
    "admin_stage_history_report_page",
    "admin_stage_cohort_outcome_summary",
    "admin_stage_cohort_outcome_page",
  ]) {
    const rpcIndex = src.indexOf(`\"${rpcName}\"`);
    assert.ok(rpcIndex > 0, `${rpcName}: RPC presente`);
    const guardIndex = src.lastIndexOf(guard, rpcIndex);
    assert.ok(
      guardIndex >= 0 && guardIndex < rpcIndex,
      `${rpcName}: sesión validada antes de RPC`,
    );
  }
});
