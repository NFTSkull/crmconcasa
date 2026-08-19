import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ASESOR_INBOX_BUSCAR_DEBOUNCE_MS,
  ASESOR_INBOX_DEPENDENT_IDS_MAX,
  ASESOR_INBOX_UI_PAGE_SIZE,
  asesorInboxTotalPages,
  asesorInboxReprecalBadgeLabel,
  buildAsesorInboxListInput,
  capIdsForDependentLoads,
  clampAsesorInboxPage,
  collectAsesorInboxExportRows,
  formatAsesorInboxActualizacion,
  formatAsesorInboxMontoAntes,
  formatAsesorInboxShowingRange,
  mapAsesorInboxNotificationsToDashboard,
  mapAsesorInboxPageResultToViewModel,
  mapAsesorInboxReprecalMeta,
  mapAsesorInboxSummaryToKpis,
} from "./asesor-inbox-ui";
import {
  ASESOR_INBOX_MAX_PAGE_SIZE,
  type AsesorListExpedientesPageInput,
  type AsesorListExpedientesPageResult,
} from "./asesor-inbox-rpc";

describe("asesor-inbox-ui B1", () => {
  it("pageSize UI = 25 y debounce 300–400ms", () => {
    assert.equal(ASESOR_INBOX_UI_PAGE_SIZE, 25);
    assert.ok(ASESOR_INBOX_BUSCAR_DEBOUNCE_MS >= 300);
    assert.ok(ASESOR_INBOX_BUSCAR_DEBOUNCE_MS <= 400);
    assert.equal(ASESOR_INBOX_DEPENDENT_IDS_MAX, 25);
  });

  it("1088 total ⇒ 44 páginas; clamp fuera de rango", () => {
    assert.equal(asesorInboxTotalPages(1088, 25), 44);
    assert.equal(clampAsesorInboxPage(99, 1088, 25), 44);
    assert.equal(clampAsesorInboxPage(0, 1088, 25), 1);
    assert.equal(
      formatAsesorInboxShowingRange(2, 25, 1088),
      "Mostrando 26–50 de 1088",
    );
  });

  it("buildAsesorInboxListInput envía filtros del contrato", () => {
    const input = buildAsesorInboxListInput({
      page: 2,
      pageSize: 25,
      filters: {
        buscar: "maria",
        decision: "aprobado",
        estatusOperativo: "en_proceso",
        resultadoReal: "en_tramite",
        programa: "Mejoravit",
        etapaExacta: "3",
        fechaDesde: "2026-01-01",
        fechaHasta: "2026-12-31",
      },
      quickFilter: "agendar_biometricos",
    });
    assert.equal(input.page, 2);
    assert.equal(input.page_size, 25);
    assert.equal(input.buscar, "maria");
    assert.equal(input.decision, "aprobado");
    assert.equal(input.estatus_operativo, "en_proceso");
    assert.equal(input.resultado_real, "en_tramite");
    assert.equal(input.programa, "Mejoravit");
    assert.equal(input.etapa_exacta, 3);
    assert.equal(input.fecha_desde, "2026-01-01");
    assert.equal(input.fecha_hasta, "2026-12-31");
    assert.equal(input.quick_filter, "agendar_biometricos");
  });

  it("U10 chips rápidos viajan en quick_filter RPC, no como filtro local de badges", () => {
    const input = buildAsesorInboxListInput({
      page: 1,
      filters: {
        buscar: "",
        decision: "",
        estatusOperativo: "",
        resultadoReal: "",
        programa: "",
        etapaExacta: "",
        fechaDesde: "",
        fechaHasta: "",
      },
      quickFilter: "correccion_enviada",
    });
    assert.equal(input.quick_filter, "correccion_enviada");
    assert.equal(input.resultado_real, null);
  });

  it("capIdsForDependentLoads nunca supera 25 ni duplica", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    ids.push(ids[0]!);
    const capped = capIdsForDependentLoads(ids);
    assert.equal(capped.length, 25);
    assert.equal(new Set(capped).size, 25);
  });

  it("summary → kpis y notifications dashboard", () => {
    const summary = {
      counts: {
        total: 1088,
        aprobados_editor: 1,
        no_cumple: 2,
        en_tramite: 3,
        rechazados_mesa: 4,
        cancelados: 5,
        correccion_requerida: 6,
        correccion_enviada: 7,
        agendar_biometricos: 8,
        agendar_firma: 9,
        subir_acuse: 10,
      },
      programas_unicos: ["Mejoravit"],
      notifications: [
        {
          id: "e1:cancelado",
          expediente_id: "00000000-0000-4000-8000-000000000001",
          cliente_nombre: "Ana",
          kind: "cancelado",
          tipo_label: "Expediente cancelado",
          mensaje: "x",
          fecha: null,
          prioridad: 1,
          href: "/asesor/expediente/00000000-0000-4000-8000-000000000001",
        },
      ],
    };
    const kpis = mapAsesorInboxSummaryToKpis(summary);
    assert.equal(kpis.total, 1088);
    assert.equal(kpis.agendarBiometricos, 8);
    const notifs = mapAsesorInboxNotificationsToDashboard(summary);
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0]!.kind, "cancelado");
    assert.equal(notifs[0]!.expedienteId, "00000000-0000-4000-8000-000000000001");
    assert.equal(notifs[0]!.href, "/asesor/expediente/00000000-0000-4000-8000-000000000001");
  });

  it("notif necesita corrección añade focus=correccion", () => {
    const summary = {
      counts: {
        total: 1,
        aprobados_editor: 0,
        no_cumple: 0,
        en_tramite: 0,
        rechazados_mesa: 0,
        cancelados: 0,
        correccion_requerida: 1,
        correccion_enviada: 0,
        agendar_biometricos: 0,
        agendar_firma: 0,
        subir_acuse: 0,
      },
      programas_unicos: [] as string[],
      notifications: [
        {
          id: "e2:correccion_requerida",
          expediente_id: "00000000-0000-4000-8000-000000000002",
          cliente_nombre: "Luis",
          kind: "correccion_requerida",
          tipo_label: "Corrección requerida",
          mensaje: "Mesa solicita corrección",
          fecha: null,
          prioridad: 1,
          href: "/asesor/expediente/00000000-0000-4000-8000-000000000002",
        },
      ],
    };
    const notifs = mapAsesorInboxNotificationsToDashboard(summary);
    assert.equal(notifs[0]!.tipoLabel, "Necesita corrección");
    assert.equal(
      notifs[0]!.href,
      "/asesor/expediente/00000000-0000-4000-8000-000000000002?focus=correccion",
    );
  });

  it("extraordinary_rebook_required no degrada a pendiente_revision", () => {
    const summary = {
      ok: true as const,
      counts: {
        total: 1,
        aprobados_editor: 0,
        no_cumple: 0,
        en_tramite: 0,
        rechazados_mesa: 0,
        cancelados: 0,
        correccion_requerida: 0,
        correccion_enviada: 0,
        agendar_biometricos: 0,
        agendar_firma: 0,
        subir_acuse: 0,
      },
      programas_unicos: [] as string[],
      notifications: [
        {
          id: "exp:extraordinary_rebook_required:item",
          expediente_id: "00000000-0000-4000-8000-000000000099",
          cliente_nombre: "Ana",
          kind: "extraordinary_rebook_required",
          tipo_label: "Reagendar cita extraordinaria",
          mensaje: "Contingencia biometricos",
          fecha: "2026-08-12",
          prioridad: 4,
          href: "/asesor/expediente/00000000-0000-4000-8000-000000000099",
        },
      ],
    };
    const notifs = mapAsesorInboxNotificationsToDashboard(summary as never);
    assert.equal(notifs[0]!.kind, "extraordinary_rebook_required");
    assert.equal(notifs[0]!.prioridad, 4);
    assert.equal(notifs[0]!.expedienteId, "00000000-0000-4000-8000-000000000099");
    assert.match(notifs[0]!.href, /asesor\/expediente/);
    assert.match(notifs[0]!.mensaje, /Contingencia/);
  });

  it("collectAsesorInboxExportRows pagina sin duplicados y usa page_size 100", async () => {
    const calls: AsesorListExpedientesPageInput[] = [];
    const listPage = async (
      input: AsesorListExpedientesPageInput,
    ): Promise<AsesorListExpedientesPageResult> => {
      calls.push(input);
      const page = input.page ?? 1;
      const size = input.page_size ?? 100;
      const total = 150;
      const from = (page - 1) * size;
      const items = Array.from({ length: Math.min(size, Math.max(0, total - from)) }, (_, i) => {
        const n = from + i + 1;
        const id = `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
        return {
          id,
          programa: "Mejoravit",
          programa_db: "mejoravit",
          nss: String(10000000000 + n),
          cliente_nombre: `Cliente ${n}`,
          telefono_cliente: "5500000000",
          direccion_opcional: "",
          asesor_id: "00000000-0000-4000-8001-000000000001",
          origen_mesa: "interno",
          submitted_to_mesa: false,
          fecha_envio_mesa: null,
          etapa_actual: 1,
          subestado: "pendiente",
          ciclo_estado: "activo",
          motivo_rechazo: null,
          comentario_rechazo: null,
          fecha_cita: null,
          firma_agendable_desde: null,
          created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
          updated_at: null,
          expediente_anterior_id: null,
          reingreso_rechazo_id: null,
          reingreso_manual_count: 0,
          reingreso_manual_at: null,
          reingreso_manual_by: null,
          reprecalificacion_pendiente_id: null,
          decision: "pendiente",
          monto_aprobado: null,
          notas_revision: "",
          aprobado_at: null,
          monto_aprobado_al_aprobar: null,
          no_cumple_at: null,
          resultado_real: "pendiente_editor" as const,
          categoria_correccion: "faltantes" as const,
        };
      });
      return {
        items,
        total_count: total,
        page,
        page_size: size,
        has_more: from + items.length < total,
      };
    };

    const rows = await collectAsesorInboxExportRows({
      listPage,
      pageSize: ASESOR_INBOX_MAX_PAGE_SIZE,
      asesorEmail: "a@test.com",
    });
    assert.equal(rows.length, 150);
    assert.equal(new Set(rows.map((r) => r.id)).size, 150);
    assert.ok(calls.length >= 2);
    assert.equal(calls[0]!.page_size, 100);
    assert.equal(calls[0]!.page, 1);
    assert.equal(calls[1]!.page, 2);
  });

  it("P183 labels y metadata no marcan aprobación inicial", () => {
    assert.equal(
      asesorInboxReprecalBadgeLabel("pending"),
      "Precalificación actualizada · En revisión",
    );
    assert.equal(asesorInboxReprecalBadgeLabel("approved"), "Monto actualizado");
    assert.equal(
      asesorInboxReprecalBadgeLabel("no_cumple"),
      "Resultado actualizado · No cumple",
    );
    assert.equal(mapAsesorInboxReprecalMeta({
      id: "00000000-0000-4000-8000-000000000001",
      programa: "Mejoravit",
      nss: "11111111111",
      cliente_nombre: "X",
      asesor_id: "00000000-0000-4000-8001-000000000001",
      submitted_to_mesa: false,
      created_at: "2026-08-14T12:00:00.000Z",
      decision: "aprobado",
      resultado_real: "aprobado_editor",
      categoria_correccion: "faltantes",
    }), null);
    const pending = mapAsesorInboxReprecalMeta({
      id: "00000000-0000-4000-8000-000000000002",
      programa: "Mejoravit",
      nss: "11111111111",
      cliente_nombre: "X",
      asesor_id: "00000000-0000-4000-8001-000000000001",
      submitted_to_mesa: false,
      created_at: "2026-05-01T00:00:00.000Z",
      decision: "aprobado",
      monto_aprobado: 80000,
      resultado_real: "aprobado_editor",
      categoria_correccion: "faltantes",
      reprecal_estado: "pending",
      reprecal_activity_at: "2026-08-14T12:20:00.000Z",
      reprecal_monto_previo: 80000,
    });
    assert.equal(pending?.estado, "pending");
    const vm = mapAsesorInboxPageResultToViewModel({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          programa: "Mejoravit",
          nss: "11111111111",
          cliente_nombre: "X",
          asesor_id: "00000000-0000-4000-8001-000000000001",
          submitted_to_mesa: false,
          created_at: "2026-05-01T00:00:00.000Z",
          decision: "aprobado",
          monto_aprobado: 80000,
          resultado_real: "aprobado_editor",
          categoria_correccion: "faltantes",
          reprecal_estado: "pending",
          reprecal_activity_at: "2026-08-14T12:20:00.000Z",
        },
      ],
      total_count: 1,
      page: 1,
      page_size: 25,
      has_more: false,
    });
    assert.equal(vm.reprecalPorId["00000000-0000-4000-8000-000000000002"]?.estado, "pending");
    assert.equal(vm.items[0]!.editorDecision.monto_aprobado, 80000);
    const actualizacion = formatAsesorInboxActualizacion(
      pending,
      "2026-08-14T18:00:00.000Z",
      () => "NO",
    );
    assert.match(actualizacion, /^Reenviada /);
    assert.doesNotMatch(actualizacion, /NO/);
    const resuelta = formatAsesorInboxActualizacion(
      {
        estado: "approved",
        solicitadaAt: null,
        resueltaAt: "2026-08-14T12:10:00.000Z",
        activityAt: "2026-08-14T12:10:00.000Z",
        montoPrevio: 80000,
        montoResultado: 95000,
        programaSolicitado: "mejoravit",
      },
      "2026-08-14T18:00:00.000Z",
      () => "NO",
    );
    assert.match(resuelta, /^Resultado /);
    assert.equal(
      formatAsesorInboxActualizacion(null, "2026-08-14T18:00:00.000Z", () => "fallback"),
      "fallback",
    );
    assert.equal(formatAsesorInboxMontoAntes(80000, 95000), "Antes $80,000");
    assert.equal(formatAsesorInboxMontoAntes(80000, 80000), null);
  });
});

describe("asesor page B1 contract (source)", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/app/asesor/page.tsx"),
    "utf8",
  );

  it("ya no llama listForAsesor()", () => {
    assert.doesNotMatch(src, /\.listForAsesor\s*\(/);
  });

  it("U10 loadInbox manda quickFilter al RPC y no filtra la tabla por categoria_correccion", () => {
    const loadStart = src.indexOf("const loadInbox");
    const loadEnd = src.indexOf("const reloadPrecalificaciones");
    const loadBody = src.slice(loadStart, loadEnd);
    assert.match(loadBody, /buildAsesorInboxListInput/);
    assert.match(loadBody, /quickFilter/);
    assert.match(loadBody, /listAsesorInboxPage\(listInput\)/);
    assert.match(src, /estadoEfectivo: row\.estado_efectivo/);
    assert.match(src, /asesorEstadoActualFilaBadge\(/);
    const tbody = src.slice(src.indexOf("expedientesPagina.map"), src.indexOf("</tbody>"));
    assert.doesNotMatch(tbody, /filter\(\(p\) => p\.categoria/);
    assert.doesNotMatch(tbody, /filter\(\(p\) => p\.resultadoReal/);
  });

  it("page size 25 y sin fallback silencioso", () => {
    assert.match(src, /ASESOR_INBOX_UI_PAGE_SIZE/);
    assert.doesNotMatch(src, /listForAsesor\s*\(/);
    assert.match(src, /capIdsForDependentLoads/);
    assert.match(src, /collectAsesorInboxExportRows/);
    assert.match(src, /queryGenRef/);
    assert.match(src, /Reintentar/);
  });

  it("P183 badges y columna Actualización por reprecal_activity_at", () => {
    assert.match(src, /asesorInboxReprecalBadgeLabel/);
    assert.match(src, /Monto actualizado/);
    assert.match(src, /formatAsesorInboxActualizacion/);
    assert.match(src, /visibilitychange/);
    assert.match(src, /8_000/);
    assert.doesNotMatch(src, /channel\(/);
  });

  it("P184 pasa etapa y pago ConCasa a badges de resultado/estatus", () => {
    assert.match(src, /asesor-inbox-fila-badges/);
    assert.match(src, /p\.operativo\?\.pagoConcasaResultado/);
    assert.match(src, /Precalificación actualizada · En revisión|asesorInboxReprecalBadgeLabel/);
    assert.match(src, /Resultado actualizado · No cumple|asesorInboxReprecalBadgeLabel/);
  });

  it("export solo on-click (no en loadInbox)", () => {
    assert.match(src, /handleDescargarExcel/);
    assert.match(src, /collectAsesorInboxExportRows/);
    // loadInbox no debe invocar export
    const loadStart = src.indexOf("const loadInbox");
    const loadEnd = src.indexOf("const reloadPrecalificaciones");
    const loadBody = src.slice(loadStart, loadEnd);
    assert.doesNotMatch(loadBody, /collectAsesorInboxExportRows/);
    assert.doesNotMatch(loadBody, /downloadAsesorPrecalificacionesExcel/);
  });
});
