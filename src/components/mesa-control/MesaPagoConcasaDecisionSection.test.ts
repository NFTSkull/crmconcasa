import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import { MESA_PAGO_CONCASA_DECISION_COPY } from "@/domain/expedientes/pago-concasa-resultado";

const ROOT = join(process.cwd());

describe("MesaPagoConcasaDecisionSection UI contract", () => {
  const src = readFileSync(
    join(ROOT, "src/components/mesa-control/MesaPagoConcasaDecisionSection.tsx"),
    "utf8",
  );
  const detalle = readFileSync(
    join(ROOT, "src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx"),
    "utf8",
  );
  const asesor = readFileSync(
    join(ROOT, "src/components/asesor/AsesorSeguimientoOperativo.tsx"),
    "utf8",
  );

  it("1. Firmado muestra Sí pagó", () => {
    assert.match(src, /mesa-pago-concasa-si-pago/);
    assert.match(src, new RegExp(MESA_PAGO_CONCASA_DECISION_COPY.botonPagado));
  });

  it("2. Firmado muestra No pagó", () => {
    assert.match(src, /mesa-pago-concasa-no-pago/);
    assert.match(src, new RegExp(MESA_PAGO_CONCASA_DECISION_COPY.botonNoPagado));
  });

  it("3. ya no muestra botón viejo en detalle", () => {
    assert.doesNotMatch(detalle, /Pasar a Pago a ConCasa/);
    assert.match(detalle, /MesaPagoConcasaDecisionSection/);
  });

  it("4. confirmación Sí", () => {
    assert.match(src, new RegExp(MESA_PAGO_CONCASA_DECISION_COPY.confirmPagado.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("5. confirmación No", () => {
    assert.match(src, new RegExp(MESA_PAGO_CONCASA_DECISION_COPY.confirmNoPagado.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("6-7. estado final Pagó / No pagó", () => {
    assert.match(src, /Resultado:/);
    assert.match(src, /labelPagoConcasaResultado/);
  });

  it("8-9. asesor ve Pagó / No pagó", () => {
    assert.match(asesor, /pagoConcasaResultado/);
    assert.match(asesor, /labelPagoConcasaResultadoConCheck|labelPagoConcasaResultado/);
  });

  it("10. asesor no tiene botones", () => {
    assert.doesNotMatch(asesor, /Sí pagó|mesa-pago-concasa-si-pago/);
  });

  it("11. error backend no cambia UI falsamente (muestra alert)", () => {
    assert.match(src, /mesa-pago-concasa-error/);
    assert.match(src, /role=\"alert\"/);
  });
});
