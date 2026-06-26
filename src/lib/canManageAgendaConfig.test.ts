import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canManageAgendaConfig } from "./canManageAgendaConfig";

describe("canManageAgendaConfig", () => {
  it("mesa_admin ve configuración", () => {
    assert.equal(canManageAgendaConfig("mesa_admin"), true);
    assert.equal(canManageAgendaConfig("mesa_control_admin"), true);
    assert.equal(canManageAgendaConfig("mesa_control"), true);
  });

  it("super_admin ve configuración", () => {
    assert.equal(canManageAgendaConfig("super_admin"), true);
  });

  it("mesa_interno no ve configuración", () => {
    assert.equal(canManageAgendaConfig("mesa_interno"), false);
    assert.equal(canManageAgendaConfig("mesa_control_interno"), false);
  });

  it("mesa_externo no ve configuración", () => {
    assert.equal(canManageAgendaConfig("mesa_externo"), false);
    assert.equal(canManageAgendaConfig("mesa_control_externo"), false);
  });

  it("otros roles no ven configuración", () => {
    assert.equal(canManageAgendaConfig("asesor"), false);
    assert.equal(canManageAgendaConfig("editor"), false);
    assert.equal(canManageAgendaConfig(""), false);
    assert.equal(canManageAgendaConfig(null), false);
  });
});
