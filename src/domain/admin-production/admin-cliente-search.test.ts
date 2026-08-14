import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clampAdminClienteSearchLimit,
  extractNssDigits,
  formatAdminSearchCoincidencias,
  isAdminClienteSearchQueryActive,
  labelAdminSearchEtapa,
  labelAdminSearchMesa,
  labelAdminSearchPrecalDecision,
  matchesAdminClienteSearchQuery,
  parseAdminClienteSearchPayload,
  shouldApplyAdminSearchResponse,
  adminSearchProgramaSolicitadoVisible,
  EMPTY_ADMIN_CLIENTE_SEARCH,
} from "./admin-cliente-search";

describe("P182 admin search cliente", () => {
  it("query vacía no es búsqueda activa", () => {
    assert.equal(isAdminClienteSearchQueryActive(""), false);
    assert.equal(isAdminClienteSearchQueryActive("   "), false);
    assert.equal(isAdminClienteSearchQueryActive("Patricia"), true);
  });

  it("match nombre exacto y parcial", () => {
    const f = {
      clienteNombre: "Patricia López",
      nss: "43139742449",
      asesorNombre: "Paty Gutierrez",
      asesorEmail: "paty@example.com",
      programa: "mejoravit",
    };
    assert.equal(matchesAdminClienteSearchQuery("Patricia López", f), true);
    assert.equal(matchesAdminClienteSearchQuery("Patricia", f), true);
    assert.equal(matchesAdminClienteSearchQuery("xxx", f), false);
  });

  it("match NSS completo y parcial + dígitos con guiones", () => {
    const f = {
      clienteNombre: "Ana",
      nss: "43139742449",
      asesorNombre: "Paty",
      programa: "mejoravit",
    };
    assert.equal(matchesAdminClienteSearchQuery("43139742449", f), true);
    assert.equal(matchesAdminClienteSearchQuery("42449", f), true);
    assert.equal(matchesAdminClienteSearchQuery("431-397-42449", f), true);
    assert.equal(matchesAdminClienteSearchQuery("P182 Patricia", {
      clienteNombre: "Ana",
      nss: "18239742449",
      programa: "mejoravit",
    }), false);
    assert.equal(extractNssDigits("431-397-42449"), "43139742449");
  });

  it("match asesor nombre/email", () => {
    const f = {
      clienteNombre: "Ana",
      nss: "11111111111",
      asesorNombre: "Paty Gutierrez",
      asesorEmail: "paty.gutierrez@concasa.mx",
      programa: "mejoravit",
    };
    assert.equal(matchesAdminClienteSearchQuery("Paty", f), true);
    assert.equal(matchesAdminClienteSearchQuery("paty.gutierrez@", f), true);
  });

  it("parse conserva dos expedientes mismo NSS", () => {
    const r = parseAdminClienteSearchPayload({
      items: [
        {
          expediente_id: "e1",
          cliente_nombre: "A",
          nss: "43139742449",
          submitted_to_mesa: false,
          etapa_actual: 1,
        },
        {
          expediente_id: "e2",
          cliente_nombre: "B",
          nss: "43139742449",
          submitted_to_mesa: false,
          etapa_actual: 1,
        },
      ],
      truncated: false,
      limit: 20,
    });
    assert.equal(r.items.length, 2);
    assert.deepEqual(
      r.items.map((i) => i.expedienteId),
      ["e1", "e2"],
    );
  });

  it("labels precal / mesa / etapa / re-precal programa", () => {
    assert.equal(labelAdminSearchPrecalDecision("pendiente"), "Pendiente de precalificación");
    assert.equal(labelAdminSearchPrecalDecision("aprobado"), "Aprobada");
    assert.equal(labelAdminSearchPrecalDecision("no_cumple"), "No cumple");
    assert.equal(labelAdminSearchMesa({ submittedToMesa: false }), "No enviado a Mesa");
    assert.equal(labelAdminSearchMesa({ submittedToMesa: true }), "Enviado a Mesa");
    assert.match(labelAdminSearchEtapa(1), /Etapa 1 · Integración/);
    assert.equal(
      adminSearchProgramaSolicitadoVisible("mejoravit", "compro_tu_casa"),
      "compro_tu_casa",
    );
    assert.equal(adminSearchProgramaSolicitadoVisible("mejoravit", "mejoravit"), null);
    assert.equal(formatAdminSearchCoincidencias(1), "1 coincidencia");
    assert.equal(formatAdminSearchCoincidencias(2), "2 coincidencias");
  });

  it("stale response no pisa query nueva", () => {
    assert.equal(shouldApplyAdminSearchResponse(1, 2), false);
    assert.equal(shouldApplyAdminSearchResponse(2, 2), true);
  });

  it("limit clamp 1..50", () => {
    assert.equal(clampAdminClienteSearchLimit(0), 1);
    assert.equal(clampAdminClienteSearchLimit(999), 50);
    assert.equal(clampAdminClienteSearchLimit(20), 20);
    assert.equal(EMPTY_ADMIN_CLIENTE_SEARCH.items.length, 0);
  });

  it("migración 179 + page Resumen localizador", () => {
    const mig = readFileSync(
      join(process.cwd(), "supabase/migrations/179_admin_search_cliente_expedientes.sql"),
      "utf8",
    );
    assert.match(mig, /admin_search_cliente_expedientes/);
    assert.match(mig, /__admin_require_super_admin/);
    assert.match(mig, /SET search_path = public/);
    assert.doesNotMatch(mig, /p_from/);
    assert.doesNotMatch(mig, /GROUP BY e\.nss/);
    assert.match(mig, /deleted_at IS NULL/);
    const page = readFileSync(join(process.cwd(), "src/app/admin/page.tsx"), "utf8");
    assert.match(page, /AdminSearchResultadosSection/);
    assert.match(page, /Resumen del periodo/);
    assert.match(page, /searchClienteExpedientes/);
    assert.match(page, /searchSeqRef/);
    assert.doesNotMatch(page, /admin_get_production_summary[\s\S]*p_buscar/);
  });
});
