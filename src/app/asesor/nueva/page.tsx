"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSessionRepo } from "@/domain/session";
import { useExpedientesRepo } from "@/domain/expedientes";
import type { CreateExpedienteInput } from "@/domain/expedientes/create-expediente.input";
import { ExpedientesSupabaseError } from "@/domain/expedientes/supabase.error";
import {
  createNuevaReprecalSubmitGuard,
  decideNuevaAfterGate,
  executeNuevaReprecalConfirm,
  formatNuevaProgramaLabel,
  MSG_NUEVA_REPRECAL_BODY,
  MSG_NUEVA_REPRECAL_CHANGE_SUCCESS,
  MSG_NUEVA_REPRECAL_PENDING,
  MSG_NUEVA_REPRECAL_SAME_Q,
  MSG_NUEVA_REPRECAL_SUCCESS,
  MSG_NUEVA_REPRECAL_TITLE,
  nuevaExpedienteDetallePath,
  type NuevaReprecalSubmitGuard,
} from "@/domain/expedientes/asesor-nueva-reprecal";
import type { ReprecalUiMode } from "@/domain/expedientes/asesor-reprecal-flow";
import { fireAutoReprecalificarAck } from "@/domain/expedientes/fire-auto-reprecalificar-ack";
import type { NssPrecalGateResult } from "@/domain/expedientes/nss-precal-gate";
import { validateCreatePrecalificacion } from "@/domain/precalificaciones/validators";
import { isDataModeSupabase } from "@/lib/dataMode";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { PROGRAMAS } from "@/lib/mock-store";

function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

type ConfirmState = {
  mode: ReprecalUiMode;
  expedienteId: string;
  input: CreateExpedienteInput;
  gate: NssPrecalGateResult;
};

