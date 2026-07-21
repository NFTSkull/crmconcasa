import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import {
  defaultMesaAgendaClientFilters,
  type MesaAgendaCitasClientFilters,
} from "@/lib/mesaAgendaCitasUi";
import {
  buildMesaCitasExportFilename,
  buildMesaCitasWorkbook,
  collectMesaCitasForExport,
  formatMesaCitasExcelSubtitleDate,
  mapMesaCitaToExcelRow,
  mapMesaCitasExportUserMessage,
  MESA_CITAS_EXCEL_HEADERS,
  MESA_CITAS_EXCEL_SHEET_NAME,
  MESA_CITAS_EXCEL_TITLE,
  prepareMesaCitasExport,
  resolveMesaCitasExportDayYmd,
  workbookToMesaCitasXlsxArrayBuffer,
} from "@/lib/exportMesaCitasExcel";

function entry(
  overrides: Partial<MesaAgendaBookingEntry> & Pick<MesaAgendaBookingEntry, "bookingId">,
): MesaAgendaBookingEntry {
  return {
    expedienteId: "exp-1",
    bookingDate: "2026-07-21",
    bookingTime: "10:00",
    kind: "biometricos",
    status: "booked",
    locationId: "sede-centro",
    note: null,
    createdAt: "2026-07-01T10:00:00.000Z",
    cancelledAt: null,
    clienteNombre: "Juan Pérez",
    nss: "12345678901",
    etapaActual: 4,
    subestado: "en_proceso",
    submittedToMesa: true,
    asesor: { id: "asesor-1", fullName: "Ana Asesor", email: "ana@test.com" },
    createdBy: { id: "mesa-1", fullName: "Mesa", email: null },
    driveValidated: false,
    driveValidatedAt: null,
    driveValidatedBy: null,
    ...overrides,
  };
}

describe("exportMesaCitasExcel — contrato columnas y nombre", () => {
  it("headers exactos Fecha | NSS | Nombre completo", () => {
    assert.deepEqual([...MESA_CITAS_EXCEL_HEADERS], ["Fecha", "NSS", "Nombre completo"]);
  });

  it("filename citas-mesa-YYYY-MM-DD.xlsx", () => {
    assert.equal(buildMesaCitasExportFilename("2026-07-21"), "citas-mesa-2026-07-21.xlsx");
  });

  it("rechaza fecha inválida en filename", () => {
    assert.throws(() => buildMesaCitasExportFilename("21/07/2026"));
  });

  it("subtítulo en español mexicano", () => {
    const subtitle = formatMesaCitasExcelSubtitleDate("2026-07-21");
    assert.match(subtitle, /2026/);
    assert.match(subtitle, /julio/i);
  });
});

describe("exportMesaCitasExcel — alcance día + filtros", () => {
  const rows = [
    entry({ bookingId: "1", bookingDate: "2026-07-21", clienteNombre: "A", nss: "111" }),
    entry({
      bookingId: "2",
      bookingDate: "2026-07-22",
      clienteNombre: "B",
      nss: "222",
    }),
    entry({
      bookingId: "3",
      bookingDate: "2026-07-21",
      kind: "firmas",
      clienteNombre: "C",
      nss: "333",
      asesor: { id: "asesor-2", fullName: "Otro", email: null },
    }),
    entry({
      bookingId: "4",
      bookingDate: "2026-07-21",
      status: "cancelled",
      clienteNombre: "D",
      nss: "444",
    }),
  ];

  it("solo el día seleccionado", () => {
    const out = collectMesaCitasForExport(rows, "2026-07-21");
    // default: sin canceladas → 2 booked del 21 (no la cancelada)
    assert.equal(out.length, 2);
    assert.ok(out.every((r) => r.bookingDate === "2026-07-21"));
    assert.ok(out.every((r) => r.status === "booked"));
  });

  it("aplica filtro tipo sin depender de selección", () => {
    const filters: MesaAgendaCitasClientFilters = {
      ...defaultMesaAgendaClientFilters(),
      kindUi: "firmas",
    };
    const out = collectMesaCitasForExport(rows, "2026-07-21", filters);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.bookingId, "3");
  });

  it("includeCancelled respeta filtro activo", () => {
    const withCancelled = collectMesaCitasForExport(rows, "2026-07-21", {
      ...defaultMesaAgendaClientFilters(),
      includeCancelled: true,
    });
    assert.equal(withCancelled.length, 3);
  });

  it("exporta más de 100 filas del día (no límite P089)", () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      entry({
        bookingId: `b-${i}`,
        bookingDate: "2026-07-21",
        nss: String(10000000000 + i),
        clienteNombre: `Cliente ${i}`,
      }),
    );
    const prepared = prepareMesaCitasExport(many, "2026-07-21");
    assert.equal(prepared.ok, true);
    if (prepared.ok) assert.equal(prepared.rowCount, 120);
  });

  it("vacío → empty", () => {
    const prepared = prepareMesaCitasExport(rows, "2026-07-23");
    assert.deepEqual(prepared, { ok: false, reason: "empty" });
  });
});

