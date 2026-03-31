"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSessionRepo } from "@/domain/session";
import { usePrecalificacionesRepo } from "@/domain/precalificaciones";
import type { Precalificacion, Decision } from "@/domain/precalificaciones";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { NotesFieldWithSuggestions } from "@/components/NotesFieldWithSuggestions";
import { parseMontoAprobado } from "@/lib/monto";

function computeDecision(montoStr: string, notasStr: string): Decision {
  const montoTrim = montoStr.trim();
  const notasTrim = (notasStr ?? "").trim();
  const num = montoTrim === "" ? null : Number(montoTrim);
  const hasMonto = num !== null && !Number.isNaN(num) && num >= 0;
  if (hasMonto) return "aprobado";
  if (notasTrim.length > 0) return "no_cumple";
  return "pendiente";
}

interface FormEditarPrecalificacionProps {
  id: string;
  precal: Precalificacion;
  backHref: string;
  redirectTo: string;
}

export function FormEditarPrecalificacion({
  id,
  precal,
  backHref,
  redirectTo,
}: FormEditarPrecalificacionProps) {
  const router = useRouter();
  const { currentUser } = useSessionRepo();
  const repo = usePrecalificacionesRepo();
  const [notesSuggestions, setNotesSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!currentUser) return;
    repo
      .listForUser({ email: currentUser.email, role: currentUser.role })
      .then((list) => {
        const set = new Set<string>();
        list.forEach((p) => {
          const n = (p.notas_revision ?? "").trim();
          if (n) set.add(n);
        });
        setNotesSuggestions(Array.from(set).sort());
      });
  }, [currentUser, repo]);

  const [monto_aprobado, setMontoAprobado] = useState<string>(
    precal.monto_aprobado != null ? String(precal.monto_aprobado) : ""
  );
  const [notas_revision, setNotasRevision] = useState(
    precal.notas_revision ?? ""
  );

  const decision = computeDecision(monto_aprobado, notas_revision);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = monto_aprobado;
    const num = parseMontoAprobado(raw);
    if (raw.trim() !== "" && (num === null || num < 0)) return;
    try {
      await repo.update(id, {
        decision,
        monto_aprobado: num,
        notas_revision: notas_revision.trim(),
      });
      router.push(redirectTo);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al guardar.");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href={backHref} className="text-sm text-gray-500 hover:text-gray-700">
            ← Volver al dashboard
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">
            ConCasa CRM · Editar precalificación
          </h1>
          <span />
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-8">
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          <p>
            <span className="font-medium text-gray-900">Programa:</span>{" "}
            {precal.programa}
          </p>
          <p>
            <span className="font-medium text-gray-900">NSS:</span> {precal.nss}
          </p>
          <p>
            <span className="font-medium text-gray-900">Cliente:</span>{" "}
            {precal.cliente_nombre ?? "—"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Teléfono:</span>{" "}
            {precal.telefono_cliente ?? "—"}
          </p>
          <p>
            <span className="font-medium text-gray-900">Asesor:</span>{" "}
            {precal.asesorId}
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <div className="flex flex-col gap-4">
            <Input
              name="monto_aprobado"
              type="number"
              label="Monto aprobado"
              placeholder="Ej. 500000"
              min={0}
              step={1}
              value={monto_aprobado}
              onChange={(e) => setMontoAprobado(e.target.value)}
              className="no-spinner font-semibold text-gray-900"
            />
            <div className="flex flex-col gap-1">
              <label
                htmlFor="notas_revision"
                className="text-sm font-medium text-gray-700"
              >
                Notas del revisor
              </label>
              <NotesFieldWithSuggestions
                id="notas_revision"
                value={notas_revision}
                onChange={setNotasRevision}
                suggestions={notesSuggestions}
                placeholder="Comentarios del revisor..."
                className="rounded-lg border border-gray-300 px-3 py-2 font-medium text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                rows={3}
              />
            </div>
            <p className="text-sm text-gray-500">
              Decisión automática:{" "}
              {decision === "aprobado"
                ? "Aprobado (hay monto)"
                : decision === "no_cumple"
                  ? "No cumple criterios (notas sin monto)"
                  : "Pendiente"}
            </p>
          </div>
          <div className="mt-6 flex gap-3">
            <Button type="submit" variant="primary">
              Guardar
            </Button>
            <Link href={backHref}>
              <Button type="button" variant="secondary">
                Cancelar
              </Button>
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