export default function NuevaPrecalificacionPage() {
  const router = useRouter();
  const { currentUser } = useSessionRepo();
  const expedientesRepo = useExpedientesRepo();
  const dataSupabase = isDataModeSupabase();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const guardRef = useRef<NuevaReprecalSubmitGuard | null>(null);
  if (!guardRef.current) {
    guardRef.current = createNuevaReprecalSubmitGuard();
  }

  async function readForm(
    form: HTMLFormElement,
  ): Promise<CreateExpedienteInput> {
    const programa = (form.elements.namedItem("programa") as HTMLSelectElement)
      .value as CreateExpedienteInput["programa"];
    const cliente_nombre = (
      form.elements.namedItem("cliente_nombre") as HTMLInputElement
    ).value.trim();
    const telefonoRaw = (
      form.elements.namedItem("telefono_cliente") as HTMLInputElement
    ).value;
    const telefono_cliente = onlyDigits(telefonoRaw);
    const nss = (form.elements.namedItem("nss") as HTMLInputElement).value.trim();
    const direccion_opcional = (
      form.elements.namedItem("direccion_opcional") as HTMLInputElement
    ).value.trim();

    return {
      programa,
      nss,
      cliente_nombre,
      telefono_cliente,
      direccion_opcional,
      asesorEmail: currentUser?.email ?? "",
    };
  }

  function closeConfirm() {
    if (submitting) return;
    setConfirm(null);
    guardRef.current?.clearKey();
  }

  async function handleConfirmSend() {
    if (!confirm || !guardRef.current) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmitting(true);
    try {
      const result = await executeNuevaReprecalConfirm({
        guard: guardRef.current,
        firstExpedienteId: confirm.expedienteId,
        mode: confirm.mode,
        form: confirm.input,
        lookup: (nss, programa) =>
          expedientesRepo.lookupNssPrecalGate(nss, programa),
        iniciar: (payload) =>
          expedientesRepo.iniciarReprecalificacion(payload),
      });
      if (!result.ok) {
        if (result.reason === "in_flight") return;
        if (result.reason === "gate") {
          setErrorMsg(result.message);
          return;
        }
        const err = result.error;
        if (err instanceof ExpedientesSupabaseError) {
          setErrorMsg(err.message);
        } else if (err instanceof Error) {
          setErrorMsg(err.message);
        } else {
          setErrorMsg("No se pudo enviar la precalificación.");
        }
        return;
      }
      try {
        const session = (await supabaseBrowser?.auth.getSession())?.data
          .session;
        await fireAutoReprecalificarAck({
          intentoId: result.intentoId,
          accessToken: session?.access_token,
        });
      } catch {
        /* ack no bloquea redirect */
      }
      setSuccessMsg(
        confirm.mode === "change_programa"
          ? MSG_NUEVA_REPRECAL_CHANGE_SUCCESS
          : MSG_NUEVA_REPRECAL_SUCCESS,
      );
      setConfirm(null);
      router.push(nuevaExpedienteDetallePath(result.expedienteId));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const form = e.currentTarget;
    const input = await readForm(form);

    try {
      validateCreatePrecalificacion(input);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Revisa los datos del formulario.",
      );
      return;
    }

    setSubmitting(true);
    try {
      if (dataSupabase) {
        const gateResult = await expedientesRepo.lookupNssPrecalGate(
          input.nss,
          input.programa,
        );
        const decision = decideNuevaAfterGate(gateResult);

        if (decision.action === "blocked") {
          setErrorMsg(decision.message);
          setConfirm(null);
          return;
        }

        if (decision.action === "confirm_missing_expediente") {
          setErrorMsg(decision.message);
          setConfirm(null);
          return;
        }

        if (
          decision.action === "confirm_same" ||
          decision.action === "confirm_change"
        ) {
          setConfirm({
            mode:
              decision.action === "confirm_same"
                ? "same_programa"
                : "change_programa",
            expedienteId: decision.expedienteId,
            input,
            gate: gateResult,
          });
          return;
        }

        if (decision.action !== "create") {
          setErrorMsg(gateResult.message);
          return;
        }
      }

      const created = await expedientesRepo.createExpediente(input);
      if (dataSupabase) {
        if (created.id) {
          try {
            const session = (await supabaseBrowser?.auth.getSession())?.data
              .session;
            const headers: HeadersInit = {};
            if (session?.access_token) {
              headers.Authorization = `Bearer ${session.access_token}`;
            }
            console.log(
              "[nueva] disparando auto-precalificar para",
              created.id,
            );
            // Esperar solo el ack 202 (trabajo largo sigue en after() del servidor).
            const res = await fetch(
              `/api/precalificaciones/${encodeURIComponent(created.id)}/auto-precalificar`,
              {
                method: "POST",
                headers,
                keepalive: true,
                signal: AbortSignal.timeout(5_000),
              },
            );
            console.log(
              "[nueva] auto-precalificar ack",
              created.id,
              res.status,
            );
          } catch (err) {
            console.error(
              "[nueva] auto-precalificar ack falló",
              created.id,
              err,
            );
          }
        }
        setSuccessMsg(
          `Expediente creado correctamente (ID ${created.id.slice(0, 8)}…). ` +
            "Aún no aparecerá en tu bandeja hasta P3B.2; un administrador puede verlo en /admin.",
        );
        window.setTimeout(() => router.push("/asesor"), 1800);
      } else {
        router.push("/asesor");
      }
    } catch (err) {
      if (err instanceof ExpedientesSupabaseError) {
        setErrorMsg(err.message);
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("No se pudo crear la precalificación.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (currentUser === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }
  if (!currentUser || currentUser.role !== "asesor") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-600">
          <Link href="/login" className="text-blue-600 underline">
            Inicia sesión como asesor
          </Link>
        </p>
      </div>
    );
  }

  const pendingId = confirm?.gate.reprecalificacion_pendiente_id;
  const hasPending = Boolean(pendingId);
  const programaActual = formatNuevaProgramaLabel(
    confirm?.gate.programa_actual ?? confirm?.gate.programa,
  );
  const programaSolicitado = formatNuevaProgramaLabel(
    confirm?.gate.programa_solicitado ?? confirm?.input.programa,
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-3 py-3 sm:px-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/asesor"
            className="min-h-[44px] flex items-center text-sm text-gray-500 hover:text-gray-700 touch-manipulation sm:min-h-0"
          >
            ← Volver al dashboard
          </Link>
          <h1 className="text-base font-semibold text-gray-900 sm:text-lg">
            ConCasa CRM · Nueva precalificación
          </h1>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-3 py-6 sm:px-4 sm:py-8">
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6"
        >
          <h2 className="mb-4 text-lg font-medium text-gray-900 sm:mb-6">
            Datos de precalificación
          </h2>
          {dataSupabase ? (
            <p className="mb-4 text-sm text-gray-600">
              Los datos se guardarán en Supabase (expediente real).
            </p>
          ) : null}
          {errorMsg ? (
            <p
              role="alert"
              className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {errorMsg}
            </p>
          ) : null}
          {successMsg ? (
            <p
              role="status"
              className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
            >
              {successMsg}
            </p>
          ) : null}
          <div className="flex flex-col gap-4">
            <Select
              name="programa"
              label="Programa"
              options={PROGRAMAS.map((p) => ({ value: p, label: p }))}
              required
              className="min-h-[44px] sm:min-h-0"
              onChange={() => {
                setConfirm(null);
              }}
            />
            <Input
              name="cliente_nombre"
              label="Nombre del cliente"
              placeholder="Nombre completo"
              required
              className="min-h-[44px] sm:min-h-0"
            />
            <Input
              name="telefono_cliente"
              label="Teléfono del cliente"
              placeholder="10 dígitos (México)"
              required
              maxLength={14}
              inputMode="numeric"
              className="min-h-[44px] sm:min-h-0"
            />
            <Input
              name="nss"
              label="IMSS / NSS"
              placeholder="11 dígitos"
              required
              maxLength={11}
              inputMode="numeric"
              className="min-h-[44px] sm:min-h-0"
              onChange={() => {
                setConfirm(null);
              }}
            />
            <Input
              name="direccion_opcional"
              label="Dirección (opcional)"
              placeholder="Calle, número, colonia..."
              className="min-h-[44px] sm:min-h-0"
            />
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || confirm != null}
              className="min-h-[44px] w-full touch-manipulation sm:min-h-0 sm:w-auto"
            >
              {submitting ? "Guardando…" : "Enviar"}
            </Button>
            <Link href="/asesor" className="w-full sm:w-auto">
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px] w-full touch-manipulation sm:min-h-0 sm:w-auto"
              >
                Cancelar
              </Button>
            </Link>
          </div>
        </form>
      </main>

      {confirm ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="nueva-reprecal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
            <h2
              id="nueva-reprecal-title"
              className="text-base font-semibold text-gray-900"
            >
              {MSG_NUEVA_REPRECAL_TITLE}
            </h2>
            {confirm.mode === "same_programa" ? (
              <>
                <p className="mt-3 text-sm text-gray-700">
                  {MSG_NUEVA_REPRECAL_SAME_Q}
                </p>
                <p className="mt-2 text-sm text-gray-700">
                  {MSG_NUEVA_REPRECAL_BODY}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-gray-700">
                Este NSS ya está en uno de tus expedientes con el programa{" "}
                <span className="font-medium text-gray-900">
                  {programaActual}
                </span>
                . Seleccionaste{" "}
                <span className="font-medium text-gray-900">
                  {programaSolicitado}
                </span>
                . ¿Quieres solicitar el cambio de programa y volver a enviarlo a
                precalificación?
              </p>
            )}
            <p className="mt-3 text-sm text-gray-700">
              <span className="font-medium text-gray-900">Programa actual:</span>{" "}
              {programaActual}
            </p>
            <p className="mt-1 text-sm text-gray-700">
              <span className="font-medium text-gray-900">
                Programa solicitado:
              </span>{" "}
              {programaSolicitado}
            </p>
            {hasPending ? (
              <p
                role="status"
                className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
              >
                {MSG_NUEVA_REPRECAL_PENDING}
              </p>
            ) : null}
            {errorMsg ? (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {errorMsg}
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={closeConfirm}
              >
                Cancelar
              </Button>
              <Link
                href={nuevaExpedienteDetallePath(confirm.expedienteId)}
                className="inline-flex"
              >
                <Button type="button" variant="secondary" disabled={submitting}>
                  Abrir expediente
                </Button>
              </Link>
              <Button
                type="button"
                variant="primary"
                disabled={submitting}
                onClick={() => void handleConfirmSend()}
              >
                {submitting
                  ? "Enviando…"
                  : confirm.mode === "change_programa"
                    ? "Sí, solicitar cambio y enviar"
                    : "Sí, enviar de nuevo"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
