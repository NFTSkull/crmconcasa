import type { AgendaBiometricosWeeklyConfig } from "@/domain/agenda-biometricos/map-agenda-config";
import type {
  MesaBookFirmasInput,
  MesaBookFirmasResponse,
  MesaCancelFirmasInput,
  MesaCancelFirmasResponse,
  MesaReagendarFirmasInput,
  MesaReagendarFirmasResponse,
} from "./mesa-firmas";

export type AgendaFirmasWeeklyConfig = AgendaBiometricosWeeklyConfig;

export type AgendaFirmasConfigRecord = Readonly<{
  id: string;
  organizationId: string;
  kind: "firmas";
  config: AgendaFirmasWeeklyConfig;
  updatedAt: string;
  updatedBy: string | null;
}>;

export type UpsertAgendaFirmasConfigResult = Readonly<{
  ok: true;
  agendaConfigId: string;
  organizationId: string;
  kind: "firmas";
  config: AgendaFirmasWeeklyConfig;
  created: boolean;
  updatedAt: string;
  updatedBy: string | null;
  warnings: readonly string[];
}>;

export interface AgendaFirmasConfigRepo {
  getFirmasConfig(): Promise<AgendaFirmasConfigRecord | null>;
  upsertFirmasConfig(config: AgendaFirmasWeeklyConfig): Promise<UpsertAgendaFirmasConfigResult>;
}

export type AgendaFirmasBookedSlot = Readonly<{
  bookingDate: string;
  bookingTime: string;
  locationId: string;
}>;

export type AgendaFirmasActiveBooking = Readonly<{
  id: string;
  expedienteId: string;
  bookingDate: string;
  bookingTime: string;
  locationId: string;
  status: "booked";
  note: string | null;
}>;

export type AgendaFirmasCancelledBooking = Readonly<{
  id: string;
  expedienteId: string;
  bookingDate: string;
  bookingTime: string;
  locationId: string;
  status: "cancelled";
  note: string | null;
  cancelledAt: string | null;
}>;

export type BookFirmasResult = Readonly<{
  ok: true;
  bookingId: string;
  expedienteId: string;
  scheduledAt: string;
  bookingDate: string;
  bookingTime: string;
  locationId: string;
  etapaActual: number;
}>;

export type CancelFirmasResult = Readonly<{
  ok: true;
  expedienteId: string;
  bookingId: string;
  status: "cancelled";
  etapaActual: number;
}>;

export type ReagendarFirmasResult = Readonly<{
  ok: true;
  expedienteId: string;
  bookingAnteriorId: string;
  bookingNuevoId: string;
  scheduledAt: string;
  status: "booked";
  kind: "firmas";
  etapaActual: number;
}>;

export interface AgendaFirmasBookingRepo {
  getFirmasConfig(): Promise<AgendaFirmasConfigRecord | null>;
  listBookedSlots(params: {
    fromDate: string;
    toDate: string;
    locationId?: string;
  }): Promise<readonly AgendaFirmasBookedSlot[]>;
  getActiveBooking(expedienteId: string): Promise<AgendaFirmasActiveBooking | null>;
  getLastCancelledBooking(
    expedienteId: string,
  ): Promise<AgendaFirmasCancelledBooking | null>;
  bookFirmas(params: {
    expedienteId: string;
    scheduledAt: string;
    locationId: string;
    note?: string | null;
  }): Promise<BookFirmasResult>;
  cancelFirmas(params: {
    expedienteId: string;
    motivo?: string | null;
  }): Promise<CancelFirmasResult>;
  reagendarFirmas(params: {
    expedienteId: string;
    scheduledAt: string;
    locationId: string;
    note?: string | null;
  }): Promise<ReagendarFirmasResult>;
  mesaBookFirmas(params: MesaBookFirmasInput): Promise<MesaBookFirmasResponse>;
  mesaReagendarFirmas(
    params: MesaReagendarFirmasInput,
  ): Promise<MesaReagendarFirmasResponse>;
  mesaCancelFirmas(
    params: MesaCancelFirmasInput,
  ): Promise<MesaCancelFirmasResponse>;
}
