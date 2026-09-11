"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  isAnetteNssOnlyEmail,
  normalizeAnetteNssOnlyInput,
  parseAnetteNssOnlyPrepareResult,
  validateAnetteNssOnlyInput,
} from "@/domain/expedientes/anette-nss-only";
import { fireAutoPrecalificarAck } from "@/domain/expedientes/fire-auto-precalificar-ack";
import { fireAutoReprecalificarAck } from "@/domain/expedientes/fire-auto-reprecalificar-ack";
import { resolveBearerAccessToken } from "@/domain/expedientes/resolve-bearer-access-token";
import { useSessionRepo } from "@/domain/session";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

function newIdempotencyKey(nss: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `anette-nss-${nss}-${crypto.randomUUID()}`;
  }
  return `anette-nss-${nss}-${Date.now()}`;
}

function friendlyRpcError(message: string): string {
  const clean = String(message ?? "").trim();
  if (!clean) return "No se pudo enviar el NSS a precalificación.";
  const marker = "asesor_preparar_precalificacion_externo_nss:";
  const index = clean.toLowerCase().indexOf(marker);
  if (index >= 0) {
    return clean.slice(index + marker.length).trim();
  }
  return clean;
}

export function AnetteNssOnlyPrecalPage() {
  const router = useRouter();
  const { currentUser } = useSessionRepo();
  const [nss, setNss] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function triggerAutomaticPrecalification(input: {
    action: "created" | "reprecal";
    expedienteId: string;
    intentoId: string | null;
  }): Promise<void> {
    if (!supabaseBrowser) {
      console.error("[anette-nss-only] sin supabaseBrowser para Bearer");
      return;
    }
    const accessToken = await resolveBearerAccessToken(
      supabaseBrowser.auth,
      "anette-nss-only",
    );

    if (input.action === "reprecal") {
      if (!input.intentoId) return;
      await fireAutoReprecalificarAck({
        intentoId: input.intentoId,
        accessToken,
      });
      return;
    }

    await fireAutoPrecalificarAck({
      expedienteId: input.expedienteId,
      accessToken,
      logPrefix: "anette-nss-only",
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (
      currentUser?.role !== "asesor" ||
      !isAnetteNssOnlyEmail(currentUser.email)
    ) {
      setErrorMsg("Este flujo de NSS no está habilitado para este usuario.");
      return;
    }

    let normalizedNss: string;
    try {
      normalizedNss = validateAnetteNssOnlyInput(nss);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Revisa el NSS capturado.",
      );
      return;
    }

    if (!supabaseBrowser) {
      setErrorMsg("No se pudo conectar con el CRM. Intenta nuevamente.");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabaseBrowser.rpc(
        "asesor_preparar_precalificacion_externo_nss",
        {
          p_nss: normalizedNss,
          p_idempotency_key: newIdempotencyKey(normalizedNss),
        },
      );
      if (error) {
        setErrorMsg(friendlyRpcError(error.message));
        return;
      }

      const prepared = parseAnetteNssOnlyPrepareResult(data);
      if (!prepared) {
        setErrorMsg("El CRM devolvió una respuesta inválida al preparar el NSS.");
        return;
      }

      try {
        await triggerAutomaticPrecalification({
          action: prepared.action,
          expedienteId: prepared.expedienteId,
          intentoId: prepared.intentoId,
        });
      } catch (err) {
        console.error(
          "[anette-nss-only] auto-precalificar ack falló",
          prepared.expedienteId,
          err,
        );
      }

      setSuccessMsg(
        prepared.action === "reprecal"
          ? "NSS enviado nuevamente al Editor y a precalificación automática."
          : "NSS enviado al Editor y a precalificación automática.",
      );
      window.setTimeout(
        () => router.push(`/asesor/expediente/${prepared.expedienteId}`),
        800,
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo enviar el NSS a precalificación.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-3 py-3 sm:px-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/asesor"
            className="flex min-h-[44px] items-center text-sm text-gray-500 hover:text-gray-700 touch-manipulation sm:min-h-0"
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
          <h2 className="text-lg font-medium text-gray-900">
            Precalificar con NSS
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Captura únicamente el NSS. El expediente se enviará al Editor y la
            precalificación se consultará automáticamente.
          </p>

          {errorMsg ? (
            <p
              role="alert"
              className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {errorMsg}
            </p>
          ) : null}
          {successMsg ? (
            <p
              role="status"
              className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
            >
              {successMsg}
            </p>
          ) : null}

          <div className="mt-5">
            <Input
              name="nss"
              label="IMSS / NSS"
              placeholder="11 dígitos"
              required
              maxLength={11}
              inputMode="numeric"
              autoComplete="off"
              value={nss}
              onChange={(e) =>
                setNss(normalizeAnetteNssOnlyInput(e.target.value))
              }
              className="min-h-[44px] sm:min-h-0"
            />
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button
              type="submit"
              variant="primary"
              disabled={submitting}
              className="min-h-[44px] w-full touch-manipulation sm:min-h-0 sm:w-auto"
            >
              {submitting ? "Enviando…" : "Precalificar"}
            </Button>
            <Link href="/asesor" className="w-full sm:w-auto">
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                className="min-h-[44px] w-full touch-manipulation sm:min-h-0 sm:w-auto"
              >
                Cancelar
              </Button>
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
