import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { parseAsesorCorreccionDetalle } from "@/domain/expedientes/asesor-correccion-detalle";
import type { AdminCorreccionEnrichedRow } from "@/domain/admin-production/admin-correccion-enrich";
import { selectAdminCorreccionRows } from "@/domain/admin-production/admin-correccion-enrich";
import {
  ADMIN_CORRECCIONES_PDF_EMPTY_MESSAGE,
  adminCorreccionesPdfTextLooksLikePii,
  buildAdminCorreccionesPdfBytes,
  buildAdminCorreccionesPdfFilename,
  buildAdminCorreccionesReportModel,
  collectAdminCorreccionesReportPlainText,
  normalizePdfLines,
  normalizePdfText,
  pdfWinAnsiSafe,
  sanitizeAdminCorreccionesPdfFilenamePart,
  shouldDownloadAdminCorreccionesPdf,
  stubAdminMesaForCorreccionPdf,
} from "./exportAdminCorreccionesPdf";

const bounds = {
  preset: "personalizado" as const,
  fromDate: "2026-09-01",
  toDateInclusive: "2026-09-23",
  fromIso: "2026-09-01T06:00:00.000Z",
  toExclusiveIso: "2026-09-24T06:00:00.000Z",
};

function row(
  id: string,
  ux: string,
  opts?: { asesorNombre?: string; etapaLabel?: string; etapaActual?: number },
): AdminCorreccionEnrichedRow {
  const detalle = parseAsesorCorreccionDetalle({
    estado: "WAITING_ADVISOR",
    request_at: "2026-09-22T21:19:00.000Z",
    items: [
      {
        type: "datos_generales",
        key: "rfc",
        label: "RFC",
        motivo: "RFC DEL ESTADO DE CUENTA NO COINCIDE",
        requested_at: "2026-09-22T21:19:00.000Z",
        action_target: "dg",
        local_status: "pendiente",
      },
      {
        type: "documento",
        key: "estado_cuenta",
        label: "Estado de cuenta",
        motivo: "EL ARCHIVO NO ES LEGIBLE",
        requested_at: "2026-09-22T21:19:00.000Z",
        action_target: "doc",
        local_status: "pendiente",
      },
    ],
    has_correction_activity_after_request: false,
    has_response_after_request: false,
    needs_resubmit: false,
    can_resubmit: false,
    ux_state: ux,
    blocking_reasons: [],
  });
  return {
    mesa: stubAdminMesaForCorreccionPdf({
      expedienteId: id,
      clienteNombre: `MARIA EJEMPLO ${id}`,
      asesorId: "a1",
      asesorNombre: opts?.asesorNombre ?? "SILVIA REYES",
      etapaLabel: opts?.etapaLabel ?? "Integración",
      etapaActual: opts?.etapaActual ?? 5,
    }),
    detalle,
    readError: false,
  };
}

