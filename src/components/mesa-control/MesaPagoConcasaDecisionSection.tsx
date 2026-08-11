"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AvanceOperativoEtapaView } from "@/domain/expedientes/mesa-avance-integracion";
import {
  formatPagoConcasaEtapaBadge,
  labelPagoConcasaResultado,
  MESA_PAGO_CONCASA_DECISION_COPY,
  type PagoConcasaResultado,
} from "@/domain/expedientes/pago-concasa-resultado";
import { MESA_AVISO_SIN_RECHAZO_DIRECTO } from "@/domain/expedientes/mesa-decision-ux";

export type MesaPagoConcasaDecisionSectionProps = Readonly<{
  /** Panel Firmado (11): muestra botones Sí/No. */
  decisionView: AvanceOperativoEtapaView;
  puedeOperar: boolean;
  loading: boolean;
  error: string | null;
  success: string | null;
  onDecidir: (resultado: PagoConcasaResultado) => Promise<void>;
  /** Etapa 12: muestra resultado final (solo lectura). */
  etapaActual: number | null | undefined;
  resultadoFinal: PagoConcasaResultado | null | undefined;
  resultadoAt: string | null | undefined;
  formatDateTime?: (iso: string) => string;
}>;

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
  const [confirm, setConfirm] = useState<PagoConcasaResultado | null>(null);

  const handleConfirm = useCallback(() => {
    if (!confirm) return;
    const chosen = confirm;
    void onDecidir(chosen).finally(() => setConfirm(null));
  }, [confirm, onDecidir]);

  const showFinal =
    etapaActual === 12 &&
    (resultadoFinal === "pagado" || resultadoFinal === "no_pagado");

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
      </section>
    );
  }

  if (!decisionView.mostrar) return null;

  const canAct = puedeOperar && decisionView.puedeAvanzar && !loading;

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700"
      data-testid="mesa-pago-concasa-decision"
      aria-label={MESA_PAGO_CONCASA_DECISION_COPY.titulo}
    >
      <h2 className="text-sm font-semibold text-slate-900">
        {MESA_PAGO_CONCASA_DECISION_COPY.titulo}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        {MESA_PAGO_CONCASA_DECISION_COPY.descripcion}
      </p>
      <p className="mt-2 text-xs text-amber-900/90">
        {MESA_PAGO_CONCASA_DECISION_COPY.avisoCierre}
      </p>
      <p className="mt-2 text-xs text-slate-500">{MESA_AVISO_SIN_RECHAZO_DIRECTO}</p>

      {error ? (
        <p
          role="alert"
          className="mt-3 text-sm text-red-700"
          data-testid="mesa-pago-concasa-error"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          role="status"
          className="mt-3 text-sm text-emerald-700"
          data-testid="mesa-pago-concasa-success"
        >
          {success}
        </p>
      ) : null}

      {confirm ? (
        <div
          className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3"
          data-testid="mesa-pago-concasa-confirm"
        >
          <p className="text-sm text-slate-800">
            {confirm === "pagado"
              ? MESA_PAGO_CONCASA_DECISION_COPY.confirmPagado
              : MESA_PAGO_CONCASA_DECISION_COPY.confirmNoPagado}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {MESA_PAGO_CONCASA_DECISION_COPY.avisoCierre}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={loading}
              onClick={handleConfirm}
              data-testid="mesa-pago-concasa-confirm-ok"
            >
              {loading ? "Guardando…" : "Confirmar"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => setConfirm(null)}
              data-testid="mesa-pago-concasa-confirm-cancel"
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!canAct}
            onClick={() => setConfirm("pagado")}
            data-testid="mesa-pago-concasa-si-pago"
          >
            {MESA_PAGO_CONCASA_DECISION_COPY.botonPagado}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canAct}
            onClick={() => setConfirm("no_pagado")}
            data-testid="mesa-pago-concasa-no-pago"
            className="border-amber-300 text-amber-950 hover:bg-amber-50"
          >
            {MESA_PAGO_CONCASA_DECISION_COPY.botonNoPagado}
          </Button>
        </div>
      )}
    </section>
  );
}
