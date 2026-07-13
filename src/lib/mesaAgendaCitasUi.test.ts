import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AgendaBiometricosSupabaseError } from "@/domain/agenda-biometricos";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import {
  applyMesaAgendaClientFiltersAndSort,
  buildMesaAgendaActiveFilterChips,
  buildMesaAgendaAdvisorOptions,
  buildMesaAgendaLocationOptions,
  buildMesaAgendaWeekRange,
  buildMesaExpedienteDetailHref,
  canAccessMesaAgendaCitasPage,
  canMesaCancelAgendaListEntry,
  canMesaReagendarAgendaListEntry,
  clearMesaAgendaClientFilters,
  defaultMesaAgendaClientFilters,
  defaultMesaAgendaMonthRange,
  deriveMesaAgendaHistoryLabel,
  deriveMesaAgendaSummary,
  filterMesaAgendaEntries,
  filterMesaAgendaEntriesForDay,
  formatMesaAgendaDateTime,
  formatMesaAgendaKind,
  formatMesaAgendaStatus,
  groupMesaAgendaEntriesByTime,
  groupMesaAgendaHistory,
  mapMesaAgendaCancelErrorMessage,
  mapMesaAgendaFetchErrorMessage,
  matchesMesaAgendaSearch,
  mesaAgendaCancelDialogKindLabel,
  mesaAgendaHasMutationActions,
  mesaAgendaHasReagendaActions,
  mesaAgendaKindUiToRpcFilter,
  mesaReagendarGateMatchesRpcRole,
  MESA_AGENDA_CITAS_ROUTE,
  MESA_AGENDA_DEFAULT_SORT,
  MESA_AGENDA_DEFAULT_VIEW,
  MESA_AGENDA_MAX_RANGE_DAYS,
  MESA_REAGENDAR_ADMIN_ROLES,
  MESA_REAGENDAR_SUCCESS_MESSAGE,
  normalizeMesaReagendarGateRole,
  resolveMesaAgendaFetchRange,
  resolveMesaReagendarAdminRole,
  shiftMesaAgendaDayYmd,
  sortMesaAgendaEntries,
  validateMesaAgendaDateRange,
} from "./mesaAgendaCitasUi";

function entry(
  overrides: Partial<MesaAgendaBookingEntry> & Pick<MesaAgendaBookingEntry, "bookingId">,
): MesaAgendaBookingEntry {
  return {
    expedienteId: "exp-1",
    bookingDate: "2026-07-15",
    bookingTime: "10:00",
    kind: "biometricos",
    status: "booked",
    locationId: "sede-centro",
    note: null,
    createdAt: "2026-07-01T10:00:00.000Z",
    cancelledAt: null,
    clienteNombre: "Juan Pérez",
    nss: "12345678901",
    etapaActual: 3,
    subestado: "en_proceso",
    submittedToMesa: true,
    asesor: { id: "asesor-1", fullName: "Ana Asesor", email: "ana@test.c" },
    createdBy: { id: "mesa-1", fullName: "Mesa Admin", email: "mesa@test.c" },
    ...overrides,
  };
}

describe("mesaAgendaCitasUi navegación", () => {
  it("botón Ver citas navega a /mesa-control/citas", () => {
    assert.equal(MESA_AGENDA_CITAS_ROUTE, "/mesa-control/citas");
  });

  it("link Ver expediente usa expedienteId correcto", () => {
    assert.equal(
      buildMesaExpedienteDetailHref("exp-abc-123"),
      "/mesa-control/exp-abc-123",
    );
  });
});

describe("mesaAgendaCitasUi rango", () => {
  it("usa rango mensual por default", () => {
    const range = defaultMesaAgendaMonthRange(new Date(2026, 6, 15));
    assert.equal(range.startDate, "2026-07-01");
    assert.equal(range.endDate, "2026-07-31");
  });

  it("rango nunca excede 62 días", () => {
    const invalid = validateMesaAgendaDateRange("2026-07-01", "2026-09-15");
    assert.equal(invalid.ok, false);
    const valid = validateMesaAgendaDateRange("2026-07-01", "2026-08-01");
    assert.equal(valid.ok, true);
    assert.equal(MESA_AGENDA_MAX_RANGE_DAYS, 62);
  });
});

