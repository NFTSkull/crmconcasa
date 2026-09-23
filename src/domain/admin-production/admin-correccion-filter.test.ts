import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAsesorCorreccionDetalle } from "@/domain/expedientes/asesor-correccion-detalle";
import {
  ADMIN_CORRECCION_FILTER_OPTIONS,
  ADMIN_CORRECCION_ALCANCE_OPTIONS,
  adminCorreccionFilterLabel,
  adminCorreccionUxBanner,
  adminCorreccionUxStateLabel,
  isAdminCorreccionFilterActive,
  matchesAdminCorreccionFilter,
  needsAdminCorreccionUniversePipeline,
  paginateAdminFilteredItems,
} from "./admin-correccion-filter";
import {
  enrichAdminMesaWithCorreccionDetalle,
  mapWithConcurrency,
  selectAdminCorreccionRows,
  type AdminCorreccionEnrichedRow,
} from "./admin-correccion-enrich";
import { emptyAdminMesaSeguimientoFields } from "./metrics";
import type { AdminMesaEnvioEvent } from "./metrics";

function mesa(
  id: string,
  opts?: Partial<AdminMesaEnvioEvent>,
): AdminMesaEnvioEvent {
  return {
    expedienteId: id,
    fechaEnvioMesa: "2026-09-20T12:00:00.000Z",
    clienteNombre: `Cliente ${id}`,
    asesorId: "a1",
    asesorNombre: "SILVIA REYES",
    programa: "mejoravit",
    etapaActual: 5,
    subestado: "en_proceso",
    cicloEstado: "activo",
    ...emptyAdminMesaSeguimientoFields("2026-09-20T12:00:00.000Z"),
    etapaLabel: "Integración",
    ...opts,
  };
}

function detalleRaw(ux: string, motivo = "RFC DEL ESTADO DE CUENTA NO COINCIDE") {
  return {
    estado: "WAITING_ADVISOR",
    request_type: "correccion",
    request_at: "2026-09-22T21:19:00.000Z",
    items: [
      {
        type: "datos_generales",
        key: "rfc",
        label: "RFC",
        motivo,
        requested_at: "2026-09-22T21:19:00.000Z",
        action_target: "dg",
        local_status: "pendiente",
      },
      {
        type: "documento",
        key: "estado_cuenta",
        label: "Estado de cuenta",
        motivo: "EL ARCHIVO NO ES LEGIBLE",
        requested_at: "2026-09-22T21:19:00.000Z",
        action_target: "doc",
        local_status: "pendiente",
      },
    ],
    has_correction_activity_after_request: false,
    has_response_after_request: false,
    needs_resubmit: false,
    can_resubmit: false,
    ux_state: ux,
    blocking_reasons: [],
  };
}

describe("Admin filtro Corrección (ux_state canónico)", () => {
  it("mapea PENDIENTE_DE_CORREGIR", () => {
    assert.equal(
      adminCorreccionUxStateLabel("PENDIENTE_DE_CORREGIR"),
      "Pendiente de corregir",
    );
    assert.equal(
      adminCorreccionFilterLabel("PENDIENTE_DE_CORREGIR"),
      "Pendiente de corregir",
    );
    assert.equal(
      matchesAdminCorreccionFilter("PENDIENTE_DE_CORREGIR", "PENDIENTE_DE_CORREGIR"),
      true,
    );
  });

  it("mapea CAMBIOS_GUARDADOS_SIN_ENVIAR", () => {
    assert.equal(
      adminCorreccionUxStateLabel("CAMBIOS_GUARDADOS_SIN_ENVIAR"),
      "Falta reenviar",
    );
    assert.match(
      adminCorreccionUxBanner("CAMBIOS_GUARDADOS_SIN_ENVIAR") ?? "",
      /FALTA REENVIAR A MESA/,
    );
  });

  it("mapea CORRECCION_ENVIADA y NO la trata como pendiente", () => {
    assert.equal(
      adminCorreccionUxStateLabel("CORRECCION_ENVIADA"),
      "Reenviada / esperando Mesa",
    );
    assert.equal(
      matchesAdminCorreccionFilter("CORRECCION_ENVIADA", "PENDIENTE_DE_CORREGIR"),
      false,
    );
    assert.match(
      adminCorreccionUxBanner("CORRECCION_ENVIADA") ?? "",
      /ESPERANDO REVISIÓN DE MESA/,
    );
    assert.doesNotMatch(
      adminCorreccionUxBanner("CORRECCION_ENVIADA") ?? "",
      /debes corregir|Pendiente de corregir/i,
    );
  });

  it("Todas no activa filtro de corrección (flujo paginado actual)", () => {
    assert.equal(isAdminCorreccionFilterActive("todas"), false);
    assert.ok(ADMIN_CORRECCION_FILTER_OPTIONS[0]?.value === "todas");
  });

  it("Alcance default es periodo; pendientes actuales es opt-in", () => {
    assert.equal(ADMIN_CORRECCION_ALCANCE_OPTIONS[0]?.value, "periodo_seleccionado");
    assert.equal(
      needsAdminCorreccionUniversePipeline({
        filter: "todas",
        alcance: "periodo_seleccionado",
      }),
      false,
    );
    assert.equal(
      needsAdminCorreccionUniversePipeline({
        filter: "todas",
        alcance: "pendientes_actuales",
      }),
      true,
    );
  });

  it("paginateAdminFilteredItems pagina sobre el conjunto filtrado", () => {
    const items = Array.from({ length: 30 }, (_, i) => i + 1);
    const p1 = paginateAdminFilteredItems(items, 1, 25);
    assert.equal(p1.totalCount, 30);
    assert.equal(p1.items.length, 25);
    const p2 = paginateAdminFilteredItems(items, 2, 25);
    assert.deepEqual(p2.items, [26, 27, 28, 29, 30]);
  });
});

