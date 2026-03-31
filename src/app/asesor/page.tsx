"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionRepo } from "@/domain/session";
import { usePrecalificacionesRepo } from "@/domain/precalificaciones";
import { Button } from "@/components/ui/Button";
import { FiltersBar } from "@/components/FiltersBar";
import type { Precalificacion } from "@/domain/precalificaciones";
import {
  applyFilters,
  formatDateTimeMx,
  DEFAULT_FILTERS,
  type FiltersState,
} from "@/lib/filters";
import { supabase } from "@/lib/supabaseClient";
import { formatMontoMX } from "@/lib/monto";

const MAX_NOTAS_LEN = 70;

function truncateNotas(s: string | undefined): string {
  const t = (s ?? "").trim();
  if (t.length <= MAX_NOTAS_LEN) return t || "—";
  return t.slice(0, MAX_NOTAS_LEN) + "…";
}

function DecisionBadge({ decision }: { decision?: string }) {
  const d = decision ?? "pendiente";
  const styles =
    d === "aprobado"
      ? "bg-green-100 text-green-800"
      : d === "no_cumple"
        ? "bg-red-100 text-red-800"
        : "bg-amber-100 text-amber-800";
  const label =
    d === "aprobado"
      ? "Aprobado"
      : d === "no_cumple"
        ? "No cumple"
        : "Pendiente";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}
    >
      {label}
    </span>
  );
}

const pageSize = 50;

