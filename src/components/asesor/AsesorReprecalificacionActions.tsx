"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import {
  canShowAsesorReprecalActions,
  isSameProgramaUi,
  opcionesCambioPrograma,
  validateGateForDetalleReprecal,
  type CambiarProgramaOption,
} from "@/domain/expedientes/asesor-reprecal-flow";
import type { ExpedienteProgramaUi } from "@/domain/expedientes/create-expediente.input";
import { newReprecalIdempotencyKey } from "@/domain/expedientes/reprecal-idempotency";
import { ExpedientesSupabaseError } from "@/domain/expedientes/supabase.error";
import { useExpedientesRepo } from "@/domain/expedientes";

export type AsesorReprecalificacionActionsProps = {
  expedienteId: string;
  nss: string;
  clienteNombre: string;
  telefonoCliente: string;
  direccionOpcional: string;
  /** Label UI vigente (`Mejoravit` / `Subcuenta` / `Compro tu casa`). */
  programaVigenteUi: string;
  submittedToMesa: boolean;
  cicloEstado?: string | null;
  dataSupabase: boolean;
  reprecalificacionPendienteId: string | null;
  /** Label UI del programa solicitado del intento pendiente, si el payload lo trae. */
  programaSolicitadoUi?: string | null;
  montoAprobadoVigente?: number | null;
  onCompleted: () => void | Promise<void>;
  /**
   * Si true, sin card exterior (ya va dentro de «Decisión del editor»).
   * No altera gates ni handlers.
   */
  embedded?: boolean;
};

type DialogKind = "nueva" | "cambio" | null;

function formatMonto(m: number | null | undefined): string {
  if (typeof m !== "number" || !Number.isFinite(m)) return "—";
  return `$${m.toLocaleString("es-MX")}`;
}