describe("mesaAgendaCitasUi filtros RPC", () => {
  it("Tipo Todos envía kind=null", () => {
    assert.equal(mesaAgendaKindUiToRpcFilter("all"), null);
  });

  it("Biométricos envía kind=biometricos", () => {
    assert.equal(mesaAgendaKindUiToRpcFilter("biometricos"), "biometricos");
  });

  it("Firma envía kind=firmas", () => {
    assert.equal(mesaAgendaKindUiToRpcFilter("firmas"), "firmas");
  });

  it("Notificación envía kind=notificacion", () => {
    assert.equal(mesaAgendaKindUiToRpcFilter("notificacion"), "notificacion");
  });
});

describe("mesaAgendaCitasUi filtros cliente", () => {
  const baseFilters = {
    kindUi: "all" as const,
    includeCancelled: false,
    locationId: "",
    asesorId: "",
    search: "",
  };

  it("filtro por sede", () => {
    const rows = filterMesaAgendaEntries(
      [
        entry({ bookingId: "1", locationId: "sede-centro" }),
        entry({ bookingId: "2", locationId: "sede-norte" }),
      ],
      { ...baseFilters, locationId: "sede-norte" },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.bookingId, "2");
  });

  it("filtro por asesor", () => {
    const rows = filterMesaAgendaEntries(
      [
        entry({ bookingId: "1", asesor: { id: "a1", fullName: "Ana", email: null } }),
        entry({ bookingId: "2", asesor: { id: "a2", fullName: "Luis", email: null } }),
      ],
      { ...baseFilters, asesorId: "a2" },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.asesor.id, "a2");
  });

  it("búsqueda por cliente", () => {
    assert.equal(
      matchesMesaAgendaSearch(entry({ bookingId: "1", clienteNombre: "María López" }), "maría"),
      true,
    );
  });

  it("búsqueda por NSS", () => {
    assert.equal(matchesMesaAgendaSearch(entry({ bookingId: "1", nss: "99887766554" }), "998877"), true);
  });

  it("búsqueda por asesor dueño", () => {
    assert.equal(
      matchesMesaAgendaSearch(
        entry({ bookingId: "1", asesor: { id: "a1", fullName: "Pedro Asesor", email: null } }),
        "pedro",
      ),
      true,
    );
  });

  it("búsqueda por quien agendó", () => {
    assert.equal(
      matchesMesaAgendaSearch(
        entry({
          bookingId: "1",
          createdBy: { id: "m1", fullName: "Operador Mesa", email: null },
        }),
        "operador",
      ),
      true,
    );
  });
});

describe("mesaAgendaCitasUi presentación", () => {
  it("distingue asesor de createdBy", () => {
    const row = entry({ bookingId: "1" });
    assert.notEqual(row.asesor.fullName, row.createdBy.fullName);
    assert.notEqual(row.asesor.id, row.createdBy.id);
  });

  it("Notificación se etiqueta separada de Biométricos", () => {
    assert.equal(formatMesaAgendaKind("notificacion"), "Notificación extraordinaria");
    assert.equal(formatMesaAgendaKind("biometricos"), "Biométricos");
    assert.notEqual(formatMesaAgendaKind("notificacion"), formatMesaAgendaKind("biometricos"));
  });

  it("Notificación muestra 12:00 PM", () => {
    const row = entry({ bookingId: "n1", kind: "notificacion", bookingTime: "12:00" });
    assert.match(formatMesaAgendaDateTime(row), /12:00 PM/);
  });

  it("Cancelada tiene estado correcto", () => {
    assert.equal(formatMesaAgendaStatus("cancelled"), "Cancelada");
    assert.equal(formatMesaAgendaStatus("booked"), "Agendada");
  });

  it("preserva orden fecha/hora con sort fecha_proxima", () => {
    const rows = sortMesaAgendaEntries(
      [
        entry({ bookingId: "late", bookingDate: "2026-07-16", bookingTime: "09:00" }),
        entry({ bookingId: "early", bookingDate: "2026-07-15", bookingTime: "16:00" }),
        entry({ bookingId: "mid", bookingDate: "2026-07-15", bookingTime: "10:00" }),
      ],
      "fecha_proxima",
    );
    assert.deepEqual(rows.map((r) => r.bookingId), ["mid", "early", "late"]);
  });

  it("funciona con campos nulos sin romper", () => {
    const row = entry({
      bookingId: "nulls",
      clienteNombre: "",
      nss: null,
      locationId: null,
      note: null,
      asesor: { id: "", fullName: null, email: null },
      createdBy: { id: "", fullName: null, email: null },
    });
    assert.equal(filterMesaAgendaEntries([row], {
      kindUi: "all",
      includeCancelled: true,
      locationId: "",
      asesorId: "",
      search: "",
    }).length, 1);
  });
});

