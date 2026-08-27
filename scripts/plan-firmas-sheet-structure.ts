#!/usr/bin/env npx tsx
/**
 * Admin READ-ONLY: genera plan estructural Firmas 5/5/5 sin writes a Google Sheets.
 * Uso: npx tsx scripts/plan-firmas-sheet-structure.ts [--date YYYY-MM-DD] [--tab "16 Septiembre"]
 */
import {
  createMemorySheetAdapter,
  generateFirmasStructurePlanFromAdapter,
  type MemorySheetTab,
} from "../src/domain/agenda-sheets/firmas-sheet-structure-planner.ts";

const args = process.argv.slice(2);
const dateIdx = args.indexOf("--date");
const tabIdx = args.indexOf("--tab");
const bookingDate =
  dateIdx >= 0 ? String(args[dateIdx + 1] ?? "").trim() : "2026-09-16";
const tabTitle =
  tabIdx >= 0 ? String(args[tabIdx + 1] ?? "").trim() : "DEMO TAB";

/** Demo grid mínimo; en prod reemplazar adapter por lectura Cloud/Drive. */
const demoTab: MemorySheetTab = {
  sheetId: 999,
  title: tabTitle,
  grid: [
    ["APODACA FIRMAS"],
    ["10:30"],
    ["MONTERREY FIRMAS"],
    ["08:30"],
    ["09:00"],
    ["", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["MONTERREY BIOMETRICOS"],
    ["08:00"],
  ],
};

async function main() {
  const adapter = createMemorySheetAdapter([demoTab]);
  const plan = await generateFirmasStructurePlanFromAdapter({
    adapter,
    sheetId: demoTab.sheetId,
    sheetTitle: demoTab.title,
    bookingDate,
  });

  console.log(JSON.stringify({
    phase: "READ_ONLY_PLAN",
    bookingDate,
    sheetTitle: plan.sheetTitle,
    canExpandNoShift: plan.canExpandNoShift,
    rejectReason: plan.rejectReason,
    targetRowsBySede: plan.targetRowsBySede,
    sections: plan.sections,
    actions: plan.actions,
    protectedRowCount: plan.protectedRows.length,
    biometricPreRowCount: plan.biometricPreChecksums.length,
    cloudWrites: 0,
    sheetWrites: 0,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
