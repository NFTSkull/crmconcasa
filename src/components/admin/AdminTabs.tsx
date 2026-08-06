"use client";

import { useRef } from "react";
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
 * Solo cambia qué panel es visible; no altera filtros ni datos cargados.
 * Bernardo no aparece aquí (B3: acceso por botón dedicado).
 */
export function AdminTabs({ active, onChange }: AdminTabsProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedMain: AdminMainTabId | null = isAdminMainTabId(active)
    ? active
    : null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const base = selectedMain ?? DEFAULT_ADMIN_TAB;
    const next = nextAdminTabIdOnKey(base, e.key);
    if (!next) return;
    e.preventDefault();
    onChange(next);
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLButtonElement>(`#${adminTabButtonId(next)}`)
        ?.focus();
    });
  };

  return (
    <nav className="border-b border-slate-200 bg-white">
      <div
        ref={listRef}
        role="tablist"
        aria-label="Secciones del panel de administración"
        onKeyDown={onKeyDown}
        className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4"
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
              onClick={() => onChange(t.id)}
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
    </nav>
  );
}
