import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as XLSX from "xlsx";

import type { AdminPrecalPerformanceResult } from "@/domain/admin-precal-performance";
import { buildAdminPrecalPerformanceWorkbook } from "./exportAdminPrecalPerformanceExcel";

const fixture: AdminPrecalPerformanceResult = {
  summary: {
    totalPrecalificaciones: 4,
    nssUnicos: 2,
    nssCompartidos: 1,
    reprecalificaciones: 1,
    aprobadas: 3,
    noCumple: 1,
    pendientes: 0,
    resueltas: 4,
    tasaAprobacionPct: 75,
    montoPromedio: 100000,
    montoTotalAdmin: 300000,
    expedientesGenerados: 2,
    expedientesEnMesa: 1,
    conversionMesaPct: 50,
    casosMayor20k: 2,
    casosMayor20kEnMesa: 1,
    conversionMayor20kPct: 50,
    topadosNss: 1,
    topadosNssEnMesa: 1,
    topadosConversionPct: 100,
  },
  asesores: [
    {
      asesorId: "a1",
      asesorNombre: "ANETTE PEREZ",
      asesorEmail: "anette@concasa.mx",
      totalPrecalificaciones: 3,
      nssUnicos: 2,
      nssCompartidos: 1,
      reprecalificaciones: 1,
      expedientesGenerados: 2,
      expedientesEnMesa: 1,
      casosMayor20k: 2,
      casosMayor20kEnMesa: 1,
      aprobadas: 2,
      noCumple: 1,
      pendientes: 0,
      tasaAprobacionPct: 66.7,
      montoPromedio: 110000,
      topadosNss: 1,
      topadosNssEnMesa: 1,
      conversionMesaPct: 50,
      conversionMayor20kPct: 50,
    },
  ],
  items: [
    {
      attemptKey: "1",
      intentoId: null,
      expedienteId: "e1",
      fecha: "2026-09-30T15:00:00.000Z",
      nss: "09001234567",
      nssPrecalHistoricas: 2,
      nssPrecalPeriodo: 2,
      isReprecalificacion: false,
      compartidoEntreAsesores: true,
      asesoresNssCount: 2,
      asesoresNss: [
        {
          asesorId: "a1",
          asesorNombre: "ANETTE PEREZ",
          asesorEmail: "anette@concasa.mx",
          precalificaciones: 1,
          reprecalificaciones: 0,
          aprobadas: 1,
          noCumple: 0,
          pendientes: 0,
          expedientes: 1,
          expedientesEnMesa: 1,
          montoPromedio: 169000,
        },
        {
          asesorId: "a2",
          asesorNombre: "MARCE RAMIREZ",
          asesorEmail: "marce@concasa.mx",
          precalificaciones: 1,
          reprecalificaciones: 0,
          aprobadas: 1,
          noCumple: 0,
          pendientes: 0,
          expedientes: 1,
          expedientesEnMesa: 0,
          montoPromedio: 120000,
        },
      ],
      clienteNombre: "CLIENTE UNO",
      asesorId: "a1",
      asesorNombre: "ANETTE PEREZ",
      asesorEmail: "anette@concasa.mx",
      precalificadorOrigenId: null,
      precalificadorNombre: null,
      precalificadorEmail: null,
      programa: "mejoravit",
      decision: "aprobado",
      montoAprobado: 169000,
      aprobadoMayor20k: true,
      topado169k: true,
      submittedToMesa: true,
      fechaEnvioMesa: "2026-09-30T17:00:00.000Z",
      etapaActual: 2,
      cicloEstado: "activo",
      subestado: "pendiente",
    },
    {
      attemptKey: "2",
      intentoId: "i2",
      expedienteId: "e1",
      fecha: "2026-09-30T18:00:00.000Z",
      nss: "09001234567",
      nssPrecalHistoricas: 2,
      nssPrecalPeriodo: 2,
      isReprecalificacion: true,
      compartidoEntreAsesores: true,
      asesoresNssCount: 2,
      asesoresNss: [],
      clienteNombre: "CLIENTE UNO",
      asesorId: "a1",
      asesorNombre: "ANETTE PEREZ",
      asesorEmail: "anette@concasa.mx",
      precalificadorOrigenId: "p1",
      precalificadorNombre: "PRECALIFICADOR ANETTE",
      precalificadorEmail: "precal.anette@concasa.mx",
      programa: "mejoravit",
      decision: "aprobado",
      montoAprobado: 120000,
      aprobadoMayor20k: true,
      topado169k: false,
      submittedToMesa: true,
      fechaEnvioMesa: "2026-09-30T17:00:00.000Z",
      etapaActual: 2,
      cicloEstado: "activo",
      subestado: "pendiente",
    },
  ],
  totalCount: 2,
  page: 1,
  pageSize: 100,
  detailFilter: "todos",
  generatedAt: "2026-09-30T20:00:00.000Z",
};

describe("Excel rendimiento de precalificaciones", () => {
  it("incluye hojas claras con NSS como texto y cruces entre asesores", () => {
    const wb = buildAdminPrecalPerformanceWorkbook({
      data: fixture,
      fromIso: "2026-09-30T06:00:00.000Z",
      toExclusiveIso: "2026-10-01T06:00:00.000Z",
      periodoLabel: "2026-09-30 — 2026-09-30",
      asesorFiltroLabel: "Todos los asesores",
    });

    assert.deepEqual(wb.SheetNames, [
      "Resumen",
      "Rendimiento por asesor",
      "Todas las precalificaciones",
      "NSS compartidos",
      "Re-precalificaciones",
    ]);

    const detail = XLSX.utils.sheet_to_json<(string | number | null)[]>(
      wb.Sheets["Todas las precalificaciones"]!,
      { header: 1 },
    );
    assert.equal(detail[0]?.[1], "NSS");
    assert.equal(detail[1]?.[1], "09001234567");
    assert.equal(wb.Sheets["Todas las precalificaciones"]?.B2?.t, "s");
    assert.equal(detail[1]?.[6], "Sí");
    assert.match(String(detail[1]?.[8] ?? ""), /ANETTE PEREZ/);
    assert.match(String(detail[1]?.[8] ?? ""), /MARCE RAMIREZ/);

    const shared = XLSX.utils.sheet_to_json<(string | number | null)[]>(
      wb.Sheets["NSS compartidos"]!,
      { header: 1 },
    );
    assert.equal(shared[0]?.[0], "NSS");
    assert.equal(shared[1]?.[0], "09001234567");
    assert.equal(shared[1]?.[2], "ANETTE PEREZ");
  });

  it("la hoja de asesor usa Expedientes a Mesa y evita llamar expediente al caso precalificado", () => {
    const wb = buildAdminPrecalPerformanceWorkbook({
      data: fixture,
      fromIso: "2026-09-30T06:00:00.000Z",
      toExclusiveIso: "2026-10-01T06:00:00.000Z",
      periodoLabel: "Hoy",
    });
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(
      wb.Sheets["Rendimiento por asesor"]!,
      { header: 1 },
    );
    assert.ok((rows[0] ?? []).includes("Casos precalificados distintos"));
    assert.ok((rows[0] ?? []).includes("Casos aprobados > $20k"));
    assert.ok((rows[0] ?? []).includes("> $20k a Mesa"));
    assert.ok((rows[0] ?? []).includes("% > $20k a Mesa"));
    assert.ok(!(rows[0] ?? []).includes("% conversión a Mesa"));
  });
});
