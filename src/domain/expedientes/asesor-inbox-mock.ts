/**
 * Simulación local (mock) de list/summary inbox asesor — paridad aproximada B1.5.
 * No se usa en modo Supabase; la UI nunca llama listForAsesor.
 */
import { matchesAsesorListadoBusqueda } from "@/lib/asesorListadoBusqueda";
import {
  ASESOR_INBOX_DEFAULT_PAGE_SIZE,
  ASESOR_INBOX_MAX_PAGE_SIZE,
  ASESOR_INBOX_NOTIF_DEFAULT_LIMIT,
  type AsesorInboxSummaryResult,
  type AsesorListExpedienteItem,
  type AsesorListExpedientesPageInput,
  type AsesorListExpedientesPageResult,
  asesorListExpedientesPageInputSchema,
} from "./asesor-inbox-rpc";
import { mapProgramaUiToDb } from "./map-programa";
import {
  deriveResultadoRealExpediente,
  type ExpedienteMock,
} from "./mock.repo";

const MOCK_ASESOR_UUID = "00000000-0000-4000-8001-000000000099";

function dayBoundsLocal(ymd: string, endOfDay: boolean): number {
  const d = new Date(ymd);
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function categoriaMock(_exp: ExpedienteMock): AsesorListExpedienteItem["categoria_correccion"] {
  void _exp;
  // Sin corpus documental en mock: faltantes (paridad con DOCUMENTO_TIPOS ausentes).
  return "faltantes";
}

function pendienteBio(exp: ExpedienteMock): boolean {
  return exp.operativo.submittedToMesa && exp.operativo.etapaActual === 3;
}

function pendienteFirma(exp: ExpedienteMock): boolean {
  const etapa = exp.operativo.etapaActual;
  return exp.operativo.submittedToMesa && (etapa === 9 || etapa === 10);
}

function pendienteAcuse(exp: ExpedienteMock): boolean {
  const etapa = exp.operativo.etapaActual ?? 0;
  return exp.operativo.submittedToMesa && etapa >= 8;
}

function toListItem(exp: ExpedienteMock): AsesorListExpedienteItem {
  const resultado = deriveResultadoRealExpediente(exp);
  return {
    id: exp.id,
    programa: exp.base.programa,
    programa_db: mapProgramaUiToDb(exp.base.programa),
    nss: exp.base.nss,
    cliente_nombre: exp.base.cliente_nombre,
    telefono_cliente: exp.base.telefono_cliente,
    direccion_opcional: exp.base.direccion_opcional,
    asesor_id: MOCK_ASESOR_UUID,
    origen_mesa: exp.base.origenMesa,
    submitted_to_mesa: exp.operativo.submittedToMesa,
    fecha_envio_mesa: exp.operativo.fechaEnvioMesa,
    etapa_actual: exp.operativo.etapaActual,
    subestado: exp.operativo.subestado,
    ciclo_estado: exp.operativo.cicloEstado,
    motivo_rechazo: exp.operativo.motivoRechazo,
    comentario_rechazo: exp.operativo.comentarioRechazo,
    fecha_cita: exp.operativo.fechaCita,
    firma_agendable_desde: exp.operativo.firmaAgendableDesde ?? null,
    created_at: exp.base.createdAt,
    updated_at: exp.operativo.updatedAt,
    expediente_anterior_id: exp.reingreso?.expedienteAnteriorId ?? null,
    reingreso_rechazo_id: exp.reingreso?.rechazoId ?? null,
    reingreso_manual_count: exp.reingresoManual?.count ?? 0,
    reingreso_manual_at: exp.reingresoManual?.at ?? null,
    reingreso_manual_by: exp.reingresoManual?.by ?? null,
    reprecalificacion_pendiente_id: exp.reprecalificacionPendienteId ?? null,
    decision: exp.editorDecision.decision,
    monto_aprobado: exp.editorDecision.monto_aprobado,
    notas_revision: exp.editorDecision.notas_revision,
    aprobado_at: exp.editorDecision.aprobadoAt ?? null,
    monto_aprobado_al_aprobar: exp.editorDecision.montoAprobadoAlAprobar ?? null,
    no_cumple_at: exp.editorDecision.noCumpleAt ?? null,
    resultado_real: resultado,
    categoria_correccion: categoriaMock(exp),
    reprecal_estado: exp.reprecalificacionPendienteId ? "pending" : null,
    reprecal_solicitada_at: exp.reprecalificacionPendienteId
      ? (exp.operativo.updatedAt ?? exp.base.createdAt)
      : null,
    reprecal_resuelta_at: null,
    reprecal_activity_at: exp.reprecalificacionPendienteId
      ? (exp.operativo.updatedAt ?? exp.base.createdAt)
      : null,
    reprecal_monto_previo: null,
    reprecal_monto_resultado: null,
    reprecal_programa_solicitado: null,
  };
}

function matchesQuick(
  exp: ExpedienteMock,
  item: AsesorListExpedienteItem,
  quick: string,
): boolean {
  if (quick === "todos") return true;
  if (exp.operativo.cicloEstado === "cerrado") return false;
  switch (quick) {
    case "en_tramite":
      return (
        item.resultado_real === "en_tramite" &&
        item.categoria_correccion !== "correccion_requerida" &&
        item.categoria_correccion !== "correccion_enviada"
      );
    case "correccion_requerida":
      return item.categoria_correccion === "correccion_requerida";
    case "correccion_enviada":
      return item.categoria_correccion === "correccion_enviada";
    case "rechazados_mesa":
      return item.resultado_real === "rechazado_mesa";
    case "cancelados":
      return item.resultado_real === "cancelado";
    case "agendar_biometricos":
      return pendienteBio(exp);
    case "agendar_firma":
      return pendienteFirma(exp);
    case "subir_acuse":
      return pendienteAcuse(exp);
    default:
      return true;
  }
}

function filterMine(
  mine: ExpedienteMock[],
  input: AsesorListExpedientesPageInput,
): AsesorListExpedienteItem[] {
  const quick = input.quick_filter ?? "todos";
  const out: AsesorListExpedienteItem[] = [];

  for (const exp of mine) {
    const item = toListItem(exp);
    if (
      !matchesAsesorListadoBusqueda(
        {
          cliente_nombre: item.cliente_nombre,
          nss: item.nss,
          telefono_cliente: item.telefono_cliente,
          programa: item.programa,
        },
        input.buscar ?? "",
      )
    ) {
      continue;
    }
    if (input.decision && item.decision !== input.decision) continue;
    if (
      input.estatus_operativo &&
      (item.subestado ?? "pendiente") !== input.estatus_operativo
    ) {
      continue;
    }
    if (input.resultado_real && item.resultado_real !== input.resultado_real) {
      continue;
    }
    if (input.programa && item.programa.trim() !== input.programa.trim()) {
      continue;
    }
    if (
      input.etapa_exacta != null &&
      item.etapa_actual !== input.etapa_exacta
    ) {
      continue;
    }
    if (input.fecha_desde) {
      const t = new Date(item.created_at).getTime();
      if (t < dayBoundsLocal(input.fecha_desde, false)) continue;
    }
    if (input.fecha_hasta) {
      const t = new Date(item.created_at).getTime();
      if (t > dayBoundsLocal(input.fecha_hasta, true)) continue;
    }
    if (!matchesQuick(exp, item, quick)) continue;
    out.push(item);
  }

  out.sort((a, b) => {
    const ta = new Date(a.reprecal_activity_at ?? a.created_at).getTime();
    const tb = new Date(b.reprecal_activity_at ?? b.created_at).getTime();
    if (tb !== ta) return tb - ta;
    return b.id.localeCompare(a.id);
  });
  return out;
}

export function mockListAsesorInboxPage(
  mine: ExpedienteMock[],
  rawInput: AsesorListExpedientesPageInput,
): AsesorListExpedientesPageResult {
  const input = asesorListExpedientesPageInputSchema.parse(rawInput);
  const pageSize = Math.min(
    ASESOR_INBOX_MAX_PAGE_SIZE,
    Math.max(1, input.page_size ?? ASESOR_INBOX_DEFAULT_PAGE_SIZE),
  );
  const page = Math.max(1, input.page ?? 1);
  const filtered = filterMine(mine, input);
  const total = filtered.length;
  const from = (page - 1) * pageSize;
  const items = filtered.slice(from, from + pageSize);
  return {
    items,
    total_count: total,
    page,
    page_size: pageSize,
    has_more: from + pageSize < total,
  };
}

export function mockGetAsesorInboxSummary(
  mine: ExpedienteMock[],
  notifLimit = ASESOR_INBOX_NOTIF_DEFAULT_LIMIT,
): AsesorInboxSummaryResult {
  const items = mine.map(toListItem);
  let aprobados_editor = 0;
  let no_cumple = 0;
  let en_tramite = 0;
  let rechazados_mesa = 0;
  let cancelados = 0;
  let correccion_requerida = 0;
  let correccion_enviada = 0;
  let agendar_biometricos = 0;
  let agendar_firma = 0;
  let subir_acuse = 0;

  for (let i = 0; i < mine.length; i += 1) {
    const exp = mine[i]!;
    const item = items[i]!;
    if (item.resultado_real === "aprobado_editor") aprobados_editor += 1;
    if (item.resultado_real === "no_cumple_editor") no_cumple += 1;
    if (
      item.resultado_real === "en_tramite" &&
      item.categoria_correccion !== "correccion_requerida" &&
      item.categoria_correccion !== "correccion_enviada"
    ) {
      en_tramite += 1;
    }
    if (item.resultado_real === "rechazado_mesa") rechazados_mesa += 1;
    if (item.resultado_real === "cancelado") cancelados += 1;
    if (item.categoria_correccion === "correccion_requerida") {
      correccion_requerida += 1;
    }
    if (item.categoria_correccion === "correccion_enviada") {
      correccion_enviada += 1;
    }
    if (pendienteBio(exp)) agendar_biometricos += 1;
    if (pendienteFirma(exp)) agendar_firma += 1;
    if (pendienteAcuse(exp)) subir_acuse += 1;
  }

  const programas = Array.from(
    new Set(
      items
        .map((i) => i.programa.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const limit = Math.min(100, Math.max(1, notifLimit));
  const notifications = items
    .filter((i) => i.resultado_real === "rechazado_mesa" || i.ciclo_estado === "cancelado")
    .slice(0, limit)
    .map((i) => ({
      id: `${i.id}:mock`,
      expediente_id: i.id,
      cliente_nombre: i.cliente_nombre || "—",
      kind: i.ciclo_estado === "cancelado" ? "cancelado" : "rechazado_mesa",
      tipo_label:
        i.ciclo_estado === "cancelado" ? "Expediente cancelado" : "Rechazado por Mesa",
      mensaje:
        i.ciclo_estado === "cancelado"
          ? "Expediente cancelado (terminal) — solo lectura"
          : "Expediente rechazado o bloqueado por Mesa",
      fecha: i.updated_at ?? i.created_at,
      prioridad: i.ciclo_estado === "cancelado" ? 1 : 2,
      href: `/asesor/expediente/${i.id}`,
    }));

  return {
    counts: {
      total: mine.length,
      aprobados_editor,
      no_cumple,
      en_tramite,
      rechazados_mesa,
      cancelados,
      correccion_requerida,
      correccion_enviada,
      agendar_biometricos,
      agendar_firma,
      subir_acuse,
    },
    programas_unicos: programas,
    notifications,
  };
}
