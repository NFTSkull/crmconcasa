"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { useSessionRepo } from "@/domain/session";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { CasaChecklistDocumental } from "@/components/casas/CasaChecklistDocumental";
import {
  CASA_CAMPO_DETALLE,
  cargarFotosCasa,
  casaTitulo,
  fechaCasa,
  pesos,
  type CasaEvento,
  type CasaFotoConUrl,
  type CasaSolicitud,
} from "@/domain/casas/casas-client";

type EstadoFiltro = "todos" | "enviada" | "ofertada" | "rechazada";
type TipoDecision = "oferta" | "rechazo";

const ESTADOS_RECIBIDOS = ["enviada", "ofertada", "rechazada"] as const;
const FIELD_CLASS = "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

function Icon({
  name,
  className = "h-5 w-5",
}: {
  name: "house" | "back" | "refresh" | "search" | "inbox" | "clock" | "check" | "x" |
    "layers" | "chevron" | "pin" | "image" | "send" | "user" | "money" | "spark" | "close";
  className?: string;
}) {
  const shapes: Record<typeof name, ReactNode> = {
    house: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h12" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14-5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14 5l2-2" /><path d="M16 16h4v4" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></>,
    inbox: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 13h5l2 3h4l2-3h5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l4 2" /></>,
    check: <><path d="m5 12 5 5L20 7" /></>,
    x: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>,
    layers: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M10 10v10" /></>,
    chevron: <><path d="m9 18 6-6-6-6" /></>,
    pin: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 3-3 6 5" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    money: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 9h19" /><circle cx="12" cy="14" r="2" /></>,
    spark: <><path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" /></>,
    close: <><path d="M18 6 6 18M6 6l12 12" /></>,
  };
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{shapes[name]}</svg>;
}

function etiquetaEstado(estado: CasaSolicitud["estado"]): string {
  if (estado === "enviada") return "Pendiente";
  if (estado === "ofertada") return "Con oferta";
  if (estado === "rechazada") return "Rechazada";
  return "No enviada";
}

