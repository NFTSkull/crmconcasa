"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useSessionRepo } from "@/domain/session";
import { usePrecalificacionesRepo } from "@/domain/precalificaciones";
import type { Precalificacion } from "@/domain/precalificaciones";
import { Button } from "@/components/ui/Button";
import { FiltersBar } from "@/components/FiltersBar";
import {
  applyFilters,
  formatDateTimeMx,
  DEFAULT_FILTERS,
  type FiltersState,
} from "@/lib/filters";
import { getAsesorDisplayMap, getAsesorDisplayLabel } from "@/lib/asesorDisplay";
import { supabase } from "@/lib/supabaseClient";
import { formatMontoMX } from "@/lib/monto";

function getTodayYMD(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/**
 * Calcula start/end en UTC ISO para Vista del día/período.
 * Si desde o hasta tienen valor → rango (mode "range"); si no → un solo día (mode "day").
 * endISO es exclusivo (lt) por eso hasta + 1 día a 00:00Z.
 */
function getPeriodStartEndISO(
  daySelected: string,
  filters: FiltersState
): { startISO: string; endISO: string; mode: "day" | "range" } {
  const hasDesde = Boolean(filters.desde?.trim());
  const hasHasta = Boolean(filters.hasta?.trim());
  if (hasDesde || hasHasta) {
    const startDate = hasDesde
      ? new Date(`${filters.desde!.trim()}T00:00:00.000Z`)
      : new Date(`${filters.hasta!.trim()}T00:00:00.000Z`);
    const endDate = hasHasta
      ? new Date(`${filters.hasta!.trim()}T00:00:00.000Z`)
      : new Date(`${filters.desde!.trim()}T00:00:00.000Z`);
    const endExclusive = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
    return {
      startISO: startDate.toISOString(),
      endISO: endExclusive.toISOString(),
      mode: "range",
    };
  }
  const baseDate = new Date(`${daySelected}T00:00:00.000Z`);
  const endExclusive = new Date(baseDate.getTime() + 24 * 60 * 60 * 1000);
  return {
    startISO: baseDate.toISOString(),
    endISO: endExclusive.toISOString(),
    mode: "day",
  };
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
    d === "aprobado" ? "Aprobado" : d === "no_cumple" ? "No cumple" : "Pendiente";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}
    >
      {label}
    </span>
  );
}

function AdminTableBody({
  list,
  editHref,
  asesorMap,
}: {
  list: Precalificacion[];
  editHref: (id: string) => string;
  asesorMap: Map<string, string>;
}) {
  return (
    <>
      {list.map((p) => (
        <tr key={p.id} className="hover:bg-gray-50">
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
            {formatDateTimeMx(p.createdAt)}
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
            {getAsesorDisplayLabel(p.asesorId, asesorMap)}
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">
            {p.programa}
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
            {p.nss}
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
            {p.cliente_nombre ?? "—"}
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
            {p.telefono_cliente ?? "—"}
          </td>
          <td className="max-w-[180px] truncate px-3 py-2 text-sm text-gray-600">
            {p.direccion_opcional || "—"}
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
            {p.monto_aprobado != null
              ? formatMontoMX(p.monto_aprobado)
              : "—"}
          </td>
          <td className="max-w-[180px] truncate px-3 py-2 text-sm text-gray-600">
            {p.notas || "—"}
          </td>
          <td className="whitespace-nowrap px-3 py-2">
            <Link href={editHref(p.id)}>
              <Button variant="outline" className="text-xs">
                Editar
              </Button>
            </Link>
          </td>
        </tr>
      ))}
    </>
  );
}

const ADMIN_TABLE_HEAD = (
  <thead className="bg-gray-50">
    <tr>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Creada
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        asesorId
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        programa
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        nss
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Cliente
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Teléfono
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        direccion_opcional
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        monto_aprobado
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        notas
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Acción
      </th>
    </tr>
  </thead>
);

const ADMIN_DAY_TABLE_HEAD = (
  <thead className="bg-gray-50">
    <tr>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Creada
      </th> 
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Programa
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        NSS
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Cliente
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Teléfono
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Asesor
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Decisión
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Monto
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Notas
      </th>
      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
        Acción
      </th>
    </tr>
  </thead>
);

