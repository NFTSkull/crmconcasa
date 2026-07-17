import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_MESA_LAST_ACTIVITY_ACTIONS,
  formatAdminMesaAsesorLabel,
  labelAdminMesaAction,
  sanitizeAdminMotivo,
  sanitizeAdminTimelineSummary,
} from "./mesa-seguimiento";

describe("admin mesa-seguimiento whitelist", () => {
  it("última actividad Mesa no incluye acciones de asesor ni editor", () => {
    assert.equal(
      ADMIN_MESA_LAST_ACTIVITY_ACTIONS.includes(
        "expediente.documento.asesor_correccion" as never,
      ),
      false,
    );
    assert.equal(
      ADMIN_MESA_LAST_ACTIVITY_ACTIONS.includes("editor.decision.upsert" as never),
      false,
    );
    assert.ok(ADMIN_MESA_LAST_ACTIVITY_ACTIONS.includes("documento.revision.update"));
    assert.ok(ADMIN_MESA_LAST_ACTIVITY_ACTIONS.includes("expediente.rechazo_operativo"));
  });

  it("etiquetas de acción Mesa sin filtrar códigos crudos", () => {
    assert.equal(
      labelAdminMesaAction("documento.revision.update"),
      "Revisión documental Mesa",
    );
    assert.equal(labelAdminMesaAction("rpc.secreta"), "Actividad");
  });

  it("sanitiza motivos y summary allowlist", () => {
    assert.equal(sanitizeAdminMotivo("  "), "Sin motivo registrado");
    assert.equal(sanitizeAdminMotivo("x".repeat(600)).length, 500);
    const s = sanitizeAdminTimelineSummary({
      tipo_documento: " ine_reverso ",
      motivo: " ok ",
      storage_path: "/secret",
      actor_id: "uuid",
    });
    assert.equal(s.tipo_documento, "ine_reverso");
    assert.equal(s.motivo, "ok");
    assert.equal(Object.hasOwn(s, "storage_path"), false);
  });

  it("asesor Mesa sin correo ni UUID", () => {
    assert.equal(formatAdminMesaAsesorLabel("Ana López"), "Ana López");
    assert.equal(formatAdminMesaAsesorLabel("  "), "Asesor sin nombre registrado");
    assert.equal(formatAdminMesaAsesorLabel(null), "Asesor sin nombre registrado");
  });
});
