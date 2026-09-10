"use client";

import { useRef, useState } from "react";
import Link from "next/link";

import { fireAutoReprecalificarAck } from "@/domain/expedientes/fire-auto-reprecalificar-ack";
import { validateExternalNssOnly } from "@/domain/precalificaciones/asesor-externo-nss-only";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type PrepareExternalNssResult = Readonly<{
  action: "created" | "reprecal";
  expediente_id: string;
  intento_id?: string | null;
}>;

function parsePrepareResult(value: unknown): PrepareExternalNssResult {
  if (!value || typeof value !== "object") {
    throw new Error("La respuesta de precalificación no es válida.");
  }
  const row = value as Record<string, unknown>;
  const action = String(row.action ?? "").trim();
  const expedienteId = String(row.expediente_id ?? row.id ?? "").trim();
  const intentoId = String(row.intento_id ?? "").trim() || null;

  if ((action !== "created" && action !== "reprecal") || !expedienteId) {
    throw new Error("La respuesta de precalificación está incompleta.");
  }
  if (action === "reprecal" && !intentoId) {
    throw new Error("La reprecalificación no devolvió un intento válido.");
  }

  return {
    action,
    expediente_id: expedienteId,
    intento_id: intentoId,
  };
}

async function fireCreatedAutoPrecalificar(args: {
  expedienteId: string;
  accessToken?: string | null;
}): Promise<void> {
  const headers: HeadersInit = {};
  if (args.accessToken) {
    headers.Authorization = `Bearer ${args.accessToken}`;
  }

  const res = await fetch(
    `/api/precalificaciones/${encodeURIComponent(args.expedienteId)}/auto-precalificar`,
    {
      method: "POST",
      headers,
      keepalive: true,
      signal: AbortSignal.timeout(5_000),
    },
  );

  if (!res.ok) {
    throw new Error(
      `No se pudo iniciar la consulta automática de Infonavit (HTTP ${res.status}).`,
    );
  }
}

export function AsesorExternoNuevaPrecalificacion() {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlightRef.current) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    let nss: string;
    try {
      const raw = (
        e.currentTarget.elements.namedItem("nss") as HTMLInputElement | null
      )?.value;
      nss = validateExternalNssOnly(raw ?? "");
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "El NSS debe tener exactamente 11 dígitos.",
      );
      return;
    }

    if (!supabaseBrowser) {
      setErrorMsg("Supabase no está disponible. Intenta de nuevo.");
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabaseBrowser.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
      }

      const { data, error } = await supabaseBrowser.rpc(
        "asesor_preparar_precalificacion_externo_nss",
        {
          p_nss: nss,
          p_idempotency_key:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${nss}`,
        },
      );

      if (error) {
        throw new Error(error.message || "No se pudo preparar la precalificación.");
      }

      const prepared = parsePrepareResult(data);

      if (prepared.action === "created") {
        await fireCreatedAutoPrecalificar({
          expedienteId: prepared.expediente_id,
          accessToken: session.access_token,
        });
      } else {
        const ack = await fireAutoReprecalificarAck({
          intentoId: prepared.intento_id!,
          accessToken: session.access_token,
        });
        if (
          !ack.ok ||
          typeof ack.status !== "number" ||
          ack.status < 200 ||
          ack.status >= 300
        ) {
          throw new Error(
            "No se pudo iniciar la consulta automática de Infonavit. Vuelve a enviar el mismo NSS; el expediente no se duplicará.",
          );
        }
      }

      e.currentTarget.reset();
      setSuccessMsg(
        "NSS enviado correctamente. La precalificación automática de Infonavit ya está en proceso.",
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo enviar el NSS a precalificación automática.",
      );
    } finally {
      inFlightRef.current = false;
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
            Ingresa únicamente el Número de Seguridad Social. Los demás datos se
            capturan después si el cliente continúa con su expediente.
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
              label="Número de Seguridad Social (NSS)"
              placeholder="11 dígitos"
              required
              maxLength={11}
              inputMode="numeric"
              autoComplete="off"
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
                className="min-h-[44px] w-full touch-manipulation sm:min-h-0 sm:w-auto"
              >
                Volver
              </Button>
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
