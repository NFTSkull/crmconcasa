import test from "node:test";
import assert from "node:assert/strict";
import type { HhmmTime, YmdDate } from "@/domain/agenda-biometricos";
import { buildLocalIsoFromDateAndTime } from "@/lib/agendaBiometricosMock";
import {
  canMountAgendaBiometricosUI,
  canShowAgendaBiometricosForEtapa,
  hasActiveFirmasBookingForCitaInList,
} from "@/lib/agendaFirmasBookingsGuard";

function installWindowStore(initial: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial));
  (globalThis as unknown as { window: object }).window = {
    localStorage: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    },
  };
}

test("hasActiveFirmasBookingForCitaInList: coincide expediente, fecha, hora y status booked", () => {
  const iso = buildLocalIsoFromDateAndTime(
    "2026-08-15" as YmdDate,
    "09:30" as HhmmTime,
  );
  assert.ok(iso);
  const ok = hasActiveFirmasBookingForCitaInList("exp-1", iso, [
    {
      expedienteId: "exp-1",
      status: "booked",
      date: "2026-08-15",
      time: "09:30",
    },
  ]);
  assert.equal(ok, true);
});

test("hasActiveFirmasBookingForCitaInList: false si la hora no coincide", () => {
  const iso = buildLocalIsoFromDateAndTime(
    "2026-08-15" as YmdDate,
    "09:30" as HhmmTime,
  );
  assert.ok(iso);
  const ok = hasActiveFirmasBookingForCitaInList("exp-1", iso, [
    {
      expedienteId: "exp-1",
      status: "booked",
      date: "2026-08-15",
      time: "10:30",
    },
  ]);
  assert.equal(ok, false);
});

test("hasActiveFirmasBookingForCitaInList: false si status no es booked", () => {
  const iso = buildLocalIsoFromDateAndTime(
    "2026-08-15" as YmdDate,
    "09:30" as HhmmTime,
  );
  assert.ok(iso);
  const ok = hasActiveFirmasBookingForCitaInList("exp-1", iso, [
    {
      expedienteId: "exp-1",
      status: "cancelled",
      date: "2026-08-15",
      time: "09:30",
    },
  ]);
  assert.equal(ok, false);
});

test("canMountAgendaBiometricosUI: solo asesor (mesa no agenda biométricos)", () => {
  installWindowStore({ mock_role: "mesa_control_interno" });
  assert.equal(canMountAgendaBiometricosUI(), false);
  installWindowStore({ mock_role: "mesa_control_externo" });
  assert.equal(canMountAgendaBiometricosUI(), false);
  installWindowStore({ mock_role: "mesa_control_admin" });
  assert.equal(canMountAgendaBiometricosUI(), false);
  installWindowStore({ mock_role: "mesa_control" });
  assert.equal(canMountAgendaBiometricosUI(), false);
  installWindowStore({ mock_role: "asesor" });
  assert.equal(canMountAgendaBiometricosUI(), true);
});

test("canShowAgendaBiometricosForEtapa: etapa 3 o 4 (legacy)", () => {
  assert.equal(canShowAgendaBiometricosForEtapa(3), true);
  assert.equal(canShowAgendaBiometricosForEtapa(4), true);
  assert.equal(canShowAgendaBiometricosForEtapa(1), false);
  assert.equal(canShowAgendaBiometricosForEtapa(2), false);
  assert.equal(canShowAgendaBiometricosForEtapa(5), false);
  assert.equal(canShowAgendaBiometricosForEtapa(null), false);
});
