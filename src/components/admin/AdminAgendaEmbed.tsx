"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type AdminAgendaEmbedProps = Readonly<{
  children: ReactNode;
  backHref: string;
  backLabel: string;
  contextLabel: string;
  hideMesaAgendaBackLink?: boolean;
}>;

/**
 * Presenta las vistas operativas existentes de Agenda dentro del contexto Admin
 * sin duplicar su lógica de negocio ni su header de Mesa Control.
 */
export function AdminAgendaEmbed({
  children,
  backHref,
  backLabel,
  contextLabel,
  hideMesaAgendaBackLink = false,
}: AdminAgendaEmbedProps) {
  return (
    <div
      className={`admin-agenda-embed min-h-screen bg-slate-50 ${
        hideMesaAgendaBackLink ? "admin-agenda-embed-hide-mesa-back" : ""
      }`}
    >
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Panel de administración
            </p>
            <p className="text-sm font-semibold text-slate-900">{contextLabel}</p>
          </div>
          <Link
            href={backHref}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {backLabel}
          </Link>
        </div>
      </header>

      <div className="admin-agenda-embed-body">{children}</div>

      <style jsx global>{`
        .admin-agenda-embed-body > div > header {
          display: none;
        }

        .admin-agenda-embed-body > div:has(> header) {
          min-height: 0;
        }

        .admin-agenda-embed-body > div > main {
          max-width: 100%;
        }

        .admin-agenda-embed-hide-mesa-back
          .admin-agenda-embed-body
          > div
          > main
          > div:first-child
          a[href="/mesa-control/citas"] {
          display: none;
        }
      `}</style>
    </div>
  );
}
