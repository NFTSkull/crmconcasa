import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_PRODUCTION_EXPAND_PAGE_SIZE,
  adminProductionExpandCountMismatch,
  adminProductionExpandExpedientesCtaLabel,
  adminProductionExpandIdentityKey,
  adminProductionExpandNeedsPagination,
  adminProductionExpandScopeKey,
  adminProductionExpandSubtitle,
  adminProductionExpandTitle,
  adminProductionPrimaryMetric,
  buildAdminProductionExpandFilters,
  buildAdminProductionExpandIdentity,
  shouldApplyAdminProductionExpandResult,
  shouldShowProductionStageSubtitleUnderName,
} from "./admin-production-expand";
import { adminProductionSelectedStageCount } from "./admin-production-stage-filter";
import { resolveAdminPeriodBounds } from "./period";
import type { AdminAsesorProductionRow } from "./repo";
import type { ExpedientesRepo } from "@/domain/expedientes/repo";
import type { ExpedienteMock } from "@/domain/expedientes/mock.repo";
import { MockAdminProductionRepo } from "./mock.repo";

const bounds = resolveAdminPeriodBounds({
  preset: "personalizado",
  customFrom: "2026-07-01",
  customToInclusive: "2026-07-31",
});

function stubExpediente(partial: {
  id: string;
  asesorId: string;
  asesorNombre: string;
  fechaEnvioMesa: string;
  etapaActual?: number;
}): ExpedienteMock {
  return {
    id: partial.id,
    base: {
      programa: "mejoravit",
      nss: "12345678901",
      cliente_nombre: `Cliente ${partial.id}`,
      telefono_cliente: "8110000000",
      direccion_opcional: "",
      asesorId: partial.asesorId,
      asesorNombre: partial.asesorNombre,
      asesorEmail: `${partial.asesorId}@example.com`,
      createdAt: partial.fechaEnvioMesa,
      origenMesa: "interno",
    },
    editorDecision: {
      decision: "aprobado",
      monto_aprobado: 30000,
      notas_revision: "",
      aprobadoAt: partial.fechaEnvioMesa,
      noCumpleAt: null,
      montoAprobadoAlAprobar: 30000,
    },
    operativo: {
      submittedToMesa: true,
      fechaEnvioMesa: partial.fechaEnvioMesa,
      etapaActual: partial.etapaActual ?? 2,
      subestado: "en_proceso",
      cicloEstado: "activo",
      updatedAt: partial.fechaEnvioMesa,
    },
  } as ExpedienteMock;
}

