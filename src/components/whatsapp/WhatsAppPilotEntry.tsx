"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isSupabaseAuthEnabled, supabaseBrowser } from "@/lib/supabaseBrowser";

// Link appears ONLY when DB owner RLS confirms an active test connection
// for the currently authenticated advisor. No global UI flag, no real numbers.
const META_TEST_PHONE = "1374640222406439";
const META_TEST_WABA = "1624750772211418";

export function WhatsAppPilotEntry() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const client = supabaseBrowser;
    if (!client || !isSupabaseAuthEnabled()) return;
    let stale = false;
    void (async () => {
      try {
        const { data: user, error: authError } = await client.auth.getUser();
        if (authError || !user.user) return;
        const { data, error } = await client.from("whatsapp_connections")
          .select("id")
          .eq("connection_type", "meta_test")
          .eq("connection_state", "active")
          .eq("phone_number_id", META_TEST_PHONE)
          .eq("waba_id", META_TEST_WABA)
          .limit(1)
          .maybeSingle();
        if (!stale) setAllowed(!error && Boolean(data));
      } catch {
        if (!stale) setAllowed(false);
      }
    })();
    return () => { stale = true; };
  }, []);
  if (!allowed) return null;
  return (
    <Link href="/asesor/whatsapp-piloto"
      className="inline-flex min-h-[40px] items-center rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100">
      WhatsApp · Piloto
    </Link>
  );
}
