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
      className="scroll-mt-4 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 shadow-md ring-2 ring-amber-200"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-md bg-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-950 ring-1 ring-amber-400/70">
          {MESA_RECHAZO_OPERATIVO_CARD_BADGE}
        </span>
        <h2 className="text-sm font-semibold text-amber-950">
          {MESA_RECHAZO_OPERATIVO_CARD_TITLE}
        </h2>
      </div>
      <p className="mt-2 text-xs font-medium text-amber-950">
        {MESA_RECHAZO_OPERATIVO_CARD_INTRO}
      </p>
      <p className="mt-1 text-xs text-amber-900/85">
        No cierra el ciclo: el cliente puede continuar o reingresar. Solo etapas
        5 y 6. No uses «Mover etapa».
      </p>
      {!open ? (
        <Button
          type="button"
          variant="outline"
          className="mt-3 border-amber-500 bg-white text-black hover:bg-amber-100 focus:ring-amber-400"
          onClick={() => setOpen(true)}
        >
          {MESA_RECHAZO_OPERATIVO_CARD_CTA}
        </Button>
      ) : (
        <div className="mt-4 grid gap-3">
          <label className="text-xs font-medium text-amber-950">
            Motivo del rechazo{" "}
            <span className="text-amber-800/80">(obligatorio)</span>
            <select
              value={motivoSelect}
              onChange={(event) => {
                setMotivoSelect(event.target.value);
                if (!isRechazoOperativoMotivoOtro(event.target.value)) {
                  setMotivoOtro("");
                }
              }}
              className="mt-1 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-neutral-900"
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
            <label className="text-xs font-medium text-amber-950">
              Describe el motivo{" "}
              <span className="text-amber-800/80">(obligatorio)</span>
              <input
                value={motivoOtro}
                onChange={(event) => setMotivoOtro(event.target.value)}
                className="mt-1 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500"
                placeholder="Escribe el motivo del rechazo"
                data-testid="mesa-rechazo-motivo-otro"
              />
            </label>
          ) : null}
          <label className="text-xs font-medium text-amber-950">
            Nota para el asesor{" "}
            <span className="text-amber-800/80">(opcional)</span>
            <textarea
              value={comentario}
              onChange={(event) => setComentario(event.target.value)}
              className="mt-1 min-h-20 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500"
              placeholder="Detalle adicional si hace falta"
              data-testid="mesa-rechazo-nota"
            />
          </label>
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="primary"
              className="border border-amber-500 bg-amber-200 text-black hover:bg-amber-300 focus:ring-amber-400"
              disabled={saving || !motivoValido}
              onClick={() => void guardar()}
              data-testid="mesa-rechazo-confirmar"
            >
              {saving ? "Registrando…" : "Confirmar rechazo"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-amber-400 bg-white text-black hover:bg-amber-100 focus:ring-amber-400"
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
