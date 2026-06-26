import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapBookFirmasRpcError } from "./book-firmas-rpc-error";

describe("mapBookFirmasRpcError", () => {
  it("mapea etapa incorrecta", () => {
    const err = mapBookFirmasRpcError({
      message: "book_firmas: solo se puede agendar en etapa 9 (actual: 8)",
    });
    assert.match(err.message, /etapa 9/i);
  });

  it("mapea asesor no dueño", () => {
    const err = mapBookFirmasRpcError({
      message: "book_firmas: solo el asesor dueño puede agendar firma",
    });
    assert.match(err.message, /asesor dueño/i);
  });
});
