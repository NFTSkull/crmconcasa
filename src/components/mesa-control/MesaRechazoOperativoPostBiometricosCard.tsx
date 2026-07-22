"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  esElegibleRechazoOperativoPostBiometricos,
  MESA_RECHAZO_OPERATIVO_ANCHOR_ID,
  MESA_RECHAZO_OPERATIVO_CARD_BADGE,
  MESA_RECHAZO_OPERATIVO_CARD_CTA,
  MESA_RECHAZO_OPERATIVO_CARD_INTRO,
  MESA_RECHAZO_OPERATIVO_CARD_TITLE,
  useExpedientesRepo,
} from "@/domain/expedientes";
import {
  MESA_RECHAZO_OPERATIVO_MOTIVOS,
  isRechazoOperativoMotivoOtro,
  motivoRechazoOperativoEsValido,
  resolveMotivoRechazoOperativo,
} from "@/domain/expedientes/mesa-rechazo-operativo-motivos";
import { buildRechazoOperativoPayload } from "@/domain/expedientes/mesa-rechazo-operativo-payload";

type Props = {
  expedienteId: string;
  etapaActual: number | null;
  subestado: string | null;
  cicloEstado: string | null;
  submittedToMesa: boolean;
  fechaCita: string | null;
  dataModeSupabase: boolean;
  onUpdated: () => void;
};

export function MesaRechazoOperativoPostBiometricosCard({
  expedienteId,
  etapaActual,
  subestado,
  cicloEstado,
  submittedToMesa,
  dataModeSupabase,
  onUpdated,
}: Props) {
  const repo = useExpedientesRepo();
  const [open, setOpen] = useState(false);
  const [motivoSelect, setMotivoSelect] = useState("");
  const [motivoOtro, setMotivoOtro] = useState("");
  const [comentario, setComentario] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible =
    dataModeSupabase &&
    esElegibleRechazoOperativoPostBiometricos({
      submittedToMesa,
      cicloEstado,
      subestado,
      etapaActual,
    });

  if (!visible) return null;

  const motivoValido = motivoRechazoOperativoEsValido(motivoSelect, motivoOtro);
  const muestraOtro = isRechazoOperativoMotivoOtro(motivoSelect);

  const guardar = async () => {
    const motivo = resolveMotivoRechazoOperativo(motivoSelect, motivoOtro);
    if (!motivo) return;
    setSaving(true);
    setError(null);
    try {
      await repo.rechazarEtapaOperativa(
        expedienteId,
        buildRechazoOperativoPayload({
          motivo,
          comentario,
        }),
      );
      setOpen(false);
      setMotivoSelect("");
      setMotivoOtro("");
      setComentario("");
      onUpdated();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo registrar el rechazo operativo.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      id={MESA_RECHAZO_OPERATIVO_ANCHOR_ID}
      data-testid="mesa-rechazo-operativo"
      className="scroll-mt-4 rounded-xl border-2 border-neutral-800 bg-neutral-950 p-4 shadow-md ring-2 ring-neutral-700"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-950">
          {MESA_RECHAZO_OPERATIVO_CARD_BADGE}
        </span>
        <h2 className="text-sm font-semibold text-neutral-50">
          {MESA_RECHAZO_OPERATIVO_CARD_TITLE}
        </h2>
      </div>
      <p className="mt-2 text-xs font-medium text-neutral-100">
        {MESA_RECHAZO_OPERATIVO_CARD_INTRO}
      </p>
      <p className="mt-1 text-xs text-neutral-300">
        No cierra el ciclo. Disponible en etapas 5 y 6. No uses «Mover etapa».
      </p>
      {!open ? (
        <Button
          type="button"
          variant="outline"
          className="mt-3 border-neutral-500 bg-neutral-900 text-neutral-50 hover:bg-neutral-800"
          onClick={() => setOpen(true)}
        >
          {MESA_RECHAZO_OPERATIVO_CARD_CTA}
        </Button>
      ) : (
        <div className="mt-4 grid gap-3">
          <label className="text-xs font-medium text-neutral-100">
            Motivo del rechazo{" "}
            <span className="text-neutral-400">(obligatorio)</span>
            <select
              value={motivoSelect}
              onChange={(event) => {
                setMotivoSelect(event.target.value);
                if (!isRechazoOperativoMotivoOtro(event.target.value)) {
                  setMotivoOtro("");
                }
              }}
              className="mt-1 w-full rounded-md border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-50"
              data-testid="mesa-rechazo-motivo"
            >
              <option value="">Selecciona un motivo…</option>
              {MESA_RECHAZO_OPERATIVO_MOTIVOS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          {muestraOtro ? (
            <label className="text-xs font-medium text-neutral-100">
              Describe el motivo{" "}
              <span className="text-neutral-400">(obligatorio)</span>
              <input
                value={motivoOtro}
                onChange={(event) => setMotivoOtro(event.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-50 placeholder:text-neutral-500"
                placeholder="Escribe el motivo del rechazo"
                data-testid="mesa-rechazo-motivo-otro"
              />
            </label>
          ) : null}
          <label className="text-xs font-medium text-neutral-100">
            Nota para el asesor{" "}
            <span className="text-neutral-400">(opcional)</span>
            <textarea
              value={comentario}
              onChange={(event) => setComentario(event.target.value)}
              className="mt-1 min-h-20 w-full rounded-md border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-50 placeholder:text-neutral-500"
              placeholder="Detalle adicional si hace falta"
              data-testid="mesa-rechazo-nota"
            />
          </label>
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-red-400/60 bg-red-950/40 px-3 py-2 text-xs text-red-200"
            >
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="primary"
              className="bg-neutral-100 text-neutral-950 hover:bg-white focus:ring-neutral-400"
              disabled={saving || !motivoValido}
              onClick={() => void guardar()}
              data-testid="mesa-rechazo-confirmar"
            >
              {saving ? "Registrando…" : "Confirmar rechazo"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-neutral-500 bg-transparent text-neutral-100 hover:bg-neutral-900"
              disabled={saving}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Volver
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