describe("Admin producción expand + métrica etapa", () => {
  it("P1 sin etapa: ENVIADOS = enviadosAMesa", () => {
    const m = adminProductionPrimaryMetric({
      etapaPasoFilter: "todas",
      stageCount: null,
      enviadosAMesa: 42,
    });
    assert.deepEqual(m, { label: "ENVIADOS", value: 42 });
    assert.equal(shouldShowProductionStageSubtitleUnderName(), false);
  });

  it("P2 Firmado: métrica FIRMADO=stageCount, no ENVIADOS 42", () => {
    // Admin paso 9 = Firmado → interna [11]
    const m = adminProductionPrimaryMetric({
      etapaPasoFilter: "9",
      stageCount: 2,
      enviadosAMesa: 42,
    });
    assert.equal(m.label, "FIRMADO");
    assert.equal(m.value, 2);
    assert.notEqual(m.label, "ENVIADOS");
  });

  it("P3 Paty: Firmado 2 aunque enviados 27", () => {
    const m = adminProductionPrimaryMetric({
      etapaPasoFilter: "9",
      stageCount: 2,
      enviadosAMesa: 27,
    });
    assert.deepEqual(m, { label: "FIRMADO", value: 2 });
  });

  it("P4/P8 filtros Expandir: asesor + bounds + etapas Firmado / legacy firma", () => {
    const firmado = buildAdminProductionExpandFilters({
      filtersBase: { bounds, estado: "todos" },
      asesorId: "marce",
      etapaPaso: "9",
      page: 1,
    });
    assert.equal(firmado.asesorId, "marce");
    assert.deepEqual(firmado.etapaActuales, [11]);
    assert.equal(firmado.etapaActual, 11);
    assert.equal(firmado.pageSize, ADMIN_PRODUCTION_EXPAND_PAGE_SIZE);

    const listoFirma = buildAdminProductionExpandFilters({
      filtersBase: { bounds, estado: "activos" },
      asesorId: "a",
      etapaPaso: "8",
      page: 1,
    });
    assert.deepEqual(listoFirma.etapaActuales, [9, 10]);
    assert.equal(listoFirma.etapaActual, null);
  });

  it("P7 sin etapa: Expandir no fija etapaActuales", () => {
    const f = buildAdminProductionExpandFilters({
      filtersBase: { bounds, estado: "todos" },
      asesorId: "marce",
      etapaPaso: "todas",
      page: 1,
    });
    assert.equal(f.etapaActuales, null);
    assert.equal(f.etapaActual, null);
    assert.equal(
      adminProductionExpandTitle({ etapaPaso: "todas" }),
      "Expedientes enviados en el periodo",
    );
  });

  it("P9 race: respuesta A no aplica si identidad activa es B", () => {
    const a = adminProductionExpandIdentityKey(
      buildAdminProductionExpandIdentity({
        asesorId: "marce",
        bounds,
        etapaPaso: "9",
        estado: "todos",
        page: 1,
      }),
    );
    const b = adminProductionExpandIdentityKey(
      buildAdminProductionExpandIdentity({
        asesorId: "paty",
        bounds,
        etapaPaso: "9",
        estado: "todos",
        page: 1,
      }),
    );
    assert.equal(shouldApplyAdminProductionExpandResult(b, a), false);
    assert.equal(shouldApplyAdminProductionExpandResult(b, b), true);
  });

  it("P10 cambio de etapa invalida scope", () => {
    const base = {
      asesorId: "marce",
      fromIso: bounds.fromIso,
      toExclusiveIso: bounds.toExclusiveIso,
      estado: "todos" as const,
    };
    const k1 = adminProductionExpandScopeKey({ ...base, etapaPaso: "9" });
    const k2 = adminProductionExpandScopeKey({ ...base, etapaPaso: "10" });
    assert.notEqual(k1, k2);
  });

  it("P11 totalCount >25 requiere paginación (no truncar)", () => {
    assert.equal(adminProductionExpandNeedsPagination(25), false);
    assert.equal(adminProductionExpandNeedsPagination(26), true);
  });

  it("P13 CTA / títulos / mismatch", () => {
    assert.equal(
      adminProductionExpandExpedientesCtaLabel("9"),
      "Ver todos en Expedientes",
    );
    assert.equal(
      adminProductionExpandExpedientesCtaLabel("todas"),
      "Ver expedientes de este asesor",
    );
    assert.match(adminProductionExpandTitle({ etapaPaso: "9" }), /Firmado/);
    assert.match(
      adminProductionExpandSubtitle({
        totalCount: 2,
        advisorLabel: "Marce Ramirez",
        etapaPaso: "9",
      }),
      /2 expedientes de Marce Ramirez/,
    );
    assert.equal(
      adminProductionExpandCountMismatch({ stageCount: 2, totalCount: 2 }),
      false,
    );
    assert.equal(
      adminProductionExpandCountMismatch({ stageCount: 2, totalCount: 3 }),
      true,
    );
  });
});

describe("Admin producción expand — equivalencia mock stageCount vs list", () => {
  it("P5/P6 stageCount === list.totalCount; solo Firmado", async () => {
    const marce = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const items = [
      stubExpediente({
        id: "m1",
        asesorId: marce,
        asesorNombre: "Marce",
        fechaEnvioMesa: "2026-07-10T15:00:00.000Z",
        etapaActual: 11,
      }),
      stubExpediente({
        id: "m2",
        asesorId: marce,
        asesorNombre: "Marce",
        fechaEnvioMesa: "2026-07-11T15:00:00.000Z",
        etapaActual: 11,
      }),
      stubExpediente({
        id: "m3",
        asesorId: marce,
        asesorNombre: "Marce",
        fechaEnvioMesa: "2026-07-12T15:00:00.000Z",
        etapaActual: 5,
      }),
    ];
    const stubRepo = {
      listForAdmin: async () => items,
    } as unknown as ExpedientesRepo;
    const repo = new MockAdminProductionRepo(stubRepo);
    const rows = await repo.listByAsesor({ bounds, estado: "todos" });
    const row = rows.find((r) => r.asesorId === marce);
    assert.ok(row);
    assert.equal(row.enviadosAMesa, 3);
    const stageCount = adminProductionSelectedStageCount(row, [11]);
    assert.equal(stageCount, 2);

    const page = await repo.listMesaEnviosPage(
      buildAdminProductionExpandFilters({
        filtersBase: { bounds, estado: "todos" },
        asesorId: marce,
        etapaPaso: "9",
        page: 1,
      }),
    );
    assert.equal(page.totalCount, stageCount);
    assert.equal(page.items.length, 2);
    assert.ok(page.items.every((i) => i.etapaActual === 11));
    assert.ok(page.items.every((i) => i.asesorId === marce));
  });

  it("P15: helper no dispara queries (puro)", () => {
    const row: AdminAsesorProductionRow = {
      asesorId: "x",
      asesorNombre: "X",
      asesorEmail: null,
      enviadosAMesa: 10,
      precalificacionesAprobadas: 1,
      precalificacionesNoCumple: 0,
      aprobadasMayorA20000: 0,
      montoAprobadoTotal: 0,
      etapas: { "11": 2 },
    };
    assert.equal(adminProductionSelectedStageCount(row, [11]), 2);
  });
});
