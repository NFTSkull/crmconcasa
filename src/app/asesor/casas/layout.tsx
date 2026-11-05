import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Pausa operativa temporal: cubre /asesor/casas y /asesor/casas/[id].
 * Los componentes existentes se conservan para una reactivación posterior.
 * Los permisos de escritura también están suspendidos en Supabase.
 */
export default function CasasAsesoresPausadasLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  void children;
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
        <span aria-hidden="true" className="text-3xl">⌂</span>
        <h1 className="mt-3 text-xl font-semibold text-slate-900">
          Compra de casas no disponible
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Esta sección está temporalmente inhabilitada para los asesores de ConCasa.
          No es necesario realizar ninguna acción.
        </p>
        <Link href="/asesor" className="mt-6 inline-flex rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">
          Regresar a mi CRM
        </Link>
      </section>
    </main>
  );
}
