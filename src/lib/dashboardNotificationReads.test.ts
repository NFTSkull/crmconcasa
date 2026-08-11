import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countUnreadDashboardNotifications,
  isDashboardNotificationUnread,
  markDashboardNotificationsRead,
  parseDashboardNotificationReadsDoc,
  readDashboardNotificationReads,
} from "./dashboardNotificationReads";
import type { DashboardNotificationItem } from "./dashboardNotifications";

function item(
  partial: Partial<DashboardNotificationItem> & Pick<DashboardNotificationItem, "id">,
): DashboardNotificationItem {
  return {
    expedienteId: "exp-1",
    clienteNombre: "Cliente",
    kind: "correccion_requerida",
    tipoLabel: "Necesita corrección",
    mensaje: "Datos generales requieren corrección",
    fecha: "2026-08-11T12:00:00.000Z",
    prioridad: 1,
    href: "/asesor/expediente/exp-1",
    ...partial,
  };
}

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
    key() {
      return null;
    },
  } as Storage;
}

describe("dashboardNotificationReads", () => {
  it("1. 1 no leída → contador 1", () => {
    const reads = parseDashboardNotificationReadsDoc(null);
    const items = [item({ id: "exp-1:correccion_requerida" })];
    assert.equal(countUnreadDashboardNotifications(items, reads), 1);
  });

  it("2+3. marcar leídas → contador 0 y persiste readAt", () => {
    const storage = memoryStorage();
    const items = [item({ id: "exp-1:correccion_requerida" })];
    const next = markDashboardNotificationsRead({
      userKey: "asesor-1",
      items,
      readAt: "2026-08-11T15:00:00.000Z",
      storage,
    });
    assert.equal(countUnreadDashboardNotifications(items, next), 0);
    const stored = readDashboardNotificationReads("asesor-1", storage);
    assert.equal(
      stored.byId["exp-1:correccion_requerida"]?.readAt,
      "2026-08-11T15:00:00.000Z",
    );
    assert.equal(
      stored.byId["exp-1:correccion_requerida"]?.fechaSnapshot,
      "2026-08-11T12:00:00.000Z",
    );
  });

  it("4. abrir varias veces → idempotente", () => {
    const storage = memoryStorage();
    const items = [item({ id: "exp-1:correccion_requerida" })];
    const a = markDashboardNotificationsRead({
      userKey: "asesor-1",
      items,
      readAt: "2026-08-11T15:00:00.000Z",
      storage,
    });
    const b = markDashboardNotificationsRead({
      userKey: "asesor-1",
      items,
      readAt: "2026-08-11T16:00:00.000Z",
      storage,
    });
    assert.equal(countUnreadDashboardNotifications(items, a), 0);
    assert.equal(countUnreadDashboardNotifications(items, b), 0);
    assert.equal(
      readDashboardNotificationReads("asesor-1", storage).byId[
        "exp-1:correccion_requerida"
      ]?.readAt,
      "2026-08-11T15:00:00.000Z",
    );
  });

  it("5. click Ver expediente (un ítem) también deja leída", () => {
    const storage = memoryStorage();
    const items = [
      item({ id: "exp-1:correccion_requerida" }),
      item({ id: "exp-2:enviado_mesa", kind: "enviado_mesa", tipoLabel: "En validación Mesa" }),
    ];
    const next = markDashboardNotificationsRead({
      userKey: "asesor-1",
      items: [items[0]!],
      storage,
    });
    assert.equal(isDashboardNotificationUnread(items[0]!, next), false);
    assert.equal(isDashboardNotificationUnread(items[1]!, next), true);
    assert.equal(countUnreadDashboardNotifications(items, next), 1);
  });

  it("6. error de persistencia no aplica estado falso", () => {
    const failing: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    assert.throws(() =>
      markDashboardNotificationsRead({
        userKey: "asesor-1",
        items: [item({ id: "exp-1:correccion_requerida" })],
        storage: failing,
      }),
    );
  });

  it("7. corrección P167 abierta sigue siendo la misma notificación (solo leída visual)", () => {
    const storage = memoryStorage();
    const correction = item({ id: "exp-1:correccion_requerida" });
    const reads = markDashboardNotificationsRead({
      userKey: "asesor-1",
      items: [correction],
      storage,
    });
    // Badge visual
    assert.equal(countUnreadDashboardNotifications([correction], reads), 0);
    // La tarea P167 no depende de este store (id/kind intactos)
    assert.equal(correction.kind, "correccion_requerida");
    assert.match(correction.tipoLabel, /Necesita corrección|Corrección/i);
  });

  it("8. notificación nueva posterior vuelve a mostrar contador 1", () => {
    const storage = memoryStorage();
    markDashboardNotificationsRead({
      userKey: "asesor-1",
      items: [item({ id: "exp-1:correccion_requerida" })],
      storage,
    });
    const reads = readDashboardNotificationReads("asesor-1", storage);
    const items = [
      item({ id: "exp-1:correccion_requerida" }),
      item({
        id: "exp-9:cita_hoy",
        kind: "cita_hoy",
        tipoLabel: "Cita hoy",
        fecha: "2026-08-12T10:00:00.000Z",
      }),
    ];
    assert.equal(countUnreadDashboardNotifications(items, reads), 1);
  });

  it("misma id con fecha nueva (actividad) vuelve a no leída", () => {
    const storage = memoryStorage();
    markDashboardNotificationsRead({
      userKey: "asesor-1",
      items: [item({ id: "exp-1:correccion_requerida", fecha: "2026-08-11T12:00:00.000Z" })],
      storage,
    });
    const reads = readDashboardNotificationReads("asesor-1", storage);
    assert.equal(
      isDashboardNotificationUnread(
        item({ id: "exp-1:correccion_requerida", fecha: "2026-08-11T18:00:00.000Z" }),
        reads,
      ),
      true,
    );
  });
});
