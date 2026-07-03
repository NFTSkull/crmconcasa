import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDashboardNotifications,
  buildBestDashboardNotification,
  fechaToYMD,
} from "./dashboardNotifications";

describe("dashboardNotifications", () => {
  it("prioriza corrección de datos generales", () => {
    const item = buildBestDashboardNotification(
      {
        expedienteId: "exp-1",
        clienteNombre: "Ana",
        clienteDatosEstado: "rechazado",
        subestado: "en_validacion_mesa",
        submittedToMesa: true,
        resumenCorreccion: "documentos_validados",
      },
      "asesor",
    );
    assert.equal(item?.kind, "correccion_requerida");
    assert.match(item?.mensaje ?? "", /Datos generales/i);
    assert.equal(item?.href, "/asesor/expediente/exp-1");
  });

  it("detecta documentos rechazados sin datos rechazados", () => {
    const item = buildBestDashboardNotification(
      {
        expedienteId: "exp-2",
        clienteNombre: "Luis",
        resumenCorreccion: "correccion_requerida",
        clienteDatosEstado: "completo",
      },
      "asesor",
    );
    assert.equal(item?.kind, "correccion_requerida");
    assert.match(item?.mensaje ?? "", /Documentos/i);
  });

  it("mesa: ordena corrección requerida antes que cita hoy", () => {
    const list = buildDashboardNotifications(
      [
        {
          expedienteId: "a",
          clienteNombre: "Cita",
          fechaCita: "2026-07-03T15:00:00.000Z",
          etapaActual: 4,
          submittedToMesa: true,
        },
        {
          expedienteId: "b",
          clienteNombre: "Corrección",
          clienteDatosEstado: "rechazado",
          submittedToMesa: true,
        },
      ],
      "mesa",
      { todayYMD: "2026-07-03", max: 5 },
    );
    assert.equal(list[0]?.expedienteId, "b");
    assert.equal(list[0]?.kind, "correccion_requerida");
  });

  it("limita a máximo 5 alertas", () => {
    const sources = Array.from({ length: 8 }, (_, i) => ({
      expedienteId: `exp-${i}`,
      clienteNombre: `Cliente ${i}`,
      clienteDatosEstado: "rechazado" as const,
      submittedToMesa: true,
    }));
    const list = buildDashboardNotifications(sources, "asesor", { max: 5 });
    assert.equal(list.length, 5);
  });

  it("fechaToYMD acepta ISO y fecha simple", () => {
    assert.equal(fechaToYMD("2026-07-03"), "2026-07-03");
    assert.equal(fechaToYMD("2026-07-03T18:00:00.000Z"), "2026-07-03");
  });
});
