import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ASESOR_INBOX_DEFAULT_PAGE_SIZE,
  ASESOR_INBOX_MAX_PAGE_SIZE,
  asesorInboxSummaryResultSchema,
  asesorListExpedientesPageInputSchema,
  asesorListExpedientesPageResultSchema,
  normalizeAsesorInboxPageOptions,
} from "./asesor-inbox-rpc";

describe("asesor-inbox-rpc contracts (B1.5 P161)", () => {
  it("default page size es 25 y max 100", () => {
    assert.equal(ASESOR_INBOX_DEFAULT_PAGE_SIZE, 25);
    assert.equal(ASESOR_INBOX_MAX_PAGE_SIZE, 100);
    const n = normalizeAsesorInboxPageOptions({});
    assert.equal(n.page, 1);
    assert.equal(n.page_size, 25);
    assert.equal(n.from, 0);
    assert.equal(n.to, 24);
  });

  it("página 2 con size 25 usa rango 25–49", () => {
    const n = normalizeAsesorInboxPageOptions({ page: 2, page_size: 25 });
    assert.equal(n.from, 25);
    assert.equal(n.to, 49);
  });

  it("1088 expedientes ⇒ 44 páginas de 25", () => {
    const total = 1088;
    const size = 25;
    const pages = Math.ceil(total / size);
    assert.equal(pages, 44);
    const last = normalizeAsesorInboxPageOptions({ page: pages, page_size: size });
    assert.equal(last.from, 1075);
    assert.ok(last.from + size >= total);
  });

  it("total_count puede superar 1000 en el schema", () => {
    const parsed = asesorListExpedientesPageResultSchema.parse({
      items: [],
      total_count: 1088,
      page: 1,
      page_size: 25,
      has_more: true,
    });
    assert.equal(parsed.total_count, 1088);
  });

  it("input acepta filtros del inbox actual", () => {
    const parsed = asesorListExpedientesPageInputSchema.parse({
      page: 1,
      page_size: 25,
      buscar: "maria",
      decision: "aprobado",
      estatus_operativo: "en_proceso",
      resultado_real: "en_tramite",
      programa: "Mejoravit",
      etapa_exacta: 2,
      fecha_desde: "2026-01-01",
      fecha_hasta: "2026-12-31",
      quick_filter: "agendar_biometricos",
    });
    assert.equal(parsed.quick_filter, "agendar_biometricos");
    assert.equal(parsed.programa, "Mejoravit");
  });

  it("summary schema exige counts de todos los chips/KPIs", () => {
    const parsed = asesorInboxSummaryResultSchema.parse({
      counts: {
        total: 1088,
        aprobados_editor: 10,
        no_cumple: 2,
        en_tramite: 100,
        rechazados_mesa: 5,
        cancelados: 3,
        correccion_requerida: 7,
        correccion_enviada: 1,
        agendar_biometricos: 4,
        agendar_firma: 2,
        subir_acuse: 6,
      },
      programas_unicos: ["Mejoravit", "Subcuenta"],
      notifications: [
        {
          id: "00000000-0000-4000-8000-000000000099:correccion_requerida",
          expediente_id: "00000000-0000-4000-8000-000000000099",
          cliente_nombre: "Cliente",
          kind: "correccion_requerida",
          tipo_label: "Corrección requerida",
          mensaje: "Datos generales requieren corrección",
          fecha: null,
          prioridad: 1,
          href: "/asesor/expediente/00000000-0000-4000-8000-000000000099",
        },
      ],
    });
    assert.equal(parsed.counts.total, 1088);
    assert.equal(parsed.programas_unicos.length, 2);
    assert.equal(parsed.notifications.length, 1);
  });

  it("migración 161 declara aislamiento por asesor_id y orden estable", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/161_asesor_inbox_page_summary.sql"),
      "utf8",
    );
    assert.match(sql, /asesor_list_expedientes_page/);
    assert.match(sql, /asesor_inbox_summary/);
    assert.match(sql, /e\.asesor_id = v_actor/);
    assert.match(sql, /ORDER BY f\.created_at DESC, f\.id DESC/);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /solo asesor activo/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.asesor_list_expedientes_page/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.asesor_inbox_summary/);
    assert.doesNotMatch(sql, /listForAsesor\(/);
  });

  it("doc de equivalencia existe y cita DOCUMENTO_TIPOS legado", () => {
    const md = readFileSync(
      resolve(process.cwd(), "docs/ASESOR_INBOX_B15_EQUIVALENCIA.md"),
      "utf8",
    );
    assert.match(md, /deriveResultadoRealExpediente/);
    assert.match(md, /DOCUMENTO_TIPOS/);
    assert.match(md, /isAsesorPendienteAgendarBiometricos/);
    assert.match(md, /NotificationsBell|notifications/i);
  });
});