describe("mesaAgendaCitasUi errores y mutación", () => {
  it("vacío puede detectarse por lista filtrada", () => {
    const rows = filterMesaAgendaEntries([], {
      kindUi: "all",
      includeCancelled: false,
      locationId: "",
      asesorId: "",
      search: "",
    });
    assert.equal(rows.length, 0);
  });

  it("error conocido muestra mensaje controlado", () => {
    assert.match(
      mapMesaAgendaFetchErrorMessage(new Error("No tienes permiso para consultar la agenda de Mesa.")),
      /permiso/i,
    );
    assert.match(
      mapMesaAgendaFetchErrorMessage(new Error("Sesión inválida. Inicia sesión de nuevo.")),
      /sesión/i,
    );
  });

  it("B4 habilita cancelación; B5 habilita reagenda admin", () => {
    assert.equal(mesaAgendaHasMutationActions(), true);
    assert.equal(mesaAgendaHasReagendaActions(), true);
  });

  it("mapMesaAgendaCancelErrorMessage usa error RPC controlado", () => {
    const msg = mapMesaAgendaCancelErrorMessage(
      new AgendaBiometricosSupabaseError("cancel_biometricos: el motivo es obligatorio para Mesa"),
      "biometricos",
    );
    assert.match(msg, /motivo/i);
  });
});

describe("mesaAgendaCitasUi cancelación lista B4", () => {
  const roles = { mockRole: "mesa_control_interno", sessionRole: "mesa_control" };

  it("permite cancelar biométricos agendados en etapa 3", () => {
    assert.equal(
      canMesaCancelAgendaListEntry(
        entry({ bookingId: "b1", kind: "biometricos", etapaActual: 3, status: "booked" }),
        roles,
      ),
      true,
    );
  });

  it("permite cancelar firmas agendadas en etapa 9", () => {
    assert.equal(
      canMesaCancelAgendaListEntry(
        entry({ bookingId: "f1", kind: "firmas", etapaActual: 9, status: "booked" }),
        roles,
      ),
      true,
    );
  });

  it("mesa_interno no cancela notificación", () => {
    assert.equal(
      canMesaCancelAgendaListEntry(
        entry({ bookingId: "n1", kind: "notificacion", etapaActual: 3, status: "booked" }),
        { mockRole: "mesa_control_interno", sessionRole: "mesa_control_interno" },
      ),
      false,
    );
  });

  it("mesa_admin sí cancela notificación en etapa 3", () => {
    assert.equal(
      canMesaCancelAgendaListEntry(
        entry({ bookingId: "n2", kind: "notificacion", etapaActual: 3, status: "booked" }),
        { mockRole: "mesa_control_admin", sessionRole: "mesa_control_admin" },
      ),
      true,
    );
  });

  it("no cancela citas ya canceladas", () => {
    assert.equal(
      canMesaCancelAgendaListEntry(
        entry({ bookingId: "c1", kind: "biometricos", status: "cancelled" }),
        roles,
      ),
      false,
    );
  });

  it("etiqueta diálogo distingue notificación", () => {
    assert.equal(
      mesaAgendaCancelDialogKindLabel("notificacion"),
      "Notificación extraordinaria",
    );
  });

  it("lista no incluye Editar; incluye Cancelar y Reagendar", () => {
    const listSrc = readFileSync(
      join(process.cwd(), "src/components/mesa-control/MesaAgendaCitasList.tsx"),
      "utf8",
    );
    const partsSrc = readFileSync(
      join(process.cwd(), "src/components/mesa-control/MesaAgendaCitasEntryParts.tsx"),
      "utf8",
    );
    assert.doesNotMatch(listSrc, /Editar|MesaCancelarCitaDialog|MesaReagendarCitaDialog/);
    assert.match(partsSrc, /Cancelar/);
    assert.match(partsSrc, /Reagendar/);
  });
});

