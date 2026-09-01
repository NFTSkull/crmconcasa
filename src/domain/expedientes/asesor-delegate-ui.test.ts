import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildAsesorInboxListInput } from "./asesor-inbox-ui";
import {
  CAP_CREATE_FOR_ANY_ADVISOR,
  CAP_INTEGRATE_FOR_ANY_ADVISOR,
  hasCapability,
} from "../asesor-lider/rpc";

const EMPTY_FILTERS = {
  buscar: "",
  decision: "",
  estatusOperativo: "",
  resultadoReal: "",
  programa: "",
  etapaExacta: "",
  fechaDesde: "",
  fechaHasta: "",
};

describe("P208 asesor delegado UI (F1–F13)", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/asesor/page.tsx"),
    "utf8",
  );
  const bar = readFileSync(
    join(process.cwd(), "src/components/asesor/AsesorOperacionDelegadaBar.tsx"),
    "utf8",
  );
  const nueva = readFileSync(
    join(process.cwd(), "src/app/asesor/nueva/page.tsx"),
    "utf8",
  );

  it("F1 usuario normal: inbox sin barra delegada obligatoria", () => {
    assert.match(page, /AsesorDashboardNormalPage/);
    assert.match(page, /canIntegrateForAny && asesoresOrg/);
    assert.doesNotMatch(page, /adriana\.reyes/i);
    assert.doesNotMatch(page, /hector\.nunez/i);
  });

  it("F2 create_for_any: selector en /asesor/nueva por capability", () => {
    assert.match(nueva, /CAP_CREATE_FOR_ANY_ADVISOR/);
    assert.match(nueva, /canCreateForAny/);
    assert.match(nueva, /listAsesoresActivosOrg/);
    assert.match(nueva, /targetAsesorId/);
  });

  it("F3 integrate_for_any: inbox filtra por owner_asesor_id", () => {
    const input = buildAsesorInboxListInput({
      page: 1,
      ownerAsesorId: "00000000-0000-4000-8001-000000000099",
      filters: EMPTY_FILTERS,
      quickFilter: "todos",
    });
    assert.equal(input.owner_asesor_id, "00000000-0000-4000-8001-000000000099");
    assert.match(page, /ownerAsesorId/);
    assert.match(page, /buildAsesorInboxListInput/);
  });

  it("F4 muestra asesor titular claramente", () => {
    assert.match(bar, /Trabajando para:/);
    assert.match(bar, /Titular del expediente/);
    assert.match(bar, /asesor-delegado-titular-label/);
    assert.match(page, /Expedientes del asesor titular/);
  });

  it("F5 permisos por capability, no email", () => {
    assert.match(page, /CAP_INTEGRATE_FOR_ANY_ADVISOR/);
    assert.match(page, /CAP_CREATE_FOR_ANY_ADVISOR/);
    assert.match(page, /hasCapability/);
    const ctx = {
      team_dashboard_read: false,
      capabilities: [CAP_INTEGRATE_FOR_ANY_ADVISOR],
      team: null,
    };
    assert.equal(hasCapability(ctx, CAP_INTEGRATE_FOR_ANY_ADVISOR), true);
    assert.equal(hasCapability(ctx, CAP_CREATE_FOR_ANY_ADVISOR), false);
  });

  it("F6/F7 sin hardcode org ni acciones Mesa en barra delegada", () => {
    assert.doesNotMatch(bar, /mesa_take_expediente|mesa_admin|MesaControl/i);
    assert.doesNotMatch(bar, /book_biometricos|agenda_sheet/i);
  });

  it("F8 capability gate en RPC inbox (repo)", () => {
    const repo = readFileSync(
      join(process.cwd(), "src/domain/expedientes/supabase.repo.ts"),
      "utf8",
    );
    assert.match(repo, /p_owner_asesor_id|owner_asesor_id/);
  });

  it("F9 selector delegado usa list_asesores_activos_org team-scoped", () => {
    const rpc = readFileSync(
      join(process.cwd(), "src/domain/asesor-lider/supabase.repo.ts"),
      "utf8",
    );
    assert.match(page, /listAsesoresActivosOrg/);
    assert.match(rpc, /list_asesores_activos_org/);
    const mig = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260901192000_asesor_integrate_for_any_advisor_p208.sql",
      ),
      "utf8",
    );
    assert.match(mig, /asesor_comparten_equipo_activo\(v_actor_id, p\.id\)/);
  });

  it("F10 selector incluye líder del equipo compartido", () => {
    assert.match(bar, /asesor-delegado-owner-select/);
    assert.match(bar, /ownerOptions/);
    assert.match(page, /asesoresOrg/);
  });

  it("F11 list RPC filtra por equipo, no todos los asesores org", () => {
    const mig = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260901192000_asesor_integrate_for_any_advisor_p208.sql",
      ),
      "utf8",
    );
    assert.doesNotMatch(
      mig.match(/list_asesores_activos_org[\s\S]*?CREATE OR REPLACE FUNCTION/)?.[0] ?? "",
      /FROM public\.profiles p[\s\S]*app_role = 'asesor';$/,
    );
    assert.match(mig, /list_asesores_activos_org[\s\S]*asesor_comparten_equipo_activo/);
  });

  it("F12 inbox manual target fuera de equipo: server RPC valida owner", () => {
    const mig = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260901192000_asesor_integrate_for_any_advisor_p208.sql",
      ),
      "utf8",
    );
    assert.match(mig, /asesor_list_expedientes_page[\s\S]*asesor_comparten_equipo_activo/);
    assert.match(mig, /asesor_list_expedientes_page[\s\S]*42501/);
    assert.match(page, /ownerAsesorId/);
  });

  it("F13 miembro Team Silvia sin caps: UI inbox normal", () => {
    assert.match(page, /AsesorDashboardNormalPage/);
    assert.match(page, /canIntegrateForAny && asesoresOrg/);
    assert.match(page, /!canCreateForAny && !canIntegrateForAny/);
  });
});
