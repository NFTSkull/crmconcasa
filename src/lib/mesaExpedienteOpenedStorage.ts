export const MESA_EXPEDIENTE_OPENED_UPDATED_EVENT = "mesa_expediente_opened_updated";

const STORAGE_PREFIX = "mesa_expediente_last_opened_";

function storageKey(expedienteId: string, userId?: string | null): string {
  const exp = String(expedienteId ?? "").trim();
  const user = String(userId ?? "local").trim() || "local";
  return `${STORAGE_PREFIX}${user}_${exp}`;
}

/** Registra apertura del detalle por usuario Mesa (localStorage, sin migración). */
export function recordMesaExpedienteOpened(
  expedienteId: string,
  userId?: string | null,
  at: Date = new Date(),
): void {
  if (typeof window === "undefined") return;
  const id = String(expedienteId ?? "").trim();
  if (!id) return;
  try {
    window.localStorage.setItem(storageKey(id, userId), at.toISOString());
    window.dispatchEvent(new CustomEvent(MESA_EXPEDIENTE_OPENED_UPDATED_EVENT));
  } catch {
    // ignore quota / private mode
  }
}

export function getMesaExpedienteLastOpenedAt(
  expedienteId: string,
  userId?: string | null,
): string | null {
  if (typeof window === "undefined") return null;
  const id = String(expedienteId ?? "").trim();
  if (!id) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(id, userId));
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}
