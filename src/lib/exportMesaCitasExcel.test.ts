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
  buildMesaCitasExcelBlockTitle,
  buildMesaCitasExcelTitle,
  buildMesaCitasExportFilename,
  buildMesaCitasWorkbook,
  collectMesaCitasForExport,
  formatMesaCitasExcelVisibleDate,
  groupMesaCitasIntoExcelBlocks,
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
    reportGroup: null,
    ...overrides,
  };
}

describe("exportMesaCitasExcel — plantilla oficial P107/P109", () => {
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

  it("fecha visible DD/MM/YYYY y título legado día", () => {
    assert.equal(formatMesaCitasExcelVisibleDate("2026-07-21"), "21/07/2026");
    assert.equal(
      buildMesaCitasExcelTitle("2026-07-21"),
      "CITAS DEL DÍA — 21/07/2026",
    );
  });
});

describe("exportMesaCitasExcel — alcance día + filtros P095", () => {
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

describe("exportMesaCitasExcel — bloques P109", () => {
  it("títulos de bloque por tipo + hora / SIN HORARIO", () => {
    assert.equal(
      buildMesaCitasExcelBlockTitle("biometricos_tramite_completo", "08:00"),
      "BIOMÉTRICOS / TRÁMITE COMPLETO — 8:00 AM",
    );
    assert.equal(
      buildMesaCitasExcelBlockTitle("biometricos", "10:30"),
      "BIOMÉTRICOS — 10:30 AM",
    );
    assert.equal(
      buildMesaCitasExcelBlockTitle("inscripcion", "11:00"),
      "INSCRIPCIÓN — 11:00 AM",
    );
    assert.equal(
      buildMesaCitasExcelBlockTitle("firmas", "12:00"),
      "FIRMAS — 12:00 PM",
    );
    assert.equal(
      buildMesaCitasExcelBlockTitle("notificacion", null),
      "NOTIFICACIÓN — SIN HORARIO",
    );
  });

  it("agrupa por report_group resuelto + hora; orden canónico; dos horarios del mismo tipo", () => {
    const blocks = groupMesaCitasIntoExcelBlocks([
      entry({
        bookingId: "f-12",
        kind: "firmas",
        bookingTime: "12:00",
        clienteNombre: "Firmas noon",
        nss: "1",
      }),
      entry({
        bookingId: "bio-1030",
        kind: "biometricos",
        bookingTime: "10:30",
        clienteNombre: "Bio late",
        nss: "2",
      }),
      entry({
        bookingId: "bio-0800-tc",
        kind: "biometricos",
        bookingTime: "08:00",
        reportGroup: "biometricos_tramite_completo",
        clienteNombre: "Trámite",
        nss: "3",
      }),
      entry({
        bookingId: "ins-1100",
        kind: "biometricos",
        bookingTime: "11:00",
        reportGroup: "inscripcion",
        clienteNombre: "Inscrito",
        nss: "4",
      }),
      entry({
        bookingId: "bio-0900",
        kind: "biometricos",
        bookingTime: "09:00",
        clienteNombre: "Bio early",
        nss: "5",
      }),
      entry({
        bookingId: "notif",
        kind: "notificacion",
        bookingTime: "",
        clienteNombre: "Notif",
        nss: "6",
      }),
    ]);

    assert.deepEqual(
      blocks.map((b) => b.title),
      [
        "BIOMÉTRICOS / TRÁMITE COMPLETO — 8:00 AM",
        "BIOMÉTRICOS — 9:00 AM",
        "BIOMÉTRICOS — 10:30 AM",
        "INSCRIPCIÓN — 11:00 AM",
        "FIRMAS — 12:00 PM",
        "NOTIFICACIÓN — SIN HORARIO",
      ],
    );
    assert.equal(blocks[1]?.rows.length, 1);
    assert.equal(blocks[2]?.rows.length, 1);
  });

  it("ninguna cita perdida; fallback kind; inscripción y trámite completo", async () => {
    const source = [
      entry({
        bookingId: "a",
        reportGroup: "biometricos_tramite_completo",
        bookingTime: "08:00",
        nss: "01234567890",
        clienteNombre: "TC",
      }),
      entry({
        bookingId: "b",
        kind: "biometricos",
        bookingTime: "10:30",
        nss: "09876543210",
        clienteNombre: "Bio",
      }),
      entry({
        bookingId: "c",
        reportGroup: "inscripcion",
        bookingTime: "11:00",
        nss: "111",
        clienteNombre: "Ins",
      }),
      entry({
        bookingId: "d",
        kind: "firmas",
        bookingTime: "12:00",
        nss: "222",
        clienteNombre: "Fir",
      }),
      entry({
        bookingId: "e",
        kind: "notificacion",
        bookingTime: "09:00",
        nss: "333",
        clienteNombre: "Not",
      }),
    ];
    const prepared = await prepareMesaCitasExport(
      source,
      "2026-07-21",
      defaultMesaAgendaClientFilters(),
      undefined,
      loadTemplateBuffer(),
    );
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(prepared.rowCount, 5);
    assert.equal(prepared.blocks.length, 5);
    const ids = prepared.blocks.flatMap((b) => b.bookingIds).sort();
    assert.deepEqual(ids, ["a", "b", "c", "d", "e"]);
  });

  it("workbook: bloques horizontales, estilos, NSS cero, round-trip XLSX", async () => {
    const prepared = await prepareMesaCitasExport(
      [
        entry({
          bookingId: "1",
          reportGroup: "biometricos_tramite_completo",
          bookingTime: "08:00",
          nss: "01234567890",
          clienteNombre: "Ana López",
        }),
        entry({
          bookingId: "2",
          kind: "biometricos",
          bookingTime: "10:30",
          nss: "09876543210",
          clienteNombre: "Bruno Díaz",
        }),
        entry({
          bookingId: "3",
          reportGroup: "inscripcion",
          bookingTime: "11:00",
          nss: "00000000001",
          clienteNombre: "Carla Ins",
        }),
        entry({
          bookingId: "4",
          kind: "firmas",
          bookingTime: "12:00",
          nss: "4",
          clienteNombre: "Diego Fir",
        }),
      ],
      "2026-07-21",
      defaultMesaAgendaClientFilters(),
      undefined,
      loadTemplateBuffer(),
    );
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    const wb = prepared.workbook;
    const ws = wb.getWorksheet(MESA_CITAS_EXCEL_SHEET_NAME)!;

    assert.equal(String(ws.getCell("A1").value), "BIOMÉTRICOS / TRÁMITE COMPLETO — 8:00 AM");
    assert.equal(String(ws.getCell("A2").value), "Fecha");
    assert.equal(String(ws.getCell("B2").value), "NSS");
    assert.equal(String(ws.getCell("A3").value), "21/07/2026");
    assert.equal(String(ws.getCell("B3").value), "01234567890");
    assert.equal(String(ws.getCell("C3").value), "Ana López");
    assert.equal(ws.getCell("B3").numFmt, "@");

    // Segundo bloque empieza en col E (columna D vacía).
    assert.equal(ws.getCell("D1").value, null);
    assert.equal(String(ws.getCell("E1").value), "BIOMÉTRICOS — 10:30 AM");
    assert.equal(String(ws.getCell("F3").value), "09876543210");

    // Tercer bloque en col I.
    assert.equal(String(ws.getCell("I1").value), "INSCRIPCIÓN — 11:00 AM");

    // Cuarto bloque debajo (altura bloque 1 = 3 filas → fila 4).
    assert.equal(String(ws.getCell("A4").value), "FIRMAS — 12:00 PM");

    const titleFill = ws.getCell("A1").fill as ExcelJS.FillPattern;
    assert.ok(String(titleFill?.fgColor?.argb ?? "").toUpperCase().endsWith("6B2D8B"));
    const headerFill = ws.getCell("A2").fill as ExcelJS.FillPattern;
    assert.ok(String(headerFill?.fgColor?.argb ?? "").toUpperCase().endsWith("1F4E79"));
    const row3Fill = ws.getCell("A3").fill as ExcelJS.FillPattern;
    assert.ok(String(row3Fill?.fgColor?.argb ?? "").toUpperCase().endsWith("D6EAF8"));
    assert.ok(ws.getCell("A3").border?.top);

    const buf = await workbookToMesaCitasXlsxArrayBuffer(wb);
    assert.ok(buf.byteLength > 0);
    const roundTrip = new ExcelJS.Workbook();
    await roundTrip.xlsx.load(buf);
    const rt = roundTrip.getWorksheet(MESA_CITAS_EXCEL_SHEET_NAME)!;
    assert.equal(String(rt.getCell("B3").value), "01234567890");
    assert.equal(String(rt.getCell("E1").value), "BIOMÉTRICOS — 10:30 AM");
    assert.equal(String(rt.getCell("A4").value), "FIRMAS — 12:00 PM");
    const rtTitle = rt.getCell("A1").fill as ExcelJS.FillPattern;
    assert.ok(String(rtTitle?.fgColor?.argb ?? "").toUpperCase().endsWith("6B2D8B"));
  });

  it("NSS y nombre como texto sanitizado; solo tres columnas por bloque", () => {
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

  it("prepare incluye filename; exportRows flat sin UUID/teléfono", async () => {
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
    assert.equal(prepared.blocks.length, 1);
  });

  it("buildMesaCitasWorkbook acepta bloques vacíos de datos sin romper estilos", async () => {
    const blocks = groupMesaCitasIntoExcelBlocks([
      entry({ bookingId: "early", bookingTime: "09:00", nss: "1", clienteNombre: "Temprano" }),
      entry({ bookingId: "late", bookingTime: "15:00", nss: "2", clienteNombre: "Tarde" }),
    ]);
    assert.equal(blocks.length, 2);
    const wb = await buildMesaCitasWorkbook(blocks, "2026-07-21", loadTemplateBuffer());
    const ws = wb.getWorksheet(MESA_CITAS_EXCEL_SHEET_NAME)!;
    assert.equal(String(ws.getCell("A1").value), "BIOMÉTRICOS — 9:00 AM");
    assert.equal(String(ws.getCell("E1").value), "BIOMÉTRICOS — 3:00 PM");
    assert.equal(String(ws.getCell("C3").value), "Temprano");
    assert.equal(String(ws.getCell("G3").value), "Tarde");
  });
});
