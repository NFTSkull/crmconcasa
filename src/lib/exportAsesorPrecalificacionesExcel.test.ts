import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASESOR_EXPORT_EXCEL_HEADERS,
  buildAsesorExportFilename,
  buildAsesorPrecalificacionesWorkbook,
  filterPrecalificacionesForAsesorExport,
  mapPrecalificacionToExportRow,
  normalizeProgramaDbKey,
  prepareAsesorPrecalificacionesExport,
  programaMatchesExportFilter,
  sanitizeExcelFormulaInjection,
  type AsesorPrecalificacionExportSource,
} from "@/lib/exportAsesorPrecalificacionesExcel";

const ASESOR_A = "asesor-a@test.com";
const ASESOR_B = "asesor-b@test.com";

function row(
  partial: Partial<AsesorPrecalificacionExportSource> & Pick<AsesorPrecalificacionExportSource, "id">,
): AsesorPrecalificacionExportSource {
  return {
    asesorId: ASESOR_A,
    cliente_nombre: "Cliente Demo",
    nss: "01234567890",
    telefono_cliente: "8181234567",
    programa: "Mejoravit",
    monto_aprobado: 150000,
    ...partial,
  };
}

const SAMPLE_ROWS: AsesorPrecalificacionExportSource[] = [
  row({ id: "1", programa: "Mejoravit", cliente_nombre: "Ana Mejoravit" }),
  row({ id: "2", programa: "Compro tu casa", cliente_nombre: "Luis Compra" }),
  row({ id: "3", programa: "Subcuenta", cliente_nombre: "Sub No Export" }),
  row({ id: "4", programa: "mejoravit", asesorId: ASESOR_B, cliente_nombre: "Otro Asesor" }),
  row({ id: "5", programa: "Mejoravit", nss: "00112233445", telefono_cliente: "044812345678" }),
];

describe("exportAsesorPrecalificacionesExcel — filtro por programa", () => {
  it("Mejoravit exporta solo Mejoravit", () => {
    const out = filterPrecalificacionesForAsesorExport(SAMPLE_ROWS, "mejoravit", ASESOR_A);
    assert.equal(out.length, 2);
    assert.ok(out.every((r) => programaMatchesExportFilter(r.programa, "mejoravit")));
  });

  it("Compra de casa exporta solo compro_tu_casa", () => {
    const out = filterPrecalificacionesForAsesorExport(SAMPLE_ROWS, "compro_tu_casa", ASESOR_A);
    assert.equal(out.length, 1);
    assert.equal(normalizeProgramaDbKey(out[0]!.programa), "compro_tu_casa");
  });

  it("Ambos exporta exactamente Mejoravit y Compro tu casa", () => {
    const out = filterPrecalificacionesForAsesorExport(SAMPLE_ROWS, "ambos", ASESOR_A);
    assert.equal(out.length, 3);
    const keys = new Set(out.map((r) => normalizeProgramaDbKey(r.programa)));
    assert.deepEqual([...keys].sort(), ["compro_tu_casa", "mejoravit"]);
  });

  it("no exporta Subcuenta ni otros programas", () => {
    const out = filterPrecalificacionesForAsesorExport(SAMPLE_ROWS, "ambos", ASESOR_A);
    assert.ok(!out.some((r) => normalizeProgramaDbKey(r.programa) === "subcuenta"));
  });
});

describe("exportAsesorPrecalificacionesExcel — alcance asesor", () => {
  it("no exporta datos de otros asesores", () => {
    const out = filterPrecalificacionesForAsesorExport(SAMPLE_ROWS, "ambos", ASESOR_A);
    assert.ok(!out.some((r) => r.asesorId === ASESOR_B));
  });

  it("usa todos los registros del asesor, no solo una página", () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      row({ id: `m-${i}`, programa: i % 2 === 0 ? "Mejoravit" : "Compro tu casa" }),
    );
    const out = filterPrecalificacionesForAsesorExport(many, "ambos", ASESOR_A);
    assert.equal(out.length, 120);
  });
});

describe("exportAsesorPrecalificacionesExcel — mapeo y formato", () => {
  it("NSS y teléfono se conservan como texto sanitizado", () => {
    const mapped = mapPrecalificacionToExportRow(
      row({ id: "x", nss: "01234567890", telefono_cliente: "044812345678" }),
    );
    assert.equal(mapped.nss, "01234567890");
    assert.equal(mapped.telefono, "044812345678");
  });

  it("montos se exportan como número", () => {
    const mapped = mapPrecalificacionToExportRow(row({ id: "x", monto_aprobado: 250000.5 }));
    assert.equal(mapped.montoAprobado, 250000.5);
  });

  it("sanitiza valores peligrosos para Excel", () => {
    assert.equal(sanitizeExcelFormulaInjection("=SUM(A1)"), "'=SUM(A1)");
    assert.equal(sanitizeExcelFormulaInjection("+123"), "'+123");
    assert.equal(sanitizeExcelFormulaInjection("-1"), "'-1");
    assert.equal(sanitizeExcelFormulaInjection("@cmd"), "'@cmd");
  });

  it("workbook incluye encabezados y hoja Precalificaciones", () => {
    const prepared = prepareAsesorPrecalificacionesExport(
      SAMPLE_ROWS,
      "mejoravit",
      ASESOR_A,
    );
    assert.equal(prepared.ok, true);
    const wb = buildAsesorPrecalificacionesWorkbook(prepared.exportRows ?? []);
    assert.equal(wb.SheetNames[0], "Precalificaciones");
    const ws = wb.Sheets.Precalificaciones!;
    assert.equal(ws.A1?.v, ASESOR_EXPORT_EXCEL_HEADERS[0]);
    assert.equal(ws.E1?.v, "Monto aprobado");
  });
});

describe("exportAsesorPrecalificacionesExcel — vacío y nombre archivo", () => {
  it("sin resultados no prepara exportación", () => {
    const onlySub = [row({ id: "s", programa: "Subcuenta" })];
    const prepared = prepareAsesorPrecalificacionesExport(onlySub, "mejoravit", ASESOR_A);
    assert.equal(prepared.ok, false);
    if (!prepared.ok) assert.equal(prepared.reason, "empty");
  });

  it("nombre de archivo según programa", () => {
    const date = new Date("2026-07-10T12:00:00");
    assert.equal(
      buildAsesorExportFilename("mejoravit", date),
      "precalificaciones_mejoravit_2026-07-10.xlsx",
    );
    assert.equal(
      buildAsesorExportFilename("compro_tu_casa", date),
      "precalificaciones_compra_casa_2026-07-10.xlsx",
    );
    assert.equal(
      buildAsesorExportFilename("ambos", date),
      "precalificaciones_ambos_2026-07-10.xlsx",
    );
  });
});

describe("exportAsesorPrecalificacionesExcel — paginación dashboard intacta", () => {
  it("filtrar export no altera el arreglo fuente (paginación independiente)", () => {
    const source = [...SAMPLE_ROWS];
    filterPrecalificacionesForAsesorExport(source, "ambos", ASESOR_A);
    assert.equal(source.length, SAMPLE_ROWS.length);
  });
});
