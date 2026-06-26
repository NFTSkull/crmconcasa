const CANCELADO_PREFIX = /^Cancelado:\s*/i;

/** Extrae motivo legible desde `agenda_bookings.note` tras cancelación RPC. */
export function parseCancelMotivoFromNote(note: string | null | undefined): string | null {
  const raw = String(note ?? "").trim();
  if (!raw) return null;

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (CANCELADO_PREFIX.test(line)) {
      const motivo = line.replace(CANCELADO_PREFIX, "").trim();
      return motivo || null;
    }
  }
  return null;
}

export function validateMesaCancelMotivo(motivo: string): string | null {
  if (!motivo.trim()) {
    return "El motivo para el asesor es obligatorio.";
  }
  return null;
}

export function formatAsesorCitaCanceladaPorMesaMessage(motivo: string | null): string {
  if (motivo) {
    return `Cita cancelada por Mesa. Motivo: ${motivo}. Puedes reagendar una nueva cita.`;
  }
  return "Cita cancelada por Mesa. Puedes reagendar una nueva cita.";
}
