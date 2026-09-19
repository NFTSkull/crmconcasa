import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  collectStrictLabeledClabeCandidates,
  collectValidClabeCandidates,
  canRunClabeDetection,
  detectClabeFromBankStatementText,
  detectClabeUnsupportedForMime,
  findBoundedClabeRawSpans,
  isPdfMimeType,
  resolveVisibleClabeDetection,
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

  it("estado de cuenta real: No. Cuenta CLABE segmentada → detected", () => {
    const text = [
      "Estado de Cuenta Libretón Básico Cuenta Digital",
      "R.F.C AAMJ830601DZ6",
      "No. Cuenta CLABE 012 700 01524466095 8",
      "Sucursal 5104",
      "Plaza Sendero San Luis Potosi",
    ].join("\n");

    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "detected");
    if (r.status === "detected") {
      assert.equal(r.clabe, "012700015244660958");
      assert.equal(r.checksumValid, true);
    }
  });

  it("CLABE puede venir partida por salto de línea del OCR", () => {
    const text = [
      "Estado de cuenta",
      "No. Cuenta CLABE 012 700",
      "01524466095 8",
      "Sucursal 5104",
    ].join("\n");

    const r = detectClabeFromBankStatementText(text);
    assert.equal(r.status, "detected");
    if (r.status === "detected") {
      assert.equal(r.clabe, "012700015244660958");
    }
  });

  it("Banorte resumen integral real: detecta 072580004193933444", () => {
    const text = [
      "BANORTE",
      "RESUMEN INTEGRAL",
      "No. de Cuenta CLABE Saldo anterior",
      "ROM 0419393344 072 580 00419393344 4 $5,173.85",
      "CUENTA ENLACE PERSONAL",
    ].join("\n");

    const result = detectClabeFromBankStatementText(text);
    assert.equal(result.status, "detected");
    if (result.status === "detected") {
      assert.equal(result.clabe, "072580004193933444");
      assert.equal(result.checksumValid, true);
    }
  });

  it("Banorte: prioriza CLABE de la fila exacta aunque exista otra CLABE válida", () => {
    const correct = "072580013691192354";
    const wrongButChecksumValid = "012180015250829604";
    assert.equal(isValidClabeMexico(correct), true);
    assert.equal(isValidClabeMexico(wrongButChecksumValid), true);

    const text = [
      "ESTADO DE CUENTA NOMINA BANORTE S/CH",
      "RESUMEN INTEGRAL",
      "No. de Cuenta    CLABE",
      "1369119235       072 580 01369119235 4",
      `Referencia CLABE ${wrongButChecksumValid}`,
      "Saldo final",
    ].join("\n");

    const strict = collectStrictLabeledClabeCandidates(text);
    assert.ok(strict.includes(correct));
    assert.ok(strict.includes(wrongButChecksumValid));

    const result = detectClabeFromBankStatementText(text);
    assert.equal(result.status, "detected");
    if (result.status === "detected") {
      assert.equal(result.clabe, correct);
      assert.equal(result.clabe.slice(0, 3), "072");
    }
  });

  it("Banorte: checksum válido de otro banco no se acepta por sí solo", () => {
    const wrongButChecksumValid = "012180015250829604";
    const text = [
      "BANORTE NOMINA",
      `CLABE ${wrongButChecksumValid}`,
      "Estado de cuenta del cliente",
    ].join("\n");

    const result = detectClabeFromBankStatementText(text);
    assert.equal(result.status, "not_found");
  });

  it("tabla visual CLABE: encabezado en una fila y valores en la siguiente", () => {
    const correct = "072580013691192354";
    const text = [
      "BANORTE",
      "No. de Cuenta CLABE",
      "1369119235 072 580 01369119235 4",
      "Movimientos",
    ].join("\n");

    const result = detectClabeFromBankStatementText(text);
    assert.equal(result.status, "detected");
    if (result.status === "detected") assert.equal(result.clabe, correct);
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

  it("boundary: 19º dígito tras espacio/guion → 0 spans / not_found", () => {
    assert.equal(findBoundedClabeRawSpans(`CLABE ${VALID_A} 9`).length, 0);
    assert.equal(findBoundedClabeRawSpans(`CLABE ${VALID_A}-9`).length, 0);
    assert.equal(findBoundedClabeRawSpans(`CLABE ${VALID_A} 00`).length, 0);
    assert.equal(findBoundedClabeRawSpans(`CLABE ${VALID_A}-00`).length, 0);
    assert.equal(
      detectClabeFromBankStatementText(`CLABE ${VALID_A} 9\n`.repeat(3)).status,
      "not_found",
    );
    assert.equal(
      detectClabeFromBankStatementText(`CLABE ${VALID_A}-9\n`.repeat(3)).status,
      "not_found",
    );
    assert.equal(
      detectClabeFromBankStatementText(`CLABE ${VALID_A} 00\n`.repeat(3))
        .status,
      "not_found",
    );
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

    const mismatch = canRunClabeDetection({
      ...base,
      activeDocumentId: "doc-B",
      blobDocumentId: "doc-A",
    });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.reason, "blob_mismatch");

    const waiting = canRunClabeDetection({
      ...base,
      activeDocumentId: "doc-B",
      blobDocumentId: null,
    });
    assert.equal(waiting.ok, false);
    if (!waiting.ok) assert.equal(waiting.reason, "no_blob");

    const ready = canRunClabeDetection({
      ...base,
      activeDocumentId: "doc-B",
      blobDocumentId: "doc-B",
    });
    assert.equal(ready.ok, true);

    const cache = new Map<string, string>();
    if (ready.ok) cache.set("doc-B", "result-B");
    assert.equal(cache.has("doc-A"), false);
    assert.equal(cache.get("doc-B"), "result-B");
  });

  it("race A→B: resultado A deja de ser visible al cambiar activeDocumentId a B", () => {
    const detectionA = {
      documentoId: "doc-A",
      result: {
        status: "detected" as const,
        clabe: VALID_A,
        checksumValid: true as const,
        candidateCount: 1,
        confidence: "high" as const,
        reason: "clabe_label_nearby" as const,
      },
    };

    // Visible bajo A
    assert.equal(
      resolveVisibleClabeDetection({
        activeDocumentId: "doc-A",
        detection: detectionA,
      })?.status,
      "detected",
    );

    // Al pasar a B (aún sin blob B / detection A en estado): A ya no se muestra
    assert.equal(
      resolveVisibleClabeDetection({
        activeDocumentId: "doc-B",
        detection: detectionA,
      }),
      null,
    );

    // blob A no analiza B
    const gate = canRunClabeDetection({
      context: "clabe",
      kind: "cliente_estado_cuenta",
      activeDocumentId: "doc-B",
      blobDocumentId: "doc-A",
      mime: "application/pdf",
    });
    assert.equal(gate.ok, false);

    // Solo resultado B bajo B
    const detectionB = {
      documentoId: "doc-B",
      result: { status: "not_found" as const },
    };
    assert.equal(
      resolveVisibleClabeDetection({
        activeDocumentId: "doc-B",
        detection: detectionB,
      })?.status,
      "not_found",
    );
    assert.equal(
      resolveVisibleClabeDetection({
        activeDocumentId: "doc-B",
        detection: detectionA,
      }),
      null,
    );
  });
});
