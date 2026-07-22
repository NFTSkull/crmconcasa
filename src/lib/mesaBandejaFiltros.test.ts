import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aplicarFiltrosBandejaMesa,
  coincideBusquedaClienteTelefono,
  contarVistaRapida,
  esCitaHoy,
  esCanceladoOperativo,
  esNuevoEtapa12,
  esRechazadoOperativoActivo,
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
    cicloEstado: "activo",
    fechaCita: null,
    resumenDocumental: null,
    ...partial,
  };
}

function estado(partial?: Partial<MesaBandejaFiltrosState>): MesaBandejaFiltrosState {
  return {
    quickFilter: "todos",
    rechazosCancelacionesSubfiltro: "rechazados",
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
  item({
    cliente_nombre: "Cliente Cancelado",
    telefono_cliente: "5500000094",
    etapaActual: 7,
    subestado: "en_proceso",
    cicloEstado: "cancelado",
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
      "rechazos_cancelaciones",
    ] as const) {
      const next = seleccionarVistaRapida(id);
      assert.equal(next.opsFilter, "todo_mesa");
      assert.equal(next.quickFilter, id);
    }
  });

  it("asignación operativa regresa vista a Todos", () => {
    const next = seleccionarAsignacion("sin_asignar");
    assert.equal(next.quickFilter, "todos");
    assert.equal(next.opsFilter, "sin_asignar");
  });

  it("limpiar deja Todo Mesa", () => {
    const next = limpiarFiltrosBandeja();
    assert.equal(next.quickFilter, "todos");
    assert.equal(next.opsFilter, "todo_mesa");
  });

  it("constantes de citas hoy", () => {
    assert.equal(MESA_CITAS_HOY_CHIP_ID, "citas_hoy");
    assert.equal(MESA_CITAS_ROUTE, "/mesa-control/citas");
  });
});

describe("mesaBandejaFiltros — P094 rechazos vs cancelados", () => {
  it("predicados disjuntos y chip agrupado", () => {
    const rechazado = item({ subestado: "rechazado", cicloEstado: "activo" });
    const cancelado = item({
      subestado: "en_proceso",
      cicloEstado: "cancelado",
    });
    const rechazadoLuegoCancelado = item({
      subestado: "rechazado",
      cicloEstado: "cancelado",
    });
    assert.equal(esRechazadoOperativoActivo(rechazado), true);
    assert.equal(esCanceladoOperativo(cancelado), true);
    assert.equal(esRechazadoOperativoActivo(rechazadoLuegoCancelado), false);
    assert.equal(esCanceladoOperativo(rechazadoLuegoCancelado), true);
    assert.equal(
      matchesMesaQuickFilter(rechazado, "rechazos_cancelaciones"),
      true,
    );
    assert.equal(
      matchesMesaQuickFilter(cancelado, "rechazos_cancelaciones"),
      true,
    );
    assert.equal(matchesMesaQuickFilter(cancelado, "todos"), false);
    assert.equal(matchesMesaQuickFilter(cancelado, "en_proceso"), false);
  });

  it("contador agrupado = rechazados activos + cancelados", () => {
    const counts = contarVistaRapida(BANDEJA, HOY);
    assert.equal(counts.rechazados, 1);
    assert.equal(counts.cancelados, 1);
    assert.equal(counts.rechazosCancelaciones, 2);
  });

  it("subvistas filtran disjuntos", () => {
    const rechazados = aplicarFiltrosBandejaMesa(
      BANDEJA,
      estado({
        quickFilter: "rechazos_cancelaciones",
        rechazosCancelacionesSubfiltro: "rechazados",
      }),
      HOY,
    );
    const cancelados = aplicarFiltrosBandejaMesa(
      BANDEJA,
      estado({
        quickFilter: "rechazos_cancelaciones",
        rechazosCancelacionesSubfiltro: "cancelados",
      }),
      HOY,
    );
    assert.equal(rechazados.length, 1);
    assert.equal(rechazados[0]?.cliente_nombre, "Pedro Hernández");
    assert.equal(cancelados.length, 1);
    assert.equal(cancelados[0]?.cliente_nombre, "Cliente Cancelado");
  });
});

