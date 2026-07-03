import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAsesorExpedienteLabel,
  formatMontoAprobadoVigente,
} from "@/lib/asesorDisplay";

test("formatAsesorExpedienteLabel: prioriza nombre", () => {
  assert.equal(
    formatAsesorExpedienteLabel({
      fullName: "Paty Gutierrez",
      email: "paty.gutierrez@concasa.mx",
      fallbackId: "d5936ec7-e12e-4e14-b287-fd1259f782cf",
    }),
    "Paty Gutierrez",
  );
});

test("formatAsesorExpedienteLabel: sin nombre usa email", () => {
  assert.equal(
    formatAsesorExpedienteLabel({
      email: "paty.gutierrez@concasa.mx",
      fallbackId: "d5936ec7-e12e-4e14-b287-fd1259f782cf",
    }),
    "paty.gutierrez@concasa.mx",
  );
});

test("formatAsesorExpedienteLabel: UUID no se muestra como principal", () => {
  assert.equal(
    formatAsesorExpedienteLabel({
      fallbackId: "d5936ec7-e12e-4e14-b287-fd1259f782cf",
    }),
    "—",
  );
});

test("formatMontoAprobadoVigente: muestra monto aunque decisión no sea aprobado", () => {
  assert.equal(formatMontoAprobadoVigente(150_000), "$150,000.00");
});

test("formatMontoAprobadoVigente: sin monto devuelve guión", () => {
  assert.equal(formatMontoAprobadoVigente(null), "—");
  assert.equal(formatMontoAprobadoVigente(0), "—");
});
