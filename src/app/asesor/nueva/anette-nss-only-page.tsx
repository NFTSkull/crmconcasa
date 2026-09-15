"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  normalizeAnetteNssOnlyInput,
  parseAnetteNssOnlyPrepareResult,
  validateAnetteNssOnlyInput,
} from "@/domain/expedientes/anette-nss-only";
import { fireAutoPrecalificarAck } from "@/domain/expedientes/fire-auto-precalificar-ack";
import { fireAutoReprecalificarAck } from "@/domain/expedientes/fire-auto-reprecalificar-ack";
import { resolveBearerAccessToken } from "@/domain/expedientes/resolve-bearer-access-token";
import { useSessionRepo } from "@/domain/session";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type DelegateTarget = Readonly<{
  id: string;
  full_name?: string | null;
  email: string;
  is_self?: boolean;
}>;

type DelegateContext = Readonly<{
  enabled: boolean;
  can_delegate: boolean;
  team_id?: string | null;
  team_name?: string | null;
  targets?: DelegateTarget[];
}>;

function newIdempotencyKey(nss: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `nss-only-${nss}-${crypto.randomUUID()}`;
  }
  return `nss-only-${nss}-${Date.now()}`;
}

function targetLabel(target: DelegateTarget): string {
  const name = String(target.full_name ?? "").trim();
  const label = name ? `${name} · ${target.email}` : target.email;
  return target.is_self ? `${label} (yo)` : label;
}

function friendlyRpcError(message: string): string {
  const clean = String(message ?? "").trim();
  if (!clean) return "No se pudo enviar el NSS a precalificación.";
  const markers = [
    "asesor_preparar_precalificacion_nss_only_para_asesor:",
    "asesor_preparar_precalificacion_nss_only:",
    "asesor_preparar_precalificacion_externo_nss:",
  ];
  const lower = clean.toLowerCase();
  for (const marker of markers) {
    const index = lower.indexOf(marker);
    if (index >= 0) {
      return clean.slice(index + marker.length).trim();
    }
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
  const [delegateCtx, setDelegateCtx] = useState<DelegateContext | null>(null);
  const [delegateLoading, setDelegateLoading] = useState(false);
  const [targetAsesorId, setTargetAsesorId] = useState("");

  useEffect(() => {
    if (currentUser?.role !== "asesor" || !supabaseBrowser) {
      setDelegateCtx(null);
      setDelegateLoading(false);
      setTargetAsesorId("");
      return;
    }

    let cancelled = false;
    setDelegateLoading(true);

    void (async () => {
      try {
        const { data, error } = await supabaseBrowser.rpc(
          "asesor_precal_nss_only_delegate_context",
        );
        if (cancelled) return;
        if (error) {
          console.error("[nss-only] contexto delegado:", error.message);
          setDelegateCtx(null);
          return;
        }
        const parsed = (data ?? null) as DelegateContext | null;
        setDelegateCtx(parsed?.enabled ? parsed : null);
      } finally {
        if (!cancelled) setDelegateLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.email, currentUser?.role]);

  async function triggerAutomaticPrecalification(input: {
    action: "created" | "reprecal";
    expedienteId: string;
    intentoId: string | null;
  }): Promise<void> {
    if (!supabaseBrowser) {
      console.error("[nss-only] sin supabaseBrowser para Bearer");
      return;
    }
    const accessToken = await resolveBearerAccessToken(
      supabaseBrowser.auth,
      "nss-only",
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
      logPrefix: "nss-only",
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (currentUser?.role !== "asesor") {
      setErrorMsg("Este flujo de NSS no está habilitado para este usuario.");
      return;
    }

    if (delegateCtx?.can_delegate && !targetAsesorId) {
      setErrorMsg("Selecciona el asesor titular del expediente.");
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
      const idempotencyKey = newIdempotencyKey(normalizedNss);
      const rpcResult = delegateCtx?.can_delegate
        ? await supabaseBrowser.rpc(
            "asesor_preparar_precalificacion_nss_only_para_asesor",
            {
              p_target_asesor_id: targetAsesorId,
              p_nss: normalizedNss,
              p_idempotency_key: idempotencyKey,
            },
          )
        : await supabaseBrowser.rpc("asesor_preparar_precalificacion_nss_only", {
            p_nss: normalizedNss,
            p_idempotency_key: idempotencyKey,
          });

      if (rpcResult.error) {
        setErrorMsg(friendlyRpcError(rpcResult.error.message));
        return;
      }

      const prepared = parseAnetteNssOnlyPrepareResult(rpcResult.data);
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
          "[nss-only] auto-precalificar ack falló",
          prepared.expedienteId,
          err,
        );
      }

      setSuccessMsg(
        prepared.action === "reprecal"
          ? "NSS enviado nuevamente al Editor y a precalificación automática."
          : delegateCtx?.can_delegate
            ? "NSS enviado al asesor seleccionado, al Editor y a precalificación automática."
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

  const targetOptions = [
    { value: "", label: "Selecciona un asesor…" },
    ...(delegateCtx?.targets ?? []).map((target) => ({
      value: target.id,
      label: targetLabel(target),
    })),
  ];

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

          {delegateCtx?.can_delegate ? (
            <p className="mt-2 rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
              Conservas tus permisos de equipo: puedes elegir el asesor titular
              antes de precalificar. El cambio de asesor dentro del expediente
              también sigue disponible.
            </p>
          ) : null}

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

          <div className="mt-5 flex flex-col gap-4">
            {delegateCtx?.can_delegate ? (
              <Select
                name="asesor_titular"
                label={delegateCtx.team_name ? `Asesor titular · ${delegateCtx.team_name}` : "Asesor titular"}
                options={targetOptions}
                required
                value={targetAsesorId}
                onChange={(e) => setTargetAsesorId(e.target.value)}
                disabled={submitting || delegateLoading}
                className="min-h-[44px] sm:min-h-0"
              />
            ) : null}

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
              disabled={submitting || delegateLoading}
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
