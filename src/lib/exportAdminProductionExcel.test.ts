import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accumulatePaginatedExport,
  assertExportHasNoPii,
  assertMesaExportHasNoEmail,
  buildAdminProductionWorkbook,
} from "./exportAdminProductionExcel";
import type { AdminPrecalSummary } from "@/domain/admin-production/repo";
import {
  emptyAdminMesaSeguimientoFields,
  type AdminProductionSummary,
} from "@/domain/admin-production/metrics";
import * as XLSX from "xlsx";

describe("exportAdminProductionExcel — paginación completa", () => {
  it("22. recupera más de 5000 filas en varias páginas", async () => {
    const total = 5200;
    const pageSize = 100;
    const pages = new Map<number, number[]>();
    for (let p = 1; p <= Math.ceil(total / pageSize); p += 1) {
      const from = (p - 1) * pageSize;
      const items = Array.from({ length: Math.min(pageSize, total - from) }, (_, i) => from + i);
      pages.set(p, items);
    }
    const out = await accumulatePaginatedExport({
      totalCount: total,
      firstPageItems: pages.get(1)!,
      fetchPage: async (page) => ({
        items: pages.get(page) ?? [],
        totalCount: total,
      }),
      label: "precalificaciones",
    });
    assert.equal(out.length, 5200);
    assert.equal(out[0], 0);
    assert.equal(out[5199], 5199);
  });

  it("23-24. detecta mismatch y no deja pasar parcial", async () => {
    await assert.rejects(
      () =>
        accumulatePaginatedExport({
          totalCount: 10,
          firstPageItems: [1, 2, 3],
          fetchPage: async () => ({ items: [], totalCount: 10 }),
          label: "precalificaciones",
        }),
      /Exportación incompleta/,
    );

    await assert.rejects(
      () =>
        accumulatePaginatedExport({
          totalCount: 4,
          firstPageItems: [1, 2],
          fetchPage: async () => ({ items: [3, 4], totalCount: 9 }),
          label: "enviados a Mesa",
        }),
      /total_count cambió/,
    );
  });

  it("25. workbook no incluye PII en encabezados", () => {
    const summary: AdminProductionSummary = {
      enviadosAMesa: 1,
      precalificacionesAprobadas: 1,
      precalificacionesNoCumple: 0,
      aprobadasMayorA20000: 0,
      montoAprobadoTotal: 1000,
    };
    const precalSummary: AdminPrecalSummary = {
      resueltasCount: 1,
      aprobadasCount: 1,
      noCumpleCount: 0,
      pendientesActualesCount: 0,
      mayores20000Count: 0,
      mejoravitAprobadasCount: 1,
      montoMejoravitTotal: 1000,
      montoMejoravitPromedio: 1000,
    };
    const wb = buildAdminProductionWorkbook({
      bounds: {
        preset: "hoy",
        fromDate: "2026-07-17",
        toDateInclusive: "2026-07-17",
        fromIso: "2026-07-17T06:00:00.000Z",
        toExclusiveIso: "2026-07-18T06:00:00.000Z",
      },
      summary,
      precalSummary,
      mesaEnvios: [],
      precalificaciones: [
        {
          expedienteId: "e1",
          fecha: "2026-07-17T12:00:00.000Z",
          aprobadoAt: "2026-07-17T12:00:00.000Z",
          noCumpleAt: null,
          clienteNombre: "Cliente Demo",
          asesorId: "as1",
          asesorNombre: "Asesor",
          asesorEmail: "a@x.com",
          decision: "aprobado",
          montoAprobadoAlAprobar: 1000,
          montoAprobadoActual: 1000,
          programa: "mejoravit",
        },
      ],
      asesores: [],
    });
    const ws = wb.Sheets.Precalificaciones!;
    const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
      header: 1,
    });
    assertExportHasNoPii(aoa as unknown[][]);
    assert.equal(aoa[0]?.[0], "Fecha canónica");
    assert.ok(!(aoa[0] ?? []).some((c) => String(c).toLowerCase().includes("nss")));
  });

  it("hoja Expedientes sin correo ni UUID; asesor sin nombre → fallback", () => {
    const summary: AdminProductionSummary = {
      enviadosAMesa: 1,
      precalificacionesAprobadas: 0,
      precalificacionesNoCumple: 0,
      aprobadasMayorA20000: 0,
      montoAprobadoTotal: 0,
    };
    const precalSummary: AdminPrecalSummary = {
      resueltasCount: 0,
      aprobadasCount: 0,
      noCumpleCount: 0,
      pendientesActualesCount: 0,
      mayores20000Count: 0,
      mejoravitAprobadasCount: 0,
      montoMejoravitTotal: 0,
      montoMejoravitPromedio: 0,
    };
    const wb = buildAdminProductionWorkbook({
      bounds: {
        preset: "hoy",
        fromDate: "2026-07-17",
        toDateInclusive: "2026-07-17",
        fromIso: "2026-07-17T06:00:00.000Z",
        toExclusiveIso: "2026-07-18T06:00:00.000Z",
      },
      summary,
      precalSummary,
      mesaEnvios: [
        {
          expedienteId: "11111111-1111-4111-8111-111111111111",
          fechaEnvioMesa: "2026-07-17T12:00:00.000Z",
          clienteNombre: "Cliente Demo",
          asesorId: "22222222-2222-4222-8222-222222222222",
          asesorNombre: null,
          programa: "mejoravit",
          etapaActual: 2,
          subestado: "en_proceso",
          cicloEstado: "activo",
          ...emptyAdminMesaSeguimientoFields("2026-07-17T12:00:00.000Z"),
        },
      ],
      precalificaciones: [],
      asesores: [],
    });
    const ws = wb.Sheets.Expedientes!;
    const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
      header: 1,
    });
    assert.equal(aoa[0]?.[0], "Fecha envío Mesa");
    assert.equal(aoa[0]?.[2], "Asesor");
    assert.equal(aoa[1]?.[2], "Asesor sin nombre registrado");
    assertMesaExportHasNoEmail(aoa as unknown[][]);
    const flat = JSON.stringify(aoa);
    assert.equal(flat.includes("11111111-1111"), false);
    assert.equal(flat.toLowerCase().includes("asesor_email"), false);
  });
});