function AdminDayTableBody({
  list,
  editHref,
  asesorMap,
}: {
  list: Precalificacion[];
  editHref: (id: string) => string;
  asesorMap: Map<string, string>;
}) {
  return (
    <>
      {list.map((p) => (
        <tr key={p.id} className="hover:bg-gray-50">
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
            {formatDateTimeMx(p.createdAt)}
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">
            {p.programa}
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
            {p.nss}
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
            {p.cliente_nombre ?? "—"}
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
            {p.telefono_cliente ?? "—"}
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
            {getAsesorDisplayLabel(p.asesorId, asesorMap)}
          </td>
          <td className="whitespace-nowrap px-3 py-2">
            <DecisionBadge decision={p.decision} />
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
            {p.decision === "no_cumple"
              ? "—"
              : p.monto_aprobado != null
                ? formatMontoMX(p.monto_aprobado)
                : "—"}
          </td>
          <td className="max-w-[180px] truncate px-3 py-2 text-sm text-gray-600">
            {(p.notas_revision ?? p.notas ?? "").trim() || "—"}
          </td>
          <td className="whitespace-nowrap px-3 py-2">
            <Link href={editHref(p.id)}>
              <Button variant="outline" className="text-xs">
                Editar
              </Button>
            </Link>
          </td>
        </tr>
      ))}
    </>
  );
}

