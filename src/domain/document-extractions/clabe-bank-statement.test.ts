import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  collectValidClabeCandidates,
  canRunClabeDetection,
  detectClabeFromBankStatementText,
  detectClabeUnsupportedForMime,
  findBoundedClabeRawSpans,
  isPdfMimeType,
  shouldRunClabeShadowDetection,
} from "./clabe-bank-statement";
import { isValidClabeMexico } from "@/domain/expediente-cliente-datos/clabe-mexico";

const VALID_A = "032180000118359719";
const VALID_B = "646180157034181180";
const INVALID_CS = "012345678901234567";

describe("P4B clabe-bank-statement parser", () => {
  it("1. CLABE válida contigua + label CLABE → detected", () => {
    const text =
      "Estado de cuenta BANCO\nCLABE " +
      VALID_A +
      "\nTitular: JUAN PEREZ\nSaldo 1000";
    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "detected");
    if (r.status === "detected") {
      assert.equal(r.clabe, VALID_A);
      assert.equal(r.checksumValid, true);
      assert.equal(r.confidence, "high");
      assert.equal(r.reason, "clabe_label_nearby");
      assert.equal(r.candidateCount, 1);
    }
  });

  it("2. válida con espacios → detected", () => {
    const spaced = "032 180 000118359719";
    const text = `CLABE INTERBANCARIA ${spaced} fin`;
    const r = detectClabeFromBankStatementText(text.padEnd(80, " x"));
    assert.equal(r.status, "detected");
    if (r.status === "detected") assert.equal(r.clabe, VALID_A);
  });

  it("3. válida con guiones → detected", () => {
    const dashed = "032-180-000118359719";
    const text = `CUENTA CLABE: ${dashed}\n`.repeat(3);
    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "detected");
    if (r.status === "detected") assert.equal(r.clabe, VALID_A);
  });

  it("4. checksum inválido → not_found", () => {
    const text = `CLABE ${INVALID_CS}\n`.repeat(3);
    assert.equal(isValidClabeMexico(INVALID_CS), false);
    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "not_found");
  });

  it("5. 18 dígitos sin contexto CLABE → NO detected", () => {
    const text =
      "Referencia de pago " +
      VALID_A +
      " importe 500\nconcepto SERVICIO\n".repeat(2);
    const r = detectClabeFromBankStatementText(text);
    assert.notEqual(r.status, "detected");
    assert.equal(r.status, "not_found");
  });

  it("6. una válida con CLABE + otra referencia 18d → elegir contextual", () => {
    const text =
      "Referencia " +
      VALID_B +
      "\nCLABE INTERBANCARIA " +
      VALID_A +
      "\nfin documento banco\n";
    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "detected");
    if (r.status === "detected") assert.equal(r.clabe, VALID_A);
  });

  it("7. dos CLABE válidas contextualizadas → ambiguous", () => {
    const text =
      "CLABE " +
      VALID_A +
      "\nOtra linea\nCLABE INTERBANCARIA " +
      VALID_B +
      "\n";
    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "ambiguous");
    if (r.status === "ambiguous") {
      assert.equal(r.candidateCount, 2);
      assert.ok(r.candidates.includes(VALID_A));
      assert.ok(r.candidates.includes(VALID_B));
    }
  });

  it("8. duplicado de misma CLABE repetida → una candidata lógica", () => {
    const text =
      "CLABE " +
      VALID_A +
      "\nCLABE INTERBANCARIA " +
      VALID_A +
      "\n";
    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "detected");
    if (r.status === "detected") {
      assert.equal(r.clabe, VALID_A);
      assert.equal(r.candidateCount, 1);
    }
    const scored = collectValidClabeCandidates(text);
    assert.equal(scored.length, 1);
  });

  it('9. lowercase "clabe interbancaria" → detected', () => {
    const text = `clabe interbancaria ${VALID_A}\n`.repeat(3);
    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "detected");
    if (r.status === "detected") assert.equal(r.clabe, VALID_A);
  });

  it("10. texto ruido → not_found", () => {
    const text =
      "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod\n".repeat(
        3,
      );
    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "not_found");
  });

  it("11. no texto → no_text_layer", () => {
    const r = detectClabeFromBankStatementText("   \n  ");
    assert.equal(r.status, "no_text_layer");
  });

  it("12. letras dentro del número → no normalizar silenciosamente", () => {
    const text = `CLABE 03218000011835971A\n`.repeat(3);
    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "not_found");
  });

  it("13. leading zero preservado", () => {
    const text = `CLABE PARA TRANSFERENCIAS 002010077777777771\n`.repeat(2);
    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "detected");
    if (r.status === "detected") {
      assert.equal(r.clabe, "002010077777777771");
      assert.ok(r.clabe.startsWith("0"));
    }
  });

  it("14. no retorna raw text", () => {
    const text = `CLABE ${VALID_A}\nsecreto PII NOMBRE COMPLETO\n`.repeat(2);
    const r = detectClabeFromBankStatementText(text);
    const json = JSON.stringify(r);
    assert.doesNotMatch(json, /secreto|NOMBRE COMPLETO|rawText|payload/i);
    assert.ok(!("text" in r));
    assert.ok(!("raw" in r));
  });

  it("15. helper usa P1 checksum, no copia algoritmo", () => {
    const src = readFileSync(
      join(process.cwd(), "src/domain/document-extractions/clabe-bank-statement.ts"),
      "utf8",
    );
    assert.match(src, /isValidClabeMexico/);
    assert.match(src, /normalizeClabeMexico/);
    assert.doesNotMatch(src, /CLABE_WEIGHTS|calculateClabeCheckDigit/);
    assert.match(src, /from "@\/domain\/expediente-cliente-datos\/clabe-mexico"/);
  });

  it("shouldRunClabeShadowDetection solo en context clabe", () => {
    assert.equal(shouldRunClabeShadowDetection("clabe"), true);
    assert.equal(shouldRunClabeShadowDetection("rfc"), false);
    assert.equal(shouldRunClabeShadowDetection("identidad"), false);
    assert.equal(shouldRunClabeShadowDetection("vivienda"), false);
    assert.equal(shouldRunClabeShadowDetection("none"), false);
  });

  it("boundary: 19 dígitos con primeros 18 = CLABE válida → NOT detected", () => {
    const text = `CLABE ${VALID_A}9\n`.repeat(3);
    assert.equal(isValidClabeMexico(VALID_A), true);
    assert.equal(findBoundedClabeRawSpans(`CLABE ${VALID_A}9`).length, 0);
    const r = detectClabeFromBankStatementText(text);
    assert.notEqual(r.status, "detected");
    assert.equal(r.status, "not_found");
  });

  it("boundary: dígito extra antes de CLABE válida → NOT detected", () => {
    const text = `CLABE 9${VALID_A}\n`.repeat(3);
    assert.equal(findBoundedClabeRawSpans(`CLABE 9${VALID_A}`).length, 0);
    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "not_found");
  });

  it("boundary: 20 dígitos → NOT detected", () => {
    const text = `CLABE ${VALID_A}00\n`.repeat(3);
    assert.equal(findBoundedClabeRawSpans(`CLABE ${VALID_A}00`).length, 0);
    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "not_found");
  });

  it("boundary: CLABE delimitada por texto/puntuación → detected", () => {
    const text = `CLABE:${VALID_A}.\nTitular demo banco\n`.repeat(2);
    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "detected");
    if (r.status === "detected") assert.equal(r.clabe, VALID_A);
  });

  it("boundary: espacios/guiones permitidos siguen funcionando", () => {
    assert.equal(
      detectClabeFromBankStatementText(
        `CLABE INTERBANCARIA 032 180 000118359719\nfin\n`.repeat(2),
      ).status,
      "detected",
    );
    assert.equal(
      detectClabeFromBankStatementText(
        `CUENTA CLABE 032-180-000118359719\nfin\n`.repeat(2),
      ).status,
      "detected",
    );
  });

  it("MIME: application/pdf y con parámetros; imágenes unsupported", () => {
    assert.equal(isPdfMimeType("application/pdf"), true);
    assert.equal(isPdfMimeType("application/pdf; charset=binary"), true);
    assert.equal(isPdfMimeType("APPLICATION/PDF"), true);
    assert.equal(detectClabeUnsupportedForMime("application/pdf"), false);
    assert.equal(
      detectClabeUnsupportedForMime("application/pdf; charset=binary"),
      false,
    );
    assert.equal(detectClabeUnsupportedForMime("image/jpeg"), true);
    assert.equal(detectClabeUnsupportedForMime("image/png"), true);
  });

  it("race A→B: blob A no puede analizarse como documento B", () => {
    const base = {
      context: "clabe",
      kind: "cliente_estado_cuenta",
      mime: "application/pdf",
    } as const;

    // Row B activo, blob aún de A
    const mismatch = canRunClabeDetection({
      ...base,
      activeDocumentId: "doc-B",
      blobDocumentId: "doc-A",
    });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.reason, "blob_mismatch");

    // Sin blob todavía
    const waiting = canRunClabeDetection({
      ...base,
      activeDocumentId: "doc-B",
      blobDocumentId: null,
    });
    assert.equal(waiting.ok, false);
    if (!waiting.ok) assert.equal(waiting.reason, "no_blob");

    // Blob B listo
    const ready = canRunClabeDetection({
      ...base,
      activeDocumentId: "doc-B",
      blobDocumentId: "doc-B",
    });
    assert.equal(ready.ok, true);

    // Solo B se cachearía bajo B (contrato de keys)
    const cache = new Map<string, string>();
    if (ready.ok) cache.set("doc-B", "result-B");
    assert.equal(cache.has("doc-A"), false);
    assert.equal(cache.get("doc-B"), "result-B");
  });
});
