"use client";

import { useEffect, useState } from "react";

import { AutoPrecalAvailabilityAlert } from "@/components/asesor/AutoPrecalAvailabilityAlert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  normalizeAnetteNssOnlyInput,
  parseAnetteNssOnlyPrepareResult,
  validateAnetteNssOnlyInput,
} from "@/domain/expedientes/anette-nss-only";
import { fireAutoPrecalificarAck } from "@/domain/expedientes/fire-auto-precalificar-ack";
import { resolveBearerAccessToken } from "@/domain/expedientes/resolve-bearer-access-token";
import { useSessionRepo } from "@/domain/session";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type LinkedContext = Readonly<{
  enabled: boolean;
  asesor_titular_id?: string;
  asesor_titular_nombre?: string | null;
  asesor_titular_email?: string | null;
}>;

function friendlyError(message: string): string {
  const clean = String(message ?? "").trim();
  if (!clean) return "No se pudo precalificar el NSS.";
  const prefix = "asesor_preparar_precalificacion_nss_only_ligada:";
  const index = clean.toLowerCase().indexOf(prefix);
  if (index >= 0) return clean.slice(index + prefix.length).trim();
  return clean;
}

export function PrecalificadorNssOnlyDashboard() {
  const { sessionRepo } = useSessionRepo();
  const [nss, setNss] = useState("");
  const [context, setContext] = useState<LinkedContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    if (!supabaseBrowser) {
      setLoadingContext(false);
      return;
    }
    void (async () => {
      try {
        const { data, error } = await supabaseBrowser.rpc(
          "asesor_precalificador_ligado_context",
        );
        if (cancelled) return;
        if (error) {
          setMessage({ tone: "error", text: "No se pudo cargar el asesor ligado." });
          return;
        }
        const row = (data ?? null) as LinkedContext | null;
        setContext(row?.enabled ? row : null);
      } finally {
        if (!cancelled) setLoadingContext(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || !supabaseBrowser) return;
    setMessage(null);

    let normalized: string;
    try {
      normalized = validateAnetteNssOnlyInput(nss);
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "Revisa el NSS.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `linked-${normalized}-${crypto.randomUUID()}`
          : `linked-${normalized}-${Date.now()}`;

      const { data, error } = await supabaseBrowser.rpc(
        "asesor_preparar_precalificacion_nss_only_ligada",
        {
          p_nss: normalized,
          p_idempotency_key: idempotencyKey,
        },
      );

      if (error) {
        setMessage({ tone: "error", text: friendlyError(error.message) });
        return;
      }

      const prepared = parseAnetteNssOnlyPrepareResult(data);
      if (!prepared || prepared.action !== "created") {
        setMessage({
          tone: "error",
          text: "El CRM devolvió una respuesta inválida al preparar el NSS.",
        });
        return;
      }

      const accessToken = await resolveBearerAccessToken(
        supabaseBrowser.auth,
        "precalificador-nss-only",
      );
      const ack = await fireAutoPrecalificarAck({
        expedienteId: prepared.expedienteId,
        accessToken,
        logPrefix: "precalificador-nss-only",
      });

      setNss("");
      setMessage({
        tone: "ok",
        text: ack.ok
          ? "NSS enviado a Anette y a precalificación automática."
          : "NSS registrado para Anette. La precalificación automática quedó pendiente de reintento.",
      });
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "No se pudo precalificar el NSS.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const titular =
    context?.asesor_titular_nombre?.trim() ||
    context?.asesor_titular_email?.trim() ||
    "asesor titular";

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-950">Precalificaciones</h1>
            <p className="text-sm text-slate-600">Captura únicamente el NSS.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void sessionRepo.logout()}
          >
            Cerrar sesión
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-8">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Nueva precalificación</h2>
          <p className="mt-1 text-sm text-slate-600">
            El expediente quedará asignado a <strong>{titular}</strong>. Tú no tendrás
            acceso a documentos, Datos Generales ni al expediente.
          </p>

          <div className="mt-4">
            <AutoPrecalAvailabilityAlert />
          </div>

          {message ? (
            <p
              role={message.tone === "error" ? "alert" : "status"}
              className={
                message.tone === "error"
                  ? "mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  : "mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
              }
            >
              {message.text}
            </p>
          ) : null}

          <form onSubmit={submit} className="mt-5 space-y-4">
            <Input
              name="nss"
              label="IMSS / NSS"
              placeholder="11 dígitos"
              required
              maxLength={11}
              inputMode="numeric"
              autoComplete="off"
              value={nss}
              onChange={(e) => setNss(normalizeAnetteNssOnlyInput(e.target.value))}
              disabled={submitting || loadingContext || !context?.enabled}
              className="min-h-[44px]"
            />
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || loadingContext || !context?.enabled}
              className="min-h-[44px] w-full"
            >
              {submitting ? "Enviando…" : "Precalificar"}
            </Button>
          </form>

          {!loadingContext && !context?.enabled ? (
            <p className="mt-4 text-sm text-red-700">
              Este usuario no tiene un asesor titular ligado. Contacta al administrador.
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
