import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aplicarFiltrosBandejaMesa,
  coincideBusquedaClienteTelefono,
  contarVistaRapida,
  esCitaHoy,
  esNuevoEtapa12,
  limpiarFiltrosBandeja,
  matchesMesaQuickFilter,
  MESA_CITAS_HOY_CHIP_ID,
  MESA_CITAS_ROUTE,
  seleccionarAsignacion,
  seleccionarVistaRapida,
  soloDigitos,
  toYMDLocal,
  type MesaBandejaFiltroItem,
  type MesaBandejaFiltrosState,
} from "@/lib/mesaBandejaFiltros";

const HOY = "2026-07-15";

function item(partial: Partial<MesaBandejaFiltroItem>): MesaBandejaFiltroItem {
  return {
    cliente_nombre: "Cliente Demo",
    telefono_cliente: "5510000000",
    etapaActual: 5,
    subestado: "en_proceso",
    fechaCita: null,
    resumenDocumental: null,
    ...partial,
  };
}

function estado(partial?: Partial<MesaBandejaFiltrosState>): MesaBandejaFiltrosState {
  return {
    quickFilter: "todos",
    buscar: "",
    etapa: "todas",
    subestado: "todas",
    soloCitasHoy: false,
    ...partial,
  };
}

const BANDEJA: MesaBandejaFiltroItem[] = [
  item({
    cliente_nombre: "Ana García",
    telefono_cliente: "8112345678",
    etapaActual: 1,
    subestado: "pendiente",
  }),
  item({
    cliente_nombre: "Roberto Sánchez",
    telefono_cliente: "5598765432",
    etapaActual: 2,
    subestado: "en_proceso",
  }),
  item({
    cliente_nombre: "Laura Martínez",
    telefono_cliente: "5511223344",
    etapaActual: 5,
    subestado: "en_proceso",
    fechaCita: HOY,
  }),
  item({
    cliente_nombre: "Pedro Hernández",
    telefono_cliente: "5544556677",
    etapaActual: 5,
    subestado: "rechazado",
  }),
  item({
    cliente_nombre: "Sofía Ramírez",
    telefono_cliente: "5588990011",
    etapaActual: 7,
    subestado: "aprobado",
    resumenDocumental: "correccion_enviada",
  }),
  item({
    cliente_nombre: "Miguel Torres",
    telefono_cliente: "5533445566",
    etapaActual: 10,
    subestado: "en_proceso",
    fechaCita: "2026-07-15T16:30:00.000Z",
  }),
];

describe("mesaBandejaFiltros — selección principal exclusiva", () => {
  it("pulsar En proceso desde Disponibles cambia asignación a Todo Mesa", () => {
    const next = seleccionarVistaRapida("en_proceso");
    assert.equal(next.quickFilter, "en_proceso");
    assert.equal(next.opsFilter, "todo_mesa");
  });

  it("todos los chips de Vista rápida fuerzan Todo Mesa", () => {
    for (const id of [
      "todos",
      "correccion_enviada",
      "nuevos",
      "en_proceso",
      "rechazados",
    ] as const) {
      const next = seleccionarVistaRapida(id);
      assert.equal(next.quickFilter, id);
      assert.equal(next.opsFilter, "todo_mesa");
    }
  });

  it("pulsar Todos limpia el filtro rápido y muestra Todo Mesa", () => {
    const next = seleccionarVistaRapida("todos");
    assert.deepEqual(next, { quickFilter: "todos", opsFilter: "todo_mesa" });
  });

  it("chips de Asignación regresan Vista rápida a Todos (sin intersección silenciosa)", () => {
    for (const id of [
      "sin_asignar",
      "en_espera_asesor",
      "mi_bandeja",
      "en_trabajo",
      "todo_mesa",
    ] as const) {
      const next = seleccionarAsignacion(id);
      assert.equal(next.quickFilter, "todos");
      assert.equal(next.opsFilter, id);
    }
  });

  it("Citas hoy es navegación a la ruta real de citas, no un filtro", () => {
    assert.equal(MESA_CITAS_ROUTE, "/mesa-control/citas");
    assert.equal(MESA_CITAS_HOY_CHIP_ID, "citas_hoy");
  });

  it("limpiar filtros restablece todo y deja Todo Mesa visible", () => {
    assert.deepEqual(limpiarFiltrosBandeja(), {
      quickFilter: "todos",
      opsFilter: "todo_mesa",
      buscar: "",
      etapa: "todas",
      subestado: "todas",
      soloCitasHoy: false,
    });
  });
});

