import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildMesaCitasExportFilename,
  collectMesaCitasForExport,
} from "@/lib/exportMesaCitasExcel";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";

describe("P120 Mesa Citas rango libre Lista", () => {
  const client = readFileSync(
    join(process.cwd(), "src/components/mesa-control/MesaAgendaCitasClient.tsx"),
    "utf8",
  );
  const controls = readFileSync(
    join(process.cwd(), "src/components/mesa-control/MesaAgendaCitasViewControls.tsx"),
    "utf8",
  );

  it("Lista no cablea Fecha inicial/final a applySingleDay", () => {
    assert.match(client, /handleListaStartDateChange/);
    assert.match(client, /handleListaEndDateChange/);
    assert.match(client, /appliedListaStart/);
    assert.match(client, /appliedListaEnd/);
    assert.match(client, /onStartDateChange=\{handleListaStartDateChange\}/);
    assert.match(client, /onEndDateChange=\{handleListaEndDateChange\}/);
    assert.doesNotMatch(client, /onStartDateChange=\{applySingleDay\}/);
    assert.doesNotMatch(client, /onEndDateChange=\{applySingleDay\}/);
  });

  it("Actualizar citas usa borrador; editar fechas no fuerza un día al volver a Lista", () => {
    assert.match(client, /handleRefreshLista/);
    assert.match(client, /onRefresh=\{handleRefreshLista\}/);
    assert.match(
      client,
      /loadEntries\(\{\s*startDate:\s*listaStartDate,\s*endDate:\s*listaEndDate\s*\}\)/,
    );
    assert.doesNotMatch(
      client,
      /mode === ["']lista["'][\s\S]{0,120}setListaStartDate\(selectedDay\)/,
    );
  });

  it("rango inválido deshabilita Actualizar y muestra error inline", () => {
    assert.match(controls, /canRefreshLista/);
    assert.match(controls, /rangeError/);
    assert.match(controls, /mesa-citas-range-error/);
    assert.match(client, /listaDraftValidation/);
    assert.match(client, /canRefreshLista=\{listaDraftValidation\.ok\}/);
  });

  it("Hoy en Lista aplica hoy a ambas fechas y consulta", () => {
    assert.match(client, /setAppliedListaStart\(today\)/);
    assert.match(client, /setAppliedListaEnd\(today\)/);
    assert.match(
      client,
      /loadEntries\(\{\s*startDate:\s*today,\s*endDate:\s*today\s*\}\)/,
    );
  });

  it("Excel exporta rango consultado (applied) no solo un día", () => {
    assert.match(client, /exportEndYmd/);
    assert.match(client, /downloadMesaCitasExcel\(\s*loadedEntries/);
    assert.match(client, /exportEndYmd/);

    const entries = [
      {
        bookingId: "a",
        bookingDate: "2026-07-01",
        bookingTime: "10:00",
        kind: "biometricos",
        status: "booked",
        nss: "1",
        clienteNombre: "Uno",
        locationId: "monterrey",
      },
      {
        bookingId: "b",
        bookingDate: "2026-07-23",
        bookingTime: "11:00",
        kind: "firmas",
        status: "booked",
        nss: "2",
        clienteNombre: "Dos",
      },
      {
        bookingId: "c",
        bookingDate: "2026-07-24",
        bookingTime: "12:00",
        kind: "firmas",
        status: "booked",
        nss: "3",
        clienteNombre: "Tres",
      },
    ] as unknown as MesaAgendaBookingEntry[];

    const ranged = collectMesaCitasForExport(
      entries,
      "2026-07-01",
      undefined,
      undefined,
      "2026-07-23",
    );
    assert.equal(ranged.length, 2);
    assert.equal(
      buildMesaCitasExportFilename("2026-07-01", "2026-07-23"),
      "citas-mesa-2026-07-01_2026-07-23.xlsx",
    );
  });
});
