"use client";

import { useCallback, useEffect, useState } from "react";

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

type ReadonlyResult = Readonly<{
  nss: string;
  nombre: string | null;
  rfcInfonavit: string | null;
  motivoRechazo: string | null;
  resultado: "pendiente" | "aprobado" | "no_cumple";
  montoAprobado: number | null;
  createdAt: string;
}>;

function friendlyError(message: string): string {
  const clean = String(message ?? "").trim();
  if (!clean) return "No se pudo precalificar el NSS.";
  const prefix = "asesor_preparar_precalificacion_nss_only_ligada:";
  const index = clean.toLowerCase().indexOf(prefix);
  if (index >= 0) return clean.slice(index + prefix.length).trim();
  return clean;
}

function parseReadonlyResults(payload: unknown): ReadonlyResult[] {
  if (!payload || typeof payload !== "object") return [];
  const rawItems = (payload as { items?: unknown }).items;
  if (!Array.isArray(rawItems)) return [];

  return rawItems.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const resultadoRaw = String(row.resultado ?? "pendiente").trim();
    const resultado: ReadonlyResult["resultado"] =
      resultadoRaw === "aprobado" || resultadoRaw === "no_cumple"
        ? resultadoRaw
        : "pendiente";
    const monto =
      row.monto_aprobado == null ? null : Number(row.monto_aprobado);

    const nombre = String(row.nombre ?? "").trim();
    const rfcInfonavit = String(row.rfc_infonavit ?? "").trim().toUpperCase();
    const motivoRechazo = String(row.motivo_rechazo ?? "").trim();

    return [{
      nss: String(row.nss ?? "").trim(),
      nombre: nombre && nombre !== "POR CAPTURAR" ? nombre : null,
      rfcInfonavit: rfcInfonavit || null,
      motivoRechazo: motivoRechazo || null,
      resultado,
      montoAprobado:
        monto != null && Number.isFinite(monto) ? monto : null,
      createdAt: String(row.created_at ?? ""),
    }];
  });
}

function formatMonto(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatFecha(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Monterrey",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function resultadoLabel(value: ReadonlyResult["resultado"]): string {
  if (value === "aprobado") return "Aprobado";
  if (value === "no_cumple") return "No cumple";
  return "Pendiente";
}

function resultadoClass(value: ReadonlyResult["resultado"]): string {
  if (value === "aprobado") return "bg-emerald-100 text-emerald-800";
  if (value === "no_cumple") return "bg-rose-100 text-rose-800";
  return "bg-amber-100 text-amber-800";
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
  const [results, setResults] = useState<ReadonlyResult[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const loadResults = useCallback(async () => {
    if (!supabaseBrowser) return;
    setLoadingResults(true);
    setResultsError(null);
    try {
      const { data, error } = await supabaseBrowser.rpc(
        "asesor_precalificador_resultados",
        { p_limit: 100 },
      );
      if (error) {
        setResultsError("No se pudieron actualizar tus precalificaciones.");
        return;
      }
      setResults(parseReadonlyResults(data));
    } finally {
      setLoadingResults(false);
    }
  }, []);

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

  useEffect(() => {
    if (!context?.enabled) return;
    void loadResults();
    const interval = window.setInterval(() => {
      void loadResults();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [context?.enabled, loadResults]);

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
      await loadResults();
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
            <p className="text-sm text-slate-600">
              Captura NSS y consulta únicamente tus resultados.
            </p>
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

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
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

        {context?.enabled ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  Mis precalificaciones
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Solo puedes ver los NSS que tú precalificaste, el nombre y RFC devueltos por
                  Bansefi/Infonavit, su resultado, el motivo cuando no cumple y el monto aprobado.
                  El expediente completo únicamente lo administra {titular}.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void loadResults()}
                disabled={loadingResults}
              >
                {loadingResults ? "Actualizando…" : "Actualizar"}
              </Button>
            </div>

            {resultsError ? (
              <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {resultsError}
              </p>
            ) : null}

            {!loadingResults && results.length === 0 ? (
              <p className="mt-5 rounded-lg bg-slate-50 px-4 py-5 text-center text-sm text-slate-600">
                Todavía no tienes precalificaciones.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {results.map((row, index) => (
                  <div
                    key={`${row.nss}-${row.createdAt}-${index}`}
                    className="rounded-lg border border-slate-200 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm font-semibold text-slate-950">
                          NSS {row.nss || "—"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatFecha(row.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${resultadoClass(row.resultado)}`}
                      >
                        {resultadoLabel(row.resultado)}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Nombre
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-950">
                          {row.nombre || "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          RFC Bansefi
                        </p>
                        <p className="mt-1 font-mono text-sm font-semibold text-slate-950">
                          {row.rfcInfonavit || "—"}
                        </p>
                      </div>
                    </div>
                    {row.resultado === "no_cumple" ? (
                      <div className="mt-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-rose-700">
                          Motivo del rechazo
                        </p>
                        <p className="mt-1 text-sm font-medium leading-relaxed text-rose-900">
                          {row.motivoRechazo || "Sin motivo registrado"}
                        </p>
                      </div>
                    ) : null}
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Monto aprobado
                      </p>
                      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">
                        {row.resultado === "aprobado"
                          ? formatMonto(row.montoAprobado)
                          : "—"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
