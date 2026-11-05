"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  ADMIN_TABS,
  DEFAULT_ADMIN_TAB,
  adminTabButtonId,
  adminTabPanelId,
  isAdminMainTabId,
  nextAdminTabIdOnKey,
  type AdminMainTabId,
  type AdminTabId,
} from "@/lib/adminUxTabs";

type AdminTabsProps = {
  active: AdminTabId;
  onChange: (tab: AdminMainTabId) => void;
};

/**
 * Barra de navegación por pestañas del panel Admin (B1).
 * Patrón WAI-ARIA tabs: roving tabindex + flechas/Home/End.
 * Expedientes tiene ruta dedicada para mostrar el inventario completo, incluidos
 * los que todavía no se envían a Mesa. El resto conserva el panel histórico.
 * Bernardo no aparece aquí (B3: acceso por botón dedicado).
 * Agenda vive en /admin/agenda para no mantener cargada la agenda pesada
 * cuando Admin está consultando otras pestañas.
 */
export function AdminTabs({ active, onChange }: AdminTabsProps) {
  const router = useRouter();
  const listRef = useRef<HTMLDivElement | null>(null);
  // Notificaciones NUEVAS sin leer, no el total de casas aún pendientes.
  // El estado de lectura se conserva por administrador en Supabase.
  const [nuevasCasas, setNuevasCasas] = useState<number | null>(null);

  useEffect(() => {
    const client = supabaseBrowser;
    if (!client) return;
    let mounted = true;
    let latestRequest = 0;
    const read = async () => {
      const requestId = ++latestRequest;
      const { data, error } = await client.rpc("casas_admin_nuevas_count");
      if (mounted && requestId === latestRequest && !error) {
        const count = Number(data ?? 0);
        if (Number.isFinite(count) && count >= 0) setNuevasCasas(count);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void read();
    };
    const onFocus = () => void read();
    void read();
    const interval = window.setInterval(() => void read(), 20_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const selectedMain: AdminMainTabId | null = isAdminMainTabId(active)
    ? active
    : null;

  const navigateTab = (tab: AdminMainTabId) => {
    if (tab === "expedientes") {
      router.push("/admin/expedientes");
      return;
    }
    onChange(tab);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const base = selectedMain ?? DEFAULT_ADMIN_TAB;
    const next = nextAdminTabIdOnKey(base, e.key);
    if (!next) return;
    e.preventDefault();
    navigateTab(next);
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLButtonElement>(`#${adminTabButtonId(next)}`)
        ?.focus();
    });
  };

  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-[1760px] items-stretch gap-1 overflow-x-auto px-3 sm:px-4 xl:px-5">
        <div
          ref={listRef}
          role="tablist"
          aria-label="Secciones del panel de administración"
          onKeyDown={onKeyDown}
          className="flex gap-1"
        >
          {ADMIN_TABS.map((t) => {
            const selected = selectedMain === t.id;
            const focusable =
              selected || (selectedMain === null && t.id === DEFAULT_ADMIN_TAB);
            return (
              <button
                key={t.id}
                id={adminTabButtonId(t.id)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={adminTabPanelId(t.id)}
                tabIndex={focusable ? 0 : -1}
                onClick={() => navigateTab(t.id)}
                className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1 ${
                  selected
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <Link
          href="/admin/casas"
          className="whitespace-nowrap border-b-2 border-transparent px-4 py-3 text-sm font-semibold text-emerald-800 outline-none transition hover:border-emerald-500 hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-800 focus-visible:ring-offset-1"
        >
          🏠 Compra de casas {nuevasCasas != null && nuevasCasas > 0 ? (
            <span
              aria-label={`${nuevasCasas} casas nuevas sin revisar`}
              title={`${nuevasCasas} casas nuevas desde tu última visita. Entra para marcarlas como vistas.`}
              className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white"
            >
              {nuevasCasas > 99 ? "99+" : nuevasCasas}
            </span>
          ) : null}
        </Link>
        <Link
          href="/admin/agenda"
          className="whitespace-nowrap border-b-2 border-transparent px-4 py-3 text-sm font-medium text-slate-500 outline-none transition hover:border-slate-300 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1"
        >
          Agenda
        </Link>
      </div>
    </nav>
  );
}