describe("enrich + selectAdminCorreccionRows", () => {
  it("filtra por cada ux_state y excluye reenviada de pendiente", async () => {
    const envios = [mesa("p"), mesa("c"), mesa("e"), mesa("n")];
    const map: Record<string, unknown> = {
      p: detalleRaw("PENDIENTE_DE_CORREGIR"),
      c: detalleRaw("CAMBIOS_GUARDADOS_SIN_ENVIAR"),
      e: detalleRaw("CORRECCION_ENVIADA"),
      n: null,
    };
    const enriched = await enrichAdminMesaWithCorreccionDetalle(
      envios,
      async (id) => parseAsesorCorreccionDetalle(map[id] ?? null),
      2,
    );
    assert.equal(
      selectAdminCorreccionRows(enriched, "PENDIENTE_DE_CORREGIR").map(
        (r) => r.mesa.expedienteId,
      ).join(","),
      "p",
    );
    assert.equal(
      selectAdminCorreccionRows(enriched, "CAMBIOS_GUARDADOS_SIN_ENVIAR").map(
        (r) => r.mesa.expedienteId,
      ).join(","),
      "c",
    );
    assert.equal(
      selectAdminCorreccionRows(enriched, "CORRECCION_ENVIADA").map(
        (r) => r.mesa.expedienteId,
      ).join(","),
      "e",
    );
    const todas = selectAdminCorreccionRows(enriched, "todas");
    assert.equal(todas.length, 3);
    assert.ok(!todas.some((r) => r.mesa.expedienteId === "n"));
  });

  it("fail-soft: error técnico no clasifica como pendiente", async () => {
    const enriched = await enrichAdminMesaWithCorreccionDetalle(
      [mesa("ok"), mesa("boom")],
      async (id) => {
        if (id === "boom") throw new Error("rpc down");
        return parseAsesorCorreccionDetalle(detalleRaw("PENDIENTE_DE_CORREGIR"));
      },
      5,
    );
    const boom = enriched.find((r) => r.mesa.expedienteId === "boom");
    assert.equal(boom?.readError, true);
    assert.equal(boom?.detalle, null);
    const selected = selectAdminCorreccionRows(enriched, "PENDIENTE_DE_CORREGIR");
    assert.deepEqual(
      selected.map((r) => r.mesa.expedienteId),
      ["ok"],
    );
  });

  it("mapWithConcurrency limita paralelismo", async () => {
    let inflight = 0;
    let max = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inflight += 1;
      max = Math.max(max, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight -= 1;
      return n;
    });
    assert.ok(max <= 2, `max inflight=${max}`);
  });

  it("repo parsea asesor_correccion_detalle (schema canónico)", () => {
    const d = parseAsesorCorreccionDetalle(detalleRaw("PENDIENTE_DE_CORREGIR"));
    assert.ok(d);
    assert.equal(d!.ux_state, "PENDIENTE_DE_CORREGIR");
    assert.equal(d!.items[0]?.label, "RFC");
    assert.equal(d!.items[0]?.motivo, "RFC DEL ESTADO DE CUENTA NO COINCIDE");
  });
});

describe("select respeta filtros globales vía conjunto exportAll (contrato)", () => {
  it("PDF/listado filtrado usa filas ya recortadas por asesor/etapa/periodo", () => {
    // Simula post-exportAll: solo quedan filas del asesor/etapa elegidos.
    const rows: AdminCorreccionEnrichedRow[] = [
      {
        mesa: mesa("silvia-int", {
          asesorId: "silvia",
          asesorNombre: "SILVIA REYES",
          etapaActual: 5,
          etapaLabel: "Integración",
        }),
        detalle: parseAsesorCorreccionDetalle(detalleRaw("PENDIENTE_DE_CORREGIR")),
        readError: false,
      },
      {
        mesa: mesa("otro", {
          asesorId: "otro",
          asesorNombre: "OTRO",
          etapaActual: 2,
          etapaLabel: "Validación",
        }),
        detalle: parseAsesorCorreccionDetalle(detalleRaw("PENDIENTE_DE_CORREGIR")),
        readError: false,
      },
    ];
    // Caller ya pasó exportAll con asesor=silvia → solo primera fila llega.
    const scoped = rows.filter((r) => r.mesa.asesorId === "silvia");
    const selected = selectAdminCorreccionRows(scoped, "PENDIENTE_DE_CORREGIR");
    assert.equal(selected.length, 1);
    assert.equal(selected[0]?.mesa.asesorNombre, "SILVIA REYES");
    assert.equal(selected[0]?.mesa.etapaLabel, "Integración");
  });
});
