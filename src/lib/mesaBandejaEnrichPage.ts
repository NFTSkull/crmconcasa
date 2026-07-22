/**
 * Enrich de una página de bandeja Mesa (P100/P102).
 * Solo pide resúmenes/ops/etc. para los IDs de la página recibida.
 */

import {
  deriveResumenExpedienteCorreccion,
  type CategoriaResumenDocumental,
  type ExpedienteArchivoResumen,
} from "@/domain/expediente-archivos";
import type { ExpedienteClienteDatosEstado } from "@/domain/expediente-cliente-datos/types";
import type { ClienteDatosEstadoBatch } from "@/domain/expediente-cliente-datos/types";
import type { MesaExpedienteOpsRow } from "@/domain/mesa-ops/types";
import type { AgendaNotificacionActiveBooking } from "@/domain/agenda-biometricos";
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
  clienteDatosEstado?: ExpedienteClienteDatosEstado | null;
  fechaEntradaMesaActual?: string | null;
  ultimaCorreccionEnviadaAt?: string | null;
  entradaLecturaEsCorreccion?: boolean;
  correccionLecturaEstado?: MesaCorreccionLecturaEstado;
  mesaOps?: MesaExpedienteOpsRow | null;
  notificacionBooking?: AgendaNotificacionActiveBooking | null;
  notificacionAgendadoPorLabel?: string;
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
  resolveAsesorDisplayBatch?: (
    creatorIds: string[],
  ) => Promise<Map<string, string>>;
  mesaUserId: string | null;
};

export async function enrichMesaBandejaPageItems<T extends MesaBandejaCasoBase>(
  base: readonly T[],
  deps: EnrichMesaBandejaPageDeps,
): Promise<Array<T & MesaBandejaCasoEnriched>> {
  if (base.length === 0) return [];

  const allExpedienteIds = base.map((c) => c.id);
  const etapa3ExpedienteIds = base
    .filter((c) => c.etapaActual === 3)
    .map((c) => c.id);

  const secondary = await fetchMesaBandejaSecondaryParallel(
    { allExpedienteIds, etapa3ExpedienteIds },
    {
      listResumenBatchByExpedienteIds: deps.listResumenBatchByExpedienteIds,
      listEstadoBatchByExpedienteIds: deps.listEstadoBatchByExpedienteIds,
      listActiveNotificacionByExpedienteIds:
        deps.listActiveNotificacionByExpedienteIds,
      listMesaOpsByExpedienteIds: deps.listMesaOpsByExpedienteIds,
    },
  );

  const { resumenPorId, estadosPorId, notificacionPorId, opsRows } = secondary;

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

  return base.map((c) => {
    const resumen = resumenPorId[c.id] ?? [];
    const clienteBatch = estadosPorId[c.id] ?? null;
    const resumenDocumental = deriveResumenExpedienteCorreccion(resumen, {
      clienteDatosEstado: clienteBatch?.estado ?? null,
      clienteDatosUpdatedAt: clienteBatch?.updatedAt ?? null,
      clienteDatosValidatedAt: clienteBatch?.validatedAt ?? null,
      fechaEnvioMesa: c.fechaEnvioMesa ?? null,
    });
    const ultimaCorreccionEnviadaAt = deriveUltimaCorreccionEnviadaAt({
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
    return {
      ...c,
      resumenDocumental,
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
    };
  });
}

export { resolveProfileDisplayLabel };
