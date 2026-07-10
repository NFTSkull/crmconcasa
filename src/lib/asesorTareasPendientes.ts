import { canShowAsesorBiometricosSupabaseCard } from "@/domain/agenda-biometricos/biometricos-booking-actions";
import { canShowAsesorFirmasSupabaseCard } from "@/domain/agenda-firmas/firmas-booking-actions";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos";
import {
  deriveRetencionAcuseAvisoFaltantes,
  RETENCION_ETAPA_OPERATIVA_ID,
  tiposRequeridosRetencion,
} from "@/domain/expediente-archivos/retencion-acuse-aviso";
import { findRowPorTipoDocumento } from "@/domain/expediente-archivos/types";
import {
  canShowAsesorRetencionSupabasePanel,
  deriveAsesorRetencionPanelView,
} from "@/domain/expediente-retencion";
import type {
  ExpedienteRetencionEnvioMesa,
  RetencionOpcion,
} from "@/domain/expediente-retencion/types";
import { MockAgendaBiometricosLocalStorageRepo } from "@/domain/agenda-biometricos/mock-localstorage.repo";
import { getActiveBiometricosBookingForExpediente } from "@/lib/agendaBiometricosMock";
import {
  readFirmasBookingsDoc,
  type FirmasBookingRow,
} from "@/lib/agendaFirmasBookingsGuard";

export type AsesorAgendaBookingHints = Readonly<{
  hasActiveBooking: boolean;
  hasLastCancelledBooking: boolean;
}>;

export type AsesorRetencionHints = Readonly<{
  opcion: RetencionOpcion | null;
  envio: ExpedienteRetencionEnvioMesa | null;
}>;

export type AsesorTareaExpedienteInput = Readonly<{
  expedienteId: string;
  submittedToMesa: boolean;
  etapaActual?: number | null;
  fechaCita?: string | null;
  archivos?: readonly ExpedienteArchivoResumen[];
  agendaBiometricos?: AsesorAgendaBookingHints | null;
  agendaFirmas?: AsesorAgendaBookingHints | null;
  retencion?: AsesorRetencionHints | null;
  dataModeSupabase?: boolean;
}>;

function hasFechaCita(value?: string | null): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function resolveBiometricosHints(
  input: AsesorTareaExpedienteInput,
): AsesorAgendaBookingHints {
  if (input.agendaBiometricos) return input.agendaBiometricos;
  const activeBooking = getActiveBiometricosBookingForExpediente(input.expedienteId);
  const repo = new MockAgendaBiometricosLocalStorageRepo();
  const idNorm = String(input.expedienteId).trim();
  const hasLastCancelledBooking = repo
    .readBookings()
    .bookings.some(
      (b) =>
        b.status === "cancelled" && String(b.expedienteId ?? "").trim() === idNorm,
    );
  return {
    hasActiveBooking: activeBooking != null || hasFechaCita(input.fechaCita),
    hasLastCancelledBooking,
  };
}

function resolveFirmasHints(input: AsesorTareaExpedienteInput): AsesorAgendaBookingHints {
  if (input.agendaFirmas) return input.agendaFirmas;
  const idNorm = String(input.expedienteId).trim();
  const bookings = readFirmasBookingsDoc().bookings ?? [];
  const active = findActiveFirmasBooking(idNorm, bookings);
  const hasLastCancelledBooking = bookings.some(
    (b) =>
      b.status === "cancelled" && String(b.expedienteId ?? "").trim() === idNorm,
  );
  return {
    hasActiveBooking: active != null || hasFechaCita(input.fechaCita),
    hasLastCancelledBooking,
  };
}

function findActiveFirmasBooking(
  expedienteId: string,
  bookings: readonly FirmasBookingRow[],
): FirmasBookingRow | null {
  const idNorm = String(expedienteId).trim();
  const found = [...bookings]
    .reverse()
    .find(
      (b) => b.status === "booked" && String(b.expedienteId ?? "").trim() === idNorm,
    );
  return found ?? null;
}

/**
 * Pendiente agendar biométricos: card visible para asesor y sin reserva activa.
 * Supabase: etapa 4 sin booking; etapa 5 solo tras cancelación Mesa (último booking cancelado).
 */
export function isAsesorPendienteAgendarBiometricos(
  input: AsesorTareaExpedienteInput,
): boolean {
  if (!input.submittedToMesa) return false;

  const hints = resolveBiometricosHints(input);
  const cardVisible = canShowAsesorBiometricosSupabaseCard({
    submittedToMesa: true,
    etapaActual: input.etapaActual,
    hasActiveBooking: hints.hasActiveBooking,
    hasLastCancelledBooking: hints.hasLastCancelledBooking,
  });

  if (!cardVisible) {
    if (
      input.dataModeSupabase === false &&
      (input.etapaActual === 3 || input.etapaActual === 4)
    ) {
      return !hints.hasActiveBooking;
    }
    return false;
  }

  return !hints.hasActiveBooking;
}