describe("mesaBandejaFiltros — coherencia contador/lista", () => {
  it("el contador y la lista usan el mismo predicado por chip", () => {
    const counts = contarVistaRapida(BANDEJA, HOY);
    assert.equal(
      aplicarFiltrosBandejaMesa(BANDEJA, estado({ quickFilter: "en_proceso" }), HOY)
        .length,
      counts.enProceso,
    );
    assert.equal(
      aplicarFiltrosBandejaMesa(BANDEJA, estado({ quickFilter: "nuevos" }), HOY).length,
      counts.nuevos,
    );
    assert.equal(
      aplicarFiltrosBandejaMesa(
        BANDEJA,
        estado({ quickFilter: "correccion_enviada" }),
        HOY,
      ).length,
      counts.correccionesEnviadas,
    );
    assert.equal(
      aplicarFiltrosBandejaMesa(BANDEJA, estado({ quickFilter: "rechazados" }), HOY)
        .length,
      counts.rechazados,
    );
  });

  it("conteos esperados sobre la bandeja de prueba", () => {
    const counts = contarVistaRapida(BANDEJA, HOY);
    assert.equal(counts.enProceso, 3);
    assert.equal(counts.nuevos, 2);
    assert.equal(counts.correccionesEnviadas, 1);
    assert.equal(counts.rechazados, 1);
    assert.equal(counts.citasHoy, 2);
  });

  it("Todos no filtra nada", () => {
    assert.equal(
      aplicarFiltrosBandejaMesa(BANDEJA, estado(), HOY).length,
      BANDEJA.length,
    );
  });

  it("nuevos = etapas 1–2 con subestado activo", () => {
    assert.equal(esNuevoEtapa12({ etapaActual: 1, subestado: "pendiente" }), true);
    assert.equal(esNuevoEtapa12({ etapaActual: 2, subestado: "en_proceso" }), true);
    assert.equal(esNuevoEtapa12({ etapaActual: 3, subestado: "pendiente" }), false);
    assert.equal(esNuevoEtapa12({ etapaActual: 1, subestado: "rechazado" }), false);
    assert.equal(
      matchesMesaQuickFilter(
        item({ etapaActual: 2, subestado: "en_validacion_mesa" }),
        "nuevos",
      ),
      true,
    );
  });
});