export default function AsesorDashboardPage() {
  const { sessionRepo, currentUser } = useSessionRepo();
  const repo = usePrecalificacionesRepo();
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [list, setList] = useState<Precalificacion[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  const fullList = useMemo(
    () => (currentUser ? list : []),
    [currentUser, list]
  );

  useEffect(() => {
    if (!currentUser) return;
    repo
      .listPageForUser(
        { email: currentUser.email, role: currentUser.role },
        { page, pageSize }
      )
      .then(({ data, count }) => {
        setList(data);
        setTotalCount(count);
        const totalPages = Math.ceil(count / pageSize) || 1;
        setPage((p) => (totalPages > 0 && p > totalPages ? totalPages : p));
      });
  }, [currentUser, repo, page, pageSize]);

  const refreshPage = useCallback(async () => {
    if (!currentUser) return;
    const { data, count } = await repo.listPageForUser(
      { email: currentUser.email, role: currentUser.role },
      { page: pageRef.current, pageSize }
    );
    setList(data);
    setTotalCount(count);
    const totalPages = Math.ceil(count / pageSize) || 1;
    setPage((p) => (totalPages > 0 && p > totalPages ? totalPages : p));
  }, [currentUser, repo, pageSize]);

  useEffect(() => {
    if (!currentUser) return;
    const debounceRef = { timeoutId: null as ReturnType<typeof setTimeout> | null };
    const channelRef = { current: null as ReturnType<typeof supabase.channel> | null };
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return;
      const ch = supabase
        .channel("precalificaciones-asesor-live")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "precalificaciones",
            filter: `asesorId=eq.${uid}`,
          },
          (payload: { eventType?: string }) => {
            if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return;
            if (payload.eventType === "INSERT") {
              if (pageRef.current === 1) {
                refreshPage();
              } else {
                setPage(1);
              }
              return;
            }
            if (debounceRef.timeoutId) clearTimeout(debounceRef.timeoutId);
            debounceRef.timeoutId = setTimeout(() => {
              refreshPage();
              debounceRef.timeoutId = null;
            }, 300);
          }
        )
        .subscribe();
      channelRef.current = ch;
    })();
    return () => {
      if (debounceRef.timeoutId) clearTimeout(debounceRef.timeoutId);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [currentUser, refreshPage]);

  const filteredList = useMemo(
    () => applyFilters(fullList, filters),
    [fullList, filters]
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const canPrevious = page > 1;
  const canNext = page < totalPages;
  const handlePrevious = useCallback(() => {
    if (canPrevious) setPage((p) => p - 1);
  }, [canPrevious]);
  const handleNext = useCallback(() => {
    if (canNext) setPage((p) => p + 1);
  }, [canNext]);

  if (currentUser === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }
  if (!currentUser || currentUser.role !== "asesor") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-600">
          No has iniciado sesión como asesor.{" "}
          <Link href="/login" className="text-blue-600 underline">
            Ir a login
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-3 py-3 sm:px-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-base font-semibold text-gray-900 sm:text-lg">
            ConCasa CRM · Asesor
          </h1>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="min-w-0 truncate text-sm text-gray-500">
              {currentUser.email}
            </span>
            <Button
              variant="outline"
              onClick={() => sessionRepo.logout()}
              className="min-h-[44px] touch-manipulation sm:min-h-0"
            >
              Cerrar sesión
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6 lg:max-w-7xl lg:px-6 xl:max-w-[1400px]">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <h2 className="text-lg font-medium text-gray-900 sm:text-xl">
            Mis precalificaciones
          </h2>
          <Link href="/asesor/nueva" className="w-full sm:w-auto">
            <Button
              variant="primary"
              className="min-h-[44px] w-full touch-manipulation sm:min-h-0 sm:w-auto"
            >
              Nueva precalificación
            </Button>
          </Link>
        </div>

        <FiltersBar
          filters={filters}
          setFilters={setFilters}
          asesorOptions={[]}
          showAsesorFilter={false}
          showProgramaFilter={false}
        />

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <span className="text-sm text-gray-600">
            Página {page} de {totalPages} · Total: {totalCount}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={!canPrevious}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              onClick={handleNext}
              disabled={!canNext}
            >
              Siguiente
            </Button>
          </div>
        </div>

        {/* Vista móvil: tarjetas (solo asesor, no afecta web revisor/admin) */}
        <div className="space-y-3 sm:hidden">
          {filteredList.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
              No hay precalificaciones. Crea una nueva.
            </div>
          ) : (
            filteredList.map((p) => {
              const telefono = p.telefono_cliente;
              const digits = telefono?.replace(/\D/g, "");
              const waHref = digits ? `https://wa.me/52${digits}` : null;
              return (
                <div
                  key={p.id}
                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="space-y-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2">
                      <span className="text-xs text-gray-500">
                        {formatDateTimeMx(p.createdAt)}
                      </span>
                      <DecisionBadge decision={p.decision} />
                    </div>
                    <div>
                      <span className="font-medium text-gray-500">Cliente: </span>
                      <span className="text-gray-900">{p.cliente_nombre ?? "—"}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-500">Programa: </span>
                      <span className="text-gray-900">{p.programa}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-500">NSS: </span>
                      <span className="text-gray-900">{p.nss}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-500">Teléfono: </span>
                      {waHref ? (
                        <a
                          href={waHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline break-all"
                        >
                          {telefono}
                        </a>
                      ) : (
                        <span className="text-gray-900">—</span>
                      )}
                    </div>
                    <div>
                      <span className="font-medium text-gray-500">Monto: </span>
                      <span className="text-gray-900">
                        {p.decision === "no_cumple"
                          ? "—"
                          : p.monto_aprobado != null
                            ? formatMontoMX(p.monto_aprobado)
                            : "—"}
                      </span>
                    </div>
                    {(p.notas_revision ?? "").trim() && (
                      <div>
                        <span className="font-medium text-gray-500">Notas: </span>
                        <span className="text-gray-600">
                          {truncateNotas(p.notas_revision)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Vista escritorio: tabla ajustable sin depender de min-width fijo */}
        <div className="hidden sm:block">
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="sm:w-[110px] lg:w-auto px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Creada
                  </th>
                  <th className="sm:w-[110px] lg:w-auto px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Programa
                  </th>
                  <th className="sm:w-[120px] lg:w-auto px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    NSS
                  </th>
                  <th className="sm:w-[220px] lg:w-auto px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Cliente
                  </th>
                  <th className="sm:w-[140px] lg:w-auto px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Teléfono
                  </th>
                  <th className="sm:w-[120px] lg:w-auto px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Decisión
                  </th>
                  <th className="sm:w-[240px] md:w-[260px] lg:w-auto px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Notas
                  </th>
                  <th className="sm:w-[150px] lg:w-auto px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Monto aprobado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {filteredList.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-sm text-gray-500"
                    >
                      No hay precalificaciones. Crea una nueva.
                    </td>
                  </tr>
                ) : (
                  filteredList.map((p) => {
                    const telefono = p.telefono_cliente;
                    const digits = telefono?.replace(/\D/g, "");
                    const waHref = digits ? `https://wa.me/52${digits}` : null;
                    return (
                      <tr key={p.id} className="hover:bg-gray-50">
                        {/* columnas cortas: mantener nowrap */}
                        <td className="sm:w-[110px] lg:w-auto whitespace-nowrap px-3 py-2 text-xs text-gray-500 align-top">
                          {formatDateTimeMx(p.createdAt)}
                        </td>
                        <td className="sm:w-[110px] lg:w-auto whitespace-nowrap px-3 sm:px-4 py-3 text-sm text-gray-900 align-top">
                          {p.programa}
                        </td>
                        <td className="sm:w-[120px] lg:w-auto whitespace-nowrap px-3 sm:px-4 py-3 text-sm text-gray-600 align-top">
                          {p.nss}
                        </td>
                        {/* columnas largas: permitir salto de línea y alinear arriba */}
                        <td className="sm:w-[220px] lg:w-auto px-3 sm:px-4 py-3 text-sm text-gray-600 align-top">
                          {p.cliente_nombre ?? "—"}
                        </td>
                        <td className="sm:w-[140px] lg:w-auto px-3 sm:px-4 py-3 text-sm text-gray-600 align-top">
                          {waHref ? (
                            <a
                              href={waHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline break-all"
                            >
                              {telefono}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="sm:w-[120px] lg:w-auto whitespace-nowrap px-3 sm:px-4 py-3 align-top">
                          <DecisionBadge decision={p.decision} />
                        </td>
                        {/* Notas: dar ancho razonable y truncar */}
                        <td className="sm:w-[240px] md:w-[260px] lg:w-auto max-w-[260px] truncate px-3 sm:px-4 py-3 text-sm text-gray-600 align-top">
                          {truncateNotas(p.notas_revision)}
                        </td>
                        <td className="sm:w-[150px] lg:w-auto whitespace-nowrap px-3 sm:px-4 py-3 text-sm text-gray-600 align-top">
                          {p.decision === "no_cumple"
                            ? "—"
                            : p.monto_aprobado != null
                              ? formatMontoMX(p.monto_aprobado)
                              : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