describe("mesaAgendaCitasUi alineación roles B5.1", () => {
  it("mesa_control_admin es alias UI de mesa_admin (no existe en app_role DB)", () => {
    assert.equal(normalizeMesaReagendarGateRole("mesa_control_admin"), "mesa_admin");
    assert.equal(normalizeMesaReagendarGateRole("mesa_admin"), "mesa_admin");
    assert.equal(normalizeMesaReagendarGateRole("mesa_control"), null);
    assert.equal(normalizeMesaReagendarGateRole("mesa_control_interno"), null);
  });

  it("gate UI con mock mesa_control_admin coincide con RPC mesa_admin", () => {
    assert.equal(
      resolveMesaReagendarAdminRole({
        mockRole: "mesa_control_admin",
        sessionRole: "mesa_control",
      }),
      "mesa_admin",
    );
    assert.equal(mesaReagendarGateMatchesRpcRole({ mockRole: "mesa_control_admin" }), true);
  });

  it("session colapsada mesa_control sola no autoriza reagenda admin", () => {
    assert.equal(
      resolveMesaReagendarAdminRole({ mockRole: null, sessionRole: "mesa_control" }),
      null,
    );
  });

  it("super_admin alinea frontend y backend", () => {
    assert.equal(normalizeMesaReagendarGateRole("super_admin"), "super_admin");
    assert.equal(
      resolveMesaReagendarAdminRole({ mockRole: "super_admin", sessionRole: "super_admin" }),
      "super_admin",
    );
  });
});

describe("mesaAgendaCitasUi reagenda lista B5", () => {
  const adminRoles = { mockRole: "mesa_control_admin", sessionRole: "mesa_control" };
  const internoRoles = { mockRole: "mesa_control_interno", sessionRole: "mesa_control_interno" };

  it("mesa_admin puede reagendar biométricos etapa 3", () => {
    const gate = canMesaReagendarAgendaListEntry(
      entry({ bookingId: "b1", kind: "biometricos", etapaActual: 3, status: "booked" }),
      adminRoles,
    );
    assert.equal(gate.allowed, true);
  });

  it("mesa_interno no puede reagendar", () => {
    const gate = canMesaReagendarAgendaListEntry(
      entry({ bookingId: "b2", kind: "firmas", etapaActual: 9, status: "booked" }),
      internoRoles,
    );
    assert.equal(gate.allowed, false);
    assert.match(gate.reason ?? "", /administrativa/i);
  });

  it("no reagenda citas canceladas", () => {
    const gate = canMesaReagendarAgendaListEntry(
      entry({ bookingId: "c1", kind: "biometricos", status: "cancelled" }),
      adminRoles,
    );
    assert.equal(gate.allowed, false);
  });

  it("notificación solo etapa 3", () => {
    const ok = canMesaReagendarAgendaListEntry(
      entry({ bookingId: "n1", kind: "notificacion", etapaActual: 3, status: "booked" }),
      adminRoles,
    );
    const bad = canMesaReagendarAgendaListEntry(
      entry({ bookingId: "n2", kind: "notificacion", etapaActual: 4, status: "booked" }),
      adminRoles,
    );
    assert.equal(ok.allowed, true);
    assert.equal(bad.allowed, false);
  });

  it("roles admin explícitos", () => {
    assert.equal(MESA_REAGENDAR_ADMIN_ROLES.has("mesa_admin"), true);
    assert.equal(MESA_REAGENDAR_ADMIN_ROLES.has("mesa_control_admin"), true);
    assert.equal(MESA_REAGENDAR_ADMIN_ROLES.has("super_admin"), true);
    assert.equal(MESA_REAGENDAR_ADMIN_ROLES.has("mesa_interno"), false);
    assert.equal(MESA_REAGENDAR_ADMIN_ROLES.has("mesa_control_interno"), false);
  });

  it("doble submit bloqueado en dialog reagenda", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/mesa-control/MesaReagendarCitaDialog.tsx"),
      "utf8",
    );
    assert.match(src, /disabled=\{saving/);
    assert.match(src, /Reagendando/);
  });

  it("notificación solo fecha en dialog", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/mesa-control/MesaReagendarCitaDialog.tsx"),
      "utf8",
    );
    assert.match(src, /NOTIFICACION_FIXED_TIME_DISPLAY/);
    assert.match(src, /entry\.kind === "notificacion"/);
  });

  it("mensaje éxito reagenda definido", () => {
    assert.match(MESA_REAGENDAR_SUCCESS_MESSAGE, /reagendada/i);
  });
});