describe("mesaBandejaFiltros — búsqueda cliente/teléfono", () => {
  it("busca por nombre sin distinguir mayúsculas y con trim", () => {
    const c = item({ cliente_nombre: "Ana García" });
    assert.equal(coincideBusquedaClienteTelefono(c, "ana"), true);
    assert.equal(coincideBusquedaClienteTelefono(c, "  GARCÍA  "), true);
    assert.equal(coincideBusquedaClienteTelefono(c, "roberto"), false);
  });

  it("teléfono con espacios y solo dígitos encuentran el mismo registro", () => {
    const c = item({ telefono_cliente: "8112345678" });
    assert.equal(coincideBusquedaClienteTelefono(c, "81 1234 5678"), true);
    assert.equal(coincideBusquedaClienteTelefono(c, "8112345678"), true);
    assert.equal(coincideBusquedaClienteTelefono(c, "1234 5678"), true);
    assert.equal(coincideBusquedaClienteTelefono(c, "9999"), false);
  });

  it("normaliza el teléfono almacenado aunque tenga formato", () => {
    const c = item({ telefono_cliente: "81 1234 5678" });
    assert.equal(coincideBusquedaClienteTelefono(c, "8112345678"), true);
  });

  it("cadena vacía o solo espacios no agrega filtro", () => {
    assert.equal(coincideBusquedaClienteTelefono(item({}), ""), true);
    assert.equal(coincideBusquedaClienteTelefono(item({}), "   "), true);
    assert.equal(
      aplicarFiltrosBandejaMesa(BANDEJA, estado({ buscar: "   " }), HOY).length,
      BANDEJA.length,
    );
  });

  it("la búsqueda se aplica sobre el conjunto completo, no una página", () => {
    const grande = [
      ...Array.from({ length: 30 }, (_, i) =>
        item({ cliente_nombre: `Relleno ${i}`, telefono_cliente: `55000000${i}` }),
      ),
      item({ cliente_nombre: "Objetivo Final", telefono_cliente: "8187654321" }),
    ];
    const res = aplicarFiltrosBandejaMesa(grande, estado({ buscar: "objetivo" }), HOY);
    assert.equal(res.length, 1);
    assert.equal(res[0]?.cliente_nombre, "Objetivo Final");
  });

  it("soloDigitos elimina espacios, guiones y letras", () => {
    assert.equal(soloDigitos("81 1234-5678"), "8112345678");
    assert.equal(soloDigitos("abc"), "");
  });
});

describe("mesaBandejaFiltros — etapa, subestado y citas de hoy", () => {
  it("etapa filtra el conjunto completo y 'todas' no filtra", () => {
    assert.equal(
      aplicarFiltrosBandejaMesa(BANDEJA, estado({ etapa: "5" }), HOY).length,
      2,
    );
    assert.equal(
      aplicarFiltrosBandejaMesa(BANDEJA, estado({ etapa: "todas" }), HOY).length,
      BANDEJA.length,
    );
  });

  it("subestado usa los valores reales del modelo", () => {
    assert.equal(
      aplicarFiltrosBandejaMesa(BANDEJA, estado({ subestado: "pendiente" }), HOY)
        .length,
      1,
    );
    assert.equal(
      aplicarFiltrosBandejaMesa(BANDEJA, estado({ subestado: "aprobado" }), HOY).length,
      1,
    );
    assert.equal(
      aplicarFiltrosBandejaMesa(BANDEJA, estado({ subestado: "todas" }), HOY).length,
      BANDEJA.length,
    );
  });

  it("etapa + subestado + búsqueda combinan correctamente", () => {
    const res = aplicarFiltrosBandejaMesa(
      BANDEJA,
      estado({ etapa: "5", subestado: "en_proceso", buscar: "laura" }),
      HOY,
    );
    assert.equal(res.length, 1);
    assert.equal(res[0]?.cliente_nombre, "Laura Martínez");
  });

  it("vista rápida + subestado se intersectan de forma visible", () => {
    const res = aplicarFiltrosBandejaMesa(
      BANDEJA,
      estado({ quickFilter: "en_proceso", etapa: "10" }),
      HOY,
    );
    assert.equal(res.length, 1);
    assert.equal(res[0]?.cliente_nombre, "Miguel Torres");
  });

  it("solo citas de hoy usa día local: fecha simple e ISO con hora", () => {
    const res = aplicarFiltrosBandejaMesa(BANDEJA, estado({ soloCitasHoy: true }), HOY);
    assert.equal(res.length, 2);
    assert.equal(esCitaHoy(HOY, HOY), true);
    assert.equal(esCitaHoy("2026-07-14", HOY), false);
    assert.equal(esCitaHoy(null, HOY), false);
  });

  it("toYMDLocal no corre el día en fechas sin hora y tolera inválidas", () => {
    assert.equal(toYMDLocal("2026-07-15"), "2026-07-15");
    assert.equal(toYMDLocal("no-es-fecha"), null);
    assert.equal(toYMDLocal(null), null);
    assert.equal(toYMDLocal(undefined), null);
    const iso = new Date(2026, 6, 15, 12, 0, 0).toISOString();
    assert.equal(toYMDLocal(iso), "2026-07-15");
  });
});
