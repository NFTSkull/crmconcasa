"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * Compatibilidad con enlaces históricos de Admin.
 * `/admin/:id` ahora representa un expediente operativo; la edición antigua de
 * precalificación vive en `/admin/precalificacion/:id`.
 */
export default function AdminExpedienteCompatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (!id) return;
    router.replace(`/admin/expediente/${encodeURIComponent(id)}`);
  }, [id, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <p className="text-slate-600">Abriendo expediente completo…</p>
    </div>
  );
}
