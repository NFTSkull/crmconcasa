"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  deriveMesaMovimientoAdvertencias,
  esElegibleRechazoOperativoPostBiometricos,
  getMesaControlManualEstado,
  getMesaMovimientoDireccion,
  mesaMovimientoInputSchema,
  mensajeAdvertenciaMotivoPareceRechazo,
  motivoManualPareceRechazo,
  MESA_MOVIMIENTO_NO_ES_RECHAZO_COPY,
  MESA_RECHAZO_OPERATIVO_ANCHOR_ID,
  MESA_RECHAZO_OPERATIVO_ATAJO_LABEL,
  puedeConfirmarMovimientoMesa,
  useExpedientesRepo,
  type MesaMovimientoHistorialRow,
} from "@/domain/expedientes";
import { mapEtapaInternaAPasoVisual } from "@/domain/expedientes/asesor-seguimiento-operativo";
import {
  formatEtapaMesaLabel,
  formatPasoOperativoLabel,
  opcionesMovimientoManualPaso,
} from "@/domain/expedientes/etapa-numeracion-ux";

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

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function scrollToRechazoOperativo() {
  document
    .getElementById(MESA_RECHAZO_OPERATIVO_ANCHOR_ID)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  /** Destino interno canónico; null = placeholder «Selecciona otro paso». */
  const [destino, setDestino] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly MesaMovimientoHistorialRow[]>(
    [],
  );

  const estado = getMesaControlManualEstado({
    role,
    submittedToMesa,
    cicloEstado,
    subestado,
  });
  const visible = estado.visible;
  const habilitado = estado.habilitado;

  const pasoActualVisual = mapEtapaInternaAPasoVisual(etapaActual);
  const opcionesDestino = useMemo(
    () =>
      opcionesMovimientoManualPaso({
        excluirPasoVisualActual: pasoActualVisual,
      }),
    [pasoActualVisual],
  );

  const elegibleRechazoOperativo = esElegibleRechazoOperativoPostBiometricos({
    submittedToMesa,
    cicloEstado,
    subestado,
    etapaActual,
  });
  const motivoPareceRechazo = motivoManualPareceRechazo(motivo);

  const loadHistory = useCallback(async () => {
    if (!visible) return;
    try {
      setHistory(await repo.listMesaMovimientos(expedienteId));
    } catch {
      setHistory([]);
    }
  }, [expedienteId, repo, visible]);

  useEffect(() => {
    setDestino(null);
    setConfirming(false);
    void loadHistory();
  }, [etapaActual, loadHistory]);

  const warnings = useMemo(
    () =>
      destino == null
        ? []
        : deriveMesaMovimientoAdvertencias({
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
    destino == null
      ? null
      : getMesaMovimientoDireccion(etapaActual, destino);
  const parsedInput =
    destino == null
      ? null
      : mesaMovimientoInputSchema.safeParse({
          etapaDestino: destino,
          etapaEsperada: etapaActual,
          motivo,
        });
  const canConfirm =
    habilitado &&
    destino != null &&
    puedeConfirmarMovimientoMesa({
      etapaActual,
      etapaDestino: destino,
      motivo,
      saving,
    });
  const controlsDisabled = saving || !habilitado;

  async function handleConfirm() {
    if (!habilitado || !parsedInput?.success || !canConfirm || destino == null) {
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await repo.mesaMoverEtapaOperativa(
        expedienteId,
        parsedInput.data,
      );
      setSuccess(
        `Movimiento registrado: ${formatPasoOperativoLabel(result.etapa_anterior)} → ${formatPasoOperativoLabel(result.etapa_actual)}.`,
      );
      setMotivo("");
      setDestino(null);
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
    <section
      id="mesa-movimiento-manual"
      data-testid="mesa-movimiento-manual"
      className="scroll-mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4"
    >
      <div>
        <h2 className="text-base font-semibold text-amber-950">
          Movimiento manual de Mesa
        </h2>
        <p className="mt-1 text-xs text-amber-900">
          Esta opción permite cambiar la etapa sin cumplir los requisitos del
          avance normal. No elimina documentos, citas, bookings, montos ni
          historial.
        </p>
        <p
          role="note"
          data-testid="mesa-movimiento-no-es-rechazo"
          className="mt-2 rounded-md border border-amber-400 bg-white px-3 py-2 text-xs font-medium text-amber-950"
        >
          {MESA_MOVIMIENTO_NO_ES_RECHAZO_COPY}
        </p>
        <p className="mt-2 text-xs font-medium text-amber-950">
          Paso actual: {formatEtapaMesaLabel(etapaActual)}
        </p>
      </div>

      {!habilitado && estado.razon ? (
        <p
          role="status"
          data-testid="mesa-movimiento-manual-razon"
          className="mt-3 rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800"
        >
          Movimiento manual no disponible: {estado.razon}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-gray-800">
          Paso destino
          <select
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:bg-gray-100"
            value={destino == null ? "" : String(destino)}
            disabled={controlsDisabled}
            data-testid="mesa-movimiento-paso-destino"
            onChange={(event) => {
              const raw = event.target.value;
              setDestino(raw === "" ? null : Number(raw));
              setConfirming(false);
              setError(null);
            }}
          >
            <option value="">Selecciona otro paso</option>
            {opcionesDestino.map((opcion) => (
              <option
                key={opcion.pasoVisual}
                value={opcion.etapaInternaDestino}
              >
                {opcion.label}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
          <span className="font-medium">Tipo de movimiento:</span>{" "}
          {direction ?? "Selecciona otro paso"}
          {destino != null ? (
            <p className="mt-1 text-xs text-gray-600">
              Destino: {formatPasoOperativoLabel(destino)}
            </p>
          ) : null}
        </div>
      </div>

      <label className="mt-3 block text-sm font-medium text-gray-800">
        Motivo obligatorio
        <textarea
          className="mt-1 min-h-20 w-full rounded-md border border-gray-300 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:bg-gray-100"
          maxLength={500}
          value={motivo}
          disabled={controlsDisabled}
          onChange={(event) => {
            setMotivo(event.target.value);
            setConfirming(false);
          }}
        />
        <span className="text-xs text-gray-500">{motivo.length}/500</span>
      </label>

      {motivoPareceRechazo ? (
        <div
          role="status"
          data-testid="mesa-movimiento-motivo-parece-rechazo"
          className="mt-3 rounded-md border border-red-300 bg-red-50 p-3"
        >
          <p className="text-xs font-semibold text-red-950">
            Advertencia: esto no es un rechazo
          </p>
          <p className="mt-1 text-xs text-red-900">
            {mensajeAdvertenciaMotivoPareceRechazo(elegibleRechazoOperativo)}
          </p>
          {elegibleRechazoOperativo ? (
            <Button
              type="button"
              variant="outline"
              className="mt-2 border-red-300 text-xs text-red-800"
              data-testid="mesa-movimiento-atajo-rechazo"
              onClick={scrollToRechazoOperativo}
            >
              {MESA_RECHAZO_OPERATIVO_ATAJO_LABEL}
            </Button>
          ) : null}
        </div>
      ) : null}

      {elegibleRechazoOperativo && !motivoPareceRechazo ? (
        <div
          data-testid="mesa-movimiento-atajo-rechazo-disponible"
          className="mt-3 rounded-md border border-red-200 bg-white p-3"
        >
          <p className="text-xs text-gray-800">
            Si debes rechazar el expediente en el paso actual (
            {formatEtapaMesaLabel(etapaActual)}), usa el rechazo operativo
            canónico (no este movimiento).
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-2 border-red-300 text-xs text-red-800"
            data-testid="mesa-movimiento-atajo-rechazo"
            onClick={scrollToRechazoOperativo}
          >
            {MESA_RECHAZO_OPERATIVO_ATAJO_LABEL}
          </Button>
        </div>
      ) : null}

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
          Mover manualmente de etapa
        </Button>
      ) : (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-900">
            Este movimiento manual omitirá los requisitos normales de la etapa.
            No se borrarán documentos, citas, bookings, montos ni historial.
          </p>
          <p className="mt-1 text-xs text-red-800">
            Tampoco registrará un rechazo operativo ni cambiará el subestado a
            «rechazado».
          </p>
          {motivoPareceRechazo ? (
            <p
              role="status"
              data-testid="mesa-movimiento-confirm-parece-rechazo"
              className="mt-2 rounded-md border border-red-300 bg-white px-2 py-1.5 text-xs font-medium text-red-900"
            >
              {mensajeAdvertenciaMotivoPareceRechazo(elegibleRechazoOperativo)}
            </p>
          ) : null}
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
                  {formatPasoOperativoLabel(item.etapa_origen)} →{" "}
                  {formatPasoOperativoLabel(item.etapa_destino)} ·{" "}
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
