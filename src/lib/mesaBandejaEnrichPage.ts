/**
 * Enrich de una página de bandeja Mesa (P100/P102/P119).
 * Solo pide resúmenes/ops/marcadores/bookings para los IDs de la página recibida.
 */

import {
  deriveResumenExpedienteCorreccion,
  hasPendingAsesorChanges,
  type CategoriaResumenDocumental,
  type ExpedienteArchivoResumen,
} from "@/domain/expediente-archivos";
import type { ExpedienteClienteDatosEstado } from "@/domain/expediente-cliente-datos/types";
import type { ClienteDatosEstadoBatch } from "@/domain/expediente-cliente-datos/types";
import type { MesaExpedienteOpsRow } from "@/domain/mesa-ops/types";
import type { AgendaNotificacionActiveBooking } from "@/domain/agenda-biometricos";
import type { MesaExpedienteMarcador } from "@/domain/expediente-mesa-marcadores";
import type { RetencionOpcion } from "@/domain/expediente-retencion/types";
import {
  deriveMesaCorreccionLecturaEstado,
  deriveUltimaCorreccionEnviadaAt,
  mesaEntradaEsPorCorreccion,
  resolveFechaEntradaMesaActual,
  type MesaCorreccionLecturaEstado,
} from "@/lib/mesaCorreccionEntrada";
import { getMesaExpedienteLastOpenedAt } from "@/lib/mesaExpedienteOpenedStorage";
import { buildMesaOpsMap } from "@/lib/mesaOpsUi";
import { fetchMesaBandejaSecondaryParallel } from "@/lib/mesaBandejaLoad";
import { resolveProfileDisplayLabel } from "@/lib/mesaNotificacionExtraordinariaUi";
import type {
  MesaBandejaActiveBookingFlags,
  MesaBandejaRetencionHint,
} from "@/lib/mesaBandejaAccionesEnrich";
import { listAsesorCambiosSummaryByExpedienteIds } from "@/domain/expedientes/mesa-asesor-cambios";
import { listCorreccionSolicitudHistoricaByExpedienteIds } from "@/domain/expedientes/mesa-correccion-solicitud-historica";
import type {
  MesaAsesorCambiosSummaryItem,
  MesaAsesorCambioStatus,
  MesaCorreccionSolicitudHistorica,
} from "@/lib/mesaAsesorCambiosUi";
import { esCorreccionHistoricaSinDetalle } from "@/lib/mesaAsesorCambiosUi";

export type MesaBandejaCasoBase = Readonly<{
  id: string;
  cliente_nombre: string;
  telefono_cliente: string;
  programa: string;
  nss?: string;
  asesorNombre?: string;
  etapaActual: number;
  subestado: string;
  cicloEstado?: string | null;
  motivoRechazo?: string;
  fechaCita?: string;
  createdAt?: string;
  updatedAt?: string;
  submittedToMesa?: boolean;
  origenMesa?: "interno" | "externo" | null;
  fechaEnvioMesa?: string | null;
}>;

export type MesaBandejaCasoEnriched = MesaBandejaCasoBase & {
  resumenDocumental?: CategoriaResumenDocumental;
  archivosResumen?: ExpedienteArchivoResumen[];
  clienteDatosEstado?: ExpedienteClienteDatosEstado | null;
  fechaEntradaMesaActual?: string | null;
  ultimaCorreccionEnviadaAt?: string | null;
  entradaLecturaEsCorreccion?: boolean;
  correccionLecturaEstado?: MesaCorreccionLecturaEstado;
  mesaOps?: MesaExpedienteOpsRow | null;
  notificacionBooking?: AgendaNotificacionActiveBooking | null;
  notificacionAgendadoPorLabel?: string;
  tieneDatos?: boolean;
  hasActiveBiometricBooking?: boolean;
  hasActiveFirmasBooking?: boolean;
  hasActiveNotificacionBooking?: boolean;
  retencionOpcion?: RetencionOpcion | null;
  retencionEnviadoAMesa?: boolean;
  retencionEnvioEstado?: "enviado" | "correccion_requerida" | null;
  /** P130 — lote de cambios del asesor (batch enrich). */
  advisorChangesCount?: number | null;
  advisorChangesSubmittedAt?: string | null;
  advisorChangesSummary?: readonly string[] | null;
  advisorChangesStatus?: MesaAsesorCambioStatus | null;
  advisorChangeBatchId?: string | null;
  /** P130.2 — solicitud Mesa canónica para histórico sin lote. */
  correctionRequestedReason?: string | null;
  correctionRequestedNote?: string | null;
  correctionRequestedAt?: string | null;
  correctionRequestedByName?: string | null;
  correctionResubmittedAt?: string | null;
};

