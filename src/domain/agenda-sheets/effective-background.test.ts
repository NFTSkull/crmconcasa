/**
 * P173 — fondo efectivo: criterio #FF0000 (solo BACKGROUND).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  backgroundToHex,
  isOperationalRedBackground,
  normalizeGoogleBackground,
  parseEffectiveBackgroundGridFromSheetsGet,
  evaluateOperationalRedFlags,
} from "./effective-background";

const RED = { red: 1, green: 0, blue: 0 };
const GREEN_6AA84F = {
  red: 0x6a / 255,
  green: 0xa8 / 255,
  blue: 0x4f / 255,
};
const PINK_D5A6BD = {
  red: 0xd5 / 255,
  green: 0xa6 / 255,
  blue: 0xbd / 255,
};
const WHITE = { red: 1, green: 1, blue: 1 };

describe("effective-background P173 A–H", () => {
  it("A. #FF0000 → true", () => {
    assert.equal(isOperationalRedBackground(RED), true);
    assert.equal(backgroundToHex(RED), "#FF0000");
  });

  it("B. #6AA84F → false", () => {
    assert.equal(isOperationalRedBackground(GREEN_6AA84F), false);
    assert.equal(backgroundToHex(GREEN_6AA84F), "#6AA84F");
  });

  it("C. #D5A6BD → false", () => {
    assert.equal(isOperationalRedBackground(PINK_D5A6BD), false);
    assert.equal(backgroundToHex(PINK_D5A6BD), "#D5A6BD");
  });

  it("D. white → false", () => {
    assert.equal(isOperationalRedBackground(WHITE), false);
    assert.equal(
      isOperationalRedBackground({ red: 1, green: 1, blue: 1 }),
      false,
    );
  });

  it("E. font-red + white bg → false (solo BACKGROUND)", () => {
    // Celda con texto rojo pero fondo blanco / sin fondo operativo.
    const cell = {
      effectiveFormat: {
        backgroundColor: WHITE,
        textFormat: { foregroundColor: RED },
      },
    };
    assert.equal(isOperationalRedBackground(cell), false);
    assert.equal(
      isOperationalRedBackground(
        normalizeGoogleBackground(cell.effectiveFormat),
      ),
      false,
    );
  });

  it("F. no bg → false", () => {
    assert.equal(isOperationalRedBackground(null), false);
    assert.equal(isOperationalRedBackground(undefined), false);
    assert.equal(isOperationalRedBackground({}), false);
    assert.equal(normalizeGoogleBackground(null), null);
  });

  it("G. style.rgbColor gana sobre backgroundColor legacy", () => {
    const mixed = {
      backgroundColorStyle: { rgbColor: RED },
      backgroundColor: GREEN_6AA84F,
    };
    assert.equal(isOperationalRedBackground(mixed), true);
    const styleOnly = {
      effectiveFormat: {
        backgroundColorStyle: { rgbColor: RED },
      },
    };
    const grid = parseEffectiveBackgroundGridFromSheetsGet({
      sheets: [{ data: [{ rowData: [{ values: [styleOnly] }] }] }],
    });
    assert.equal(isOperationalRedBackground(grid[0]?.[0] ?? null), true);
  });

  it("H. themeColor / fallback legacy sin style", () => {
    assert.equal(
      isOperationalRedBackground({
        backgroundColorStyle: { themeColor: "ACCENT1" },
      }),
      false,
    );
    assert.equal(
      isOperationalRedBackground({ backgroundColor: RED }),
      true,
    );
    // Google omite canales en 0 → {red:1} vía normalize = #FF0000
    assert.equal(
      isOperationalRedBackground({ backgroundColor: { red: 1 } }),
      true,
    );
  });

  it("evaluateOperationalRedFlags: E rojo → biometric + veto", () => {
    const f = evaluateOperationalRedFlags({
      kind: "biometricos",
      eiBackgrounds: [RED, null, null, null, null],
    });
    assert.equal(f.biometric_cell_red, true);
    assert.equal(f.notification_cell_red, false);
    assert.equal(f.operational_red_veto, true);
    assert.deepEqual(f.operational_red_columns, ["E"]);
  });
});
