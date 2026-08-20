import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMesaBandejaCountsRpcMissing,
  mesaBandejaCountsShouldUseListRpcFallback,
  parseMesaBandejaCountsRpcPayload,
} from "./mesa-bandeja-counts-fast";

describe("P205-B1 mesa_bandeja_counts_fast FE helpers", () => {
  it("C15: counts no usa list RPC salvo missing", () => {
    assert.equal(
      mesaBandejaCountsShouldUseListRpcFallback({ fastRpcMissing: false }),
      false,
    );
    assert.equal(
      mesaBandejaCountsShouldUseListRpcFallback({ fastRpcMissing: true }),
      true,
    );
  });

  it("C14/parse: 13 campos canónicos", () => {
    const counts = parseMesaBandejaCountsRpcPayload({
      correccionesEnviadas: 68,
      correccionesSolicitadas: 6,
      otrasActualizaciones: 62,
      nuevos: 84,
      enProceso: 333,
      citasHoy: 24,
      rechazosCancelaciones: 46,
      rechazados: 36,
      cancelados: 10,
      bloqueadosRechazados: 72,
      enValidacionMesa: 1,
      enEsperaAsesor: 72,
      totalBandeja: 407,
    });
    assert.ok(counts);
    assert.equal(counts!.totalBandeja, 407);
    assert.equal(counts!.correccionesEnviadas, 68);
    assert.equal(Object.keys(counts!).length, 13);
  });

  it("PGRST202 / function missing → fallback permitido", () => {
    assert.equal(
      isMesaBandejaCountsRpcMissing({ code: "PGRST202", message: "..." }),
      true,
    );
    assert.equal(
      isMesaBandejaCountsRpcMissing({
        code: "42883",
        message: "Could not find the function mesa_bandeja_counts_fast",
      }),
      true,
    );
    assert.equal(
      isMesaBandejaCountsRpcMissing({ code: "57014", message: "timeout" }),
      false,
    );
    assert.equal(
      isMesaBandejaCountsRpcMissing({ code: "42501", message: "denied" }),
      false,
    );
  });
});
