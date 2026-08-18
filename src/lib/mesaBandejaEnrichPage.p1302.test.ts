import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos";
import { enrichMesaBandejaPageItems } from "./mesaBandejaEnrichPage";
import type { MesaCorreccionSolicitudHistorica } from "./mesaAsesorCambiosUi";

const EXP_HIST = "00000000-0000-4000-8000-0000000000e1";
const EXP_LOTE = "00000000-0000-4000-8000-0000000000e2";
const EXP_ESPERA = "00000000-0000-4000-8000-0000000000e3";

function resumen(
  expedienteId: string,
  id: string,
  estatus: ExpedienteArchivoResumen["estatus_revision"],
  createdAt: string,
  comentario: string | null = null,
): ExpedienteArchivoResumen {
  return {
    expediente_id: expedienteId,
    tipo_documento: "ine",
    id,
    nombre_original: "ine.pdf",
    mime_type: "application/pdf",
    size_bytes: 10,
    created_at: createdAt,
    uploaded_by_role: "asesor",
    uploaded_by_email: "a@b.c",
    estatus_revision: estatus,
    comentario_mesa: comentario,
  };
}

describe("enrichMesaBandejaPageItems P130.2", () => {
  it("histórico sin lote recibe motivo canónico; lote conserva P130; espera asesor intacta", async () => {
    let solicitudCalls = 0;
    const items = await enrichMesaBandejaPageItems(
      [
        {
          id: EXP_HIST,
          cliente_nombre: "Histórico",
          telefono_cliente: "8111111111",
          programa: "mejoravit",
          etapaActual: 2,
          subestado: "en_proceso",
          fechaEnvioMesa: "2026-07-10T10:00:00.000Z",
        },
        {
          id: EXP_LOTE,
          cliente_nombre: "Con lote",
          telefono_cliente: "8111111112",
          programa: "mejoravit",
          etapaActual: 2,
          subestado: "en_proceso",
          fechaEnvioMesa: "2026-07-10T10:00:00.000Z",
        },
        {
          id: EXP_ESPERA,
          cliente_nombre: "Espera asesor",
          telefono_cliente: "8111111113",
          programa: "mejoravit",
          etapaActual: 2,
          subestado: "en_proceso",
          fechaEnvioMesa: "2026-07-10T10:00:00.000Z",
        },
      ],
      {
        mesaUserId: null,
        listResumenBatchByExpedienteIds: async () => ({
          [EXP_HIST]: [
            resumen(
              EXP_HIST,
              "00000000-0000-4000-8000-0000000000d1",
              "resubido",
              "2026-07-21T12:00:00.000Z",
            ),
            {
              ...resumen(
                EXP_HIST,
                "00000000-0000-4000-8000-0000000000d4",
                "validado",
                "2026-07-10T10:00:00.000Z",
              ),
              tipo_documento: "estado_cuenta",
            },
            {
              ...resumen(
                EXP_HIST,
                "00000000-0000-4000-8000-0000000000d5",
                "validado",
                "2026-07-10T10:00:00.000Z",
              ),
              tipo_documento: "nss",
            },
            {
              ...resumen(
                EXP_HIST,
                "00000000-0000-4000-8000-0000000000d6",
                "validado",
                "2026-07-10T10:00:00.000Z",
              ),
              tipo_documento: "direccion",
            },
          ],
          [EXP_LOTE]: [
            resumen(
              EXP_LOTE,
              "00000000-0000-4000-8000-0000000000d2",
              "resubido",
              "2026-07-21T13:00:00.000Z",
            ),
            {
              ...resumen(
                EXP_LOTE,
                "00000000-0000-4000-8000-0000000000d7",
                "validado",
                "2026-07-10T10:00:00.000Z",
              ),
              tipo_documento: "estado_cuenta",
            },
            {
              ...resumen(
                EXP_LOTE,
                "00000000-0000-4000-8000-0000000000d8",
                "validado",
                "2026-07-10T10:00:00.000Z",
              ),
              tipo_documento: "nss",
            },
            {
              ...resumen(
                EXP_LOTE,
                "00000000-0000-4000-8000-0000000000d9",
                "validado",
                "2026-07-10T10:00:00.000Z",
              ),
              tipo_documento: "direccion",
            },
          ],
          [EXP_ESPERA]: [
            resumen(
              EXP_ESPERA,
              "00000000-0000-4000-8000-0000000000d3",
              "rechazado",
              "2026-07-20T10:00:00.000Z",
              "Imagen borrosa",
            ),
            {
              ...resumen(
                EXP_ESPERA,
                "00000000-0000-4000-8000-0000000000da",
                "validado",
                "2026-07-10T10:00:00.000Z",
              ),
              tipo_documento: "estado_cuenta",
            },
            {
              ...resumen(
                EXP_ESPERA,
                "00000000-0000-4000-8000-0000000000db",
                "validado",
                "2026-07-10T10:00:00.000Z",
              ),
              tipo_documento: "nss",
            },
            {
              ...resumen(
                EXP_ESPERA,
                "00000000-0000-4000-8000-0000000000dc",
                "validado",
                "2026-07-10T10:00:00.000Z",
              ),
              tipo_documento: "direccion",
            },
          ],
        }),
        listEstadoBatchByExpedienteIds: async () => ({}),
        listAsesorCambiosSummaryByExpedienteIds: async () =>
          new Map([
            [
              EXP_LOTE,
              {
                expedienteId: EXP_LOTE,
                batchId: "00000000-0000-4000-8000-0000000000b1",
                status: "pendiente_revision" as const,
                submittedAt: "2026-07-21T13:00:00.000Z",
                changesCount: 2,
                summary: ["INE frente reemplazado", "RFC actualizado"],
              },
            ],
          ]),
        listCorreccionSolicitudHistoricaByExpedienteIds: async (ids) => {
          solicitudCalls += 1;
          assert.deepEqual([...ids], [EXP_HIST]);
          const soli: MesaCorreccionSolicitudHistorica = {
            correctionRequestedReason: "Imagen borrosa",
            correctionRequestedNote: null,
            correctionRequestedAt: "2026-07-20T15:00:00.000Z",
            correctionRequestedByName: "Keyla",
            correctionRequestedById: "00000000-0000-4000-8000-0000000000aa",
            correctionResubmittedAt: "2026-07-21T12:00:00.000Z",
          };
          return new Map([[EXP_HIST, soli]]);
        },
      },
    );

    assert.equal(solicitudCalls, 1);

    const hist = items.find((x) => x.id === EXP_HIST)!;
    assert.equal(hist.resumenDocumental, "correccion_enviada");
    assert.equal(hist.advisorChangeBatchId, null);
    assert.equal(hist.correctionRequestedReason, "Imagen borrosa");
    assert.equal(hist.correctionRequestedByName, "Keyla");
    assert.equal(hist.correctionRequestedAt, "2026-07-20T15:00:00.000Z");
    assert.equal(hist.correctionResubmittedAt, "2026-07-21T12:00:00.000Z");

    const lote = items.find((x) => x.id === EXP_LOTE)!;
    assert.equal(lote.resumenDocumental, "correccion_enviada");
    assert.equal(
      lote.advisorChangeBatchId,
      "00000000-0000-4000-8000-0000000000b1",
    );
    assert.equal(lote.advisorChangesCount, 2);
    assert.deepEqual(lote.advisorChangesSummary, [
      "INE frente reemplazado",
      "RFC actualizado",
    ]);
    assert.equal(lote.correctionRequestedReason, null);

    const espera = items.find((x) => x.id === EXP_ESPERA)!;
    assert.equal(espera.resumenDocumental, "correccion_requerida");
    assert.equal(espera.correctionRequestedReason, null);
    assert.equal(espera.advisorChangeBatchId, null);
  });

  it("cliente_* subido + lote P130 pendiente → correccion_enviada (sin resubido)", async () => {
    const expId = "00000000-0000-4000-8000-0000000000e4";
    const items = await enrichMesaBandejaPageItems(
      [
        {
          id: expId,
          cliente_nombre: "P130 subido",
          telefono_cliente: "8111111114",
          programa: "mejoravit",
          etapaActual: 11,
          subestado: "en_proceso",
          fechaEnvioMesa: "2026-07-10T10:00:00.000Z",
        },
      ],
      {
        mesaUserId: null,
        listResumenBatchByExpedienteIds: async () => ({
          [expId]: [
            {
              expediente_id: expId,
              tipo_documento: "cliente_comprobante_domicilio",
              id: "00000000-0000-4000-8000-0000000000d9",
              nombre_original: "dom.pdf",
              mime_type: "application/pdf",
              size_bytes: 10,
              created_at: "2026-07-21T12:00:00.000Z",
              uploaded_by_role: "asesor",
              uploaded_by_email: "a@b.c",
              estatus_revision: "subido",
              comentario_mesa: null,
            },
          ],
        }),
        listEstadoBatchByExpedienteIds: async () => ({
          [expId]: { estado: "rechazado", updatedAt: null, validatedAt: null },
        }),
        listAsesorCambiosSummaryByExpedienteIds: async () =>
          new Map([
            [
              expId,
              {
                expedienteId: expId,
                batchId: "00000000-0000-4000-8000-0000000000b2",
                status: "pendiente_revision" as const,
                submittedAt: "2026-07-21T13:00:00.000Z",
                changesCount: 1,
                summary: ["Comprobante de domicilio reemplazado"],
              },
            ],
          ]),
      },
    );
    assert.equal(items[0]?.resumenDocumental, "correccion_enviada");
    assert.equal(items[0]?.ultimaCorreccionEnviadaAt, "2026-07-21T13:00:00.000Z");
    assert.equal(items[0]?.etapaActual, 11);
  });
});