describe("mesaBandejaFiltros — coherencia contador/lista", () => {
  it("En proceso: contador = tamaño de lista filtrada", () => {
    const counts = contarVistaRapida(BANDEJA, HOY);
    const list = aplicarFiltrosBandejaMesa(
      BANDEJA,
      estado({ quickFilter: "en_proceso" }),
      HOY,
    );
    assert.equal(list.length, counts.enProceso);
  });

  it("chip agrupado: contador = unión; lista usa subvista", () => {
    const counts = contarVistaRapida(BANDEJA, HOY);
    const listRech = aplicarFiltrosBandejaMesa(
      BANDEJA,
      estado({
        quickFilter: "rechazos_cancelaciones",
        rechazosCancelacionesSubfiltro: "rechazados",
      }),
      HOY,
    );
    const listCanc = aplicarFiltrosBandejaMesa(
      BANDEJA,
      estado({
        quickFilter: "rechazos_cancelaciones",
        rechazosCancelacionesSubfiltro: "cancelados",
      }),
      HOY,
    );
    assert.equal(listRech.length + listCanc.length, counts.rechazosCancelaciones);
    assert.equal(listRech.length, counts.rechazados);
    assert.equal(listCanc.length, counts.cancelados);
  });

  it("contadores básicos sin cancelados en operativos", () => {
    const counts = contarVistaRapida(BANDEJA, HOY);
    assert.equal(counts.nuevos, 2);
    assert.equal(counts.enProceso, 3);
    assert.equal(counts.correccionesEnviadas, 1);
    assert.equal(counts.citasHoy, 2);
  });
});

describe("mesaBandejaFiltros — nuevos etapa 1-2", () => {
  it("solo etapas 1-2 con subestado operativo activo", () => {
    assert.equal(esNuevoEtapa12({ etapaActual: 2, subestado: "en_proceso" }), true);
    assert.equal(esNuevoEtapa12({ etapaActual: 1, subestado: "rechazado" }), false);
    assert.equal(
      esNuevoEtapa12({
        etapaActual: 1,
        subestado: "pendiente",
        cicloEstado: "cancelado",
      }),
      false,
    );
  });
});

describe("mesaBandejaFiltros — búsqueda cliente/teléfono", () => {
  it("coincide por nombre case-insensitive", () => {
    assert.equal(
      coincideBusquedaClienteTelefono(
        { cliente_nombre: "Ana García", telefono_cliente: "55" },
        "ana",
      ),
      true,
    );
  });

  it("coincide por dígitos de teléfono", () => {
    assert.equal(
      coincideBusquedaClienteTelefono(
        { cliente_nombre: "X", telefono_cliente: "81 1234 5678" },
        "811234",
      ),
      true,
    );
  });

  it("soloDigitos y toYMDLocal / esCitaHoy", () => {
    assert.equal(soloDigitos("81-12"), "8112");
    assert.equal(toYMDLocal("2026-07-15"), "2026-07-15");
    assert.equal(esCitaHoy(HOY, HOY), true);
  });
});

describe("mesaBandejaFiltros — etapa, subestado y citas de hoy", () => {
  it("filtra por paso visual (interna 5 = paso 4) y subestado", () => {
    const list = aplicarFiltrosBandejaMesa(
      BANDEJA,
      estado({ etapa: "4", subestado: "en_proceso" }),
      HOY,
    );
    assert.equal(list.length, 1);
    assert.equal(list[0]?.cliente_nombre, "Laura Martínez");
  });

  it("soloCitasHoy", () => {
    const list = aplicarFiltrosBandejaMesa(
      BANDEJA,
      estado({ soloCitasHoy: true }),
      HOY,
    );
    assert.equal(list.length, 2);
  });

  it("combinación búsqueda + paso visual", () => {
    const list = aplicarFiltrosBandejaMesa(
      BANDEJA,
      estado({ etapa: "4", subestado: "en_proceso", buscar: "laura" }),
      HOY,
    );
    assert.equal(list.length, 1);
  });

  it("En proceso + paso 9 (interna 10)", () => {
    const list = aplicarFiltrosBandejaMesa(
      BANDEJA,
      estado({ quickFilter: "en_proceso", etapa: "9" }),
      HOY,
    );
    assert.equal(list.length, 1);
    assert.equal(list[0]?.cliente_nombre, "Miguel Torres");
  });

  it("paso 3 incluye internas 3 y 4", () => {
    const mix = [
      ...BANDEJA,
      item({ cliente_nombre: "Bio Tres", etapaActual: 3, subestado: "en_proceso" }),
      item({ cliente_nombre: "Bio Cuatro", etapaActual: 4, subestado: "en_proceso" }),
    ];
    const list = aplicarFiltrosBandejaMesa(mix, estado({ etapa: "3" }), HOY);
    assert.equal(list.length, 2);
    assert.ok(list.some((c) => c.cliente_nombre === "Bio Tres"));
    assert.ok(list.some((c) => c.cliente_nombre === "Bio Cuatro"));
  });
});