export function AsesorReprecalificacionActions({
  expedienteId,
  nss,
  clienteNombre,
  telefonoCliente,
  direccionOpcional,
  programaVigenteUi,
  submittedToMesa,
  cicloEstado,
  dataSupabase,
  reprecalificacionPendienteId,
  programaSolicitadoUi = null,
  montoAprobadoVigente = null,
  onCompleted,
  embedded = false,
}: AsesorReprecalificacionActionsProps) {
  const titleId = useId();
  const repo = useExpedientesRepo();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [nuevoPrograma, setNuevoPrograma] = useState<CambiarProgramaOption | "">(
    "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const visible = canShowAsesorReprecalActions({
    dataSupabase,
    submittedToMesa,
    cicloEstado,
  });
  if (!visible) return null;

  const hasPending = Boolean(reprecalificacionPendienteId);
  const cambioEsCambio =
    Boolean(nuevoPrograma) &&
    !isSameProgramaUi(programaVigenteUi, String(nuevoPrograma));
  const opciones = opcionesCambioPrograma(programaVigenteUi);
  const solicitadoLabel = programaSolicitadoUi?.trim() || null;
  const esCambioPendiente =
    hasPending &&
    solicitadoLabel != null &&
    !isSameProgramaUi(programaVigenteUi, solicitadoLabel);

  function closeDialog() {
    if (submitting) return;
    setDialog(null);
    setErrorMsg(null);
    setNuevoPrograma("");
    // Conserva key solo mientras el ciclo de submit no terminó con éxito;
    // al cancelar liberamos para no reutilizar entre dialogs distintos.
    idempotencyKeyRef.current = null;
  }

  async function runIniciar(
    mode: "same_programa" | "change_programa",
    programa: ExpedienteProgramaUi,
  ) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const gate = await repo.lookupNssPrecalGate(nss, programa);
      const gateErr = validateGateForDetalleReprecal({
        mode,
        gate,
        expedienteId,
      });
      if (gateErr) {
        setErrorMsg(gateErr);
        return;
      }
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = newReprecalIdempotencyKey();
      }
      const result = await repo.iniciarReprecalificacion({
        programa,
        nss,
        cliente_nombre: clienteNombre,
        telefono_cliente: telefonoCliente,
        direccion_opcional: direccionOpcional,
        idempotency_key: idempotencyKeyRef.current,
      });
      idempotencyKeyRef.current = null;
      setDialog(null);
      setNuevoPrograma("");
      setSuccessMsg(
        mode === "change_programa"
          ? "Cambio de programa enviado al Editor. El programa y monto vigentes no cambian hasta que apruebe."
          : "Nueva precalificación enviada al Editor. El monto vigente se conserva hasta que termine la revisión.",
      );
      void result;
      await onCompleted();
    } catch (err) {
      if (err instanceof ExpedientesSupabaseError) {
        setErrorMsg(err.message);
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("No se pudo enviar la precalificación.");
      }
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div
      className={
        embedded
          ? "mt-4 border-t border-gray-200 pt-4 text-sm text-gray-700"
          : "rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700"
      }
    >
      {!embedded ? (
        <p className="text-sm font-semibold text-gray-900">
          Precalificación / Editor
        </p>
      ) : null}

      {hasPending ? (
        <div
          role="status"
          className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
        >
          <p className="font-semibold">Precalificación en revisión</p>
          <p className="mt-1 text-xs">
            El Editor tiene una actualización pendiente para este expediente.
          </p>
          {esCambioPendiente ? (
            <div className="mt-2 space-y-1 text-xs">
              <p>
                <span className="font-medium">Programa vigente:</span>{" "}
                {programaVigenteUi}
              </p>
              <p>
                <span className="font-medium">Programa solicitado:</span>{" "}
                {solicitadoLabel}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs">
              <span className="font-medium">Programa:</span> {programaVigenteUi}
            </p>
          )}
          <p className="mt-2 text-xs text-amber-900">
            Monto vigente: {formatMonto(montoAprobadoVigente)} (no se modifica
            hasta que el Editor resuelva).
          </p>
        </div>
      ) : null}

      {successMsg ? (
        <p
          role="status"
          className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900"
        >
          {successMsg}
        </p>
      ) : null}

      {errorMsg && !dialog ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {errorMsg}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {!hasPending ? (
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => {
              setErrorMsg(null);
              setSuccessMsg(null);
              setDialog("nueva");
            }}
          >
            Enviar nueva precalificación
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={submitting || opciones.length === 0}
          onClick={() => {
            setErrorMsg(null);
            setSuccessMsg(null);
            setNuevoPrograma("");
            setDialog("cambio");
          }}
        >
          {hasPending ? "Modificar programa solicitado" : "Cambiar programa"}
        </Button>
      </div>

      {dialog === "nueva" ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
            <h2 id={titleId} className="text-base font-semibold text-gray-900">
              Enviar nueva precalificación
            </h2>
            <p className="mt-3 text-sm text-gray-700">
              Se enviará nuevamente este cliente al Editor para actualizar su
              precalificación.
            </p>
            <p className="mt-3 text-sm text-gray-700">
              <span className="font-medium text-gray-900">Programa actual:</span>{" "}
              {programaVigenteUi}
            </p>
            <p className="mt-2 text-sm text-gray-700">
              El monto aprobado actual ({formatMonto(montoAprobadoVigente)}) se
              conservará hasta que el Editor termine la nueva revisión.
            </p>
            {errorMsg ? (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {errorMsg}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={closeDialog}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={submitting}
                onClick={() =>
                  void runIniciar(
                    "same_programa",
                    programaVigenteUi as ExpedienteProgramaUi,
                  )
                }
              >
                {submitting ? "Enviando…" : "Enviar al Editor"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {dialog === "cambio" ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
            <h2 id={titleId} className="text-base font-semibold text-gray-900">
              Cambiar programa y enviar a precalificación
            </h2>
            <p className="mt-3 text-sm text-gray-700">
              <span className="font-medium text-gray-900">Programa actual:</span>{" "}
              {programaVigenteUi}
            </p>
            <div className="mt-3">
              <Select
                id="asesor-reprecal-nuevo-programa"
                label="Nuevo programa"
                value={nuevoPrograma}
                onChange={(e) =>
                  setNuevoPrograma(e.target.value as CambiarProgramaOption | "")
                }
                disabled={submitting}
                options={[
                  { value: "", label: "Selecciona…" },
                  ...opciones.map((opt) => ({ value: opt, label: opt })),
                ]}
              />
            </div>
            {nuevoPrograma && !cambioEsCambio ? (
              <p className="mt-2 text-xs text-amber-800">
                Ese es el programa vigente. Para re-precalificar sin cambio usa
                «Enviar nueva precalificación».
              </p>
            ) : null}
            {cambioEsCambio ? (
              <>
                <p className="mt-3 text-sm text-gray-700">
                  <span className="font-medium text-gray-900">
                    Programa solicitado:
                  </span>{" "}
                  {nuevoPrograma}
                </p>
                <p className="mt-2 text-sm text-gray-700">
                  El programa y monto actuales permanecerán vigentes hasta que
                  el Editor apruebe la nueva precalificación.
                </p>
                <p className="mt-2 text-sm text-gray-700">
                  Si el Editor determina que no cumple, el programa y monto
                  actuales no cambiarán.
                </p>
              </>
            ) : null}
            {errorMsg ? (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {errorMsg}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={closeDialog}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={submitting || !cambioEsCambio}
                onClick={() => {
                  if (!nuevoPrograma || !cambioEsCambio) return;
                  void runIniciar("change_programa", nuevoPrograma);
                }}
              >
                {submitting ? "Enviando…" : "Enviar al Editor"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