export type EnrichMesaBandejaPageDeps = {
  listResumenBatchByExpedienteIds: (
    ids: readonly string[],
  ) => Promise<Record<string, ExpedienteArchivoResumen[]>>;
  listEstadoBatchByExpedienteIds: (
    ids: readonly string[],
  ) => Promise<Record<string, ClienteDatosEstadoBatch>>;
  listActiveNotificacionByExpedienteIds?: (
    ids: readonly string[],
  ) => Promise<Map<string, AgendaNotificacionActiveBooking>>;
  listMesaOpsByExpedienteIds?: (
    ids: readonly string[],
  ) => Promise<MesaExpedienteOpsRow[]>;
  listActiveBookingFlagsByExpedienteIds?: (
    ids: readonly string[],
  ) => Promise<Map<string, MesaBandejaActiveBookingFlags>>;
  listRetencionHintsByExpedienteIds?: (
    ids: readonly string[],
  ) => Promise<Map<string, MesaBandejaRetencionHint>>;
  listTieneDatosMarcadoresByExpedienteIds?: (
    ids: readonly string[],
  ) => Promise<Map<string, MesaExpedienteMarcador>>;
  resolveAsesorDisplayBatch?: (
    creatorIds: string[],
  ) => Promise<Map<string, string>>;
  listAsesorCambiosSummaryByExpedienteIds?: (
    ids: readonly string[],
  ) => Promise<ReadonlyMap<string, MesaAsesorCambiosSummaryItem>>;
  listCorreccionSolicitudHistoricaByExpedienteIds?: (
    ids: readonly string[],
    resubmittedAtByExpediente: ReadonlyMap<string, string | null | undefined>,
  ) => Promise<ReadonlyMap<string, MesaCorreccionSolicitudHistorica>>;
  mesaUserId: string | null;
};

const BOOKING_HINT_ETAPAS = new Set([3, 4, 5, 9, 10]);