describe("exportMesaCitasExcel — UI helpers B3", () => {
  it("resolveMesaCitasExportDayYmd: lista/dia usan selected/lista; semana usa detail", () => {
    assert.equal(
      resolveMesaCitasExportDayYmd({
        viewMode: "lista",
        selectedDay: "2026-07-21",
        weekDetailDay: "2026-07-22",
        listaStartDate: "2026-07-21",
      }),
      "2026-07-21",
    );
    assert.equal(
      resolveMesaCitasExportDayYmd({
        viewMode: "dia",
        selectedDay: "2026-07-18",
        weekDetailDay: null,
        listaStartDate: "2026-07-01",
      }),
      "2026-07-18",
    );
    assert.equal(
      resolveMesaCitasExportDayYmd({
        viewMode: "semana",
        selectedDay: "2026-07-21",
        weekDetailDay: "2026-07-23",
        listaStartDate: "2026-07-21",
      }),
      "2026-07-23",
    );
  });

  it("mensajes de usuario para empty/success", () => {
    assert.equal(
      mapMesaCitasExportUserMessage({ ok: false, reason: "empty" }),
      "No hay citas para exportar con la fecha y filtros actuales.",
    );
    assert.equal(
      mapMesaCitasExportUserMessage({
        ok: true,
        filename: "citas-mesa-2026-07-21.xlsx",
        rowCount: 2,
      }),
      "Se descargó citas-mesa-2026-07-21.xlsx (2 citas).",
    );
  });

  it("prepare no usa selección ni límite 100 (integración contrato)", () => {
    const many = Array.from({ length: 105 }, (_, i) =>
      entry({
        bookingId: `sel-${i}`,
        bookingDate: "2026-07-21",
        nss: String(10000000000 + i),
        clienteNombre: `N${i}`,
      }),
    );
    // Simula selección parcial: export ignora cualquier subset y toma todas del día.
    const selectedOnly = new Set(many.slice(0, 3).map((r) => r.bookingId));
    assert.equal(selectedOnly.size, 3);
    const prepared = prepareMesaCitasExport(many, "2026-07-21");
    assert.equal(prepared.ok, true);
    if (prepared.ok) assert.equal(prepared.rowCount, 105);
  });
});

describe("exportMesaCitasExcel — mapeo y workbook", () => {
  it("NSS y nombre como texto sanitizado; sin columnas extra", () => {
    const mapped = mapMesaCitaToExcelRow(
      entry({
        bookingId: "x",
        nss: "=1+1",
        clienteNombre: "+Hack",
        bookingDate: "2026-07-21",
      }),
    );
    assert.equal(mapped.nss, "'=1+1");
    assert.equal(mapped.nombreCompleto, "'+Hack");
    assert.deepEqual(Object.keys(mapped).sort(), ["fecha", "nombreCompleto", "nss"]);
  });

  it("workbook hoja Citas, título y NSS tipo string", () => {
    const exportRows = [
      mapMesaCitaToExcelRow(
        entry({ bookingId: "1", nss: "01234567890", clienteNombre: "Ana" }),
      ),
    ];
    const wb = buildMesaCitasWorkbook(exportRows, "2026-07-21");
    assert.deepEqual(wb.SheetNames, [MESA_CITAS_EXCEL_SHEET_NAME]);
    const ws = wb.Sheets[MESA_CITAS_EXCEL_SHEET_NAME]!;
    assert.equal(ws.A1?.v, MESA_CITAS_EXCEL_TITLE);
    assert.equal(ws.A3?.v, "Fecha");
    assert.equal(ws.B3?.v, "NSS");
    assert.equal(ws.C3?.v, "Nombre completo");
    assert.equal(ws.B4?.v, "01234567890");
    assert.equal(ws.B4?.t, "s");
    assert.ok(ws["!merges"] && ws["!merges"].length >= 2);
    assert.ok(ws["!autofilter"]);

    const buf = workbookToMesaCitasXlsxArrayBuffer(wb);
    assert.ok(buf.byteLength > 0);
    const roundTrip = XLSX.read(buf, { type: "array" });
    assert.deepEqual(roundTrip.SheetNames, [MESA_CITAS_EXCEL_SHEET_NAME]);
  });

  it("prepare incluye filename y no inventa columnas UUID/teléfono", () => {
    const prepared = prepareMesaCitasExport(
      [entry({ bookingId: "1", nss: "999", clienteNombre: "Solo Tres" })],
      "2026-07-21",
    );
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(prepared.filename, "citas-mesa-2026-07-21.xlsx");
    assert.equal(prepared.exportRows.length, 1);
    assert.deepEqual(prepared.exportRows[0], {
      fecha: "2026-07-21",
      nss: "999",
      nombreCompleto: "Solo Tres",
    });
  });
});