describe("mesaAgendaCitasUi roles", () => {
  it("permite roles Mesa y super_admin", () => {
    assert.equal(canAccessMesaAgendaCitasPage("mesa_admin"), true);
    assert.equal(canAccessMesaAgendaCitasPage("mesa_control_interno"), true);
    assert.equal(canAccessMesaAgendaCitasPage("super_admin"), true);
    assert.equal(canAccessMesaAgendaCitasPage("asesor"), false);
  });
});

describe("mesaAgendaCitasUi opciones derivadas", () => {
  it("buildMesaAgendaAdvisorOptions y locationOptions", () => {
    const advisors = buildMesaAgendaAdvisorOptions([
      entry({ bookingId: "1", asesor: { id: "a1", fullName: "Ana", email: null } }),
      entry({ bookingId: "2", asesor: { id: "a2", fullName: "Luis", email: null } }),
    ]);
    const locations = buildMesaAgendaLocationOptions([
      entry({ bookingId: "1", locationId: "sede-centro" }),
      entry({ bookingId: "2", locationId: "sede-norte" }),
    ]);
    assert.equal(advisors.length, 2);
    assert.equal(locations.length, 2);
  });
});

describe("mesaAgendaCitasUi B6 vistas", () => {
  it("Lista es default", () => {
    assert.equal(MESA_AGENDA_DEFAULT_VIEW, "lista");
    assert.equal(MESA_AGENDA_DEFAULT_SORT, "fecha_proxima");
  });

  it("Día filtra un solo día", () => {
    const rows = filterMesaAgendaEntriesForDay(
      [
        entry({ bookingId: "1", bookingDate: "2026-07-15" }),
        entry({ bookingId: "2", bookingDate: "2026-07-16" }),
      ],
      "2026-07-15",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.bookingId, "1");
  });

  it("Semana calcula siete días lun–dom", () => {
    const week = buildMesaAgendaWeekRange("2026-07-15");
    assert.equal(week.days.length, 7);
    assert.equal(week.startDate, "2026-07-13");
    assert.equal(week.endDate, "2026-07-19");
  });

  it("Día anterior/siguiente", () => {
    assert.equal(shiftMesaAgendaDayYmd("2026-07-15", -1), "2026-07-14");
    assert.equal(shiftMesaAgendaDayYmd("2026-07-15", 1), "2026-07-16");
  });

  it("Semana anterior/siguiente vía anchor", () => {
    assert.equal(shiftMesaAgendaDayYmd("2026-07-15", -7), "2026-07-08");
    assert.equal(shiftMesaAgendaDayYmd("2026-07-15", 7), "2026-07-22");
  });

  it("resolveMesaAgendaFetchRange conserva filtros al cambiar vista", () => {
    const filters = defaultMesaAgendaClientFilters();
    assert.deepEqual(
      resolveMesaAgendaFetchRange({
        viewMode: "lista",
        listaStartDate: "2026-07-01",
        listaEndDate: "2026-07-31",
        selectedDay: "2026-07-10",
        weekAnchor: "2026-07-10",
      }),
      { startDate: "2026-07-01", endDate: "2026-07-31" },
    );
    assert.deepEqual(
      resolveMesaAgendaFetchRange({
        viewMode: "dia",
        listaStartDate: "2026-07-01",
        listaEndDate: "2026-07-31",
        selectedDay: "2026-07-10",
        weekAnchor: "2026-07-10",
      }),
      { startDate: "2026-07-10", endDate: "2026-07-10" },
    );
    assert.equal(filters.kindUi, "all");
  });

  it("agrupa citas del mismo horario en vista Día", () => {
    const groups = groupMesaAgendaEntriesByTime([
      entry({ bookingId: "1", bookingTime: "10:00" }),
      entry({ bookingId: "2", bookingTime: "10:00" }),
      entry({ bookingId: "3", bookingTime: "12:00", kind: "notificacion" }),
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.entries.length, 2);
    assert.match(groups[1]?.timeLabel ?? "", /12:00 PM/);
  });
});

describe("mesaAgendaCitasUi B6 resumen", () => {
  it("total y conteos por tipo", () => {
    const summary = deriveMesaAgendaSummary([
      entry({ bookingId: "1", kind: "biometricos", status: "booked" }),
      entry({ bookingId: "2", kind: "firmas", status: "booked" }),
      entry({ bookingId: "3", kind: "notificacion", status: "cancelled" }),
    ]);
    assert.equal(summary.total, 3);
    assert.equal(summary.biometricos, 1);
    assert.equal(summary.firmas, 1);
    assert.equal(summary.notificacion, 1);
    assert.equal(summary.canceladas, 1);
  });
});

describe("mesaAgendaCitasUi B6 historial", () => {
  it("agrupa por expediente + kind", () => {
    const groups = groupMesaAgendaHistory([
      entry({ bookingId: "1", expedienteId: "exp-1", kind: "biometricos" }),
      entry({ bookingId: "2", expedienteId: "exp-1", kind: "biometricos", status: "cancelled" }),
      entry({ bookingId: "3", expedienteId: "exp-1", kind: "notificacion" }),
    ]);
    assert.equal(groups.size, 2);
    assert.equal(groups.get("exp-1::biometricos")?.length, 2);
    assert.equal(groups.get("exp-1::notificacion")?.length, 1);
  });

  it("Reagendada solo con activa posterior", () => {
    const group = [
      entry({
        bookingId: "old",
        expedienteId: "exp-1",
        kind: "biometricos",
        status: "cancelled",
        createdAt: "2026-07-01T10:00:00.000Z",
        cancelledAt: "2026-07-02T10:00:00.000Z",
      }),
      entry({
        bookingId: "new",
        expedienteId: "exp-1",
        kind: "biometricos",
        status: "booked",
        createdAt: "2026-07-03T10:00:00.000Z",
      }),
    ];
    assert.equal(deriveMesaAgendaHistoryLabel(group[1]!, group), "Cita actual");
    assert.equal(deriveMesaAgendaHistoryLabel(group[0]!, group), "Reagendada");
  });

  it("Cancelada sin activa posterior", () => {
    const group = [
      entry({
        bookingId: "c1",
        expedienteId: "exp-2",
        kind: "firmas",
        status: "cancelled",
        createdAt: "2026-07-01T10:00:00.000Z",
        cancelledAt: "2026-07-02T10:00:00.000Z",
      }),
    ];
    assert.equal(deriveMesaAgendaHistoryLabel(group[0]!, group), null);
  });

  it("cancelada no tiene acciones (gate)", () => {
    assert.equal(
      canMesaCancelAgendaListEntry(
        entry({ bookingId: "c1", status: "cancelled" }),
        { mockRole: "mesa_control_admin", sessionRole: "mesa_control" },
      ),
      false,
    );
    assert.equal(
      canMesaReagendarAgendaListEntry(
        entry({ bookingId: "c1", status: "cancelled" }),
        { mockRole: "mesa_control_admin", sessionRole: "mesa_control" },
      ).allowed,
      false,
    );
  });
});

describe("mesaAgendaCitasUi B6 filtros activos", () => {
  it("chips activos correctos", () => {
    const chips = buildMesaAgendaActiveFilterChips(
      {
        kindUi: "biometricos",
        includeCancelled: true,
        locationId: "sede-centro",
        asesorId: "a1",
        search: "juan",
      },
      {
        advisorOptions: [{ value: "a1", label: "Ana" }],
        locationOptions: [{ value: "sede-centro", label: "Monterrey" }],
      },
    );
    assert.ok(chips.some((chip) => chip.label.includes("Biométricos")));
    assert.ok(chips.some((chip) => chip.label.includes("Monterrey")));
    assert.ok(chips.some((chip) => chip.label.includes("Ana")));
    assert.ok(chips.some((chip) => chip.label.includes("canceladas")));
    assert.ok(chips.some((chip) => chip.label.includes("juan")));
  });

  it("limpiar filtros no toca rango (estado separado)", () => {
    const cleared = clearMesaAgendaClientFilters();
    assert.deepEqual(cleared, defaultMesaAgendaClientFilters());
  });

  it("búsqueda y sede/asesor siguen funcionando", () => {
    const rows = applyMesaAgendaClientFiltersAndSort(
      [
        entry({
          bookingId: "1",
          locationId: "sede-centro",
          asesor: { id: "a1", fullName: "Ana", email: null },
          clienteNombre: "Juan",
        }),
        entry({
          bookingId: "2",
          locationId: "sede-norte",
          asesor: { id: "a2", fullName: "Luis", email: null },
        }),
      ],
      {
        kindUi: "all",
        includeCancelled: false,
        locationId: "sede-centro",
        asesorId: "a1",
        search: "juan",
      },
      "fecha_proxima",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.bookingId, "1");
  });
});

describe("mesaAgendaCitasUi B6 orden", () => {
  const sample = [
    entry({
      bookingId: "b",
      bookingDate: "2026-07-16",
      bookingTime: "09:00",
      clienteNombre: "Bravo",
      asesor: { id: "a2", fullName: "Luis", email: null },
      kind: "firmas",
    }),
    entry({
      bookingId: "a",
      bookingDate: "2026-07-15",
      bookingTime: "10:00",
      clienteNombre: "Alpha",
      asesor: { id: "a1", fullName: "Ana", email: null },
      kind: "biometricos",
    }),
  ];

  it("fecha próxima y lejana", () => {
    assert.equal(sortMesaAgendaEntries(sample, "fecha_proxima")[0]?.bookingId, "a");
    assert.equal(sortMesaAgendaEntries(sample, "fecha_lejana")[0]?.bookingId, "b");
  });

  it("cliente y asesor A–Z", () => {
    assert.equal(sortMesaAgendaEntries(sample, "cliente_az")[0]?.clienteNombre, "Alpha");
    assert.equal(sortMesaAgendaEntries(sample, "asesor_az")[0]?.asesor.fullName, "Ana");
  });

  it("tipo", () => {
    assert.equal(sortMesaAgendaEntries(sample, "tipo")[0]?.kind, "biometricos");
  });
});

describe("mesaAgendaCitasUi B6 regresiones", () => {
  it("Client usa fetchMesaAgendaBookings sin UPDATE directo", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/mesa-control/MesaAgendaCitasClient.tsx"),
      "utf8",
    );
    assert.match(src, /fetchMesaAgendaBookings/);
    assert.doesNotMatch(src, /\.update\(/);
  });

  it("mobile y desktop comparten gates en List", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/mesa-control/MesaAgendaCitasList.tsx"),
      "utf8",
    );
    assert.match(src, /canCancelEntry\(entry\)/);
    assert.match(src, /canReagendarEntry\(entry\)/);
  });
});
