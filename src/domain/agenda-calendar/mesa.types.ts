export type MesaAgendaBookingKind = "biometricos" | "firmas" | "notificacion";

export type MesaAgendaBookingStatus = "booked" | "cancelled";

/** `null` = todos los tipos (sin filtro RPC). */
export type MesaAgendaBookingKindFilter = MesaAgendaBookingKind | null;

export type MesaAgendaBookingPerson = Readonly<{
  id: string;
  fullName: string | null;
  email: string | null;
}>;

export type MesaAgendaBookingEntry = Readonly<{
  bookingId: string;
  expedienteId: string;
  bookingDate: string;
  bookingTime: string;
  kind: MesaAgendaBookingKind;
  status: MesaAgendaBookingStatus;
  locationId: string | null;
  note: string | null;
  createdAt: string;
  cancelledAt: string | null;
  clienteNombre: string;
  nss: string | null;
  etapaActual: number;
  subestado: string | null;
  submittedToMesa: boolean;
  asesor: MesaAgendaBookingPerson;
  createdBy: MesaAgendaBookingPerson;
  driveValidated: boolean;
  driveValidatedAt: string | null;
  driveValidatedBy: MesaAgendaBookingPerson | null;
  /** Clasificación Excel (P109). null → fallback por kind. */
  reportGroup: string | null;
}>;

export type FetchMesaAgendaBookingsParams = Readonly<{
  startDate: string;
  endDate: string;
  includeCancelled: boolean;
  kind?: MesaAgendaBookingKindFilter;
}>;
