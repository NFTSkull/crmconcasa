import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateClabeCheckDigit,
  isValidClabeMexico,
  normalizeClabeMexico,
} from "./clabe-mexico";

/** Vectores conocidos (checksum Banxico / pesos 3-7-1). */
const VALID = [
  "032180000118359719",
  "646180157034181180",
  "002010077777777771",
] as const;

const INVALID_CHECKSUM = [
  "012345678901234567",
  "111122223333444455",
] as const;

describe("clabe-mexico", () => {
  it("calculateClabeCheckDigit calcula el dígito correcto", () => {
    assert.equal(calculateClabeCheckDigit("03218000011835971"), 9);
    assert.equal(calculateClabeCheckDigit("64618015703418118"), 0);
    assert.equal(calculateClabeCheckDigit("00201007777777777"), 1);
    assert.equal(calculateClabeCheckDigit("0321800001183597"), null); // 16
    assert.equal(calculateClabeCheckDigit("032180000118359719"), null); // 18
    assert.equal(calculateClabeCheckDigit("abcdefghijklmnopq"), null);
  });

  it("acepta las 3 CLABE válidas conocidas", () => {
    for (const c of VALID) {
      assert.equal(isValidClabeMexico(c), true, c);
    }
  });

  it("rechaza checksums inválidos conocidos", () => {
    for (const c of INVALID_CHECKSUM) {
      assert.equal(isValidClabeMexico(c), false, c);
    }
  });

  it("normaliza espacios y guiones sin perder ceros iniciales", () => {
    assert.equal(
      normalizeClabeMexico("0321 8000 0118 3597 19"),
      "032180000118359719",
    );
    assert.equal(
      normalizeClabeMexico("0321-8000-0118-3597-19"),
      "032180000118359719",
    );
    assert.equal(
      normalizeClabeMexico("0020 1007 7777 7777 71"),
      "002010077777777771",
    );
    assert.equal(isValidClabeMexico("0321 8000 0118 3597 19"), true);
    assert.equal(isValidClabeMexico("0321-8000-0118-3597-19"), true);
  });

  it("vacío → normalize \"\"; isValid false", () => {
    assert.equal(normalizeClabeMexico(""), "");
    assert.equal(normalizeClabeMexico("   "), "");
    assert.equal(isValidClabeMexico(""), false);
    assert.equal(isValidClabeMexico("   "), false);
  });

  it("rechaza 17 y 19 dígitos", () => {
    assert.equal(isValidClabeMexico("03218000011835971"), false);
    assert.equal(isValidClabeMexico("0321800001183597190"), false);
  });

  it("rechaza letras y no las elimina en silencio", () => {
    assert.equal(normalizeClabeMexico("03218000011835971A"), null);
    assert.equal(normalizeClabeMexico("ABCD80000118359719"), null);
    assert.equal(isValidClabeMexico("03218000011835971A"), false);
  });

  it("rechaza caracteres raros", () => {
    assert.equal(normalizeClabeMexico("0321.8000.0118.3597.19"), null);
    assert.equal(normalizeClabeMexico("0321_8000_0118_3597_19"), null);
    assert.equal(isValidClabeMexico("0321.8000.0118.3597.19"), false);
  });

  it("modificar un solo dígito invalida el checksum", () => {
    const base = "032180000118359719";
    const flipped = "032180000118359719".replace(/.$/, "8"); // last digit wrong
    assert.equal(isValidClabeMexico(base), true);
    assert.equal(isValidClabeMexico(flipped), false);
    const mid = `${base.slice(0, 5)}9${base.slice(6)}`;
    assert.notEqual(mid, base);
    assert.equal(isValidClabeMexico(mid), false);
  });

  it("no produce falsos positivos con 18 dígitos de checksum incorrecto", () => {
    // Nota: "000000000000000000" SÍ pasa el algoritmo (suma 0 → dígito 0);
    // no es cuenta real, pero el checksum es matemáticamente válido.
    assert.equal(isValidClabeMexico("123456789012345678"), false);
    assert.equal(isValidClabeMexico("999999999999999999"), false);
    assert.equal(isValidClabeMexico("111122223333444455"), false);
    assert.equal(isValidClabeMexico("012345678901234567"), false);
  });
});
