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

  it("migración 191 excluye terminales del mismo guard en bio/firma/acuse", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/191_asesor_tareas_excluir_terminales.sql"),
      "utf8",
    );
    assert.match(sql, /asesor_inbox_es_accionable/);
    assert.match(sql, /asesor_inbox_resultado_real/);
    assert.match(sql, /rechazado_mesa/);
    assert.match(sql, /asesor_inbox_pendiente_agendar_biometricos/);
    assert.match(sql, /asesor_inbox_pendiente_agendar_firma/);
    assert.match(sql, /asesor_inbox_pendiente_subir_acuse/);
  });

  it("migración 192 alinea categoria Mesa/Asesor al predicado P130", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/192_correcciones_enviadas_p130_mesa.sql"),
      "utf8",
    );
    assert.match(sql, /expediente_tiene_correccion_asesor_pendiente/);
    assert.match(sql, /pendiente_revision/);
    assert.match(sql, /submitted_at IS NOT NULL/);
    assert.match(sql, /mesa_bandeja_categoria_resumen/);
    assert.match(sql, /asesor_inbox_categoria_correccion/);
    assert.match(sql, /mesa_bandeja_sort_ts/);
    assert.doesNotMatch(sql, /UPDATE public\.expedientes/);
    assert.doesNotMatch(sql, /UPDATE public\.expediente_asesor_cambio_lotes/);
    assert.doesNotMatch(sql, /etapa_actual/);
  });

  it("migración 167 calibra categoría cliente_* y bio 4/5", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/167_asesor_pendientes_calibrados.sql"),
      "utf8",
    );
    assert.match(sql, /asesor_inbox_categoria_correccion/);
    assert.match(sql, /cliente_ine_frente/);
    assert.match(sql, /retencion_envios/);
    assert.match(sql, /asesor_inbox_latest_booking_status/);
    assert.match(sql, /p_etapa_actual IN \(4, 5\)/);
  });

  it("migración 180 ordena por actividad de re-precal, no por updated_at", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/180_asesor_reprecal_inbox_activity.sql"),
      "utf8",
    );
    assert.match(sql, /asesor_list_expedientes_page/);
    assert.match(sql, /inbox_sort_at DESC/);
    assert.match(sql, /reprecal_activity_at/);
    assert.match(sql, /decision_previa IS NOT NULL/);
    assert.doesNotMatch(sql, /ORDER BY f\.updated_at/);
    assert.doesNotMatch(sql, /asesor_iniciar_reprecalificacion/);
    assert.doesNotMatch(sql, /editor_resolver_reprecalificacion/);
  });

  it("Zod acepta metadata P183 opcional", () => {
    const parsed = asesorListExpedientesPageResultSchema.parse({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000183",
          programa: "Mejoravit",
          nss: "99183000001",
          cliente_nombre: "Ana",
          asesor_id: "00000000-0000-4000-8001-000000000001",
          submitted_to_mesa: false,
          created_at: "2026-08-14T12:00:00.000Z",
          decision: "aprobado",
          monto_aprobado: 95000,
          resultado_real: "aprobado_editor",
          categoria_correccion: "faltantes",
          reprecal_estado: "approved",
          reprecal_solicitada_at: "2026-08-14T12:05:00.000Z",
          reprecal_resuelta_at: "2026-08-14T12:10:00.000Z",
          reprecal_activity_at: "2026-08-14T12:10:00.000Z",
          reprecal_monto_previo: 80000,
          reprecal_monto_resultado: 95000,
          reprecal_programa_solicitado: "mejoravit",
        },
      ],
      total_count: 1,
      page: 1,
      page_size: 25,
      has_more: false,
    });
    assert.equal(parsed.items[0]!.reprecal_estado, "approved");
    assert.equal(parsed.items[0]!.reprecal_monto_previo, 80000);
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
    assert.match(md, /cliente_\*|P167/);
    assert.match(md, /Necesita corrección/);
  });
});
