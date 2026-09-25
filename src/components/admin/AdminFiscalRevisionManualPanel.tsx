"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AdminFiscalRevisionManualItem } from "@/domain/validacion-fiscal/admin-aprobar-envio-mesa";
import {
  fetchAdminFiscalRevisionManual,
  postAdminFiscalAprobarEnvioMesa,
} from "@/domain/validacion-fiscal/admin-fiscal-client";
import { formatDateTimeMx } from "@/lib/filters";

type Props = {
  /** Si se pasa, solo muestra/aprueba ese expediente (detalle). */
  expedienteId?: string;
};

export function AdminFiscalRevisionManualPanel({ expedienteId }: Props) {
  const [items, setItems] = useState<AdminFiscalRevisionManualItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [motivoById, setMotivoById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items: next } = await fetchAdminFiscalRevisionManual();
      const filtered = expedienteId
        ? next.filter((i) => i.expedienteId === expedienteId)
        : next;
      setItems(filtered);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : "No se pudo cargar la revisión manual.");
    } finally {
      setLoading(false);
    }
  }, [expedienteId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onAprobar = async (id: string) => {
    const motivo = (motivoById[id] ?? "").trim();
    setFlash(null);
    if (motivo.length < 10) {
      setFlash({
        kind: "err",
        text: "El motivo debe tener al menos 10 caracteres.",
      });
      return;
    }
    setBusyId(id);
    try {
      await postAdminFiscalAprobarEnvioMesa({ expedienteId: id, motivo });
      setFlash({
        kind: "ok",
        text: "Envío a Mesa aprobado sin validación SAT. El expediente quedó enviado.",
      });
      setMotivoById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await reload();
    } catch (e) {
      setFlash({
        kind: "err",
        text: e instanceof Error ? e.message : "No se pudo aprobar el envío.",
      });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Revisión manual fiscal (SAT)</h2>
        <p className="mt-2 text-sm text-slate-600">Cargando…</p>
      </section>
    );
  }

  if (expedienteId && items.length === 0 && !error) {
    return null;
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Revisión manual fiscal (SAT)</h2>
          <p className="mt-1 text-sm text-slate-600">
            Expedientes con validación SAT vigente en revisión manual. Solo super_admin puede aprobar el envío sin
            validación SAT (queda auditado).
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-950">
          {items.length} pendiente{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {flash ? (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            flash.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
          role="status"
        >
          {flash.text}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      ) : null}

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">No hay expedientes en revisión manual fiscal.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li
              key={item.expedienteId}
              className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  {expedienteId ? (
                    <p className="font-semibold text-slate-950">{item.clienteNombre}</p>
                  ) : (
                    <Link
                      href={`/admin/expedientes/${item.expedienteId}`}
                      className="font-semibold text-blue-800 underline-offset-2 hover:underline"
                    >
                      {item.clienteNombre}
                    </Link>
                  )}
                  <p className="mt-1 text-xs text-slate-600">
                    NSS {item.nssMasked} · Asesor {item.asesorNombre} ·{" "}
                    {item.realizadoAt ? formatDateTimeMx(item.realizadoAt) : "—"}
                  </p>
                  <p className="mt-1 text-sm text-slate-800">
                    <span className="font-medium">Motivo SAT:</span> {item.motivoResumen}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="block flex-1 text-sm text-slate-700">
                  Motivo de aprobación (mín. 10 caracteres)
                  <textarea
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
                    rows={2}
                    value={motivoById[item.expedienteId] ?? ""}
                    onChange={(e) =>
                      setMotivoById((prev) => ({
                        ...prev,
                        [item.expedienteId]: e.target.value,
                      }))
                    }
                    disabled={busyId === item.expedienteId}
                    placeholder="Explica por qué se aprueba el envío sin validación SAT…"
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busyId === item.expedienteId}
                  onClick={() => void onAprobar(item.expedienteId)}
                >
                  {busyId === item.expedienteId
                    ? "Aprobando…"
                    : "Aprobar envío sin validación SAT"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
