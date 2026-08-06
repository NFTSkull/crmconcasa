import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveAdminStatusTone,
  adminStatusToneClass,
} from "@/lib/adminStatusBadge";

describe("Admin UX B2 — AdminStatusBadge tones", () => {
  it("mapea rechazo/cancelado a danger", () => {
    assert.equal(
      resolveAdminStatusTone({
        situacionLabel: "Continuar",
        rechazoOperativo: true,
      }),
      "danger",
    );
    assert.equal(
      resolveAdminStatusTone({
        situacionLabel: "X",
        cicloEstado: "cancelado",
      }),
      "danger",
    );
  });

  it("mapea corrección a warning", () => {
    assert.equal(
      resolveAdminStatusTone({
        situacionLabel: "Corrección requerida",
        correccionesAbiertasCount: 1,
      }),
      "warning",
    );
  });

  it("mapea validación Mesa a info y completado a success", () => {
    assert.equal(
      resolveAdminStatusTone({
        situacionLabel: "Validación Mesa",
        situacionCode: "validacion_mesa",
      }),
      "info",
    );
    assert.equal(
      resolveAdminStatusTone({
        situacionLabel: "Completado",
        cicloEstado: "finalizado",
      }),
      "success",
    );
  });

  it("default neutro y clases CSS presentes", () => {
    assert.equal(
      resolveAdminStatusTone({ situacionLabel: "Continuar etapa actual" }),
      "neutral",
    );
    assert.match(adminStatusToneClass("warning"), /amber/);
    assert.match(adminStatusToneClass("danger"), /red/);
    assert.match(adminStatusToneClass("success"), /emerald/);
  });
});
