"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { isSupabaseAuthEnabled, supabaseBrowser } from "@/lib/supabaseBrowser";

// Pilot is strictly bound to Meta's ConCasa development test sender.
// Production advisors' WhatsApp Business numbers are NOT eligible here.
const TEST_PHONE_NUMBER_ID = "1374640222406439";
const TEST_WABA_ID = "1624750772211418";

type PilotConnection = {
  id: string;
  display_phone_number: string | null;
};
type Thread = {
  id: string;
  contact_wa_id: string;
  contact_display_name: string | null;
  last_message_at: string | null;
};
type IncomingMessage = {
  id: string;
  conversation_id: string;
  text_body: string | null;
  message_type: string;
  direction: "incoming" | "outgoing";
  sent_at: string;
  source: string;
};

function formatDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short", timeStyle: "short", timeZone: "America/Monterrey",
  }).format(d);
}

function messagePreview(message: IncomingMessage): string {
  if (message.message_type === "text") return message.text_body || "(Sin texto)";
  const known: Record<string, string> = {
    image: "Imagen", video: "Video", document: "Documento",
    audio: "Audio", location: "Ubicación", sticker: "Sticker",
  };
  return known[message.message_type] || "Archivo de WhatsApp";
}

export default function WhatsAppPilotProductionPage() {
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<PilotConnection | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<IncomingMessage[]>([]);
  const [threadBusy, setThreadBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // RLS authorizes advisor_id + active advisor + matching organization.
  // A guessed URL is not enough to access another advisor's messages.
  const load = useCallback(async (cancelled: () => boolean) => {
    setBusy(true);
    setError(null);
    setConnection(null);
    setThreads([]);
    setMessages([]);
    setSelectedId(null);

    const client = supabaseBrowser;
    if (!isSupabaseAuthEnabled() || !client) {
      if (!cancelled()) {
        setBusy(false);
        setError("El acceso seguro mediante Supabase Auth no está habilitado en este entorno.");
      }
      return;
    }

    try {
      const { data: session, error: authError } = await client.auth.getUser();
      if (authError || !session.user) {
        throw new Error("Debes iniciar sesión como asesor de prueba autorizado.");
      }

      // Server-enforced owner RLS. Never accept an advisor id from the URL.
      const account = await client.from("whatsapp_connections")
        .select("id,display_phone_number")
        .eq("connection_type", "meta_test")
        .eq("connection_state", "active")
        .eq("phone_number_id", TEST_PHONE_NUMBER_ID)
        .eq("waba_id", TEST_WABA_ID)
        .limit(1)
        .maybeSingle();
      if (account.error) throw new Error("No se pudo comprobar el permiso del piloto.");
      if (!account.data) {
        throw new Error("Tu usuario aún no está autorizado para el piloto de WhatsApp.");
      }

      const convs = await client.from("whatsapp_conversations")
        .select("id,contact_wa_id,contact_display_name,last_message_at")
        .eq("connection_id", account.data.id)
        .order("last_message_at", { ascending: false })
        .limit(100);
      if (convs.error) throw new Error("No se pudieron cargar tus conversaciones de prueba.");
      if (!cancelled()) {
        const safeThreads = (convs.data || []) as Thread[];
        setConnection(account.data as PilotConnection);
        setThreads(safeThreads);
        setSelectedId(safeThreads[0]?.id ?? null);
      }
    } catch (cause) {
      if (!cancelled()) {
        setError(cause instanceof Error ? cause.message : "La bandeja no está disponible.");
      }
    } finally {
      if (!cancelled()) setBusy(false);
    }
  }, []);

  useEffect(() => {
    let stale = false;
    void load(() => stale);
    return () => { stale = true; };
  }, [load, refresh]);

  useEffect(() => {
    let stale = false;
    const client = supabaseBrowser;
    if (!selectedId || !connection || !client || !threads.some((x) => x.id === selectedId)) {
      setMessages([]);
      return;
    }
    setThreadBusy(true);
    setMessages([]);
    void (async () => {
      const result = await client.from("whatsapp_messages")
        .select("id,conversation_id,text_body,message_type,direction,sent_at,source")
        .eq("conversation_id", selectedId)
        .order("sent_at", { ascending: false })
        .limit(150);
      if (stale) return;
      if (result.error) {
        setError("No se pudieron cargar los mensajes de esta conversación.");
      } else {
        setMessages(((result.data || []) as IncomingMessage[]).reverse());
      }
      setThreadBusy(false);
    })();
    return () => { stale = true; };
  }, [selectedId, connection, threads]);

  async function syncTestMessages() {
    const client = supabaseBrowser;
    if (!connection || !client || !isSupabaseAuthEnabled()) return;
    setSyncing(true);
    setSyncNotice(null);
    try {
      // Invokes an independently deployed Supabase Edge Function requiring
      // a verified advisor JWT and an active owner-only Meta test connection.
      // It cannot transmit WhatsApp messages or process a real advisor number.
      const result = await client.functions.invoke("concasa-meta-wa-pilot-project", {
        method: "POST",
        body: {},
      });
      if (result.error) throw new Error("No se pudo sincronizar la prueba. Revisa tu sesión.");
      const summary = result.data as { claimed?: number; projected?: number; failed?: number } | null;
      if (summary?.failed) {
        throw new Error("Ocurrió un error durante el procesamiento. Revisa los registros del piloto.");
      }
      setSyncNotice(summary?.projected
        ? `Se procesaron ${summary.projected} mensaje(s) de prueba.`
        : "No hay mensajes nuevos pendientes por procesar.");
      setRefresh((n) => n + 1);
    } catch (cause) {
      setSyncNotice(cause instanceof Error ? cause.message : "No se pudo sincronizar.");
    } finally {
      setSyncing(false);
    }
  }

  const selected = threads.find((x) => x.id === selectedId);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/asesor" className="text-sm font-medium text-emerald-800 hover:underline">
              ← Volver a mi panel
            </Link>
            <h1 className="mt-3 text-2xl font-semibold">WhatsApp · Piloto ConCasa</h1>
            <p className="mt-1 text-sm text-slate-600">
              Solo conversaciones del número de prueba de Meta. Bandeja de lectura únicamente.
            </p>
          </div>
          <button type="button" onClick={() => setRefresh((x) => x + 1)}
            disabled={busy}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? "Actualizando..." : "Actualizar mensajes"}
          </button>
        </header>

        {error && (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            {error}
          </div>
        )}

        {connection && !error ? (
          <>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
              Número de prueba conectado: {connection.display_phone_number || "Meta TEST"}.
              No se han conectado teléfonos de asesores reales.
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void syncTestMessages()}
                disabled={syncing || busy}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {syncing ? "Sincronizando…" : "Sincronizar mensajes de prueba"}
              </button>
              {syncNotice && <p role="status" className="text-sm text-slate-700">{syncNotice}</p>}
            </div>

            <div className="grid min-h-[530px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:grid-cols-[320px_1fr]">
              <section className="border-b border-slate-200 md:border-b-0 md:border-r" aria-label="Conversaciones de prueba">
                <h2 className="border-b p-4 text-sm font-semibold">
                  Conversaciones ({threads.length})
                </h2>
                {threads.length === 0 && (
                  <p className="p-4 text-sm text-slate-500">
                    La cuenta está vinculada, pero todavía no hay mensajes procesados.
                  </p>
                )}
                {threads.map((thread) => (
                  <button type="button" key={thread.id} onClick={() => setSelectedId(thread.id)}
                    className={`block w-full border-b p-4 text-left text-sm hover:bg-slate-50 ${selectedId === thread.id ? "bg-emerald-50" : ""}`}>
                    <span className="block truncate font-semibold">
                      {thread.contact_display_name || thread.contact_wa_id}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {formatDate(thread.last_message_at)}
                    </span>
                  </button>
                ))}
              </section>

              <section className="flex min-h-[530px] flex-col" aria-label="Mensajes de prueba">
                <div className="border-b px-4 py-4">
                  <h2 className="font-semibold">
                    {selected?.contact_display_name || selected?.contact_wa_id || "Selecciona una conversación"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Lectura solamente · Los envíos están desactivados
                  </p>
                </div>
                <div className="flex flex-1 flex-col gap-3 bg-slate-50 p-4">
                  {threadBusy && <p className="text-sm text-slate-500">Cargando mensajes...</p>}
                  {!threadBusy && messages.length === 0 && (
                    <p className="m-auto text-sm text-slate-500">No hay mensajes procesados para mostrar.</p>
                  )}
                  {messages.map((message) => (
                    <article key={message.id}
                      className={`max-w-[90%] rounded-xl border border-slate-100 px-4 py-3 text-sm shadow-sm ${message.direction === "outgoing" ? "ml-auto bg-emerald-100" : "mr-auto bg-white"}`}>
                      <p className="whitespace-pre-wrap break-words">{messagePreview(message)}</p>
                      <time className="mt-2 block text-right text-xs text-slate-500">
                        {formatDate(message.sent_at)}
                      </time>
                    </article>
                  ))}
                </div>
                <div className="border-t bg-white px-4 py-3 text-xs text-slate-500">
                  Las respuestas, Coexistence y la vinculación de teléfonos reales todavía no están habilitadas.
                </div>
              </section>
            </div>
          </>
        ) : busy && !error ? (
          <p className="rounded-lg border bg-white p-6 text-sm text-slate-500">Verificando tu acceso al piloto…</p>
        ) : null}
      </div>
    </main>
  );
}
