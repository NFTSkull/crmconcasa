/**
 * Estado visual «leído» de notificaciones del dashboard (asesor/mesa).
 * Las notificaciones se derivan del summary (P161); no hay tabla SQL de reads.
 * Persistencia local por usuario — no cierra tareas P167.
 */

import type { DashboardNotificationItem } from "@/lib/dashboardNotifications";

export const DASHBOARD_NOTIFICATION_READS_STORAGE_PREFIX =
  "concasa_dashboard_notif_reads_v1_";

export const DASHBOARD_NOTIFICATION_READS_UPDATED_EVENT =
  "dashboard_notification_reads_updated";

export type DashboardNotificationReadEntry = Readonly<{
  readAt: string;
  /** Fecha de la notificación al momento de leer (detecta actividad nueva). */
  fechaSnapshot: string | null;
}>;

export type DashboardNotificationReadsDoc = Readonly<{
  version: 1;
  byId: Readonly<Record<string, DashboardNotificationReadEntry>>;
}>;

function storageKey(userKey: string): string {
  const user = String(userKey ?? "").trim() || "local";
  return `${DASHBOARD_NOTIFICATION_READS_STORAGE_PREFIX}${user}`;
}

function emptyDoc(): DashboardNotificationReadsDoc {
  return { version: 1, byId: {} };
}

export function parseDashboardNotificationReadsDoc(
  raw: string | null | undefined,
): DashboardNotificationReadsDoc {
  if (!raw?.trim()) return emptyDoc();
  try {
    const parsed = JSON.parse(raw) as Partial<DashboardNotificationReadsDoc>;
    if (parsed?.version !== 1 || typeof parsed.byId !== "object" || !parsed.byId) {
      return emptyDoc();
    }
    const byId: Record<string, DashboardNotificationReadEntry> = {};
    for (const [id, entry] of Object.entries(parsed.byId)) {
      const key = String(id ?? "").trim();
      if (!key || !entry || typeof entry !== "object") continue;
      const readAt = String((entry as DashboardNotificationReadEntry).readAt ?? "").trim();
      if (!readAt) continue;
      const fechaRaw = (entry as DashboardNotificationReadEntry).fechaSnapshot;
      byId[key] = {
        readAt,
        fechaSnapshot:
          typeof fechaRaw === "string" && fechaRaw.trim() ? fechaRaw.trim() : null,
      };
    }
    return { version: 1, byId };
  } catch {
    return emptyDoc();
  }
}

export function readDashboardNotificationReads(
  userKey: string,
  storage: Pick<Storage, "getItem"> | null = typeof window !== "undefined"
    ? window.localStorage
    : null,
): DashboardNotificationReadsDoc {
  if (!storage) return emptyDoc();
  try {
    return parseDashboardNotificationReadsDoc(storage.getItem(storageKey(userKey)));
  } catch {
    return emptyDoc();
  }
}

export function writeDashboardNotificationReads(
  userKey: string,
  doc: DashboardNotificationReadsDoc,
  storage: Pick<Storage, "setItem"> | null = typeof window !== "undefined"
    ? window.localStorage
    : null,
): void {
  if (!storage) {
    throw new Error("No hay almacenamiento disponible para marcar notificaciones.");
  }
  storage.setItem(storageKey(userKey), JSON.stringify(doc));
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(DASHBOARD_NOTIFICATION_READS_UPDATED_EVENT, {
        detail: { userKey },
      }),
    );
  }
}

export function isDashboardNotificationUnread(
  item: Pick<DashboardNotificationItem, "id" | "fecha">,
  reads: DashboardNotificationReadsDoc,
): boolean {
  const id = String(item.id ?? "").trim();
  if (!id) return false;
  const entry = reads.byId[id];
  if (!entry) return true;
  const fecha = item.fecha?.trim() || null;
  if (fecha && entry.fechaSnapshot && fecha !== entry.fechaSnapshot) {
    return true;
  }
  return false;
}

export function countUnreadDashboardNotifications(
  items: readonly Pick<DashboardNotificationItem, "id" | "fecha">[],
  reads: DashboardNotificationReadsDoc,
): number {
  let n = 0;
  for (const item of items) {
    if (isDashboardNotificationUnread(item, reads)) n += 1;
  }
  return n;
}

export function listUnreadDashboardNotificationIds(
  items: readonly Pick<DashboardNotificationItem, "id" | "fecha">[],
  reads: DashboardNotificationReadsDoc,
): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (isDashboardNotificationUnread(item, reads)) {
      const id = String(item.id ?? "").trim();
      if (id) out.push(id);
    }
  }
  return out;
}

/**
 * Marca como leídas las notificaciones indicadas (idempotente).
 * Devuelve el doc resultante. Lanza si no puede persistir.
 */
export function markDashboardNotificationsRead(params: {
  userKey: string;
  items: readonly Pick<DashboardNotificationItem, "id" | "fecha">[];
  readAt?: string;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}): DashboardNotificationReadsDoc {
  const storage =
    params.storage === undefined
      ? typeof window !== "undefined"
        ? window.localStorage
        : null
      : params.storage;
  const prev = readDashboardNotificationReads(params.userKey, storage);
  const readAt = params.readAt ?? new Date().toISOString();
  const byId: Record<string, DashboardNotificationReadEntry> = { ...prev.byId };
  let changed = false;
  for (const item of params.items) {
    const id = String(item.id ?? "").trim();
    if (!id) continue;
    const fechaSnapshot = item.fecha?.trim() || null;
    const existing = byId[id];
    if (
      existing &&
      existing.fechaSnapshot === fechaSnapshot &&
      !isDashboardNotificationUnread(item, { version: 1, byId })
    ) {
      continue;
    }
    byId[id] = { readAt, fechaSnapshot };
    changed = true;
  }
  const next: DashboardNotificationReadsDoc = { version: 1, byId };
  if (changed || Object.keys(prev.byId).length !== Object.keys(byId).length) {
    writeDashboardNotificationReads(params.userKey, next, storage);
  }
  return next;
}
