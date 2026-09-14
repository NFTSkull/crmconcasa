"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { getAdminEtapaDisplayNombre } from "@/domain/admin-production/admin-visible-stages";
import {
  fetchAdminExpedientesOverviewAsesores,
  fetchAdminExpedientesOverviewPage,
  type AdminExpedienteAsesorOption,
  type AdminExpedienteEstadoFilter,
  type AdminExpedienteOverviewRow,
  type AdminMesaStatusFilter,
} from "@/domain/admin-expedientes-overview";
import { useSessionRepo } from "@/domain/session";
import { formatDateTimeMx } from "@/lib/filters";
import type { AdminMainTabId } from "@/lib/adminUxTabs";

const PAGE_SIZE = 25;

function displayDateTime(value: string | null | undefined): string {
  return value ? formatDateTimeMx(value) : "—";
}

function asesorLabel(a: AdminExpedienteAsesorOption): string {
  return a.asesorNombre || a.asesorEmail || "Asesor sin nombre";
}

function estadoBadge(row: AdminExpedienteOverviewRow) {
  if (row.cicloEstado === "cancelado") {
    return "Cancelado";
  }
  if (row.subestado === "rechazado") {
    return "Rechazado";
  }
  if (row.cicloEstado === "cerrado" || row.etapaActual >= 11) {
    return "Finalizado";
  }
  return "Activo";
}

