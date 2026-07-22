import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("MesaAgendaCitasClient — P095 B3 Excel UI wiring", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/mesa-control/MesaAgendaCitasClient.tsx"),
    "utf8",
  );

  it("expone botón Descargar Excel y usa la util de export", () => {
    assert.match(source, /Descargar Excel/);
    assert.match(source, /downloadMesaCitasExcel/);
    assert.match(source, /resolveMesaCitasExportDayYmd/);
    assert.match(source, /exportExcelLoading/);
    assert.match(source, /exportExcelBusyRef/);
  });

  it("exporta desde loadedEntries + filters, no desde selección P089", () => {
    assert.match(source, /downloadMesaCitasExcel\(\s*loadedEntries/);
    const downloadBlock = source.slice(
      source.indexOf("handleDescargarExcel"),
      source.indexOf("handleBulkRowCheckedChange"),
    );
    assert.ok(downloadBlock.includes("downloadMesaCitasExcel"));
    assert.ok(downloadBlock.includes("await downloadMesaCitasExcel"));
    assert.ok(downloadBlock.includes("loadedEntries"));
    assert.ok(downloadBlock.includes("filters"));
    assert.ok(!/\bselectedBookingIds\b/.test(downloadBlock));
    assert.ok(!/\bexecuteBulk\b/.test(downloadBlock));
  });
});
