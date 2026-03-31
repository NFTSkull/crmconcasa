"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionRepo } from "@/domain/session";
import { usePrecalificacionesRepo } from "@/domain/precalificaciones";
import type { Precalificacion } from "@/domain/precalificaciones";
import { Button } from "@/components/ui/Button";
import { FiltersBar } from "@/components/FiltersBar";
import {
  applyFilters,
  groupByDay,
  formatDateTimeMx,
  formatDateKeyToDisplay,
  DEFAULT_FILTERS,
  type FiltersState,
} from "@/lib/filters";
import type { Decision } from "@/domain/precalificaciones";
import { NotesFieldWithSuggestions } from "@/components/NotesFieldWithSuggestions";
import { getAsesorDisplayMap, getAsesorDisplayLabel } from "@/lib/asesorDisplay";
import { supabase } from "@/lib/supabaseClient";
import { parseMontoAprobado } from "@/lib/monto";

function computeDecision(montoStr: string, notasStr: string): Decision {
  const notasTrim = (notasStr ?? "").trim();
  const num = parseMontoAprobado(montoStr);
  const hasMonto = num !== null && num >= 0;
  if (hasMonto) return "aprobado";
  if (notasTrim.length > 0) return "no_cumple";
  return "pendiente";
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

interface RevisorRowProps {
  p: Precalificacion;
  suggestions: string[];
  asesorMap: Map<string, string>;
  updatePrecalificacion: (
    id: string,
    data: {
      decision?: Decision;
      monto_aprobado: number | null;
      notas_revision: string;
    }
  ) => void;
}

function RevisorRow({ p, suggestions, asesorMap, updatePrecalificacion }: RevisorRowProps) {
  type EditingField = "monto" | "notas" | null;
  const [editingField, setEditingField] = useState<EditingField>(null);
  const [draftValue, setDraftValue] = useState("");

  const montoFromP = p.monto_aprobado != null ? String(p.monto_aprobado) : "";
  const notasFromP = p.notas_revision ?? "";
  const montoStr = editingField === "monto" ? draftValue : montoFromP;
  const notasStr = editingField === "notas" ? draftValue : notasFromP;

  const persist = (monto: string, notas: string) => {
    const validNum = parseMontoAprobado(monto);
    const decision = computeDecision(monto, notas);
    updatePrecalificacion(p.id, {
      decision,
      monto_aprobado: validNum,
      notas_revision: notas.trim(),
    });
  };

  const onFocusMonto = () => {
    setEditingField("monto");
    setDraftValue(montoFromP);
  };
  const onFocusNotas = () => {
    setEditingField("notas");
    setDraftValue(notasFromP);
  };
  const onBlurMonto = () => {
    const monto = editingField === "monto" ? draftValue : montoFromP;
    const notas = editingField === "notas" ? draftValue : notasFromP;
    persist(monto, notas);
    setEditingField(null);
  };
  const onBlurNotas = () => {
    const monto = editingField === "monto" ? draftValue : montoFromP;
    const notas = editingField === "notas" ? draftValue : notasFromP;
    persist(monto, notas);
    setEditingField(null);
  };

  const decision = computeDecision(montoStr, notasStr);

  return (
    <tr className="hover:bg-gray-50">
      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
        {formatDateTimeMx(p.createdAt)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
        {p.programa}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
        {p.nss}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
        {p.cliente_nombre ?? "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
        {p.telefono_cliente ?? "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
        {getAsesorDisplayLabel(p.asesorId, asesorMap)}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <DecisionBadge decision={decision} />
      </td>
      <td className="min-w-[140px] px-4 py-2">
        <input
          type="number"
          min={0}
          step={1}
          placeholder="Monto"
          className="no-spinner w-full min-w-[120px] rounded border border-gray-300 px-2 py-1.5 text-sm font-semibold text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={montoStr}
          onChange={(e) =>
            editingField === "monto"
              ? setDraftValue(e.target.value)
              : (setEditingField("monto"), setDraftValue(e.target.value))
          }
          onFocus={onFocusMonto}
          onBlur={onBlurMonto}
        />
      </td>
      <td className="min-w-[260px] px-4 py-2">
        <NotesFieldWithSuggestions
          value={notasStr}
          onChange={(val) =>
            editingField === "notas"
              ? setDraftValue(val)
              : (setEditingField("notas"), setDraftValue(val))
          }
          onFocus={onFocusNotas}
          onBlur={onBlurNotas}
          suggestions={suggestions}
          placeholder="Notas..."
          className="w-full resize-y rounded border border-gray-300 px-2 py-1.5 text-sm font-medium text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          rows={2}
        />
      </td>
    </tr>
  );
}

function RevisorTableBody({
  list,
  suggestions,
  asesorMap,
  updatePrecalificacion,
}: {
  list: Precalificacion[];
  suggestions: string[];
  asesorMap: Map<string, string>;
  updatePrecalificacion: RevisorRowProps["updatePrecalificacion"];
}) {
  return (
    <>
      {list.map((p) => (
        <RevisorRow
          key={p.id}
          p={p}
          suggestions={suggestions}
          asesorMap={asesorMap}
          updatePrecalificacion={updatePrecalificacion}
        />
      ))}
    </>
  );
}

const REVISOR_TABLE_HEAD = (
  <thead className="bg-gray-50">
    <tr>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Creada
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
        Programa
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
        NSS
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
        Cliente
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
        Teléfono
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
        Asesor
      </th>
      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
        Decisión
      </th>
      <th className="min-w-[140px] px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
        Monto aprobado
      </th>
      <th className="min-w-[260px] px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
        Notas
      </th>
    </tr>
  </thead>
);

export default function RevisorDashboardPage() {
  const { sessionRepo, currentUser } = useSessionRepo();
  const repo = usePrecalificacionesRepo();
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [groupByDate, setGroupByDate] = useState(false);
  const [list, setList] = useState<Precalificacion[]>([]);
  const [asesorMap, setAsesorMap] = useState<Map<string, string>>(new Map());
  const [asesorDebug, setAsesorDebug] = useState<
    { status: "idle" | "loading" | "ok" | "error"; message?: string; sample?: string[] }
  >({ status: "idle" });
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 50;
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
        const newTotalPages = Math.ceil(count / pageSize) || 0;
        setPage((p) =>
          newTotalPages > 0 && p > newTotalPages ? newTotalPages : p
        );
      });
  }, [currentUser, repo, page, pageSize]);

  const refreshPage = useCallback(async () => {
    if (!currentUser) return;
    console.log("[revisor] Realtime: refreshPage()");
    const { data, count } = await repo.listPageForUser(
      { email: currentUser.email, role: currentUser.role },
      { page: pageRef.current, pageSize }
    );
    setList(data);
    setTotalCount(count);
    const newTotalPages = Math.ceil(count / pageSize) || 0;
    setPage((p) =>
      newTotalPages > 0 && p > newTotalPages ? newTotalPages : p
    );
  }, [currentUser, repo, pageSize]);

  useEffect(() => {
    if (!currentUser) return;
    const debounceRef = {
      timeoutId: null as ReturnType<typeof setTimeout> | null,
      hasInsert: false,
      hasUpdate: false,
    };
    const channel = supabase
      .channel("precalificaciones-revisor-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "precalificaciones" },
        (payload: { eventType?: string; new?: { id?: string } }) => {
          console.log("[revisor] postgres_changes", payload.eventType, "id:", payload.new?.id);
          if (debounceRef.timeoutId) clearTimeout(debounceRef.timeoutId);
          if (payload.eventType === "INSERT") debounceRef.hasInsert = true;
          if (payload.eventType === "UPDATE") debounceRef.hasUpdate = true;
          debounceRef.timeoutId = setTimeout(() => {
            if (debounceRef.hasInsert) {
              console.log("[revisor] Realtime: INSERT -> setPage(1)");
              setPage(1);
              refreshPage();
            } else if (debounceRef.hasUpdate && pageRef.current === 1) {
              console.log("[revisor] Realtime: UPDATE (página 1) -> refreshPage()");
              refreshPage();
            }
            debounceRef.hasInsert = false;
            debounceRef.hasUpdate = false;
            debounceRef.timeoutId = null;
          }, 300);
        }
      )
      .subscribe((status) => {
        console.log("[revisor] Realtime channel status:", status);
        if (status === "SUBSCRIBED") {
          console.log("[revisor] SUBSCRIBED to public.precalificaciones");
        }
      });
    return () => {
      if (debounceRef.timeoutId) clearTimeout(debounceRef.timeoutId);
      supabase.removeChannel(channel);
    };
  }, [currentUser, refreshPage]);

  useEffect(() => {
    queueMicrotask(() => setAsesorDebug({ status: "loading" }));
    getAsesorDisplayMap()
      .then((map) => {
        setAsesorMap(map);
        console.log("[asesorMap] size:", map.size);
        const sample = Array.from(map.entries())
          .slice(0, 3)
          .map(([id, email]) => `${id} -> ${email}`);
        setAsesorDebug({ status: "ok", sample });
      })
      .catch((err) => {
        console.log("[asesorMap] error loading map", err);
        setAsesorMap(new Map());
        setAsesorDebug({
          status: "error",
          message: String((err as Error)?.message ?? err),
        });
      });
  }, []);

  const updatePrecalificacion = useCallback(
    (
      id: string,
      data: {
        decision?: Decision;
        monto_aprobado: number | null;
        notas_revision: string;
      }
    ) => {
      repo
        .update(id, data)
        .then((updated) => {
          setList((prev) =>
            prev.map((item) => (item.id === id ? updated : item))
          );
        })
        .catch((err) => {
          alert(err instanceof Error ? err.message : "Error al guardar.");
        });
    },
    [repo]
  );
  const asesorOptions = useMemo(() => {
    const ids = new Set(fullList.map((p) => p.asesorId));
    return Array.from(ids)
      .sort((a, b) => getAsesorDisplayLabel(a, asesorMap).localeCompare(getAsesorDisplayLabel(b, asesorMap)))
      .map((id) => ({ value: id, label: getAsesorDisplayLabel(id, asesorMap) }));
  }, [fullList, asesorMap]);

  const filteredList = useMemo(
    () => applyFilters(fullList, filters),
    [fullList, filters]
  );

  const notesSuggestions = useMemo(() => {
    const set = new Set<string>();
    fullList.forEach((precal) => {
      const n = (precal.notas_revision ?? "").trim();
      if (n) set.add(n);
    });
    return Array.from(set).sort();
  }, [fullList]);

  const groupedByDay = useMemo(
    () => groupByDay(filteredList),
    [filteredList]
  );

  const totalPages = Math.ceil(totalCount / pageSize) || 0;
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
  if (!currentUser || currentUser.role !== "revisor") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-600">
          No has iniciado sesión como revisor.{" "}
          <Link href="/login" className="text-blue-600 underline">
            Ir a login
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">
            ConCasa CRM · Revisor
          </h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{currentUser.email}</span>
            <Button variant="outline" onClick={() => sessionRepo.logout()}>
              Cerrar sesión
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 lg:max-w-7xl xl:max-w-[1400px]">
        <FiltersBar
          filters={filters}
          setFilters={setFilters}
          asesorOptions={asesorOptions}
          showAsesorFilter
          showProgramaFilter
        />

        <section className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={groupByDate}
              onChange={(e) => setGroupByDate(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">
              Agrupar por fecha
            </span>
          </label>
        </section>

        <h2 className="text-xl font-medium text-gray-900">
          Todas las precalificaciones
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <span className="text-sm text-gray-600">
            Página {page} de {totalPages || 1} · Total: {totalCount}
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

        {(currentUser as { role?: string } | undefined)?.role === "super_admin" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 font-mono text-xs text-gray-800">
            <div className="font-semibold text-amber-800">[debug] asesorMap</div>
            <div>status: {asesorDebug.status}</div>
            <div>asesorMap.size: {asesorMap.size}</div>
            {asesorDebug.status === "error" && asesorDebug.message && (
              <div className="text-red-700">error: {asesorDebug.message}</div>
            )}
            {asesorDebug.sample && asesorDebug.sample.length > 0 && (
              <div className="mt-1">
                sample (id → email): {asesorDebug.sample.map((s, i) => (
                  <div key={i}>{s}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {groupByDate ? (
          <div className="space-y-6">
            {groupedByDay.length === 0 ? (
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="px-4 py-8 text-center text-sm text-gray-500">
                  No hay precalificaciones.
                </div>
              </div>
            ) : (
              groupedByDay.map(([dateKey, dayList]) => (
                <div key={dateKey}>
                  <h3 className="mb-2 text-sm font-semibold text-gray-800">
                    {formatDateKeyToDisplay(dateKey)} ({dayList.length})
                  </h3>
                  <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                    <table className="w-full min-w-[1100px] divide-y divide-gray-200 lg:min-w-0">
                      {REVISOR_TABLE_HEAD}
                      <tbody className="divide-y divide-gray-200 bg-white">
                        <RevisorTableBody
                          list={dayList}
                          suggestions={notesSuggestions}
                          asesorMap={asesorMap}
                          updatePrecalificacion={updatePrecalificacion}
                        />
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[1100px] divide-y divide-gray-200 lg:min-w-0">
              {REVISOR_TABLE_HEAD}
              <tbody className="divide-y divide-gray-200 bg-white">
                {filteredList.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-sm text-gray-500"
                    >
                      No hay precalificaciones.
                    </td>
                  </tr>
                ) : (
                  <RevisorTableBody
                    list={filteredList}
                    suggestions={notesSuggestions}
                    asesorMap={asesorMap}
                    updatePrecalificacion={updatePrecalificacion}
                  />
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
