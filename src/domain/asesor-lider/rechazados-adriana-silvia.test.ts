import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  asesorLiderExpedienteRowSchema,
  asesorLiderListPageInputSchema,
} from "@/domain/asesor-lider/rpc";
import { asesorInboxOwnerCountsResultSchema } from "@/domain/expedientes/asesor-inbox-rpc";

describe("Asesor — filtro de rechazados Adriana/Silvia", () => {
  it("acepta estados efectivos de Mesa en el dashboard líder", () => {
    for (const ciclo of [
      "en_mesa",
      "rechazados_mesa",
      "correccion_requerida",
      "correccion_enviada",
      "cancelados",
    ] as const) {
      const parsed = asesorLiderListPageInputSchema.parse({ ciclo });
      assert.equal(parsed.ciclo, ciclo);
    }
  });

  it("conserva estado_efectivo en cada fila líder", () => {
    const row = asesorLiderExpedienteRowSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      cliente_nombre: "Cliente",
      nss: "12345678901",
      asesor_id: "22222222-2222-4222-8222-222222222222",
      etapa_actual: 3,
      ciclo_estado: "activo",
      subestado: "rechazado",
      submitted_to_mesa: true,
      estado_efectivo: "rechazado_mesa",
      created_at: "2026-09-18T12:00:00.000Z",
    });
    assert.equal(row.estado_efectivo, "rechazado_mesa");
  });

  it("valida KPIs del titular delegado", () => {
    const parsed = asesorInboxOwnerCountsResultSchema.parse({
      counts: {
        total: 29,
        aprobados_editor: 4,
        no_cumple: 1,
        en_tramite: 11,
        rechazados_mesa: 1,
        cancelados: 0,
        correccion_requerida: 12,
        correccion_enviada: 0,
        agendar_biometricos: 3,
        agendar_firma: 0,
        subir_acuse: 0,
      },
      programas_unicos: ["Mejoravit"],
    });
    assert.equal(parsed.counts.rechazados_mesa, 1);
  });

  it("UI ofrece Estado en Mesa y ya no pinta todo enviado como En Mesa", () => {
    const leaderSrc = readFileSync(
      join(process.cwd(), "src/components/asesor/AsesorLiderDashboard.tsx"),
      "utf8",
    );
    const asesorSrc = readFileSync(
      join(process.cwd(), "src/app/asesor/page.tsx"),
      "utf8",
    );

    assert.match(leaderSrc, /label="Estado en Mesa"/);
    assert.match(leaderSrc, /Rechazados por Mesa/);
    assert.match(leaderSrc, /mesaStatusMeta/);
    assert.doesNotMatch(
      leaderSrc,
      /const isEnMesa = isSilviaDashboard && r\.submitted_to_mesa/,
    );

    assert.match(asesorSrc, /id="asesor-estado-mesa"/);
    assert.match(asesorSrc, /Rechazados por Mesa/);
    assert.match(
      asesorSrc,
      /getAsesorInboxSummary\([\s\S]*?ASESOR_INBOX_NOTIF_DEFAULT_LIMIT,[\s\S]*?scopedOwnerId/,
    );
  });
});
