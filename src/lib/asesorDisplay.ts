const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Modo mock: no hay backend de perfiles de asesores.
 * Devolvemos mapa vacío y la UI cae al fallback por `asesorId`.
 */
export async function getAsesorDisplayMap(): Promise<{
  map: Map<string, string>;
  error: Error | null;
}> {
  return { map: new Map<string, string>(), error: null };
}

/**
 * Deriva un nombre visible desde email: parte antes de @, puntos por espacios, capitalizar palabras.
 */
export function asesorDisplayName(email: string): string {
  const trimmed = (email ?? "").trim();
  if (!trimmed) return "";
  const beforeAt = trimmed.includes("@") ? trimmed.split("@")[0]! : trimmed;
  const words = beforeAt.replace(/\./g, " ").split(/\s+/).filter(Boolean);
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Devuelve el texto a mostrar para un asesorId: nombre derivado del email si existe, sino asesorId (fallback).
 */
export function getAsesorDisplayLabel(asesorId: string, asesorMap: Map<string, string>): string {
  const email = asesorMap.get(asesorId);
  if (email) return asesorDisplayName(email);
  if (asesorId.includes("@")) return asesorDisplayName(asesorId);
  return asesorId;
}

export type AsesorExpedienteDisplayFields = Readonly<{
  fullName?: string | null;
  email?: string | null;
  fallbackId?: string | null;
}>;

/** Etiqueta visible del asesor: nombre → email → fallback no-UUID → — → UUID (último recurso). */
export function formatAsesorExpedienteLabel(fields: AsesorExpedienteDisplayFields): string {
  const name = String(fields.fullName ?? "").trim();
  if (name) return name;

  const email = String(fields.email ?? "").trim();
  if (email) return email;

  const fallback = String(fields.fallbackId ?? "").trim();
  if (fallback && !UUID_RE.test(fallback)) return fallback;
  if (fallback && UUID_RE.test(fallback)) return "—";

  return "—";
}

/** Monto aprobado vigente (`editor_decisions.monto_aprobado`), sin condicionar por decisión. */
export function formatMontoAprobadoVigente(monto: number | null | undefined): string {
  if (typeof monto === "number" && !Number.isNaN(monto) && monto > 0) {
    return `$${monto.toLocaleString("es-MX", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return "—";
}
