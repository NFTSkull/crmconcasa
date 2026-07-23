import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMesaAbiertoAhoraBadge,
  type MesaPresenciaUser,
} from "./mesaExpedientePresenciaUi";

function u(name: string, id = "00000000-0000-4000-8000-000000000001"): MesaPresenciaUser {
  return { userId: id, fullName: name };
}

describe("formatMesaAbiertoAhoraBadge", () => {
  it("sin usuarios → null (no badge)", () => {
    assert.equal(formatMesaAbiertoAhoraBadge([]), null);
    assert.equal(formatMesaAbiertoAhoraBadge(null), null);
  });

  it("una persona", () => {
    assert.equal(
      formatMesaAbiertoAhoraBadge([u("Jorge")]),
      "Abierto ahora por Jorge",
    );
  });

  it("dos personas", () => {
    assert.equal(
      formatMesaAbiertoAhoraBadge([
        u("Jorge", "00000000-0000-4000-8000-000000000001"),
        u("Sara", "00000000-0000-4000-8000-000000000002"),
      ]),
      "Abierto ahora por Jorge y Sara",
    );
  });

  it("más de dos → +N", () => {
    assert.equal(
      formatMesaAbiertoAhoraBadge([
        u("Jorge", "00000000-0000-4000-8000-000000000001"),
        u("Sara", "00000000-0000-4000-8000-000000000002"),
        u("Keyla", "00000000-0000-4000-8000-000000000003"),
        u("July", "00000000-0000-4000-8000-000000000004"),
      ]),
      "Abierto ahora por Jorge, Sara +2",
    );
  });

  it("sin full_name no muestra correo", () => {
    assert.equal(
      formatMesaAbiertoAhoraBadge([{ userId: "x", fullName: null }]),
      "Abierto ahora por Usuario Mesa",
    );
  });
});