export async function enrichMesaBandejaPageItems<T extends MesaBandejaCasoBase>(
  base: readonly T[],
  deps: EnrichMesaBandejaPageDeps,
): Promise<Array<T & MesaBandejaCasoEnriched>> {
  if (base.length === 0) return [];

  const allExpedienteIds = base.map((c) => c.id);
  const etapa3ExpedienteIds = base
    .filter((c) => c.etapaActual === 3)
    .map((c) => c.id);
  const bookingHintExpedienteIds = base
    .filter((c) => BOOKING_HINT_ETAPAS.has(c.etapaActual))
    .map((c) => c.id);
  const etapa8ExpedienteIds = base
    .filter((c) => c.etapaActual === 8)
    .map((c) => c.id);

  const secondary = await fetchMesaBandejaSecondaryParallel(
    {
      allExpedienteIds,
      etapa3ExpedienteIds,
      bookingHintExpedienteIds,
      etapa8ExpedienteIds,
    },
    {
      listResumenBatchByExpedienteIds: deps.listResumenBatchByExpedienteIds,
      listEstadoBatchByExpedienteIds: deps.listEstadoBatchByExpedienteIds,
      listActiveNotificacionByExpedienteIds:
        deps.listActiveNotificacionByExpedienteIds,
      listMesaOpsByExpedienteIds: deps.listMesaOpsByExpedienteIds,
      listActiveBookingFlagsByExpedienteIds:
        deps.listActiveBookingFlagsByExpedienteIds,
      listRetencionHintsByExpedienteIds: deps.listRetencionHintsByExpedienteIds,
      listTieneDatosMarcadoresByExpedienteIds:
        deps.listTieneDatosMarcadoresByExpedienteIds,
    },
  );

  const {
    resumenPorId,
    estadosPorId,
    notificacionPorId,
    opsRows,
    bookingFlagsPorId,
    retencionPorId,
    marcadorTieneDatosPorId,
  } = secondary;

  const creatorIds = [
    ...new Set(
      [...notificacionPorId.values()]
        .map((b) => b.createdById?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const agendadoPorLabels =
    deps.resolveAsesorDisplayBatch && creatorIds.length > 0
      ? await deps.resolveAsesorDisplayBatch(creatorIds)
      : new Map<string, string>();

  const opsMap = buildMesaOpsMap(opsRows);

  const listAdvisorChanges =
    deps.listAsesorCambiosSummaryByExpedienteIds ??
    listAsesorCambiosSummaryByExpedienteIds;
  let advisorChangesById = new Map<string, MesaAsesorCambiosSummaryItem>();
  try {
    advisorChangesById = new Map(await listAdvisorChanges(allExpedienteIds));
  } catch {
    advisorChangesById = new Map();
  }

  // Pre-derive categoría + resubmit para acotar query histórica (1 batch, sin N+1).
  const prelim = base.map((c) => {
    const resumen = resumenPorId[c.id] ?? [];
    const clienteBatch = estadosPorId[c.id] ?? null;
    const advisor = advisorChangesById.get(c.id);
    const cambiosPendientesRevision = hasPendingAsesorChanges({
      loteStatus: advisor?.status ?? null,
      submittedAt: advisor?.submittedAt ?? null,
    });
    const resumenDocumental = deriveResumenExpedienteCorreccion(resumen, {
      clienteDatosEstado: clienteBatch?.estado ?? null,
      clienteDatosUpdatedAt: clienteBatch?.updatedAt ?? null,
      clienteDatosValidatedAt: clienteBatch?.validatedAt ?? null,
      fechaEnvioMesa: c.fechaEnvioMesa ?? null,
      cambiosPendientesRevision,
    });
    const ultimaCorreccionEnviadaAt = cambiosPendientesRevision
      ? (advisor?.submittedAt ?? null)
      : deriveUltimaCorreccionEnviadaAt({
          resumen,
          clienteDatos: clienteBatch
            ? {
                estado: clienteBatch.estado,
                updatedAt: clienteBatch.updatedAt,
                validatedAt: clienteBatch.validatedAt,
              }
            : null,
          fechaEnvioMesa: c.fechaEnvioMesa ?? null,
        });
    const resubmittedAt =
      advisor?.submittedAt ?? ultimaCorreccionEnviadaAt ?? null;
    return {
      c,
      resumen,
      clienteBatch,
      advisor,
      resumenDocumental,
      ultimaCorreccionEnviadaAt,
      resubmittedAt,
      historica: esCorreccionHistoricaSinDetalle({
        resumenDocumental,
        advisorChangeBatchId: advisor?.batchId ?? null,
      }),
    };
  });

  const historicIds = prelim.filter((p) => p.historica).map((p) => p.c.id);
  const resubmittedAtByExpediente = new Map(
    prelim
      .filter((p) => p.historica)
      .map((p) => [p.c.id, p.resubmittedAt] as const),
  );

  let solicitudById = new Map<string, MesaCorreccionSolicitudHistorica>();
  if (historicIds.length > 0) {
    const listSolicitud =
      deps.listCorreccionSolicitudHistoricaByExpedienteIds ??
      ((ids, resubMap) =>
        listCorreccionSolicitudHistoricaByExpedienteIds(ids, resubMap, {
          resolveActorDisplayBatch: deps.resolveAsesorDisplayBatch,
        }));
    try {
      solicitudById = new Map(
        await listSolicitud(historicIds, resubmittedAtByExpediente),
      );
    } catch {
      solicitudById = new Map();
    }
  }

  return prelim.map((p) => {
    const {
      c,
      resumen,
      clienteBatch,
      advisor,
      resumenDocumental,
      ultimaCorreccionEnviadaAt,
      resubmittedAt,
      historica,
    } = p;
    const fechaEntradaMesaActual = resolveFechaEntradaMesaActual(
      c.fechaEnvioMesa ?? null,
      ultimaCorreccionEnviadaAt,
      c.createdAt ?? null,
    );
    const correccionLecturaEstado = deriveMesaCorreccionLecturaEstado(
      fechaEntradaMesaActual,
      getMesaExpedienteLastOpenedAt(c.id, deps.mesaUserId),
    );
    const entradaLecturaEsCorreccion = mesaEntradaEsPorCorreccion(
      fechaEntradaMesaActual,
      ultimaCorreccionEnviadaAt,
    );
    const booking = notificacionPorId.get(c.id) ?? null;
    const flags = bookingFlagsPorId.get(c.id);
    const retencion = retencionPorId.get(c.id);
    const solicitud = historica ? solicitudById.get(c.id) : undefined;
    return {
      ...c,
      resumenDocumental,
      archivosResumen: resumen,
      clienteDatosEstado: clienteBatch?.estado ?? null,
      fechaEntradaMesaActual,
      ultimaCorreccionEnviadaAt,
      entradaLecturaEsCorreccion,
      correccionLecturaEstado,
      notificacionBooking: booking,
      notificacionAgendadoPorLabel: booking?.createdById
        ? agendadoPorLabels.get(booking.createdById) ?? "—"
        : undefined,
      mesaOps: opsMap.get(c.id) ?? null,
      tieneDatos: marcadorTieneDatosPorId.has(c.id),
      hasActiveBiometricBooking: Boolean(flags?.biometricos),
      hasActiveFirmasBooking: Boolean(flags?.firmas),
      hasActiveNotificacionBooking:
        Boolean(flags?.notificacion) || Boolean(booking),
      retencionOpcion: retencion?.opcion ?? null,
      retencionEnviadoAMesa: Boolean(retencion?.enviadoAMesa),
      retencionEnvioEstado: retencion?.envioEstado ?? null,
      advisorChangesCount: advisor?.changesCount ?? null,
      advisorChangesSubmittedAt: advisor?.submittedAt ?? null,
      advisorChangesSummary: advisor?.summary ?? null,
      advisorChangesStatus: advisor?.status ?? null,
      advisorChangeBatchId: advisor?.batchId ?? null,
      correctionRequestedReason: solicitud?.correctionRequestedReason ?? null,
      correctionRequestedNote: solicitud?.correctionRequestedNote ?? null,
      correctionRequestedAt: solicitud?.correctionRequestedAt ?? null,
      correctionRequestedByName: solicitud?.correctionRequestedByName ?? null,
      correctionResubmittedAt:
        solicitud?.correctionResubmittedAt ??
        (historica ? resubmittedAt : null),
    };
  });
}

export { resolveProfileDisplayLabel };
