import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapUpsertAgendaConfigBiometricosRpcError } from "./upsert-agenda-config-rpc-error";

describe("mapUpsertAgendaConfigBiometricosRpcError", () => {
  it("mapea rol no autorizado", () => {
    const err = mapUpsertAgendaConfigBiometricosRpcError({
      code: "42501",
      message: "upsert_agenda_config_biometricos: rol no autorizado (asesor)",
    });
    assert.match(err.message, /Mesa Admin o Super Admin/);
  });

  it("mapea timezone inválido", () => {
    const err = mapUpsertAgendaConfigBiometricosRpcError({
      message: "upsert_agenda_config_biometricos: timezone inválido: Foo/Bar",
    });
    assert.match(err.message, /zona horaria/i);
  });

  it("expone mensaje SQL conocido sin prefijo", () => {
    const err = mapUpsertAgendaConfigBiometricosRpcError({
      message: "upsert_agenda_config_biometricos: slots con duplicados",
    });
    assert.match(err.message, /horarios/i);
  });

  it("mapea reducción bajo ocupados con mínimo permitido", () => {
    const err = mapUpsertAgendaConfigBiometricosRpcError({
      message: "No puedes establecer un cupo menor a las 5 citas ya reservadas.",
    });
    assert.match(err.message, /5 citas ya reservadas/);
    assert.match(err.message, /Capacidad mínima permitida: 5/);
  });
});