export default function AdminDashboardPage() {
  const { sessionRepo, currentUser } = useSessionRepo();
  const repo = usePrecalificacionesRepo();
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [daySelected, setDaySelected] = useState<string>(getTodayYMD);
  const [dayKpis, setDayKpis] = useState({
    total: 0,
    pendientes: 0,
    aprobadas: 0,
    noCumple: 0,
  });
  const [dayRows, setDayRows] = useState<Precalificacion[]>([]);
  const [dayRowsLoading, setDayRowsLoading] = useState(false);
  const [dayRowsCount, setDayRowsCount] = useState(0);
  const [dayPage, setDayPage] = useState(1);
  const vistaDiaRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    setPage(1);
    setDayPage(1);
  }, [daySelected]);

  useEffect(() => {
    setDayPage(1);
  }, [filters.asesorId, filters.programa, filters.desde, filters.hasta, filters.buscar]);

  const fullList = useMemo(
    () => (currentUser ? list : []),
    [currentUser, list]
  );

  useEffect(() => {
    if (!currentUser) return;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    console.log("[admin][table] before listPageForUser", { page, pageSize, from, to });
    repo
      .listPageForUser(
        { email: currentUser.email, role: currentUser.role },
        { page, pageSize }
      )
      .then(({ data, count }) => {
        const first = data.length > 0 ? data[0].createdAt : null;
        const last = data.length > 0 ? data[data.length - 1].createdAt : null;
        console.log("[admin][table] listPageForUser result", {
          page,
          pageSize,
          from: (page - 1) * pageSize,
          to: (page - 1) * pageSize + pageSize - 1,
          dataLength: data.length,
          count,
          firstCreatedAt: first,
          lastCreatedAt: last,
        });
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
    console.log("[admin] Realtime: refreshPage()");
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
      .channel("precalificaciones-admin-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "precalificaciones" },
        (payload: { eventType?: string; new?: { id?: string } }) => {
          console.log("[admin] postgres_changes", payload.eventType, "id:", payload.new?.id);
          if (debounceRef.timeoutId) clearTimeout(debounceRef.timeoutId);
          if (payload.eventType === "INSERT") debounceRef.hasInsert = true;
          if (payload.eventType === "UPDATE") debounceRef.hasUpdate = true;
          debounceRef.timeoutId = setTimeout(() => {
            if (debounceRef.hasInsert) {
              console.log("[admin] Realtime: INSERT -> setPage(1)");
              setPage(1);
              refreshPage();
            } else if (debounceRef.hasUpdate) {
              console.log("[admin] Realtime: UPDATE -> refreshPage()");
              refreshPage();
            }
            debounceRef.hasInsert = false;
            debounceRef.hasUpdate = false;
            debounceRef.timeoutId = null;
          }, 300);
        }
      )
      .subscribe((status) => {
        console.log("[admin] Realtime channel status:", status);
        if (status === "SUBSCRIBED") {
          console.log("[admin] SUBSCRIBED to public.precalificaciones");
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

  const asesorOptions = useMemo(() => {
    const ids = Array.from(asesorMap.keys());
    return ids
      .sort((a, b) => getAsesorDisplayLabel(a, asesorMap).localeCompare(getAsesorDisplayLabel(b, asesorMap)))
      .map((id) => ({ value: id, label: getAsesorDisplayLabel(id, asesorMap) }));
  }, [asesorMap]);

  const filteredList = useMemo(
    () => applyFilters(fullList, filters),
    [fullList, filters]
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

  const dayTotalPages = Math.max(1, Math.ceil(dayRowsCount / pageSize));

  useEffect(() => {
    if (dayPage > dayTotalPages) setDayPage(dayTotalPages);
  }, [dayPage, dayTotalPages]);

  useEffect(() => {
    if (!currentUser) return;

    let cancelled = false;

    const fetchDayKpis = async () => {
      try {
        const { startISO, endISO } = getPeriodStartEndISO(daySelected, filters);
        const startDate = new Date(startISO);
        if (Number.isNaN(startDate.getTime())) {
          if (!cancelled) {
            setDayKpis({ total: 0, pendientes: 0, aprobadas: 0, noCumple: 0 });
          }
          return;
        }
        const start = startISO;
        const end = endISO;
        console.log("[admin][cards]", { daySelected, startISO: start, endISO: end });

        const buildBaseQuery = () => {
          let q = supabase
            .from("precalificaciones")
            .select("id", { count: "exact", head: true })
            .gte("createdAt", start)
            .lt("createdAt", end);
          if (filters.asesorId) q = q.eq("asesorId", filters.asesorId);
          if (filters.programa) q = q.eq("programa", filters.programa);
          if (filters.buscar.trim()) {
            const searchQ = filters.buscar.trim().replace(/,/g, " ");
            const like = `%${searchQ}%`;
            q = q.or(
              `nss.ilike.${like},cliente_nombre.ilike.${like},telefono_cliente.ilike.${like},direccion_opcional.ilike.${like},notas.ilike.${like}`
            );
          }
          return q;
        };

        const [totalRes, pendientesRes, aprobadasRes, noCumpleRes] = await Promise.all([
          buildBaseQuery(),
          buildBaseQuery().or("decision.is.null,decision.eq.pendiente"),
          buildBaseQuery().eq("decision", "aprobado"),
          buildBaseQuery().eq("decision", "no_cumple"),
        ]);

        if (cancelled) return;

        console.log("[admin][cards] counts", {
          total: totalRes.count ?? 0,
          pendientes: pendientesRes.count ?? 0,
          aprobadas: aprobadasRes.count ?? 0,
          noCumple: noCumpleRes.count ?? 0,
        });

        if (totalRes.error || pendientesRes.error || aprobadasRes.error || noCumpleRes.error) {
          console.error("[admin] Error fetching day KPIs", {
            totalError: totalRes.error,
            pendientesError: pendientesRes.error,
            aprobadasError: aprobadasRes.error,
            noCumpleError: noCumpleRes.error,
          });
          return;
        }

        setDayKpis({
          total: totalRes.count ?? 0,
          pendientes: pendientesRes.count ?? 0,
          aprobadas: aprobadasRes.count ?? 0,
          noCumple: noCumpleRes.count ?? 0,
        });
      } catch (err) {
        if (!cancelled) {
          console.error("[admin] Exception fetching day KPIs", err);
        }
      }
    };

    fetchDayKpis();

    return () => {
      cancelled = true;
    };
  }, [currentUser, daySelected, filters.desde, filters.hasta, filters.asesorId, filters.programa, filters.buscar]);

  useEffect(() => {
    if (!currentUser) return;

    let cancelled = false;
    setDayRowsLoading(true);

    const fetchDayRows = async () => {
      try {
        const { startISO, endISO } = getPeriodStartEndISO(daySelected, filters);
        const startDate = new Date(startISO);
        if (Number.isNaN(startDate.getTime())) {
          if (!cancelled) {
            setDayRows([]);
            setDayRowsCount(0);
          }
          return;
        }
        const start = startISO;
        const end = endISO;
        const from = (dayPage - 1) * pageSize;
        const to = from + pageSize - 1;

        let query = supabase
          .from("precalificaciones")
          .select("*", { count: "exact" })
          .gte("createdAt", start)
          .lt("createdAt", end);
        if (filters.asesorId) query = query.eq("asesorId", filters.asesorId);
        if (filters.programa) query = query.eq("programa", filters.programa);
        if (filters.buscar.trim()) {
          const searchQ = filters.buscar.trim().replace(/,/g, " ");
          const like = `%${searchQ}%`;
          query = query.or(
            `nss.ilike.${like},cliente_nombre.ilike.${like},telefono_cliente.ilike.${like},direccion_opcional.ilike.${like},notas.ilike.${like}`
          );
        }
        const { data, error, count } = await query
          .order("createdAt", { ascending: false })
          .range(from, to);

        if (cancelled) return;
        if (error) {
          console.error("[admin] Error fetching day rows", error);
          setDayRows([]);
          setDayRowsCount(0);
          return;
        }
        setDayRows((data ?? []) as Precalificacion[]);
        setDayRowsCount(count ?? 0);
      } catch (err) {
        if (!cancelled) {
          console.error("[admin] Exception fetching day rows", err);
          setDayRows([]);
        }
      } finally {
        if (!cancelled) setDayRowsLoading(false);
      }
    };

    fetchDayRows();
    return () => {
      cancelled = true;
    };
  }, [currentUser, daySelected, dayPage, filters.asesorId, filters.programa, filters.desde, filters.hasta, filters.buscar]);

  if (currentUser === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }
  if (!currentUser || currentUser.role !== "super_admin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-600">
          No tienes acceso como Super Admin.{" "}
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
            ConCasa CRM · Super Admin
          </h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{currentUser.email}</span>
            <Button variant="outline" onClick={() => sessionRepo.logout()}>
              Cerrar sesión
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <FiltersBar
          filters={filters}
          setFilters={setFilters}
          asesorOptions={asesorOptions}
          showAsesorFilter
          showProgramaFilter
        />

        {/* Vista del día */}
        <section ref={vistaDiaRef} className="scroll-mt-4">
          <h2 className="mb-4 text-xl font-medium text-gray-900">
            Vista del día
          </h2>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="admin-day-picker"
                className="text-sm font-medium text-gray-700"
              >
                Día
              </label>
              <input
                id="admin-day-picker"
                type="date"
                value={daySelected}
                onChange={(e) => setDaySelected(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
              <div className="text-xs font-medium uppercase text-gray-500">
                Total del día
              </div>
              <div className="mt-1 text-xl font-semibold text-gray-900">
                {dayKpis.total}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
              <div className="text-xs font-medium uppercase text-gray-500">
                Pendientes
              </div>
              <div className="mt-1 text-xl font-semibold text-amber-700">
                {dayKpis.pendientes}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
              <div className="text-xs font-medium uppercase text-gray-500">
                Aprobadas
              </div>
              <div className="mt-1 text-xl font-semibold text-green-700">
                {dayKpis.aprobadas}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
              <div className="text-xs font-medium uppercase text-gray-500">
                No cumple
              </div>
              <div className="mt-1 text-xl font-semibold text-red-700">
                {dayKpis.noCumple}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              {ADMIN_DAY_TABLE_HEAD}
              <tbody className="divide-y divide-gray-200 bg-white">
                {dayRowsLoading ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-8 text-center text-sm text-gray-500"
                    >
                      Cargando…
                    </td>
                  </tr>
                ) : dayRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-8 text-center text-sm text-gray-500"
                    >
                      No hay precalificaciones en este día.
                    </td>
                  </tr>
                ) : (
                  <AdminDayTableBody
                    list={dayRows}
                    editHref={(id) => `/admin/${id}`}
                    asesorMap={asesorMap}
                  />
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3">
            <span className="text-sm text-gray-600">
              Mostrando {dayRows.length} de {dayRowsCount} · Página {dayPage} de {dayTotalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setDayPage((p) => p - 1)}
                disabled={dayPage === 1}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                onClick={() => setDayPage((p) => p + 1)}
                disabled={dayPage >= dayTotalPages}
              >
                Siguiente
              </Button>
            </div>
          </div>
        </section>

        {/* Paginación */}
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

        {/* Tabla(s) */}
        <section>
          <h2 className="mb-4 text-xl font-medium text-gray-900">
            Todas las precalificaciones
          </h2>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              {ADMIN_TABLE_HEAD}
              <tbody className="divide-y divide-gray-200 bg-white">
                {filteredList.length === 0 ? (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-4 py-8 text-center text-sm text-gray-500"
                    >
                      No hay precalificaciones.
                    </td>
                  </tr>
                ) : (
                  <AdminTableBody
                    list={filteredList}
                    editHref={(id) => `/admin/${id}`}
                    asesorMap={asesorMap}
                  />
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
