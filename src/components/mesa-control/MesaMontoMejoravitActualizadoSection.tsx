"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { MesaMontoMejoravitActualizadoDialog } from "@/components/mesa-control/MesaMontoMejoravitActualizadoDialog";
import {
  actualizarMontoMejoravitMesa,
  calculateMontoDifference,
  describeMontoDifference,
  formatDateTimeEsMx,
  formatMoneyMx,
  getExpedienteMontoMejoravitContext,
  hasMesaMontoOverride,
  MontoMejoravitSupabaseError,
  MONTO_MEJORAVIT_CONCURRENCY_MESSAGE,
  shouldShowMesaMontoUpdateButton,
  type ExpedienteMontoMejoravitContext,
} from "@/domain/monto-mejoravit-actualizado";

export type MesaMontoMejoravitActualizadoSectionProps = Readonly<{
  expedienteId: string;
  /** Refresco del detalle padre (p. ej. cobro en Datos Generales). */
  onParentRefresh?: () => void | Promise<void>;
}>;

export function MesaMontoMejoravitActualizadoSection({
  expedienteId,
  onParentRefresh,
}: MesaMontoMejoravitActualizadoSectionProps) {
  const [context, setContext] = useState<ExpedienteMontoMejoravitContext | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const updateButtonRef = useRef<HTMLButtonElement>(null);
  const savingLockRef = useRef(false);

  const loadContext = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const ctx = await getExpedienteMontoMejoravitContext(expedienteId);
      setContext(ctx);
    } catch (err) {
      const message =
        err instanceof MontoMejoravitSupabaseError
          ? err.message
          : "No se pudo cargar el contexto de monto Mejoravit.";
      setLoadError(message);
      setContext(null);
    } finally {
      setLoading(false);
    }
  }, [expedienteId]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const openDialog = () => {
    if (!context) return;
    if (context.porcentajeCobro == null) {
      setWriteError(
        "No existe un porcentaje de cobro registrado. Debe capturarse antes de actualizar el monto.",
      );
      return;
    }
    setWriteError(null);
    setSuccessMsg(null);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
    setWriteError(null);
    window.setTimeout(() => updateButtonRef.current?.focus(), 0);
  };

  const handleConfirm = async (input: Readonly<{
    montoNuevo: number;
    motivo: string;
  }>) => {
    if (savingLockRef.current) return;
    savingLockRef.current = true;
    setSaving(true);
    setWriteError(null);
    try {
      const result = await actualizarMontoMejoravitMesa({
        expedienteId,
        montoNuevo: input.montoNuevo,
        motivo: input.motivo,
      });
      setSuccessMsg(
        `Monto actualizado a ${formatMoneyMx(result.montoNuevo)}. Cobro: ${formatMoneyMx(result.montoCobroNuevo)}.`,
      );
      setDialogOpen(false);
      await loadContext();
      if (onParentRefresh) {
        await onParentRefresh();
      }
      window.setTimeout(() => updateButtonRef.current?.focus(), 0);
    } catch (err) {
      const message =
        err instanceof MontoMejoravitSupabaseError
          ? err.message
          : "No se pudo actualizar el monto Mejoravit.";
      setWriteError(message);
      if (message === MONTO_MEJORAVIT_CONCURRENCY_MESSAGE) {
        await loadContext();
      }
    } finally {
      savingLockRef.current = false;
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section
        aria-busy="true"
        className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600"
      >
        Cargando monto actualizado Mejoravit…
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        <p role="alert">{loadError}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-2 text-xs"
          onClick={() => void loadContext()}
        >
          Reintentar lectura
        </Button>
      </section>
    );
  }

  if (!context) return null;

  const override = hasMesaMontoOverride(context);
  const diffVsOriginal =
    context.montoOperativoVigente != null &&
    context.montoOriginalOperativo != null
      ? describeMontoDifference(
          calculateMontoDifference(
            context.montoOperativoVigente,
            context.montoOriginalOperativo,
          ),
        )
      : null;

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white px-4 py-4 text-sm text-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Monto actualizado Mejoravit
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Independiente de Datos Generales. No modifica el monto aprobado del editor.
          </p>
        </div>
        {override ? (
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-900">
            Actualizado por Mesa
            {diffVsOriginal && diffVsOriginal.kind !== "igual"
              ? ` · ${diffVsOriginal.kind === "aumento" ? "Aumento" : "Disminución"}`
              : ""}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-700">
            Sin actualización de Mesa
          </span>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Info
          label="Monto original operativo"
          value={
            context.montoOriginalOperativo != null
              ? formatMoneyMx(context.montoOriginalOperativo)
              : "—"
          }
        />
        <Info
          label="Monto vigente Mejoravit"
          value={
            context.montoOperativoVigente != null
              ? formatMoneyMx(context.montoOperativoVigente)
              : "—"
          }
        />
        <Info
          label="Monto aprobado por editor (referencia)"
          value={
            context.montoAprobadoEditor != null
              ? formatMoneyMx(context.montoAprobadoEditor)
              : "—"
          }
        />
        <Info
          label="Porcentaje de cobro"
          value={
            context.porcentajeCobro != null
              ? `${context.porcentajeCobro}%`
              : "—"
          }
        />
        <Info label="Cargo fijo" value={formatMoneyMx(context.cargoFijo)} />
        <Info
          label="Monto de cobro vigente"
          value={
            context.montoCalculado != null
              ? formatMoneyMx(context.montoCalculado)
              : "—"
          }
        />
        <Info
          label="Diferencia vs original"
          value={
            diffVsOriginal && diffVsOriginal.kind !== "igual"
              ? `${diffVsOriginal.signedLabel} (${diffVsOriginal.proseLabel})`
              : override
                ? formatMoneyMx(0)
                : "—"
          }
        />
        <Info
          label="Última actualización"
          value={
            context.ultimaActualizacion
              ? formatDateTimeEsMx(context.ultimaActualizacion.updatedAt)
              : "—"
          }
        />
        <Info
          label="Actualizado por"
          value={context.ultimaActualizacion?.updatedByName?.trim() || "—"}
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <Info
            label="Motivo"
            value={context.ultimaActualizacion?.motivo?.trim() || "—"}
          />
        </div>
      </dl>

      {successMsg ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          {successMsg}
        </p>
      ) : null}

      {writeError && !dialogOpen ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {writeError}
        </p>
      ) : null}

      {shouldShowMesaMontoUpdateButton(context) ? (
        <div>
          <Button
            ref={updateButtonRef}
            type="button"
            variant="primary"
            onClick={openDialog}
            disabled={saving}
          >
            Actualizar monto
          </Button>
        </div>
      ) : null}

      <div className="border-t border-gray-100 pt-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Historial de actualizaciones
        </h4>
        {context.historial.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            Todavía no existen actualizaciones de monto realizadas por Mesa.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {context.historial.map((entry) => {
              const d = describeMontoDifference(entry.diferencia);
              return (
                <li
                  key={entry.id}
                  className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700"
                >
                  <p className="font-medium text-gray-900">
                    {formatDateTimeEsMx(entry.createdAt)}
                    {" · "}
                    {entry.createdByName?.trim() || "Usuario Mesa"}
                  </p>
                  <p className="mt-1">
                    {formatMoneyMx(entry.montoAnterior)} →{" "}
                    {formatMoneyMx(entry.montoNuevo)}{" "}
                    <span className="text-gray-600">
                      ({d.signedLabel} · {d.proseLabel})
                    </span>
                  </p>
                  <p className="mt-0.5">
                    % {entry.porcentajeCobro} · Cobro{" "}
                    {entry.montoCobroAnterior != null
                      ? formatMoneyMx(entry.montoCobroAnterior)
                      : "—"}{" "}
                    → {formatMoneyMx(entry.montoCobroNuevo)}
                  </p>
                  <p className="mt-0.5 text-gray-600">Motivo: {entry.motivo}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <MesaMontoMejoravitActualizadoDialog
        key={dialogKey}
        open={dialogOpen}
        context={context}
        saving={saving}
        error={writeError}
        onClose={closeDialog}
        onConfirm={(input) => void handleConfirm(input)}
      />
    </section>
  );
}

function Info({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-gray-900">{value}</dd>
    </div>
  );
}