describe("exportAdminCorreccionesPdf", () => {
  it("normaliza tipografía no soportada sin perder acentos", () => {
    assert.equal(
      normalizePdfText("• Documento — INE frente · revisión… “válida”"),
      '- Documento - INE frente - revisión... "válida"',
    );
    assert.equal(normalizePdfText("Corrección de José Muñoz"), "Corrección de José Muñoz");
    assert.deepEqual(
      normalizePdfLines(["• Uno", "Dos — tres"]),
      ["- Uno", "Dos - tres"],
    );
  });

  it("pdfWinAnsiSafe ya no convierte viñetas o guiones tipográficos en ?", () => {
    const safe = pdfWinAnsiSafe("• Datos generales — Datos generales");
    assert.equal(safe, "- Datos generales - Datos generales");
    assert.doesNotMatch(safe, /\?/);
  });

  it("incluye label + motivo exacto del RPC", () => {
    const model = buildAdminCorreccionesReportModel({
      rows: [row("e1", "PENDIENTE_DE_CORREGIR")],
      alcance: "periodo_seleccionado",
      bounds,
      filter: "PENDIENTE_DE_CORREGIR",
      asesorNombreSeleccionado: "SILVIA REYES",
    });
    assert.equal(model.total, 1);
    const text = collectAdminCorreccionesReportPlainText(model);
    assert.match(text, /RFC DEL ESTADO DE CUENTA NO COINCIDE/);
    assert.match(text, /EL ARCHIVO NO ES LEGIBLE/);
    assert.match(text, /Estado de cuenta/);
    assert.match(text, /Pendiente de corregir/);
  });

  it("PDF vacío no descarga", async () => {
    assert.equal(shouldDownloadAdminCorreccionesPdf([]), false);
    const result = await buildAdminCorreccionesPdfBytes({
      rows: [],
      alcance: "periodo_seleccionado",
      bounds,
      filter: "todas",
      asesorNombreSeleccionado: null,
    });
    assert.equal(result.empty, true);
    assert.equal(result.bytes, null);
    assert.match(ADMIN_CORRECCIONES_PDF_EMPTY_MESSAGE, /No hay correcciones/);
  });

  it("nombre archivo periodo y pendientes actuales", () => {
    assert.equal(
      buildAdminCorreccionesPdfFilename({
        alcance: "periodo_seleccionado",
        asesorNombre: "SILVIA REYES",
        bounds,
      }),
      "Correcciones_SILVIA_REYES_2026-09-01_2026-09-23.pdf",
    );
    assert.equal(
      buildAdminCorreccionesPdfFilename({
        alcance: "periodo_seleccionado",
        asesorNombre: null,
        bounds,
      }),
      "Correcciones_TODOS_2026-09-01_2026-09-23.pdf",
    );
    assert.equal(
      buildAdminCorreccionesPdfFilename({
        alcance: "pendientes_actuales",
        asesorNombre: "SILVIA REYES",
        dateYmd: "2026-09-23",
      }),
      "Correcciones_Pendientes_SILVIA_REYES_2026-09-23.pdf",
    );
    assert.equal(
      sanitizeAdminCorreccionesPdfFilenamePart("Silvia / Reyes!"),
      "Silvia_Reyes",
    );
  });

  it("modelo no contiene NSS/RFC/CURP/CLABE como valores", () => {
    const model = buildAdminCorreccionesReportModel({
      rows: [row("e1", "PENDIENTE_DE_CORREGIR")],
      alcance: "periodo_seleccionado",
      bounds,
      filter: "todas",
      asesorNombreSeleccionado: null,
    });
    const text = collectAdminCorreccionesReportPlainText(model);
    assert.equal(adminCorreccionesPdfTextLooksLikePii(text), false);
    assert.doesNotMatch(text, /\b\d{11}\b/);
    assert.doesNotMatch(text, /\b\d{18}\b/);
    assert.doesNotMatch(text, /https?:\/\//i);
  });

  it("PDF de pendientes actuales usa todos los resultados y no pone periodo engañoso", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      row(`e${i}`, "PENDIENTE_DE_CORREGIR"),
    );
    const { model, bytes, empty } = await buildAdminCorreccionesPdfBytes({
      rows: many,
      alcance: "pendientes_actuales",
      bounds: null,
      filter: "PENDIENTE_DE_CORREGIR",
      asesorNombreSeleccionado: "SILVIA REYES",
      generatedAtIso: "2026-09-23T22:10:00.000Z",
    });
    assert.equal(empty, false);
    assert.equal(model.total, 30);
    assert.equal(model.alcanceLine, "Pendientes actuales");
    assert.equal(model.periodoLine, null);
    assert.ok(model.corteLine);
    assert.doesNotMatch(
      collectAdminCorreccionesReportPlainText(model),
      /Periodo: 2026-09/,
    );
    assert.ok(bytes && bytes.byteLength > 500);
    const doc = await PDFDocument.load(bytes!);
    assert.ok(doc.getPageCount() >= 1);
  });

  it("PDF y tabla producen el mismo conjunto (ids)", () => {
    const enriched = [
      row("p1", "PENDIENTE_DE_CORREGIR"),
      row("r1", "CORRECCION_ENVIADA"),
      row("p2", "PENDIENTE_DE_CORREGIR"),
    ];
    const tableIds = selectAdminCorreccionRows(
      enriched,
      "PENDIENTE_DE_CORREGIR",
    ).map((r) => r.mesa.expedienteId);
    const pdfIds = buildAdminCorreccionesReportModel({
      rows: selectAdminCorreccionRows(enriched, "PENDIENTE_DE_CORREGIR"),
      alcance: "pendientes_actuales",
      bounds: null,
      filter: "PENDIENTE_DE_CORREGIR",
      asesorNombreSeleccionado: "SILVIA REYES",
    }).entries.map((e, i) => tableIds[i]);
    assert.deepEqual(tableIds, ["p1", "p2"]);
    assert.deepEqual(pdfIds, ["p1", "p2"]);
  });

  it("Pendiente no incluye reenviada", () => {
    const model = buildAdminCorreccionesReportModel({
      rows: selectAdminCorreccionRows(
        [row("p", "PENDIENTE_DE_CORREGIR"), row("e", "CORRECCION_ENVIADA")],
        "PENDIENTE_DE_CORREGIR",
      ),
      alcance: "pendientes_actuales",
      bounds: null,
      filter: "PENDIENTE_DE_CORREGIR",
      asesorNombreSeleccionado: null,
    });
    assert.equal(model.total, 1);
    assert.match(model.entries[0]?.estadoLabel ?? "", /Pendiente/);
  });

  it("periodo seleccionado muestra Periodo; sin Corte", () => {
    const model = buildAdminCorreccionesReportModel({
      rows: [row("a", "PENDIENTE_DE_CORREGIR")],
      alcance: "periodo_seleccionado",
      bounds,
      filter: "PENDIENTE_DE_CORREGIR",
      asesorNombreSeleccionado: "SILVIA REYES",
    });
    assert.equal(model.alcanceLine, "Periodo seleccionado");
    assert.equal(model.periodoLine, "2026-09-01 — 2026-09-23");
    assert.equal(model.corteLine, null);
  });
});
