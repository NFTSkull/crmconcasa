import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  asesorLiderDashboardSchema,
  asesorLiderListPageInputSchema,
} from "@/domain/asesor-lider/rpc";

describe("Dashboard líder — filtros rápidos completos", () => {
  it("acepta quick_counts completos del equipo", () => {
    const parsed = asesorLiderDashboardSchema.parse({
      activos: 56,
      enviados: 40,
      cerrados: 0,
      total: 56,
      monto_total_aprobado: 1000,
      quick_counts: {
        todos: 56,
        en_mesa: 19,
        en_tramite: 19,
        correccion_requerida: 19,
        correccion_enviada: 0,
        rechazados_mesa: 2,
        cancelados: 0,
        agendar_biometricos: 5,
        agendar_firma: 1,
        subir_acuse: 1,
      },
      by_etapa: [],
      filters: {
        asesor_id: null,
        fecha_desde: null,
        fecha_hasta: null,
      },
    });

    assert.equal(parsed.quick_counts?.rechazados_mesa, 2);
    assert.equal(parsed.quick_counts?.agendar_biometricos, 5);
  });

  it("lista acepta las mismas tareas rápidas del inbox asesor", () => {
    for (const ciclo of [
      "en_mesa",
      "en_tramite",
      "correccion_requerida",
      "correccion_enviada",
      "rechazados_mesa",
      "cancelados",
      "agendar_biometricos",
      "agendar_firma",
      "subir_acuse",
    ] as const) {
      assert.equal(
        asesorLiderListPageInputSchema.parse({ ciclo }).ciclo,
        ciclo,
      );
    }
  });

  it("UI deja todos los accesos visibles, no escondidos en el select", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "src/components/asesor/AsesorLiderDashboard.tsx",
      ),
      "utf8",
    );

    assert.match(src, /aria-label="Filtros rápidos del equipo"/);
    assert.match(src, /Necesita corrección/);
    assert.match(src, /Corrección enviada/);
    assert.match(src, /Rechazados por Mesa/);
    assert.match(src, /Cancelados/);
    assert.match(src, /Agendar biométricos/);
    assert.match(src, /Agendar firma/);
    assert.match(src, /Subir acuse/);
    assert.match(src, /dashboard\?\.quick_counts/);
  });
});
