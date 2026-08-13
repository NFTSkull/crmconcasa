/**
 * Contrato repo P175 — book/cancel/reagendar/availability.
 * Implementación Supabase en bloque UI; B1 solo tipa el contrato.
 */

import type {
  AgendaInscripcionActiveBooking,
  AgendaInscripcionAsesorEligibility,
  AgendaInscripcionRequirement,
} from "./types";
import { INSCRIPCION_FIXED_TIME } from "./constants";

export type BookInscripcionParams = Readonly<{
  expedienteId: string;
  bookingDate: string;
  locationId: string;
  note?: string | null;
}>;

export type CancelInscripcionParams = Readonly<{
  expedienteId: string;
  motivo?: string | null;
  /** true = cerrar requisito (cancelled); false/omit = rebook_required */
  terminal?: boolean;
}>;

export type ReagendarInscripcionParams = Readonly<{
  expedienteId: string;
  bookingDate: string;
  locationId: string;
  note?: string | null;
}>;

export type InscripcionAvailabilitySlot = Readonly<{
  bookingDate: string;
  locationId: string;
  /** Siempre 11:00 lógico = físico. */
  bookingTime: typeof INSCRIPCION_FIXED_TIME;
  capacity: number;
  occupied: number;
  available: number;
}>;

export type InscripcionMutationResult = Readonly<{
  ok: boolean;
  bookingId?: string;
  requirementId?: string;
  requirementCreated?: boolean;
  errorCode?: string;
  message?: string;
}>;

export interface AgendaInscripcionRepo {
  getOpenRequirement(
    expedienteId: string,
  ): Promise<AgendaInscripcionRequirement | null>;
  getActiveBooking(
    expedienteId: string,
  ): Promise<AgendaInscripcionActiveBooking | null>;
  /** P178: elegibilidad self-service (read-only). Fail-soft → ineligible. */
  getAsesorEligibility?(
    expedienteId: string,
  ): Promise<AgendaInscripcionAsesorEligibility>;
  listAvailability(params: {
    fromDate: string;
    toDate: string;
    locationId?: string;
  }): Promise<readonly InscripcionAvailabilitySlot[]>;
  book(params: BookInscripcionParams): Promise<InscripcionMutationResult>;
  cancel(params: CancelInscripcionParams): Promise<InscripcionMutationResult>;
  reagendar(
    params: ReagendarInscripcionParams,
  ): Promise<InscripcionMutationResult>;
  cancelByBookingId?(params: {
    bookingId: string;
    motivo?: string | null;
    terminal?: boolean;
  }): Promise<InscripcionMutationResult>;
  mesaSolicitar?(params: {
    expedienteId: string;
    motivo: string;
  }): Promise<
    InscripcionMutationResult & {
      requirementId?: string;
      idempotent?: boolean;
    }
  >;
  listOpenRequirementsForAsesor?(): Promise<
    readonly AgendaInscripcionRequirement[]
  >;
  listBookedForPeriod?(params: {
    fromDate: string;
    toDateInclusive: string;
  }): Promise<
    ReadonlyArray<{
      bookingId: string;
      expedienteId: string;
      bookingDate: string;
      bookingTime: string;
      locationId: string;
      clienteNombre: string;
      asesorNombre: string;
    }>
  >;
}
