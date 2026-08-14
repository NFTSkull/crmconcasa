import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { MockAdminProductionRepo } from "@/domain/admin-production/mock.repo";
import type { ExpedientesRepo } from "@/domain/expedientes/repo";
import type { ExpedienteMock } from "@/domain/expedientes/mock.repo";

function stub(partial: {
  id: string;
  nombre: string;
  nss: string;
  asesorId: string;
  asesorNombre: string;
  submitted: boolean;
  decision?: "pendiente" | "aprobado" | "no_cumple";
  monto?: number | null;
  pendingId?: string | null;
  solicitado?: string | null;
  updatedAt: string;
}): ExpedienteMock {
  return {
    id: partial.id,
    base: {
      programa: "mejoravit",
      nss: partial.nss,
      cliente_nombre: partial.nombre,
      telefono_cliente: "8110000000",
      direccion_opcional: "",
      asesorId: partial.asesorId,
      asesorNombre: partial.asesorNombre,
      asesorEmail: `${partial.asesorId}@example.com`,
      createdAt: "2026-07-01T15:00:00.000Z",
      origenMesa: "interno",
    },
    editorDecision: {
      decision: partial.decision ?? "pendiente",
      monto_aprobado: partial.monto ?? null,
      notas_revision: "",
      aprobadoAt: partial.decision === "aprobado" ? "2026-07-02T15:00:00.000Z" : null,
      noCumpleAt: partial.decision === "no_cumple" ? "2026-07-02T15:00:00.000Z" : null,
    },
    operativo: {
      submittedToMesa: partial.submitted,
      fechaEnvioMesa: partial.submitted ? "2026-07-20T15:00:00.000Z" : null,
      etapaActual: 1,
      subestado: "pendiente",
      cicloEstado: "activo",
      updatedAt: partial.updatedAt,
      motivoRechazo: null,
      comentarioRechazo: null,
      fechaCita: null,
    },
    reprecalificacionPendienteId: partial.pendingId ?? null,
    reprecalificacionPendiente: partial.solicitado
      ? { programa: "mejoravit", programaSolicitado: partial.solicitado }
      : null,
  } as ExpedienteMock;
}

describe("P182 /admin Resumen localizador", () => {
  const page = readFileSync(join(process.cwd(), "src/app/admin/page.tsx"), "utf8");

  it("query vacía no llama RPC; panel solo con query; KPIs separados", () => {
    assert.match(page, /isAdminClienteSearchQueryActive\(q\)/);
    assert.match(page, /searchClienteExpedientes/);
    assert.match(page, /AdminSearchResultadosSection/);
    assert.match(page, /Resumen del periodo/);
    assert.match(page, /hidden=\{activeTab !== "resumen"\}/);
    assert.match(page, /300/);
    assert.match(page, /searchSeqRef/);
    assert.match(page, /shouldApplyAdminSearchResponse/);
    assert.match(page, /AdminSearchExpedientePanel/);
    assert.match(page, /item=\{searchOpenItem\}/);
    assert.doesNotMatch(page, /row=\{searchOpenItem\}/);
  });

  it("mock: nombre, NSS, multi expediente, asesor, precal, mesa, reprecal, vacío", async () => {
    const naty = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const paty = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    const items = [
      stub({
        id: "e-naty",
        nombre: "Patricia P182 Naty",
        nss: "18239742449",
        asesorId: naty,
        asesorNombre: "Naty",
        submitted: false,
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
      stub({
        id: "e-paty",
        nombre: "Patricia P182 Paty",
        nss: "18239742449",
        asesorId: paty,
        asesorNombre: "Paty Gutierrez",
        submitted: false,
        updatedAt: "2026-08-02T00:00:00.000Z",
      }),
      stub({
        id: "e-mesa",
        nombre: "Cliente Mesa",
        nss: "18200000003",
        asesorId: naty,
        asesorNombre: "Naty",
        submitted: true,
        decision: "aprobado",
        monto: 80000,
        updatedAt: "2026-07-20T00:00:00.000Z",
      }),
      stub({
        id: "e-rep",
        nombre: "Reprecal",
        nss: "18200000005",
        asesorId: naty,
        asesorNombre: "Naty",
        submitted: true,
        decision: "aprobado",
        monto: 50000,
        pendingId: "int-1",
        solicitado: "compro_tu_casa",
        updatedAt: "2026-08-03T00:00:00.000Z",
      }),
    ];
    const repo = new MockAdminProductionRepo({
      listForAdmin: async () => items,
    } as unknown as ExpedientesRepo);

    const empty = await repo.searchClienteExpedientes({ buscar: "  " });
    assert.equal(empty.items.length, 0);

    const byName = await repo.searchClienteExpedientes({ buscar: "Patricia" });
    assert.equal(byName.items.length, 2);

    const byNss = await repo.searchClienteExpedientes({ buscar: "18239742449" });
    assert.equal(byNss.items.length, 2);

    const byAsesor = await repo.searchClienteExpedientes({
      buscar: "18239742449",
      asesorId: naty,
    });
    assert.equal(byAsesor.items.length, 1);
    assert.equal(byAsesor.items[0]?.expedienteId, "e-naty");

    const mesa = await repo.searchClienteExpedientes({ buscar: "Cliente Mesa" });
    assert.equal(mesa.items[0]?.submittedToMesa, true);
    assert.equal(mesa.items[0]?.editorDecision, "aprobado");
    assert.equal(mesa.items[0]?.montoAprobado, 80000);

    const rep = await repo.searchClienteExpedientes({ buscar: "Reprecal" });
    assert.equal(rep.items[0]?.precalPending, true);
    assert.equal(rep.items[0]?.programaSolicitado, "compro_tu_casa");

    const none = await repo.searchClienteExpedientes({ buscar: "zzz-no" });
    assert.equal(none.items.length, 0);
  });
});
