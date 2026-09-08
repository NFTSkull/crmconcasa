"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AvanceOperativoEtapaView } from "@/domain/expedientes/mesa-avance-integracion";
import {
  formatPagoConcasaEtapaBadge,
  labelPagoConcasaResultado,
  MESA_PAGO_CONCASA_DECISION_COPY,
  type PagoConcasaResultado,
} from "@/domain/expedientes/pago-concasa-resultado";
import {
  fetchPagoConcasaEstado,
  registrarPagoConcasa,
  PagoConcasaPagosError,
  type PagoConcasaEstado,
  type PagoConcasaTipoMovimiento,
} from "@/domain/expedientes/pago-concasa-pagos";
import { MESA_AVISO_SIN_RECHAZO_DIRECTO } from "@/domain/expedientes/mesa-decision-ux";

export type MesaPagoConcasaDecisionSectionProps = Readonly<{
  decisionView: AvanceOperativoEtapaView;
  puedeOperar: boolean;
  loading: boolean;
  error: string | null;
  success: string | null;
  /** Compatibilidad P166: conserva la opción histórica No pagó. */
  onDecidir: (resultado: PagoConcasaResultado) => Promise<void>;
  etapaActual: number | null | undefined;
  resultadoFinal: PagoConcasaResultado | null | undefined;
  resultadoAt: string | null | undefined;
  formatDateTime?: (iso: string) => string;
}>;

const MXN = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? MXN.format(value) : "—";
}

