import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import {
  defaultMesaAgendaClientFilters,
  type MesaAgendaCitasClientFilters,
} from "@/lib/mesaAgendaCitasUi";
import {
  buildMesaCitasExcelTitle,
  buildMesaCitasExportFilename,
  buildMesaCitasWorkbook,
  collectMesaCitasForExport,
  formatMesaCitasExcelVisibleDate,
  mapMesaCitaToExcelRow,
  mapMesaCitasExportUserMessage,
  MESA_CITAS_EXCEL_HEADERS,
  MESA_CITAS_EXCEL_SHEET_NAME,
  MESA_CITAS_TEMPLATE_FS_RELATIVE,
  prepareMesaCitasExport,
  resolveMesaCitasExportDayYmd,
  workbookToMesaCitasXlsxArrayBuffer,
} from "@/lib/exportMesaCitasExcel";

function loadTemplateBuffer(): ArrayBuffer {
  const buf = readFileSync(join(process.cwd(), MESA_CITAS_TEMPLATE_FS_RELATIVE));
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
}

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

describe("exportMesaCitasExcel — plantilla oficial P107", () => {
  it("plantilla carga correctamente desde public/templates", async () => {
    const buffer = loadTemplateBuffer();
    assert.ok(buffer.byteLength > 0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet(MESA_CITAS_EXCEL_SHEET_NAME);
    assert.ok(ws);
    assert.equal(String(ws!.getCell("A1").value ?? ""), "CITAS DEL DÍA — DD/MM/YYYY");
    assert.equal(String(ws!.getCell("A2").value ?? ""), "Fecha");
    assert.equal(String(ws!.getCell("B2").value ?? ""), "NSS");
    assert.match(
      String(ws!.getCell("C2").value ?? ""),
      /Nombre \(Nombre completo con apellidos\)/,
    );
  });

  it("headers exactos Fecha | NSS | Nombre (…)", () => {
    assert.deepEqual([...MESA_CITAS_EXCEL_HEADERS], [
      "Fecha",
      "NSS",
      "Nombre (Nombre completo con apellidos)",
    ]);
  });

  it("filename citas-mesa-YYYY-MM-DD.xlsx", () => {
    assert.equal(buildMesaCitasExportFilename("2026-07-21"), "citas-mesa-2026-07-21.xlsx");
  });

  it("fecha visible DD/MM/YYYY y título oficial", () => {
    assert.equal(formatMesaCitasExcelVisibleDate("2026-07-21"), "21/07/2026");
    assert.equal(
      buildMesaCitasExcelTitle("2026-07-21"),
      "CITAS DEL DÍA — 21/07/2026",
    );
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

  it("exporta más de 100 filas del día (no límite P089)", async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      entry({
        bookingId: `b-${i}`,
        bookingDate: "2026-07-21",
        nss: String(10000000000 + i),
        clienteNombre: `Cliente ${i}`,
      }),
    );
    const prepared = await prepareMesaCitasExport(
      many,
      "2026-07-21",
      defaultMesaAgendaClientFilters(),
      undefined,
      loadTemplateBuffer(),
    );
    assert.equal(prepared.ok, true);
    if (prepared.ok) assert.equal(prepared.rowCount, 120);
  });

  it("cero citas no rompe (empty)", async () => {
    const prepared = await prepareMesaCitasExport(
      rows,
      "2026-07-23",
      defaultMesaAgendaClientFilters(),
      undefined,
      loadTemplateBuffer(),
    );
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
});

describe("exportMesaCitasExcel — mapeo y workbook plantilla", () => {
  it("NSS y nombre como texto sanitizado; solo tres columnas", () => {
    const mapped = mapMesaCitaToExcelRow(
      entry({
        bookingId: "x",
        nss: "=1+1",
        clienteNombre: "+Hack",
        bookingDate: "2026-07-21",
      }),
    );
    assert.equal(mapped.fecha, "21/07/2026");
    assert.equal(mapped.nss, "'=1+1");
    assert.equal(mapped.nombreCompleto, "'+Hack");
    assert.deepEqual(Object.keys(mapped).sort(), ["fecha", "nombreCompleto", "nss"]);
  });

  it("workbook: título, 3 columnas, NSS texto con ceros, estilos tras round-trip", async () => {
    const exportRows = [
      mapMesaCitaToExcelRow(
        entry({ bookingId: "1", nss: "01234567890", clienteNombre: "Ana López" }),
      ),
      mapMesaCitaToExcelRow(
        entry({
          bookingId: "2",
          nss: "09876543210",
          clienteNombre: "Bruno Díaz",
          bookingTime: "11:00",
        }),
      ),
    ];
    const wb = await buildMesaCitasWorkbook(
      exportRows,
      "2026-07-21",
      loadTemplateBuffer(),
    );
    assert.deepEqual(wb.worksheets.map((s) => s.name), [MESA_CITAS_EXCEL_SHEET_NAME]);
    const ws = wb.getWorksheet(MESA_CITAS_EXCEL_SHEET_NAME)!;
    assert.equal(String(ws.getCell("A1").value), "CITAS DEL DÍA — 21/07/2026");
    assert.equal(String(ws.getCell("A2").value), "Fecha");
    assert.equal(String(ws.getCell("B2").value), "NSS");
    assert.equal(
      String(ws.getCell("C2").value),
      "Nombre (Nombre completo con apellidos)",
    );
    assert.equal(String(ws.getCell("A3").value), "21/07/2026");
    assert.equal(String(ws.getCell("B3").value), "01234567890");
    assert.equal(String(ws.getCell("C3").value), "Ana López");
    assert.equal(ws.getCell("B3").numFmt, "@");

    // Solo 3 columnas: D3 vacío
    assert.equal(ws.getCell("D3").value, null);

    // Estilos principales de plantilla
    const titleFill = ws.getCell("A1").fill as ExcelJS.FillPattern;
    assert.equal(titleFill?.pattern, "solid");
    assert.ok(String(titleFill?.fgColor?.argb ?? "").toUpperCase().endsWith("6B2D8B"));
    const headerFill = ws.getCell("A2").fill as ExcelJS.FillPattern;
    assert.ok(String(headerFill?.fgColor?.argb ?? "").toUpperCase().endsWith("1F4E79"));
    assert.equal(ws.getCell("A2").font?.color?.argb?.toUpperCase(), "FFFFFFFF");
    const row3Fill = ws.getCell("A3").fill as ExcelJS.FillPattern;
    const row4Fill = ws.getCell("A4").fill as ExcelJS.FillPattern;
    assert.ok(String(row3Fill?.fgColor?.argb ?? "").toUpperCase().endsWith("D6EAF8"));
    assert.ok(String(row4Fill?.fgColor?.argb ?? "").toUpperCase().endsWith("FFFFFF"));
    assert.ok(ws.getCell("A3").border?.top);
    assert.ok((ws.getColumn(3).width ?? 0) >= 40);

    const buf = await workbookToMesaCitasXlsxArrayBuffer(wb);
    assert.ok(buf.byteLength > 0);
    const roundTrip = new ExcelJS.Workbook();
    await roundTrip.xlsx.load(buf);
    const rt = roundTrip.getWorksheet(MESA_CITAS_EXCEL_SHEET_NAME)!;
    assert.equal(String(rt.getCell("B3").value), "01234567890");
    const rtTitle = rt.getCell("A1").fill as ExcelJS.FillPattern;
    assert.ok(String(rtTitle?.fgColor?.argb ?? "").toUpperCase().endsWith("6B2D8B"));
    const rtHeader = rt.getCell("A2").fill as ExcelJS.FillPattern;
    assert.ok(String(rtHeader?.fgColor?.argb ?? "").toUpperCase().endsWith("1F4E79"));
    // Dimensión ajustada (sin cientos de filas)
    assert.equal(rt.rowCount, 4);
    assert.match(String(rt.dimensions ?? ""), /^A1:C4$/i);
  });

  it("prepare incluye filename y fecha DD/MM; sin UUID/teléfono", async () => {
    const prepared = await prepareMesaCitasExport(
      [entry({ bookingId: "1", nss: "999", clienteNombre: "Solo Tres" })],
      "2026-07-21",
      defaultMesaAgendaClientFilters(),
      undefined,
      loadTemplateBuffer(),
    );
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(prepared.filename, "citas-mesa-2026-07-21.xlsx");
    assert.equal(prepared.exportRows.length, 1);
    assert.deepEqual(prepared.exportRows[0], {
      fecha: "21/07/2026",
      nss: "999",
      nombreCompleto: "Solo Tres",
    });
  });

  it("ordena por hora aunque la hora no se exporte", async () => {
    const prepared = await prepareMesaCitasExport(
      [
        entry({
          bookingId: "late",
          bookingTime: "15:00",
          nss: "2",
          clienteNombre: "Tarde",
        }),
        entry({
          bookingId: "early",
          bookingTime: "09:00",
          nss: "1",
          clienteNombre: "Temprano",
        }),
      ],
      "2026-07-21",
      defaultMesaAgendaClientFilters(),
      undefined,
      loadTemplateBuffer(),
    );
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.deepEqual(
      prepared.exportRows.map((r) => r.nombreCompleto),
      ["Temprano", "Tarde"],
    );
  });
});
