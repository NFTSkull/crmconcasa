"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { supabaseBrowser } from "@/lib/supabaseBrowser";

type SharedItem = Readonly<{ id: string; owner: string }>;

type OwnerDisplayRow = {
  asesor_id: string;
  full_name: string | null;
};

/**
 * Consulta de solo lectura: se muestra únicamente tras un bloqueo del gate NSS.
 * El servidor/RLS restringe la lectura a expedientes que puede ver el asesor.
 * Nunca autoriza una nueva alta ni elimina el bloqueo de un expediente en Mesa.
 */
export function SharedPreMesaExpedienteHints({ nss }: { nss: string }) {
  const [items, setItems] = useState<SharedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setLoaded(false);
    setFailed(false);

    const client = supabaseBrowser;
    if (!client || !/^\d{11}$/.test(nss)) {
      setLoaded(true);
      return;
    }

    void (async () => {
      try {
        const { data, error } = await client
          .from("expedientes")
          .select("id, asesor_id")
          .eq("nss", nss)
          .eq("submitted_to_mesa", false)
          .eq("ciclo_estado", "activo")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) throw error;

        const rows = (data ?? []) as { id: string; asesor_id: string }[];
        const ownerIds = [...new Set(rows.map((r) => r.asesor_id).filter(Boolean))];
        const owners = new Map<string, string>();

        if (ownerIds.length > 0) {
          const { data: names, error: namesError } = await client.rpc(
            "get_asesor_display_batch",
            { p_asesor_ids: ownerIds },
          );
          if (!namesError) {
            for (const name of (names ?? []) as OwnerDisplayRow[]) {
              owners.set(name.asesor_id, name.full_name?.trim() || "Asesor de ConCasa");
            }
          }
        }

        if (!cancelled) {
          setItems(
            rows.map((row) => ({
              id: row.id,
              owner: owners.get(row.asesor_id) ?? "Asesor de ConCasa",
            })),
          );
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nss]);

  if (!loaded) {
    return <p className="mt-2 text-sm text-gray-600" role="status">Buscando expedientes disponibles…</p>;
  }
  if (failed) {
    return (
      <p className="mt-2 text-sm text-amber-900">
        No fue posible cargar los expedientes existentes. Comprueba tu sesión o entra desde la bandeja.
      </p>
    );
  }
  if (items.length === 0) return null;

  return (
    <section aria-label="Expedientes existentes disponibles" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">Puedes trabajar en un expediente existente sin enviar a Mesa</p>
      <p className="mt-1">
        Hay expedientes activos con este NSS. Para evitar duplicados, confirma con el asesor titular cuál corresponde al trámite y abre ese expediente.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/asesor/expediente/${item.id}`}
            className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-3 py-2 font-medium text-gray-900 hover:border-amber-400 hover:bg-amber-100"
          >
            <span>Abrir expediente de {item.owner}</span>
            <span aria-hidden="true">→</span>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs">
        Los expedientes ya enviados a Mesa no se desbloquean. Abrir uno existente no cambia su asesor titular.
      </p>
    </section>
  );
}
