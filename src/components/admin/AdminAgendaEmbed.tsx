"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSessionRepo } from "@/domain/session";

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
 * La ruta /admin sigue siendo exclusiva de super_admin aunque la agenda base
 * también sea reutilizada por roles de Mesa en sus rutas originales.
 */
export function AdminAgendaEmbed({
  children,
  backHref,
  backLabel,
  contextLabel,
  hideMesaAgendaBackLink = false,
}: AdminAgendaEmbedProps) {
  const { currentUser } = useSessionRepo();

  if (!currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Link href="/login" className="text-sm font-medium text-blue-700 underline">
          Inicia sesión
        </Link>
      </div>
    );
  }

  if (currentUser.role !== "super_admin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <p role="alert">No tienes permiso para abrir la agenda desde el panel Admin.</p>
          <Link href="/" className="mt-3 inline-block font-medium underline">
            Volver
          </Link>
        </div>
      </div>
    );
  }

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
