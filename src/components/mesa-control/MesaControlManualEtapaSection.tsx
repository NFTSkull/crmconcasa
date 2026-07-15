"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  deriveMesaMovimientoAdvertencias,
  getMesaMovimientoDireccion,
  mesaMovimientoInputSchema,
  puedeConfirmarMovimientoMesa,
  puedeMostrarControlManualMesa,
  useExpedientesRepo,
  type MesaMovimientoHistorialRow,
} from "@/domain/expedientes";
import { ETAPAS_OPERATIVAS_ASESOR } from "@/domain/expedientes/asesor-seguimiento-operativo";

type Props = Readonly<{
  expedienteId: string;
  etapaActual: number;
  role: string | null;
  submittedToMesa: boolean;
  cicloEstado: string | null;
  subestado: string | null;
  hasBiometricBooking: boolean;
  hasFirmasBooking: boolean;
  hasMonto: boolean;
  hasMissingDocuments: boolean;
  hasRetencion: boolean;
  hasValidatedData: boolean;
  onRefresh: () => void;
}>;

function etapaNombre(etapa: number): string {
  return (
    ETAPAS_OPERATIVAS_ASESOR.find((item) => item.id === etapa)?.nombre ??
    `Etapa ${etapa}`
  );
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function MesaControlManualEtapaSection({
  expedienteId,
  etapaActual,
  role,
  submittedToMesa,
  cicloEstado,
  subestado,
  hasBiometricBooking,
  hasFirmasBooking,
  hasMonto,
  hasMissingDocuments,
  hasRetencion,
  hasValidatedData,
  onRefresh,
}: Props) {
  const repo = useExpedientesRepo();
  const [destino, setDestino] = useState(etapaActual);
  const [motivo, setMotivo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly MesaMovimientoHistorialRow[]>(
    [],
  );

  const visible = puedeMostrarControlManualMesa({
    role,
    submittedToMesa,
    cicloEstado,
    subestado,
  });

  const loadHistory = useCallback(async () => {
    if (!visible) return;
    try {
      setHistory(await repo.listMesaMovimientos(expedienteId));
    } catch {
      setHistory([]);
    }
  }, [expedienteId, repo, visible]);

  useEffect(() => {
    setDestino(etapaActual);
    setConfirming(false);
    void loadHistory();
  }, [etapaActual, loadHistory]);

  const warnings = useMemo(
    () =>
      deriveMesaMovimientoAdvertencias({
        etapaActual,
        etapaDestino: destino,
        hasBiometricBooking,
        hasFirmasBooking,
        hasMonto,
        hasMissingDocuments,
        hasRetencion,
        hasValidatedData,
      }),
    [
      destino,
      etapaActual,
      hasBiometricBooking,
      hasFirmasBooking,
      hasMissingDocuments,
      hasMonto,
      hasRetencion,
      hasValidatedData,
    ],
  );

  if (!visible) return null;

  const direction =
    destino === etapaActual
      ? null
      : getMesaMovimientoDireccion(etapaActual, destino);
  const parsedInput = mesaMovimientoInputSchema.safeParse({
    etapaDestino: destino,
    etapaEsperada: etapaActual,
    motivo,
  });
  const canConfirm = puedeConfirmarMovimientoMesa({
    etapaActual,
    etapaDestino: destino,
    motivo,
    saving,
  });

  async function handleConfirm() {
    if (!parsedInput.success || !canConfirm) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await repo.mesaMoverEtapaOperativa(
        expedienteId,
        parsedInput.data,
      );
      setSuccess(
        `Movimiento registrado: etapa ${result.etapa_anterior} → ${result.etapa_actual}.`,
      );
      setMotivo("");
      setConfirming(false);
      await loadHistory();
      onRefresh();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "No se pudo realizar el movimiento manual.";
      setError(message);
      if (message.includes("La etapa cambió")) onRefresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div>
        <h2 className="text-base font-semibold text-amber-950">
          Control manual de etapa
        </h2>
        <p className="mt-1 text-xs text-amber-900">
          Etapa actual: {etapaActual}. {etapaNombre(etapaActual)}
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-gray-800">
          Etapa destino
          <select
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2"
            value={destino}
            disabled={saving}
            onChange={(event) => {
              setDestino(Number(event.target.value));
              setConfirming(false);
              setError(null);
            }}
          >
            {ETAPAS_OPERATIVAS_ASESOR.map((etapa) => (
              <option key={etapa.id} value={etapa.id}>
                {etapa.id}. {etapa.nombre}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
          <span className="font-medium">Tipo de movimiento:</span>{" "}
          {direction ?? "Selecciona otra etapa"}
          {destino !== etapaActual ? (
            <p className="mt-1 text-xs text-gray-600">
              Destino: {destino}. {etapaNombre(destino)}
            </p>
          ) : null}
        </div>
      </div>

      <label className="mt-3 block text-sm font-medium text-gray-800">
        Motivo obligatorio
        <textarea
          className="mt-1 min-h-20 w-full rounded-md border border-gray-300 bg-white px-3 py-2"
          maxLength={500}
          value={motivo}
          disabled={saving}
          onChange={(event) => {
            setMotivo(event.target.value);
            setConfirming(false);
          }}
        />
        <span className="text-xs text-gray-500">{motivo.length}/500</span>
      </label>

      {warnings.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-white p-3">
          <p className="text-xs font-semibold text-amber-950">
            Advertencias informativas (no bloquean)
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-900">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!confirming ? (
        <Button
          type="button"
          className="mt-3"
          disabled={!canConfirm}
          onClick={() => setConfirming(true)}
        >
          Revisar movimiento
        </Button>
      ) : (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-900">
            Este movimiento manual omitirá los requisitos normales de la etapa.
            No se borrarán documentos, citas, bookings, montos ni historial.
          </p>
          {destino === 11 || destino === 12 ? (
            <p className="mt-1 text-xs text-red-800">
              Cambiar la etapa no registra automáticamente una firma o un pago.
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              disabled={saving}
              onClick={() => void handleConfirm()}
            >
              {saving ? "Guardando…" : "Confirmar movimiento"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setConfirming(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="mt-3 text-sm text-green-700">
          {success}
        </p>
      ) : null}

      <div className="mt-5 border-t border-amber-200 pt-4">
        <h3 className="text-sm font-semibold text-gray-900">
          Historial de movimientos manuales
        </h3>
        {history.length === 0 ? (
          <p className="mt-2 text-xs text-gray-600">
            No hay movimientos manuales registrados.
          </p>
        ) : (
          <ol className="mt-2 space-y-2">
            {history.map((item) => (
              <li
                key={item.id}
                className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700"
              >
                <p className="font-medium text-gray-900">
                  {item.etapa_origen} → {item.etapa_destino} ·{" "}
                  {formatCreatedAt(item.created_at)}
                </p>
                <p className="mt-1">{item.motivo}</p>
                <p className="mt-1 text-gray-500">
                  {item.actor_role} · {item.subestado_origen} →{" "}
                  {item.subestado_destino}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
