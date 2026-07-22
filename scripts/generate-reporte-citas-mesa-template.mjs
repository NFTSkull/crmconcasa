/**
 * Genera la plantilla oficial de citas Mesa (estilos canónicos).
 * Ejecutar: node scripts/generate-reporte-citas-mesa-template.mjs
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "public", "templates", "reporte-citas-mesa.xlsx");

const PURPLE = "6B2D8B";
const HEADER_BLUE = "1F4E79";
const ROW_ALT = "D6EAF8";
const WHITE = "FFFFFF";
const BORDER = {
  top: { style: "thin", color: { argb: "FF9BB3C9" } },
  left: { style: "thin", color: { argb: "FF9BB3C9" } },
  bottom: { style: "thin", color: { argb: "FF9BB3C9" } },
  right: { style: "thin", color: { argb: "FF9BB3C9" } },
};

function applyDataRowStyle(row, fillArgb) {
  row.height = 18;
  for (let c = 1; c <= 3; c += 1) {
    const cell = row.getCell(c);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${fillArgb}` },
    };
    cell.border = BORDER;
    cell.alignment = {
      vertical: "middle",
      horizontal: c === 3 ? "left" : "center",
    };
    cell.font = { name: "Calibri", size: 11, color: { argb: "FF1A1A1A" } };
    if (c === 1 || c === 2) {
      cell.numFmt = "@";
    }
  }
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ConCasa CRM";
  wb.created = new Date();

  const ws = wb.addWorksheet("Citas", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  ws.columns = [
    { key: "fecha", width: 14 },
    { key: "nss", width: 16 },
    { key: "nombre", width: 48 },
  ];

  ws.mergeCells("A1:C1");
  const title = ws.getCell("A1");
  title.value = "CITAS DEL DÍA — DD/MM/YYYY";
  title.font = {
    name: "Calibri",
    size: 16,
    bold: true,
    color: { argb: `FF${WHITE}` },
  };
  title.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: `FF${PURPLE}` },
  };
  title.alignment = { vertical: "middle", horizontal: "center" };
  title.border = BORDER;
  ws.getRow(1).height = 28;
  // Propagar borde/estilo a celdas fusionadas B1/C1
  for (const addr of ["B1", "C1"]) {
    const cell = ws.getCell(addr);
    cell.fill = title.fill;
    cell.border = BORDER;
  }

  const headers = [
    "Fecha",
    "NSS",
    "Nombre (Nombre completo con apellidos)",
  ];
  const headerRow = ws.getRow(2);
  headerRow.height = 22;
  headers.forEach((text, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = text;
    cell.font = {
      name: "Calibri",
      size: 11,
      bold: true,
      color: { argb: `FF${WHITE}` },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${HEADER_BLUE}` },
    };
    cell.border = BORDER;
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
  });

  // Filas plantilla de estilo (par/impar) — se clonan al exportar.
  applyDataRowStyle(ws.getRow(3), ROW_ALT);
  applyDataRowStyle(ws.getRow(4), WHITE);
  ws.getCell("A3").value = "";
  ws.getCell("B3").value = "";
  ws.getCell("C3").value = "";
  ws.getCell("A4").value = "";
  ws.getCell("B4").value = "";
  ws.getCell("C4").value = "";

  ws.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: 3 },
  };

  mkdirSync(dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);
  console.log("Wrote", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