function estiloEstado(estado: CasaSolicitud["estado"]): string {
  if (estado === "enviada") return "border-amber-200 bg-amber-50 text-amber-800";
  if (estado === "ofertada") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function SeccionVacia({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400">
        <Icon name="inbox" className="h-7 w-7" />
      </div>
      <h3 className="mt-5 text-base font-semibold text-slate-900">{titulo}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{descripcion}</p>
    </div>
  );
}

/** Exclusivamente solicitudes ENVIADAS. Los borradores nunca pertenecen a la bandeja Admin. */
export default function CasasAdminPage() {
  const { currentUser } = useSessionRepo();
  const [list, setList] = useState<CasaSolicitud[]>([]);
  const [advisorNames, setAdvisorNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<EstadoFiltro>("todos");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<CasaFotoConUrl[]>([]);
  const [history, setHistory] = useState<CasaEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailVersion, setDetailVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [decision, setDecision] = useState<TipoDecision | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    const client = supabaseBrowser;
    if (!client) {
      setError("No se pudo establecer conexión con ConCasa.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error: loadError } = await client.from("casas_solicitudes")
        .select("*")
        .in("estado", [...ESTADOS_RECIBIDOS])
        .order("enviada_at", { ascending: false })
        .limit(500);
      if (loadError) throw new Error(loadError.message);
      const items = (data ?? []) as CasaSolicitud[];
      setList(items);
      const ids = [...new Set(items.map((c) => c.asesor_id))];
      if (ids.length) {
        const names = await client.from("profiles").select("id,full_name").in("id", ids);
        if (!names.error && names.data) {
          setAdvisorNames(Object.fromEntries(names.data.map((p) => [p.id, p.full_name])));
        }
      } else {
        setAdvisorNames({});
      }
    } catch (err) {
      setError("No se pudieron cargar las propiedades: " + (err instanceof Error ? err.message : "Error de conexión"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser?.role === "super_admin") void refresh();
    else if (currentUser !== undefined) setLoading(false);
  }, [currentUser?.role, refresh]);

  const counts = useMemo(() => ({
    enviada: list.filter((c) => c.estado === "enviada").length,
    ofertada: list.filter((c) => c.estado === "ofertada").length,
    rechazada: list.filter((c) => c.estado === "rechazada").length,
    todos: list.length,
  }), [list]);

  const visible = useMemo(() => list.filter((c) => {
    if (filter !== "todos" && c.estado !== filter) return false;
    const term = search.trim().toLocaleLowerCase("es-MX");
    if (!term) return true;
    return [casaTitulo(c), c.municipio, c.colonia, c.direccion, c.nombre_contacto,
      c.telefono_contacto, advisorNames[c.asesor_id]]
      .filter(Boolean).some((value) => String(value).toLocaleLowerCase("es-MX").includes(term));
  }).sort((a, b) =>
    (a.estado === "enviada" ? 0 : 1) - (b.estado === "enviada" ? 0 : 1) ||
    (b.enviada_at ?? b.created_at).localeCompare(a.enviada_at ?? a.created_at)
  ), [list, filter, search, advisorNames]);

  useEffect(() => {
    setSelectedId((prev) =>
      prev && visible.some((c) => c.id === prev) ? prev : (visible[0]?.id ?? null)
    );
  }, [visible]);

  useEffect(() => {
    let active = true;
    setPhotos([]);
    setHistory([]);
    setDetailLoading(Boolean(selectedId));
    if (!selectedId || !supabaseBrowser) {
      setDetailLoading(false);
      return;
    }
    const client = supabaseBrowser;
    void (async () => {
      try {
        const [f, h] = await Promise.all([
          cargarFotosCasa(client, selectedId),
          client.from("casas_historial").select("*")
            .eq("solicitud_id", selectedId)
            .order("created_at", { ascending: false }).limit(50),
        ]);
        if (!active) return;
        if (h.error) throw new Error(h.error.message);
        setPhotos(f);
        setHistory((h.data ?? []) as CasaEvento[]);
      } catch (err) {
        if (active) setError("No se pudo consultar el detalle: " + (err instanceof Error ? err.message : "Error"));
      } finally {
        if (active) setDetailLoading(false);
      }
    })();
    return () => { active = false; };
  }, [selectedId, detailVersion]);

  const selected = visible.find((c) => c.id === selectedId) ?? null;

  function choose(casa: CasaSolicitud) {
    setSelectedId(casa.id);
    setDecision(null);
    setAmount("");
    setNote("");
    setReason("");
    setMessage(null);
    setError(null);
  }

  async function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabaseBrowser || !selected || !decision || busy) return;
    const monto = decision === "oferta" ? Number(amount) : null;
    if (decision === "oferta" && (monto == null || !Number.isFinite(monto) || monto <= 0)) {
      setError("Introduce una oferta válida mayor a cero.");
      return;
    }
    if (decision === "rechazo" && !reason.trim()) {
      setError("El motivo de rechazo es obligatorio.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { error: rpcError } = await supabaseBrowser.rpc("casas_responder", {
        p_solicitud_id: selected.id,
        p_accion: decision,
        p_monto_mxn: monto,
        p_motivo: decision === "rechazo" ? reason.trim() : null,
        p_nota: decision === "oferta" ? note.trim() || null : null,
      });
      if (rpcError) throw new Error(rpcError.message);
      setDecision(null);
      setAmount("");
      setNote("");
      setReason("");
      setMessage(decision === "oferta"
        ? "Oferta guardada. La respuesta quedó registrada para el asesor."
        : "Rechazo registrado con su motivo.");
      await refresh();
      setDetailVersion((x) => x + 1);
    } catch (err) {
      setError("No se pudo guardar la respuesta: " + (err instanceof Error ? err.message : "Error"));
    } finally {
      setBusy(false);
    }
  }

  if (currentUser === undefined) return <main className="p-8 text-slate-500">Verificando sesión…</main>;
  if (!currentUser) return <main className="p-8">Inicia sesión como administrador. <Link href="/login" className="font-semibold text-emerald-800 underline">Entrar</Link></main>;
  if (currentUser.role !== "super_admin") return <main className="p-8">Esta sección está reservada a la administración de ConCasa.</main>;

  const metrics: ReadonlyArray<{ id: EstadoFiltro; label: string; description: string; value: number; icon: "inbox" | "clock" | "check" | "x"; accent: string }> = [
    { id: "todos", label: "Total recibidas", description: "Solicitudes enviadas", value: counts.todos, icon: "inbox", accent: "text-slate-700 bg-slate-100" },
    { id: "enviada", label: "Por revisar", description: "Requieren respuesta", value: counts.enviada, icon: "clock", accent: "text-amber-800 bg-amber-50" },
    { id: "ofertada", label: "Con oferta", description: "Monto comunicado", value: counts.ofertada, icon: "check", accent: "text-emerald-800 bg-emerald-50" },
    { id: "rechazada", label: "Rechazadas", description: "Con motivo registrado", value: counts.rechazada, icon: "x", accent: "text-rose-700 bg-rose-50" },
  ];

  return (
    <main className="min-h-screen bg-[#f6f8f7] pb-14 text-slate-900">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-[1536px] items-center justify-between gap-4 px-4 py-4 sm:px-7">
          <Link href="/admin" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-emerald-900">
            <Icon name="back" className="h-4 w-4" /> Volver a Administración
          </Link>
          <span className="hidden text-xs font-semibold uppercase tracking-[0.15em] text-slate-400 sm:inline">ConCasa · Gestión de oportunidades</span>
        </div>
      </header>

      <div className="mx-auto max-w-[1536px] space-y-7 px-4 py-8 sm:px-7">
        <section className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-600" /> Bandeja de evaluación
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Compra de casas</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Evalúa las propiedades recibidas de tus asesores, consulta sus fotografías y comunica una oferta o el motivo de rechazo.
            </p>
          </div>
          <button type="button" onClick={() => { setError(null); void refresh(); }}
            disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50">
            <Icon name="refresh" className="h-4 w-4" /> {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </section>

        {error ? <div role="alert" className="flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Cerrar aviso de error"><Icon name="close" className="h-4 w-4" /></button>
        </div> : null}
        {message ? <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><Icon name="check" className="h-5 w-5" />{message}</div> : null}

        <section aria-label="Resumen de casas recibidas" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {metrics.map((metric) => (
            <button key={metric.id} type="button" aria-pressed={filter === metric.id}
              onClick={() => setFilter(metric.id)}
              className={"group rounded-2xl border p-4 text-left transition sm:p-5 " +
                (filter === metric.id
                  ? "border-emerald-600 bg-white shadow-[0_0_0_1px_#059669] ring-2 ring-emerald-600/5"
                  : "border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:shadow-md")}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500 sm:text-sm">{metric.label}</span>
                <span className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " + metric.accent}><Icon name={metric.icon} className="h-[18px] w-[18px]" /></span>
              </div>
              <div className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-slate-950">{metric.value}</div>
              <div className="mt-1 text-xs text-slate-400">{metric.description}</div>
            </button>
          ))}
        </section>

        {loading && list.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-14 text-center text-sm text-slate-500" role="status">Cargando solicitudes de compra…</div>
        ) : list.length === 0 ? (
          <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <div className="mx-auto flex max-w-2xl flex-col items-center px-6 py-14 text-center sm:py-20">
              <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl border border-emerald-100 bg-emerald-50 text-emerald-700">
                <Icon name="house" className="h-11 w-11" />
                <span className="absolute -bottom-2 -right-2 flex h-10 w-10 items-center justify-center rounded-2xl border-4 border-white bg-slate-900 text-white"><Icon name="inbox" className="h-5 w-5" /></span>
              </div>
              <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Todo en orden</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Aún no hay propiedades recibidas</h2>
              <p className="mt-3 max-w-lg text-sm leading-7 text-slate-500">
                Aquí aparecerán las casas cuando se envíen al administrador. Podrás revisar su información y fotografías y responder desde un solo lugar.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3 text-xs font-medium text-slate-500">
                <span className="rounded-full bg-slate-50 px-3 py-2">01 · Solicitud recibida</span>
                <Icon name="chevron" className="h-4 w-4 text-slate-300" />
                <span className="rounded-full bg-slate-50 px-3 py-2">02 · Evaluación</span>
                <Icon name="chevron" className="h-4 w-4 text-slate-300" />
                <span className="rounded-full bg-emerald-50 px-3 py-2 text-emerald-800">03 · Respuesta</span>
              </div>
              <button type="button" onClick={() => void refresh()} className="mt-9 inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 transition hover:text-emerald-950 hover:underline"><Icon name="refresh" className="h-4 w-4" /> Verificar nuevas solicitudes</button>
            </div>
          </section>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.45fr)] xl:grid-cols-[420px_minmax(0,1fr)]">
            <section aria-label="Lista de propiedades" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-4 sm:p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-base font-bold text-slate-950">Solicitudes</h2>
                  <span className="text-xs font-medium text-slate-400">{visible.length} {visible.length === 1 ? "propiedad" : "propiedades"}</span>
                </div>
                <div className="relative mt-3">
                  <Icon name="search" className="pointer-events-none absolute left-3.5 top-3 h-5 w-5 text-slate-400" />
                  <input type="search" aria-label="Buscar propiedades" value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Asesor, colonia, municipio o contacto"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100" />
                </div>
                <p className="mt-3 text-xs text-slate-400">Ordenadas por atención: pendientes primero.</p>
              </div>
              {visible.length === 0 ? <SeccionVacia titulo="Sin coincidencias" descripcion="Prueba otra búsqueda o selecciona Total recibidas para ver todas las casas." /> : (
                <div className="max-h-[72vh] divide-y divide-slate-100 overflow-y-auto">
                  {visible.map((casa) => (
                    <button key={casa.id} type="button" aria-pressed={selected?.id === casa.id}
                      onClick={() => choose(casa)}
                      className={"flex w-full gap-3 px-4 py-4 text-left transition sm:px-5 " +
                        (selected?.id === casa.id ? "bg-emerald-50/80 shadow-[inset_3px_0_0_#047857]" : "hover:bg-slate-50")}>
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-800">
                        <Icon name="house" className="h-6 w-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={"inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold " + estiloEstado(casa.estado)}>{etiquetaEstado(casa.estado)}</span>
                          <span className="text-[11px] text-slate-400">{fechaCasa(casa.enviada_at)}</span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm font-bold leading-5 text-slate-950">{casaTitulo(casa)}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">{advisorNames[casa.asesor_id] || "Asesor de ConCasa"}</p>
                        {casa.precio_esperado_mxn != null ? <p className="mt-2 text-xs font-semibold text-slate-700">Solicitan {pesos(casa.precio_esperado_mxn)}</p> : null}
                      </div>
                      <Icon name="chevron" className="mt-10 h-4 w-4 shrink-0 text-slate-300" />
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section aria-label="Detalle de la propiedad" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {!selected ? <SeccionVacia titulo="Selecciona una propiedad" descripcion="Elige una casa de la lista para consultar fotografías, información y enviar una respuesta." /> : (
                <>
                  <div className="border-b border-slate-100 bg-gradient-to-r from-[#f3faf6] to-white px-5 py-6 sm:px-7">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-800">Detalle de oportunidad</p>
                      <span className={"inline-flex rounded-full border px-3 py-1 text-xs font-bold " + estiloEstado(selected.estado)}>{etiquetaEstado(selected.estado)}</span>
                    </div>
                    <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{casaTitulo(selected)}</h2>
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1.5"><Icon name="user" className="h-4 w-4 text-slate-400" /> {advisorNames[selected.asesor_id] || "Asesor de ConCasa"}</span>
                      <span className="inline-flex items-center gap-1.5"><Icon name="clock" className="h-4 w-4 text-slate-400" /> {fechaCasa(selected.enviada_at)}</span>
                      {selected.municipio ? <span className="inline-flex items-center gap-1.5"><Icon name="pin" className="h-4 w-4 text-slate-400" /> {selected.municipio}</span> : null}
                    </div>
                  </div>
                  <div className="space-y-7 p-5 sm:p-7">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                        <p className="text-xs font-medium text-slate-500">Precio solicitado</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-slate-950">{pesos(selected.precio_esperado_mxn)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                        <p className="text-xs font-medium text-slate-500">Adeudo aproximado</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-slate-950">{pesos(selected.adeudo_aproximado_mxn)}</p>
                      </div>
                    </div>

                    {selected.estado === "ofertada" ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-800"><Icon name="check" className="h-4 w-4" /> Oferta registrada</div>
                        <div className="mt-2 text-2xl font-bold text-emerald-950">{pesos(selected.oferta_mxn)}</div>
                        {selected.nota_admin ? <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-900">{selected.nota_admin}</p> : null}
                      </div>
                    ) : null}
                    {selected.estado === "rechazada" ? (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5">
                        <div className="flex items-center gap-2 text-sm font-bold text-rose-900"><Icon name="x" className="h-5 w-5" /> Compra rechazada</div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-rose-800">{selected.motivo_rechazo}</p>
                      </div>
                    ) : null}

                    <CasaChecklistDocumental
                      key={selected.id}
                      solicitudId={selected.id}
                      organizationId={selected.organization_id}
                      estado={selected.estado}
                      conyugeAplica={selected.conyuge_aplica}
                    />

                    <section className="rounded-xl border border-slate-200 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-bold text-slate-950">Revisión y respuesta</h3>
                          <p className="mt-1 text-xs leading-5 text-slate-500">La respuesta se registra en el historial y queda asociada al asesor.</p>
                        </div>
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800"><Icon name="money" /></span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2.5">
                        <button type="button" onClick={() => {
                          setDecision("oferta"); setAmount(selected.oferta_mxn == null ? "" : String(selected.oferta_mxn));
                          setReason(""); setNote(selected.nota_admin || ""); setError(null);
                        }} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
                          <Icon name="check" className="h-4 w-4" /> {selected.estado === "ofertada" ? "Modificar oferta" : "Hacer oferta"}
                        </button>
                        <button type="button" onClick={() => {
                          setDecision("rechazo"); setReason(selected.motivo_rechazo || "");
                          setAmount(""); setNote(""); setError(null);
                        }} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 transition hover:bg-rose-100">
                          <Icon name="x" className="h-4 w-4" /> Rechazar
                        </button>
                      </div>

                      {decision ? (
                        <form onSubmit={(e) => void submitDecision(e)} className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                          <h4 className="text-sm font-bold text-slate-950">{decision === "oferta" ? "Preparar oferta" : "Motivo de rechazo"}</h4>
                          {decision === "oferta" ? (
                            <>
                              <label htmlFor="casa-oferta" className="mt-4 block text-xs font-semibold text-slate-700">Monto de la oferta (MXN) *</label>
                              <input id="casa-oferta" type="number" min="0.01" step="0.01" required value={amount}
                                onChange={(e) => setAmount(e.target.value)} placeholder="Ej. 480000" className={FIELD_CLASS} />
                              <label htmlFor="casa-nota" className="mt-4 block text-xs font-semibold text-slate-700">Observaciones (opcional)</label>
                              <textarea id="casa-nota" rows={3} maxLength={2000} value={note}
                                onChange={(e) => setNote(e.target.value)} placeholder="Condiciones o detalles de la oferta…" className={FIELD_CLASS} />
                            </>
                          ) : (
                            <>
                              <label htmlFor="casa-motivo" className="mt-4 block text-xs font-semibold text-slate-700">Explica el motivo *</label>
                              <textarea id="casa-motivo" rows={3} maxLength={2000} required value={reason}
                                onChange={(e) => setReason(e.target.value)} placeholder="Indica al asesor por qué no se comprará esta propiedad…" className={FIELD_CLASS} />
                            </>
                          )}
                          <p className="mt-3 text-xs text-slate-500">La respuesta quedará registrada. Si realizas un cambio posterior, se conservará el historial.</p>
                          <div className="mt-4 flex flex-wrap justify-end gap-2">
                            <button type="button" disabled={busy} onClick={() => setDecision(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancelar</button>
                            <button type="submit" disabled={busy} className={"inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 " + (decision === "oferta" ? "bg-emerald-800 hover:bg-emerald-900" : "bg-rose-700 hover:bg-rose-800")}>
                              <Icon name="send" className="h-4 w-4" /> {busy ? "Guardando…" : decision === "oferta" ? "Confirmar oferta" : "Confirmar rechazo"}
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </section>

                    <section>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 className="text-base font-bold text-slate-950">Fotografías de la casa</h3>
                        <span className="text-xs font-medium text-slate-400">{photos.length} {photos.length === 1 ? "imagen" : "imágenes"}</span>
                      </div>
                      {detailLoading ? <div className="rounded-xl bg-slate-50 p-7 text-center text-sm text-slate-500">Cargando fotografías…</div>
                        : photos.length === 0 ? (
                          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-center">
                            <Icon name="image" className="h-7 w-7 text-slate-300" />
                            <p className="mt-2 text-sm font-medium text-slate-600">Esta propiedad no incluye fotografías.</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {photos.map((photo) =>
                              photo.url ? (
                                <a href={photo.url} target="_blank" rel="noreferrer" key={photo.id}
                                  className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                                  <img src={photo.url} alt={photo.nombre_archivo} className="aspect-square w-full object-cover transition group-hover:scale-[1.03]" />
                                  <div className="truncate px-2.5 py-2 text-xs text-slate-600">{photo.nombre_archivo}</div>
                                </a>
                              ) : <div key={photo.id} className="flex aspect-square items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">Imagen no disponible</div>
                            )}
                          </div>
                        )}
                    </section>

                    <section className="border-t border-slate-100 pt-6">
                      <h3 className="text-base font-bold text-slate-950">Información de la propiedad</h3>
                      <dl className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2">
                        {CASA_CAMPO_DETALLE.filter((item) => !item.money).map((field) => {
                          const raw = selected[field.key];
                          return <div key={field.key} className={field.key === "comentarios" ? "sm:col-span-2" : ""}>
                            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{field.label}</dt>
                            <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-slate-800">{raw == null || raw === "" ? <span className="font-normal text-slate-400">Sin información</span> : String(raw)}</dd>
                          </div>;
                        })}
                      </dl>
                    </section>

                    {history.length > 0 ? <section className="border-t border-slate-100 pt-6">
                      <h3 className="text-base font-bold text-slate-950">Historial de movimientos</h3>
                      <ol className="mt-4 space-y-3">
                        {history.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-3 border-l-2 border-emerald-200 py-1 pl-4">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{event.accion === "envio" ? "Recibida en Admin" : event.accion === "oferta" ? "Oferta · " + pesos(event.monto_mxn) : "Rechazada"}</p>
                            {event.nota ? <p className="mt-1 max-w-lg whitespace-pre-wrap text-xs leading-5 text-slate-500">{event.nota}</p> : null}
                          </div>
                          <time className="text-xs text-slate-400">{fechaCasa(event.created_at)}</time>
                        </li>)}
                      </ol>
                    </section> : null}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