export default function AdminExpedientesPage() {
  const router = useRouter();
  const { currentUser, sessionRepo } = useSessionRepo();
  const [asesores, setAsesores] = useState<readonly AdminExpedienteAsesorOption[]>([]);
  const [asesorId, setAsesorId] = useState("");
  const [etapa, setEtapa] = useState("todas");
  const [estado, setEstado] = useState<AdminExpedienteEstadoFilter>("todos");
  const [mesaStatus, setMesaStatus] = useState<AdminMesaStatusFilter>("todos");
  const [buscar, setBuscar] = useState("");
  const [buscarDebounced, setBuscarDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<readonly AdminExpedienteOverviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setBuscarDebounced(buscar.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [buscar]);

  useEffect(() => {
    setPage(1);
  }, [asesorId, etapa, estado, mesaStatus, buscarDebounced]);

  useEffect(() => {
    if (currentUser?.role !== "super_admin") return;
    void fetchAdminExpedientesOverviewAsesores()
      .then(setAsesores)
      .catch(() => setAsesores([]));
  }, [currentUser?.role]);

  useEffect(() => {
    if (currentUser?.role !== "super_admin") return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    void fetchAdminExpedientesOverviewPage({
      page,
      pageSize: PAGE_SIZE,
      asesorId: asesorId || null,
      etapaActual: etapa === "todas" ? null : Number(etapa),
      estado,
      buscar: buscarDebounced || null,
      mesaStatus,
    })
      .then((result) => {
        if (seq !== requestSeq.current) return;
        setItems(result.items);
        setTotal(result.totalCount);
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setItems([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : "No se pudieron cargar los expedientes.");
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [currentUser?.role, page, asesorId, etapa, estado, buscarDebounced, mesaStatus]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const asesorOptions = useMemo(
    () => [
      { value: "", label: "Todos los asesores" },
      ...asesores.map((a) => ({ value: a.asesorId, label: asesorLabel(a) })),
    ],
    [asesores],
  );
  const etapaOptions = useMemo(
    () => [
      { value: "todas", label: "Todas las etapas" },
      ...Array.from({ length: 12 }, (_, i) => {
        const etapaActual = i + 1;
        return {
          value: String(etapaActual),
          label: `${etapaActual}. ${getAdminEtapaDisplayNombre(etapaActual)}`,
        };
      }),
    ],
    [],
  );

  const clearFilters = () => {
    setAsesorId("");
    setEtapa("todas");
    setEstado("todos");
    setMesaStatus("todos");
    setBuscar("");
    setBuscarDebounced("");
    setPage(1);
  };

  const handleTabChange = (tab: AdminMainTabId) => {
    if (tab === "expedientes") return;
    router.push(`/admin?adminTab=${encodeURIComponent(tab)}`);
  };

  if (currentUser === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100">Cargando…</div>;
  }

  if (!currentUser || currentUser.role !== "super_admin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <Link href="/login" className="text-blue-700 underline">Inicia sesión como Super Admin</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">Administración</h1>
            <p className="text-sm text-slate-600">Inventario completo y trazabilidad de expedientes.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">{currentUser.email}</span>
            <Button type="button" variant="secondary" onClick={() => void sessionRepo.logout()}>
              Cerrar sesión
            </Button>
          </div>
        </div>
      </header>

      <AdminTabs active="expedientes" onChange={handleTabChange} />

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Expedientes</h2>
              <p className="mt-1 text-sm text-slate-600">
                Inventario actual. Incluye expedientes enviados y todavía no enviados a Mesa; no depende del periodo de producción.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
              {total.toLocaleString("es-MX")} expediente{total === 1 ? "" : "s"}
            </span>
          </div>

          <div className="mt-5">
            <p className="mb-2 text-sm font-medium text-slate-700">Envío a Mesa</p>
            <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Filtrar por envío a Mesa">
              {([
                ["todos", "Todos"],
                ["enviados", "Enviados a Mesa"],
                ["no_enviados", "No enviados"],
              ] as const).map(([value, label]) => {
                const active = mesaStatus === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setMesaStatus(value)}
                    className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                      active
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-700 hover:bg-white"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Select
              label="Asesor"
              value={asesorId}
              onChange={(e) => setAsesorId(e.target.value)}
              options={asesorOptions}
            />
            <Select
              label="Etapa actual"
              value={etapa}
              onChange={(e) => setEtapa(e.target.value)}
              options={etapaOptions}
            />
            <Select
              label="Estado"
              value={estado}
              onChange={(e) => setEstado(e.target.value as AdminExpedienteEstadoFilter)}
              options={[
                { value: "todos", label: "Todos" },
                { value: "activos", label: "Activos" },
                { value: "finalizados", label: "Finalizados" },
                { value: "rechazados", label: "Rechazados" },
                { value: "cancelados", label: "Cancelados" },
              ]}
            />
            <Input
              label="Buscar"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Cliente, NSS, asesor, programa"
            />
            <div className="flex items-end">
              <Button type="button" variant="secondary" className="w-full" onClick={clearFilters}>
                Limpiar filtros
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Detalle de expedientes</h2>
              <p className="text-sm text-slate-600">
                El detalle completo muestra documentos, correcciones, citas, decisiones e historial.
              </p>
            </div>
            <span className="text-xs text-slate-500">Página {Math.min(page, totalPages)} de {totalPages}</span>
          </div>

          {error ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
          ) : null}

          {loading ? (
            <p className="mt-5 text-sm text-slate-600">Cargando expedientes…</p>
          ) : items.length === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
              No hay expedientes que coincidan con estos filtros.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1120px] w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-3">Cliente</th>
                    <th className="px-2 py-3">Asesor</th>
                    <th className="px-2 py-3">Programa / etapa</th>
                    <th className="px-2 py-3">Mesa</th>
                    <th className="px-2 py-3">Documentos</th>
                    <th className="px-2 py-3">Estado</th>
                    <th className="px-2 py-3">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.expedienteId} className="border-b border-slate-100 align-top last:border-0 hover:bg-slate-50/70">
                      <td className="px-2 py-3">
                        <p className="font-semibold text-slate-900">{row.clienteNombre || "Sin nombre"}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">NSS {row.nss || "—"}</p>
                      </td>
                      <td className="px-2 py-3 text-slate-800">
                        <p>{row.asesorNombre || "Asesor sin nombre"}</p>
                        {row.asesorEmail ? <p className="mt-0.5 text-xs text-slate-500">{row.asesorEmail}</p> : null}
                      </td>
                      <td className="px-2 py-3">
                        <p className="text-slate-900">{row.programa || "—"}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{row.etapaActual}. {getAdminEtapaDisplayNombre(row.etapaActual)}</p>
                      </td>
                      <td className="px-2 py-3">
                        {row.enviadoAMesa ? (
                          <>
                            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-900">Enviado</span>
                            <p className="mt-1 text-xs tabular-nums text-slate-600">{displayDateTime(row.fechaEnvioMesa)}</p>
                          </>
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">No enviado</span>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <p className="font-medium text-slate-900">{row.documentosActivosCount} activo{row.documentosActivosCount === 1 ? "" : "s"}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{row.documentosTotalCount} versión{row.documentosTotalCount === 1 ? "" : "es"} total</p>
                        {row.ultimoDocumentoAt ? <p className="mt-0.5 text-xs text-slate-500">Último: {displayDateTime(row.ultimoDocumentoAt)}</p> : <p className="mt-0.5 text-xs text-slate-400">Sin documentos</p>}
                      </td>
                      <td className="px-2 py-3">
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{estadoBadge(row)}</span>
                        {row.subestado ? <p className="mt-1 text-xs text-slate-500">{row.subestado}</p> : null}
                      </td>
                      <td className="px-2 py-3">
                        <Link
                          href={`/admin/expedientes/${encodeURIComponent(row.expedienteId)}`}
                          className="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
                        >
                          Ver detalle
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && total > PAGE_SIZE ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-600">
                Mostrando {Math.min(total, (page - 1) * PAGE_SIZE + 1)}–{Math.min(total, page * PAGE_SIZE)} de {total.toLocaleString("es-MX")}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Anterior
                </Button>
                <Button type="button" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  Siguiente
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
