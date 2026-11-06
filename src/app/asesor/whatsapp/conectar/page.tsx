"use client";

import Link from "next/link";
import { useState } from "react";
import { supabaseBrowser, isSupabaseAuthEnabled } from "@/lib/supabaseBrowser";

type Requirement = { id: string; label: string; state: string };
type Readiness = {
  ready_to_connect: false;
  test_pilot: { linked: boolean; messages_enabled: boolean };
  coexistence: { launch_enabled: false; verified_connections: number; requirements: Requirement[] };
  message: string;
};

const PILOT_UID = "7f5c513e-ca81-4811-a349-531b02a345d3";
const translation: Record<string, string> = {
  pending: "Pendiente",
  not_implemented: "Por implementar",
  manual_review_required: "Verificar en Meta",
};

export default function ConnectMyWhatsAppPilotPage() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkReadiness() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const client = supabaseBrowser;
      if (!client || !isSupabaseAuthEnabled()) {
        throw new Error("Debes iniciar sesión en el CRM operativo de ConCasa.");
      }
      const { data: person, error: authError } = await client.auth.getUser();
      if (authError || person.user?.id !== PILOT_UID) {
        throw new Error("Esta comprobación está habilitada solo para el usuario piloto autorizado.");
      }
      const { data: session } = await client.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Inicia sesión para verificar los permisos del piloto.");
      const reply = await fetch("/api/asesor/whatsapp/onboarding/status", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (reply.status === 403) {
        throw new Error("Tu usuario no está autorizado para esta prueba.");
      }
      if (!reply.ok) throw new Error("No se pudo verificar la configuración del piloto.");
      setResult(await reply.json() as Readiness);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo realizar la comprobación.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <Link href="/asesor/whatsapp-piloto" className="text-sm font-medium text-emerald-800 hover:underline">
          ← Volver a mi WhatsApp Piloto
        </Link>
        <header>
          <h1 className="text-2xl font-semibold">Conectar mi WhatsApp Business</h1>
          <p className="mt-2 text-sm text-slate-600">
            Preparación para conservar WhatsApp Business en tu celular y compartir
            conversaciones individuales compatibles con ConCasa mediante Meta Coexistence.
          </p>
        </header>
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-950">Aún no conectes tu número real</h2>
          <p className="mt-2 text-sm leading-relaxed text-amber-950">
            El número de prueba ya recibe mensajes; la vinculación de un WhatsApp
            Business que utilizas diariamente es diferente. No hemos habilitado
            el intercambio seguro de autorización ni los webhooks necesarios
            para sincronizar lo que contestas desde el teléfono. Esta pantalla
            es una comprobación de preparación, no inicia sesión en Meta.
          </p>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Estado real de la integración</h2>
          <p className="mt-2 text-sm text-slate-600">
            Comprobaremos tu sesión y permisos sin revelar credenciales, abrir
            ventanas de Meta, enviar mensajes o modificar tu WhatsApp.
          </p>
          <button type="button" onClick={() => void checkReadiness()}
            disabled={busy}
            className="mt-4 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Verificando…" : "Comprobar preparación"}
          </button>
          {error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
          {result && (
            <div role="status" className="mt-5 space-y-3">
              <p className="rounded-md bg-slate-100 p-3 text-sm font-medium">{result.message}</p>
              <p className="text-sm text-slate-700">
                Piloto TEST: <strong>{result.test_pilot.linked ? "conectado" : "sin conectar"}</strong>.
                Números Business reales registrados: <strong>{result.coexistence.verified_connections}</strong>.
              </p>
              <ul className="space-y-3">
                {result.coexistence.requirements.map((r) => (
                  <li key={r.id} className="rounded-lg border border-slate-200 p-3">
                    <span className="block text-sm font-medium">{r.label}</span>
                    <span className="mt-1 block text-xs text-amber-800">
                      {translation[r.state] || "Pendiente"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Qué podremos probar cuando Meta lo permita</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>Autorizar oficialmente tu mismo número desde WhatsApp Business, conservando la app.</li>
            <li>Recibir un mensaje controlado en el celular y en ConCasa.</li>
            <li>Responder desde ConCasa y comprobar la entrega.</li>
            <li>Responder desde el celular y comprobar el evento de sincronización en el CRM.</li>
          </ol>
          <p className="mt-4 text-xs text-slate-500">
            Solo la cuenta piloto puede consultar esta preparación. Ningún número
            real se conectará sin tu consentimiento y una confirmación explícita de
            la modalidad Coexistence de Meta.
          </p>
        </section>
      </div>
    </main>
  );
}