/**
 * Pendiente agendar firma: card visible para asesor y sin reserva activa.
 * Supabase: etapa 9 sin booking; etapa 10 solo tras cancelación Mesa.
 */
export function isAsesorPendienteAgendarFirma(input: AsesorTareaExpedienteInput): boolean {
  if (!input.submittedToMesa) return false;

  const hints = resolveFirmasHints(input);
  const cardVisible = canShowAsesorFirmasSupabaseCard({
    submittedToMesa: true,
    etapaActual: input.etapaActual,
    hasActiveBooking: hints.hasActiveBooking,
    hasLastCancelledBooking: hints.hasLastCancelledBooking,
  });

  if (!cardVisible) {
    if (input.dataModeSupabase === false && input.etapaActual === 9) {
      return !hints.hasActiveBooking;
    }
    return false;
  }

  return !hints.hasActiveBooking;
}

function retencionTieneDocumentoRechazado(
  archivos: readonly ExpedienteArchivoResumen[],
  opcion: RetencionOpcion | null,
): boolean {
  if (!opcion) return false;
  for (const tipo of tiposRequeridosRetencion(opcion)) {
    const row = findRowPorTipoDocumento(archivos, tipo);
    if (row?.estatus_revision === "rechazado") return true;
  }
  return false;
}

/**
 * Pendiente subir acuse: etapa 8 con panel retención visible y faltan uploads
 * (opción no elegida, documentos faltantes o rechazados por Mesa).
 */
export function isAsesorPendienteSubirAcuse(input: AsesorTareaExpedienteInput): boolean {
  if (
    !canShowAsesorRetencionSupabasePanel({
      dataModeSupabase: input.dataModeSupabase === true,
      etapaActual: input.etapaActual,
      submittedToMesa: input.submittedToMesa,
    })
  ) {
    return false;
  }

  const archivos = input.archivos ?? [];
  const opcion = input.retencion?.opcion ?? null;
  const envio = input.retencion?.envio ?? null;

  const faltantes = deriveRetencionAcuseAvisoFaltantes({
    retencion_opcion: opcion,
    archivos,
  });
  if (faltantes.length > 0) return true;

  const panel = deriveAsesorRetencionPanelView({
    opcionDraft: opcion,
    opcionPersistida:
      opcion != null
        ? {
            expedienteId: input.expedienteId,
            retencion_opcion: opcion,
            updatedAt: "",
          }
        : null,
    envio,
    archivos,
  });

  if (panel.uiEstado === "correccion_requerida") {
    return retencionTieneDocumentoRechazado(archivos, panel.opcionPanel);
  }

  return false;
}

export function buildAsesorTareaExpedienteInput(params: {
  expedienteId: string;
  submittedToMesa: boolean;
  etapaActual?: number | null;
  fechaCita?: string | null;
  archivos?: readonly ExpedienteArchivoResumen[];
  agendaBiometricos?: AsesorAgendaBookingHints | null;
  agendaFirmas?: AsesorAgendaBookingHints | null;
  retencion?: AsesorRetencionHints | null;
  dataModeSupabase: boolean;
}): AsesorTareaExpedienteInput {
  return {
    expedienteId: params.expedienteId,
    submittedToMesa: params.submittedToMesa,
    etapaActual: params.etapaActual,
    fechaCita: params.fechaCita,
    archivos: params.archivos,
    agendaBiometricos: params.agendaBiometricos,
    agendaFirmas: params.agendaFirmas,
    retencion: params.retencion,
    dataModeSupabase: params.dataModeSupabase,
  };
}

export function countAsesorTareasPendientes(
  items: readonly AsesorTareaExpedienteInput[],
): Readonly<{
  agendarBiometricos: number;
  agendarFirma: number;
  subirAcuse: number;
}> {
  let agendarBiometricos = 0;
  let agendarFirma = 0;
  let subirAcuse = 0;
  for (const item of items) {
    if (isAsesorPendienteAgendarBiometricos(item)) agendarBiometricos += 1;
    if (isAsesorPendienteAgendarFirma(item)) agendarFirma += 1;
    if (isAsesorPendienteSubirAcuse(item)) subirAcuse += 1;
  }
  return { agendarBiometricos, agendarFirma, subirAcuse };
}

export const ASESOR_TAREAS_ETAPAS_AGENDA = [3, 4, 5, 9, 10] as const;
export const ASESOR_TAREAS_ETAPA_RETENCION = RETENCION_ETAPA_OPERATIVA_ID;
