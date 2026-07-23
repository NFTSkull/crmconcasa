/** Formatea líneas de actividad Mesa (Visto por / Actualizado por). TZ America/Monterrey. */

const TZ = "America/Monterrey";

export type MesaActividadSnapshot = Readonly<{
  lastViewedByName?: string | null;
  lastViewedAt?: string | null;
  lastUpdatedByName?: string | null;
  lastUpdatedAt?: string | null;
}>;

function formatMesaActividadWhen(iso: string | null | undefined): string | null {
  if (!iso || !String(iso).trim()) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("es-MX", {
      timeZone: TZ,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return null;
  }
}

export function formatMesaVistoPorLine(actividad: MesaActividadSnapshot): string {
  const name = actividad.lastViewedByName?.trim();
  const when = formatMesaActividadWhen(actividad.lastViewedAt);
  if (name && when) return `Visto por ${name} · ${when}`;
  if (name) return `Visto por ${name}`;
  return "Sin registro de vista";
}

export function formatMesaActualizadoPorLine(actividad: MesaActividadSnapshot): string {
  const name = actividad.lastUpdatedByName?.trim();
  const when = formatMesaActividadWhen(actividad.lastUpdatedAt);
  if (name && when) return `Actualizado por ${name} · ${when}`;
  if (name) return `Actualizado por ${name}`;
  return "Sin actualización de Mesa registrada";
}
