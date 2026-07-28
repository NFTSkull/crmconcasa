import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";

describe("P138 AdminIngresosSection excel UI", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/components/admin/AdminIngresosSection.tsx",
    ),
    "utf8",
  );

  it("expone Descargar Excel y Personalizar Excel", () => {
    assert.match(source, /Descargar Excel/);
    assert.match(source, /Personalizar Excel/);
    assert.match(source, /admin-ingresos-excel-download/);
    assert.match(source, /admin-ingresos-excel-customize/);
  });

  it("usa snapshot de filtros y bundle de exportación", () => {
    assert.match(source, /fetchIngresosExportBundle/);
    assert.match(source, /filterSnapshot/);
    assert.match(source, /excelBusy/);
    assert.match(source, /Preparando Excel/);
  });

  it("no muta filtros al abrir modal", () => {
    assert.match(source, /AdminIngresosExcelCustomizeModal/);
    assert.ok(!/setUi\(.*excelModalOpen/.test(source));
  });
});
