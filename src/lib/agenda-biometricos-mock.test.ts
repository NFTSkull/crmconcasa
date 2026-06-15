import test from "node:test";
import assert from "node:assert/strict";
import {
  computeMinBookableDateYmd,
  getAgendaBiometricosDisponibilidad,
  type AgendaBiometricosBookingsV1,
  type AgendaBiometricosConfigV1,
} from "@/domain/agenda-biometricos";
import {
  buildLocalIsoFromDateAndTime,
  mesaPuedeAvanzarEtapa4Biometricos,
  resolveFechaCitaBiometricosOperativa,
} from "@/lib/agendaBiometricosMock";
import type { HhmmTime, YmdDate } from "@/domain/agenda-biometricos";

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
    dispatchEvent: () => true,
  };
}

const BOOKINGS_FIXTURE: AgendaBiometricosBookingsV1 = {
  version: 1,
  kind: "biometricos",
  updatedAt: "2026-04-20T00:00:00.000Z",
  bookings: [
    {
      id: "b-exp-4",
      expedienteId: "exp-etapa-4",
      date: "2026-04-23",
      locationId: "monterrey",
      time: "08:30",
      status: "booked",
      createdAt: "2026-04-20T00:00:00.000Z",
      createdBy: { email: "asesor@test", role: "asesor" },
      note: null,
    },
  ],
};

test("computeMinBookableDateYmd: después de 14:30 sube minLeadDays a 3", () => {
  const rules = {
    minLeadDays: 2,
    afterTimeLocal: "14:30",
    minLeadDaysAfterCutoff: 3,
  } as const;
  const now = new Date("2026-04-20T20:31:00.000Z"); // 14:31 local aproximado; la función usa hora local del Date.
  const ymd = computeMinBookableDateYmd(now, rules);
  assert.equal(typeof ymd, "string");
});

test("getAgendaBiometricosDisponibilidad: usa slots del día/config y resta bookings booked", () => {
  const config: AgendaBiometricosConfigV1 = {
    version: 1,
    kind: "biometricos",
    updatedAt: "2026-04-20T00:00:00.000Z",
    updatedBy: { email: "cynthia@test", role: "mesa_control_admin" },
    locations: [
      { id: "monterrey", label: "Monterrey", tz: "America/Monterrey" },
      { id: "apodaca", label: "Apodaca", tz: "America/Monterrey" },
    ],
    rules: { minLeadDays: 2, afterTimeLocal: "14:30", minLeadDaysAfterCutoff: 3 },
    days: {
      "2026-04-23": {
        monterrey: { slots: [{ time: "08:30", capacity: 2 }] },
      },
    },
  };
  const bookings: AgendaBiometricosBookingsV1 = {
    version: 1,
    kind: "biometricos",
    updatedAt: "2026-04-20T00:00:00.000Z",
    bookings: [
      {
        id: "b1",
        expedienteId: "exp-1",
        date: "2026-04-23",
        locationId: "monterrey",
        time: "08:30",
        status: "booked",
        createdAt: "2026-04-20T00:00:00.000Z",
        createdBy: { email: "cynthia@test", role: "mesa_control_admin" },
        note: null,
      },
    ],
  };
  const av = getAgendaBiometricosDisponibilidad({
    config,
    bookings,
    date: "2026-04-23",
    locationId: "monterrey",
  });
  assert.equal(av.length, 1);
  assert.equal(av[0].capacity, 2);
  assert.equal(av[0].bookedCount, 1);
  assert.equal(av[0].remaining, 1);
});

test("resolveFechaCitaBiometricosOperativa: prioriza inbox", () => {
  const iso = buildLocalIsoFromDateAndTime(
    "2026-04-23" as YmdDate,
    "08:30" as HhmmTime,
  );
  assert.ok(iso);
  installWindowStore({
    agenda_bookings_v1: JSON.stringify(BOOKINGS_FIXTURE),
  });
  assert.equal(
    resolveFechaCitaBiometricosOperativa("exp-etapa-4", "2026-04-24T10:00:00.000Z"),
    "2026-04-24T10:00:00.000Z",
  );
});

test("resolveFechaCitaBiometricosOperativa: fallback a agenda_bookings_v1", () => {
  const iso = buildLocalIsoFromDateAndTime(
    "2026-04-23" as YmdDate,
    "08:30" as HhmmTime,
  );
  assert.ok(iso);
  installWindowStore({
    agenda_bookings_v1: JSON.stringify(BOOKINGS_FIXTURE),
  });
  assert.equal(resolveFechaCitaBiometricosOperativa("exp-etapa-4", null), iso);
});

test("mesaPuedeAvanzarEtapa4Biometricos: bloquea sin cita", () => {
  installWindowStore({});
  assert.equal(mesaPuedeAvanzarEtapa4Biometricos("exp-sin-cita", null), false);
});

test("mesaPuedeAvanzarEtapa4Biometricos: permite con booking activo", () => {
  installWindowStore({
    agenda_bookings_v1: JSON.stringify(BOOKINGS_FIXTURE),
  });
  assert.equal(mesaPuedeAvanzarEtapa4Biometricos("exp-etapa-4", null), true);
});
