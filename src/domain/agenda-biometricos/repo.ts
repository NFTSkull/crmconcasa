import type { AgendaBiometricosWeeklyConfig } from "./map-agenda-config";

export type AgendaBiometricosConfigRecord = Readonly<{
  id: string;
  organizationId: string;
  kind: "biometricos";
  config: AgendaBiometricosWeeklyConfig;
  updatedAt: string;
  updatedBy: string | null;
}>;

export type UpsertAgendaBiometricosConfigResult = Readonly<{
  ok: true;
  agendaConfigId: string;
  organizationId: string;
  kind: "biometricos";
  config: AgendaBiometricosWeeklyConfig;
  created: boolean;
  updatedAt: string;
  updatedBy: string | null;
  warnings: readonly string[];
}>;

export interface AgendaBiometricosConfigRepo {
  getBiometricosConfig(): Promise<AgendaBiometricosConfigRecord | null>;
  upsertBiometricosConfig(
    config: AgendaBiometricosWeeklyConfig,
  ): Promise<UpsertAgendaBiometricosConfigResult>;
}

export type AgendaBiometricosBookedSlot = Readonly<{
  bookingDate: string;
  bookingTime: string;
  locationId: string;
}>;

export type AgendaBiometricosActiveBooking = Readonly<{
  id: string;
  expedienteId: string;
  bookingDate: string;
  bookingTime: string;
  locationId: string;
  status: "booked";
  note: string | null;
}>;

export type BookBiometricosResult = Readonly<{
  ok: true;
  bookingId: string;
  expedienteId: string;
  scheduledAt: string;
  bookingDate: string;
  bookingTime: string;
  locationId: string;
  etapaActual: number;
}>;

export interface AgendaBiometricosBookingRepo {
  getBiometricosConfig(): Promise<AgendaBiometricosConfigRecord | null>;
  listBookedSlots(params: {
    fromDate: string;
    toDate: string;
    locationId?: string;
  }): Promise<readonly AgendaBiometricosBookedSlot[]>;
  getActiveBooking(expedienteId: string): Promise<AgendaBiometricosActiveBooking | null>;
  bookBiometricos(params: {
    expedienteId: string;
    scheduledAt: string;
    locationId: string;
    note?: string | null;
  }): Promise<BookBiometricosResult>;
}
