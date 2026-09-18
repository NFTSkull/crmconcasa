import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_MESA_LAST_ACTIVITY_ACTIONS,
  formatAdminMesaAsesorLabel,
  formatAdminTimelineDateTimeMx,
  labelAdminMesaAction,
  labelAdminMesaTimelineEvent,
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
      comentario_rechazo: " El IMSS reporta inconsistencias ",
      request_type: "SOLICITUD_DATOS_GENERALES",
      request_at: "2026-09-18T14:10:53.348439+00:00",
      submitted_at: "2026-09-18T16:30:52.565591+00:00",
      copied_cambios: 1,
      storage_path: "/secret",
      actor_id: "uuid",
    });
    assert.equal(s.tipo_documento, "ine_reverso");
    assert.equal(s.motivo, "ok");
    assert.equal(s.comentario_rechazo, "El IMSS reporta inconsistencias");
    assert.equal(s.request_type, "SOLICITUD_DATOS_GENERALES");
    assert.equal(s.request_at, "2026-09-18T14:10:53.348439+00:00");
    assert.equal(s.submitted_at, "2026-09-18T16:30:52.565591+00:00");
    assert.equal(s.copied_cambios, "1");
    assert.equal(Object.hasOwn(s, "storage_path"), false);
  });

  it("distingue solicitud, validación y reenvío de corrección", () => {
    assert.equal(
      labelAdminMesaTimelineEvent({
        action: "cliente_datos.revision.update",
        summary: { estado_nuevo: "rechazado" },
      }),
      "Mesa solicitó corrección de datos generales",
    );
    assert.equal(
      labelAdminMesaTimelineEvent({
        action: "documento.revision.update",
        summary: { estatus_nuevo: "validado" },
      }),
      "Mesa validó documento",
    );
    assert.equal(
      labelAdminMesaAction("asesor.correccion.reenviada_a_mesa"),
      "Asesor reenvió corrección a Mesa",
    );
  });

  it("hora de auditoría se fija a Monterrey", () => {
    const text = formatAdminTimelineDateTimeMx("2026-09-18T14:10:53.348439+00:00");
    assert.match(text, /18\/09\/2026/);
    assert.match(text, /08:10:53/);
  });

  it("asesor Mesa sin correo ni UUID", () => {
    assert.equal(formatAdminMesaAsesorLabel("Ana López"), "Ana López");
    assert.equal(formatAdminMesaAsesorLabel("  "), "Asesor sin nombre registrado");
    assert.equal(formatAdminMesaAsesorLabel(null), "Asesor sin nombre registrado");
  });
});
