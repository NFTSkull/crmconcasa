import { describe, expect, it } from "vitest";
import { celularFueAutopopuladoDesdeTelefonoCasa } from "./telefono-casa-autofill";

describe("P219 teléfono de casa no autopopula celular", () => {
  it("detecta el mismo número aunque cambie el formato", () => {
    expect(
      celularFueAutopopuladoDesdeTelefonoCasa(
        "8119087564",
        "+52 81 1908 7564",
      ),
    ).toBe(true);
  });

  it("no limpia números distintos", () => {
    expect(
      celularFueAutopopuladoDesdeTelefonoCasa(
        "8119087564",
        "8187654321",
      ),
    ).toBe(false);
  });

  it("no considera iguales valores incompletos", () => {
    expect(celularFueAutopopuladoDesdeTelefonoCasa("8119", "8119")).toBe(false);
  });
});