export function MesaPagoConcasaDecisionSection({
  decisionView,
  puedeOperar,
  loading,
  error,
  success,
  onDecidir,
  etapaActual,
  resultadoFinal,
  resultadoAt,
  formatDateTime,
}: MesaPagoConcasaDecisionSectionProps) {
  const params = useParams<{ id: string }>();
  const expedienteId = String(params?.id ?? "").trim();
  const [confirmNoPagado, setConfirmNoPagado] = useState(false);
  const [estado, setEstado] = useState<PagoConcasaEstado | null>(null);
  const [estadoLoading, setEstadoLoading] = useState(false);
  const [estadoError, setEstadoError] = useState<string | null>(null);
  const [modo, setModo] = useState<PagoConcasaTipoMovimiento | null>(null);
  const [montoParcial, setMontoParcial] = useState("");
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const shouldLoad = decisionView.mostrar || etapaActual === 12;

  const refreshEstado = useCallback(async () => {
    if (!shouldLoad || !expedienteId) return;
    setEstadoLoading(true);
    setEstadoError(null);
    try {
      const next = await fetchPagoConcasaEstado(expedienteId);
      setEstado(next);
    } catch (err) {
      setEstadoError(
        err instanceof PagoConcasaPagosError
          ? err.message
          : "No se pudo consultar el estado de Pago a ConCasa.",
      );
    } finally {
      setEstadoLoading(false);
    }
  }, [expedienteId, shouldLoad]);

  useEffect(() => {
    void refreshEstado();
  }, [refreshEstado]);

  const saldo = estado?.saldoPendiente ?? null;
  const canAct =
    puedeOperar &&
    decisionView.puedeAvanzar &&
    !loading &&
    !saving &&
    estado?.puedeRegistrar === true;

  const parcialNumero = useMemo(() => {
    const n = Number(montoParcial);
    return Number.isFinite(n) ? n : null;
  }, [montoParcial]);

  const parcialValido =
    parcialNumero != null &&
    parcialNumero > 0 &&
    saldo != null &&
    parcialNumero < saldo &&
    notas.trim().length > 0;

  const handleRegistrar = useCallback(async () => {
    if (!expedienteId || !modo || saving) return;
    setSaveError(null);
    setSaveSuccess(null);

    if (modo === "parcial") {
      const monto = Number(montoParcial);
      if (!Number.isFinite(monto) || monto <= 0) {
        setSaveError("Captura un monto parcial mayor a cero.");
        return;
      }
      if (saldo == null || monto >= saldo) {
        setSaveError("El pago parcial debe ser menor al saldo pendiente. Para liquidar usa Pago total.");
        return;
      }
      if (!notas.trim()) {
        setSaveError("Las notas son obligatorias para registrar un pago parcial.");
        return;
      }
    }

    setSaving(true);
    try {
      const next = await registrarPagoConcasa(expedienteId, {
        tipo: modo,
        monto: modo === "parcial" ? Number(montoParcial) : null,
        notas: notas.trim() || null,
      });
      setEstado(next);
      setModo(null);
      setMontoParcial("");
      setNotas("");
      setSaveSuccess(
        modo === "parcial"
          ? `Pago parcial registrado. Saldo pendiente: ${money(next.saldoPendiente)}.`
          : "Pago total registrado. Expediente cerrado en Pago a ConCasa.",
      );
      if (next.finalizado && typeof window !== "undefined") {
        window.setTimeout(() => window.location.reload(), 250);
      }
    } catch (err) {
      setSaveError(
        err instanceof PagoConcasaPagosError
          ? err.message
          : "No se pudo registrar el pago a ConCasa.",
      );
    } finally {
      setSaving(false);
    }
  }, [expedienteId, modo, montoParcial, notas, saldo, saving]);

  const handleNoPagado = useCallback(() => {
    void onDecidir("no_pagado").finally(() => setConfirmNoPagado(false));
  }, [onDecidir]);

  const showFinal =
    etapaActual === 12 &&
    (resultadoFinal === "pagado" || resultadoFinal === "no_pagado");

  const resumen = estado?.montoObjetivo != null ? (
    <div className="mt-4 grid gap-2 sm:grid-cols-3" data-testid="mesa-pago-concasa-resumen">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Total a pagar</p>
        <p className="mt-1 text-base font-semibold text-slate-900">{money(estado.montoObjetivo)}</p>
      </div>
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Pagado acumulado</p>
        <p className="mt-1 text-base font-semibold text-emerald-900">{money(estado.pagadoAcumulado)}</p>
      </div>
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700">Saldo pendiente</p>
        <p className="mt-1 text-base font-semibold text-amber-950">{money(estado.saldoPendiente)}</p>
      </div>
    </div>
  ) : null;

  const historial = estado && estado.movimientos.length > 0 ? (
    <div className="mt-4 overflow-hidden rounded-md border border-slate-200" data-testid="mesa-pago-concasa-historial">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
        Historial de pagos
      </div>
      <div className="divide-y divide-slate-100">
        {estado.movimientos.map((mov) => (
          <div key={mov.id} className="px-3 py-3 text-xs text-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">
                {mov.tipo === "parcial" ? "Pago parcial" : "Pago total"} · {money(mov.monto)}
              </span>
              <span className="text-slate-500">
                {formatDateTime ? formatDateTime(mov.createdAt) : mov.createdAt}
              </span>
            </div>
            <p className="mt-1 text-slate-500">Saldo después: {money(mov.saldoDespues)}</p>
            {mov.notas ? <p className="mt-1 whitespace-pre-wrap text-slate-700">Notas: {mov.notas}</p> : null}
            {mov.actorNombre || mov.actorEmail ? (
              <p className="mt-1 text-slate-500">Registró: {mov.actorNombre ?? mov.actorEmail}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  ) : null;

  if (showFinal) {
    const label = labelPagoConcasaResultado(resultadoFinal);
    return (
      <section
        className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700"
        data-testid="mesa-pago-concasa-resultado"
        aria-label="Pago ConCasa"
      >
        <h2 className="text-sm font-semibold text-slate-900">Pago ConCasa</h2>
        <p className="mt-2 text-sm text-slate-800" data-testid="mesa-pago-concasa-resultado-label">
          Resultado: <span className="font-semibold">{label}</span>
        </p>
        {resultadoAt && formatDateTime ? (
          <p className="mt-1 text-xs text-slate-500" data-testid="mesa-pago-concasa-resultado-fecha">
            Registrado: {formatDateTime(resultadoAt)}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-slate-500">{formatPagoConcasaEtapaBadge(resultadoFinal)}</p>
        {estadoLoading ? <p className="mt-3 text-xs text-slate-500">Cargando detalle de pagos…</p> : null}
        {estadoError ? <p className="mt-3 text-xs text-amber-700">{estadoError}</p> : null}
        {resumen}
        {historial}
        {estado?.legacy ? (
          <p className="mt-3 text-xs text-slate-500">Pago final registrado con el flujo anterior; se conserva sin modificar su historial.</p>
        ) : null}
      </section>
    );
  }

  if (!decisionView.mostrar) return null;

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700"
      data-testid="mesa-pago-concasa-decision"
      aria-label={MESA_PAGO_CONCASA_DECISION_COPY.titulo}
    >
      <h2 className="text-sm font-semibold text-slate-900">Pago a ConCasa</h2>
      <p className="mt-1 text-sm text-slate-600">
        Registra un pago total o un pago parcial. Los parciales conservan el expediente en Firmado hasta liquidar el saldo.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        El total se calcula con el monto base y porcentaje de cobro ya definidos en el expediente.
      </p>
      <p className="mt-2 text-xs text-slate-500">{MESA_AVISO_SIN_RECHAZO_DIRECTO}</p>

      {estadoLoading ? <p className="mt-3 text-sm text-slate-500">Calculando saldo…</p> : null}
      {estadoError ? <p role="alert" className="mt-3 text-sm text-red-700">{estadoError}</p> : null}
      {resumen}
      {historial}

      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
      {success ? <p role="status" className="mt-3 text-sm text-emerald-700">{success}</p> : null}
      {saveError ? <p role="alert" className="mt-3 text-sm text-red-700">{saveError}</p> : null}
      {saveSuccess ? <p role="status" className="mt-3 text-sm text-emerald-700">{saveSuccess}</p> : null}

      {modo === "parcial" ? (
        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50/50 p-3" data-testid="mesa-pago-concasa-form-parcial">
          <p className="font-semibold text-slate-900">Pago parcial</p>
          <label className="mt-3 block text-xs font-medium text-slate-700" htmlFor="pago-concasa-monto-parcial">
            Monto pagado
          </label>
          <input
            id="pago-concasa-monto-parcial"
            type="number"
            min="0.01"
            step="0.01"
            value={montoParcial}
            disabled={saving}
            onChange={(e) => setMontoParcial(e.target.value)}
            placeholder="0.00"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 sm:max-w-xs"
          />
          <p className="mt-1 text-xs text-slate-500">Debe ser menor al saldo pendiente de {money(saldo)}.</p>
          <label className="mt-3 block text-xs font-medium text-slate-700" htmlFor="pago-concasa-notas-parcial">
            Notas del pago parcial *
          </label>
          <textarea
            id="pago-concasa-notas-parcial"
            value={notas}
            disabled={saving}
            maxLength={2000}
            rows={3}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Ej. Cliente entrega primer abono; queda pendiente el resto…"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" disabled={!canAct || !parcialValido} onClick={handleRegistrar}>
              {saving ? "Guardando…" : "Registrar pago parcial"}
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => { setModo(null); setSaveError(null); }}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : modo === "total" ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50/50 p-3" data-testid="mesa-pago-concasa-form-total">
          <p className="font-semibold text-slate-900">Pago total</p>
          <p className="mt-1 text-sm text-slate-700">
            Se registrará exactamente el saldo pendiente de <span className="font-semibold">{money(saldo)}</span> y el expediente pasará a Pago a ConCasa.
          </p>
          <label className="mt-3 block text-xs font-medium text-slate-700" htmlFor="pago-concasa-notas-total">
            Notas (opcional)
          </label>
          <textarea
            id="pago-concasa-notas-total"
            value={notas}
            disabled={saving}
            maxLength={2000}
            rows={2}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Comentario opcional del pago total"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" disabled={!canAct || saldo == null || saldo <= 0} onClick={handleRegistrar}>
              {saving ? "Guardando…" : `Confirmar pago total · ${money(saldo)}`}
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => { setModo(null); setSaveError(null); }}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : confirmNoPagado ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3" data-testid="mesa-pago-concasa-confirm-no-pagado">
          <p className="text-sm text-amber-950">¿Confirmas que no hubo pago? Esta opción conserva el comportamiento histórico y cierra el expediente como “No pagó”.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" disabled={loading} onClick={handleNoPagado}>{loading ? "Guardando…" : "Confirmar No pagó"}</Button>
            <Button type="button" variant="secondary" disabled={loading} onClick={() => setConfirmNoPagado(false)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!canAct}
            onClick={() => { setModo("total"); setNotas(""); setSaveError(null); }}
            data-testid="mesa-pago-concasa-total"
          >
            Pago total
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canAct || saldo == null || saldo <= 0.01}
            onClick={() => { setModo("parcial"); setMontoParcial(""); setNotas(""); setSaveError(null); }}
            data-testid="mesa-pago-concasa-parcial"
          >
            Pago parcial
          </Button>
          {estado?.pagadoAcumulado === 0 ? (
            <Button
              type="button"
              variant="secondary"
              disabled={!canAct}
              onClick={() => setConfirmNoPagado(true)}
              data-testid="mesa-pago-concasa-no-pago"
              className="border-amber-300 text-amber-950 hover:bg-amber-50"
            >
              No pagó
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
