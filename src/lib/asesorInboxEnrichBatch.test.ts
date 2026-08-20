import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listAsesorAgendaHintsByExpedienteIds } from "./asesorInboxEnrichBatch";
import { listRetencionHintsByExpedienteIds } from "./mesaBandejaAccionesEnrich";

type FakeRow = Record<string, unknown>;

function fakeClient(opts: {
  booked?: FakeRow[];
  cancelled?: FakeRow[];
  opciones?: FakeRow[];
  envios?: FakeRow[];
}) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      let statusFilter: string | null = null;
      chain.select = () => self();
      chain.in = () => self();
      chain.eq = (_col: string, val: string) => {
        if (_col === "status") statusFilter = val;
        return self();
      };
      chain.order = () => self();
      (chain as { then: (...args: unknown[]) => Promise<unknown> }).then = (
        onfulfilled?: unknown,
        onrejected?: unknown,
      ) => {
        const data =
          table === "agenda_bookings"
            ? statusFilter === "cancelled"
              ? (opts.cancelled ?? [])
              : (opts.booked ?? [])
            : table === "retencion_opciones"
              ? (opts.opciones ?? [])
              : table === "retencion_envios"
                ? (opts.envios ?? [])
                : [];
        return Promise.resolve({ data, error: null }).then(
          onfulfilled as ((v: unknown) => unknown) | undefined,
          onrejected as ((e: unknown) => unknown) | undefined,
        );
      };
      return chain;
    },
  } as never;
}

describe("P203 Asesor enrich batch AE5–AE7", () => {
  it("AE6 agenda batch matches individual flags", async () => {
    const client = fakeClient({
      booked: [
        { expediente_id: "e1", kind: "biometricos" },
        { expediente_id: "e2", kind: "firmas" },
      ],
      cancelled: [
        {
          expediente_id: "e1",
          kind: "firmas",
          cancelled_at: "2026-08-01T00:00:00Z",
        },
        {
          expediente_id: "e1",
          kind: "firmas",
          cancelled_at: "2026-07-01T00:00:00Z",
        },
      ],
    });
    const map = await listAsesorAgendaHintsByExpedienteIds(client, ["e1", "e2", "e3"]);
    assert.equal(map.get("e1")!.agendaBiometricos.hasActiveBooking, true);
    assert.equal(map.get("e1")!.agendaFirmas.hasLastCancelledBooking, true);
    assert.equal(map.get("e1")!.agendaFirmas.hasActiveBooking, false);
    assert.equal(map.get("e2")!.agendaFirmas.hasActiveBooking, true);
    assert.equal(map.get("e3")!.agendaBiometricos.hasActiveBooking, false);
  });

  it("AE7 retención batch", async () => {
    const client = fakeClient({
      opciones: [{ expediente_id: "e1", retencion_opcion: "con_sello" }],
      envios: [
        {
          expediente_id: "e1",
          enviado: true,
          opcion: "con_sello",
          estado: "correccion_requerida",
          fecha_envio_mesa: "2026-08-01T00:00:00Z",
        },
      ],
    });
    const map = await listRetencionHintsByExpedienteIds(client, ["e1", "e2"]);
    assert.equal(map.get("e1")!.opcion, "con_sello");
    assert.equal(map.get("e1")!.enviadoAMesa, true);
    assert.equal(map.get("e1")!.envioEstado, "correccion_requerida");
    assert.equal(map.get("e2")!.opcion, null);
    assert.equal(map.get("e2")!.fechaEnvioMesa, null);
  });
});
