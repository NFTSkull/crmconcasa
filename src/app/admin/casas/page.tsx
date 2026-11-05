"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useSessionRepo } from "@/domain/session";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  CASA_CAMPO_DETALLE,cargarFotosCasa,casaEstadoLabel,casaEstadoStyle,casaTitulo,fechaCasa,pesos,
  type CasaEvento,type CasaFotoConUrl,type CasaSolicitud,type CasaEstado,
} from "@/domain/casas/casas-client";

type Filtro = "todos" | CasaEstado;
const filters: ReadonlyArray<{id:Filtro;label:string}> = [
  {id:"enviada",label:"Pendientes"},
  {id:"ofertada",label:"Con oferta"},
  {id:"rechazada",label:"Rechazadas"},
  {id:"borrador",label:"Borradores"},
  {id:"todos",label:"Todas"},
];

export default function CasasAdminPage() {
  const { currentUser } = useSessionRepo();
  const [list,setList] = useState<CasaSolicitud[]>([]);
  const [advisorNames,setAdvisorNames] = useState<Record<string,string>>({});
  const [filter,setFilter] = useState<Filtro>("enviada");
  const [search,setSearch] = useState("");
  const [selectedId,setSelectedId] = useState<string | null>(null);
  const [photos,setPhotos] = useState<CasaFotoConUrl[]>([]);
  const [history,setHistory] = useState<CasaEvento[]>([]);
  const [loading,setLoading] = useState(true);
  const [detailLoading,setDetailLoading] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [message,setMessage] = useState<string|null>(null);
  const [decision,setDecision] = useState<"oferta"|"rechazo"|null>(null);
  const [amount,setAmount] = useState("");
  const [reason,setReason] = useState("");
  const [note,setNote] = useState("");

  const refresh = useCallback(async () => {
    if(!supabaseBrowser){setLoading(false);setError("Supabase no está configurado.");return;}
    setLoading(true);
    const {data,error:loadError}=await supabaseBrowser.from("casas_solicitudes")
      .select("*").order("created_at",{ascending:false}).limit(500);
    if(loadError){setError("No se pudieron cargar las propiedades: "+loadError.message);setLoading(false);return;}
    const items=(data??[]) as CasaSolicitud[];
    setList(items);
    const ids=[...new Set(items.map(c=>c.asesor_id))];
    if(ids.length){
      const names=await supabaseBrowser.from("profiles").select("id,full_name").in("id",ids);
      if(!names.error && names.data) setAdvisorNames(Object.fromEntries(names.data.map(p=>[p.id,p.full_name])));
    }
    setLoading(false);
  },[]);

  const reloadDetail=useCallback(async(id:string)=>{
    if(!supabaseBrowser)return;
    setDetailLoading(true);
    try{
      const [f,h]=await Promise.all([
        cargarFotosCasa(supabaseBrowser,id),
        supabaseBrowser.from("casas_historial").select("*")
          .eq("solicitud_id",id).order("created_at",{ascending:false}).limit(40),
      ]);
      setPhotos(f);
      if(h.error)throw new Error(h.error.message);
      setHistory((h.data??[]) as CasaEvento[]);
    }catch(e){setError(e instanceof Error?e.message:"Error al cargar fotografías o historial.");}
    finally{setDetailLoading(false);}
  },[]);

  useEffect(()=>{if(currentUser?.role==="super_admin")void refresh();else setLoading(false);},[currentUser?.role,refresh]);
  useEffect(()=>{
    if(!selectedId)return;
    setPhotos([]);setHistory([]);void reloadDetail(selectedId);
  },[selectedId,reloadDetail]);

  const counts=useMemo(()=>({
    enviada:list.filter(c=>c.estado==="enviada").length,
    ofertada:list.filter(c=>c.estado==="ofertada").length,
    rechazada:list.filter(c=>c.estado==="rechazada").length,
    borrador:list.filter(c=>c.estado==="borrador").length,
    todos:list.length,
  }),[list]);
  const selected=list.find(c=>c.id===selectedId)??null;
  const filtered=useMemo(()=>list.filter(c=>{
    if(filter!=="todos"&&c.estado!==filter)return false;
    const normalized=search.trim().toLocaleLowerCase("es-MX");
    if(!normalized)return true;
    return [casaTitulo(c),c.municipio,c.colonia,c.direccion,c.nombre_contacto,advisorNames[c.asesor_id]]
      .filter(Boolean).some(v=>String(v).toLocaleLowerCase("es-MX").includes(normalized));
  }).sort((a,b)=>(a.estado==="enviada"?0:1)-(b.estado==="enviada"?0:1) || b.created_at.localeCompare(a.created_at)),[list,filter,search,advisorNames]);

  async function submitDecision(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!supabaseBrowser||!selected||!decision||busy)return;
    setBusy(true);setError(null);setMessage(null);
    try{
      const monto=decision==="oferta"?Number(amount):null;
      if(decision==="oferta" && (!Number.isFinite(monto)||monto===null||monto<=0)){
        throw new Error("Ingresa un monto de oferta mayor a cero.");
      }
      if(decision==="rechazo" && !reason.trim())throw new Error("Explica el motivo de rechazo.");
      const {error:rpcError}=await supabaseBrowser.rpc("casas_responder",{
        p_solicitud_id:selected.id,
        p_accion:decision,
        p_monto_mxn:monto,
        p_motivo:decision==="rechazo"?reason.trim():null,
        p_nota:decision==="oferta"?note.trim()||null:null,
      });
      if(rpcError)throw new Error(rpcError.message);
      setDecision(null);setAmount("");setNote("");setReason("");
      setMessage("Respuesta guardada. Ya está disponible en la sección de casas del asesor.");
      await refresh();
      await reloadDetail(selected.id);
    }catch(err){setError(err instanceof Error?err.message:"No se pudo guardar la respuesta.");}
    finally{setBusy(false);}
  }

  if(currentUser===undefined)return <main className="p-8 text-slate-500">Verificando sesión…</main>;
  if(!currentUser)return <main className="p-8">Inicia sesión como administrador. <Link href="/login" className="text-emerald-700 underline">Entrar</Link></main>;
  if(currentUser.role!=="super_admin")return <main className="p-8 text-slate-700">Solo un administrador de ConCasa puede revisar las ofertas de compra.</main>;

  return <main className="min-h-screen bg-[#f6f8f6] pb-14">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-7">
        <div className="flex items-center gap-3"><Link href="/admin" className="text-sm font-semibold text-slate-500 hover:text-emerald-800">← Panel Admin</Link><span className="h-5 w-px bg-slate-200"/><span className="text-sm font-bold text-slate-900">ConCasa · Compra de casas</span></div>
        <button type="button" onClick={()=>void refresh()} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">↻ Actualizar bandeja</button>
      </div>
    </header>
    <div className="mx-auto max-w-[1480px] px-4 pt-8 sm:px-7">
      <div className="mb-7">
        <div className="mb-2 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-widest text-emerald-800">Bandeja administrativa</div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Compra de casas</h1>
        <p className="mt-2 text-sm text-slate-600">Oportunidades que envían tus asesores. Revisa fotos y datos y responde con una oferta o un rechazo motivado. Independiente de Mesa de Control.</p>
      </div>

      {error?<div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}<button className="ml-3 underline" onClick={()=>setError(null)}>Cerrar</button></div>:null}
      {message?<div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div>:null}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[{id:"enviada" as const,title:"Por revisar",n:counts.enviada},{id:"ofertada" as const,title:"Ofertas enviadas",n:counts.ofertada},{id:"rechazada" as const,title:"Rechazadas",n:counts.rechazada},{id:"todos" as const,title:"Total de casas",n:counts.todos}].map(item=><button key={item.id} onClick={()=>setFilter(item.id)} className={`rounded-2xl border p-5 text-left shadow-sm transition hover:shadow-md ${filter===item.id?"border-emerald-500 bg-emerald-50":"border-slate-200 bg-white"}`}><span className="text-xs font-semibold text-slate-600">{item.title}</span><span className="mt-2 block text-3xl font-bold text-slate-950">{item.n}</span></button>)}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(330px,0.9fr)_minmax(0,1.4fr)]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <input aria-label="Buscar casa" placeholder="Buscar por colonia, asesor o contacto…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"/>
            <div className="mt-3 flex flex-wrap gap-2">{filters.map(item=><button key={item.id} onClick={()=>setFilter(item.id)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${filter===item.id?"border-emerald-800 bg-emerald-800 text-white":"border-slate-200 text-slate-600 hover:border-slate-400"}`}>{item.label}</button>)}</div>
          </div>
          {loading?<p className="p-8 text-center text-slate-500">Cargando casas…</p>
            :filtered.length===0?<div className="p-10 text-center"><div className="text-3xl">⌂</div><p className="mt-2 font-semibold text-slate-800">Sin propiedades en esta vista</p><p className="mt-2 text-xs text-slate-500">Las casas enviadas aparecerán aquí automáticamente.</p></div>
            :<div className="max-h-[75vh] divide-y divide-slate-100 overflow-y-auto">{filtered.map(casa=><button key={casa.id} type="button" onClick={()=>{setSelectedId(casa.id);setDecision(null);setMessage(null);setError(null);}} className={`w-full p-4 text-left transition hover:bg-emerald-50/50 ${selectedId===casa.id?"bg-emerald-50 ring-1 ring-inset ring-emerald-300":""}`}>
              <div className="flex items-center justify-between gap-3"><span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${casaEstadoStyle(casa.estado)}`}>{casaEstadoLabel(casa.estado)}</span><span className="text-xs text-slate-400">{fechaCasa(casa.enviada_at||casa.created_at)}</span></div>
              <p className="mt-2 font-semibold text-slate-950">{casaTitulo(casa)}</p><p className="mt-1 text-xs text-slate-600">Asesor: <strong>{advisorNames[casa.asesor_id]||"Asesor de ConCasa"}</strong></p>
              <p className="mt-1 text-xs text-slate-500">{[casa.municipio,casa.nombre_contacto].filter(Boolean).join(" · ")||"Sin datos adicionales"}</p>
            </button>)}</div>}
        </section>

        <section className="min-h-[400px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {!selected?<div className="flex min-h-[400px] flex-col items-center justify-center p-10 text-center"><span className="text-5xl text-slate-300">⌂</span><h2 className="mt-4 text-lg font-bold text-slate-900">Selecciona una propiedad</h2><p className="mt-2 max-w-sm text-sm text-slate-500">Aquí verás los datos, fotografías privadas y la opción de hacer una oferta o rechazar la compra.</p></div>
            :<div>
              <div className="bg-emerald-950 p-6 text-white">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">Solicitud de compra</p><h2 className="mt-2 text-2xl font-bold">{casaTitulo(selected)}</h2><p className="mt-2 text-xs text-emerald-100">Enviada: {fechaCasa(selected.enviada_at)} · {advisorNames[selected.asesor_id]||"Asesor"}</p></div><span className={`rounded-full border px-3 py-1 text-xs font-bold ${casaEstadoStyle(selected.estado)}`}>{casaEstadoLabel(selected.estado)}</span></div>
              </div>
              <div className="space-y-7 p-5 sm:p-6">
                {selected.estado==="borrador"?<div className="rounded-xl bg-slate-100 p-4 text-sm text-slate-700">Esta casa todavía es un borrador del asesor. No puedes responder hasta que la envíe.</div>:null}
                {selected.estado==="ofertada"?<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-xs font-bold uppercase text-emerald-800">Oferta vigente</div><div className="mt-1 text-3xl font-bold text-emerald-950">{pesos(selected.oferta_mxn)}</div>{selected.nota_admin?<p className="mt-1 text-sm text-emerald-900">{selected.nota_admin}</p>:null}</div>:null}
                {selected.estado==="rechazada"?<div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="font-semibold text-rose-950">Rechazada</p><p className="mt-1 text-sm text-rose-900">{selected.motivo_rechazo}</p></div>:null}
                <div><h3 className="font-bold text-slate-900">Información recibida</h3><dl className="mt-4 grid gap-4 sm:grid-cols-2">{CASA_CAMPO_DETALLE.map(field=>{
                  const raw=selected[field.key];
                  return <div key={field.key} className={field.key==="comentarios"?"sm:col-span-2":""}><dt className="text-xs font-semibold uppercase text-slate-500">{field.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-slate-950">{raw==null||raw===""?"Sin información":field.money?pesos(Number(raw)):String(raw)}</dd></div>;
                })}</dl></div>
                <div><h3 className="mb-3 font-bold text-slate-900">Fotos de la casa <span className="text-sm font-normal text-slate-500">({photos.length})</span></h3>{detailLoading?<p className="text-sm text-slate-500">Cargando fotos…</p>:photos.length===0?<div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">Sin fotografías adjuntas</div>:<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map(p=><a key={p.id} href={p.url||"#"} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">{p.url?<img src={p.url} alt={p.nombre_archivo} className="aspect-square w-full object-cover" />:<div className="flex aspect-square items-center justify-center text-xs text-slate-500">No disponible</div>}<div className="truncate p-2 text-xs text-slate-600">{p.nombre_archivo}</div></a>)}</div>}</div>
                {selected.estado!=="borrador"?<div className="border-t border-slate-100 pt-6">
                  <h3 className="font-bold text-slate-900">Tu decisión</h3>
                  <p className="mt-1 text-xs text-slate-500">La respuesta quedará guardada y será visible para el asesor. Si cambias una decisión, se conserva el historial.</p>
                  <div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={()=>{setDecision("oferta");setAmount(selected.oferta_mxn?String(selected.oferta_mxn):"");setReason("");setNote(selected.nota_admin||"");}} className="rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-900">Hacer oferta</button><button type="button" onClick={()=>{setDecision("rechazo");setReason(selected.motivo_rechazo||"");setAmount("");setNote("");}} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-800 hover:bg-rose-100">Rechazar compra</button></div>
                  {decision?<form onSubmit={submitDecision} className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h4 className="font-semibold text-slate-900">{decision==="oferta"?"Enviar oferta al asesor":"Informar rechazo al asesor"}</h4>
                    {decision==="oferta"?<><label htmlFor="casa-oferta" className="mt-4 block text-xs font-semibold text-slate-700">Oferta en pesos mexicanos (MXN) *</label><input id="casa-oferta" type="number" step="0.01" min="0.01" required value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Ej. 480000" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"/><label htmlFor="casa-nota" className="mt-4 block text-xs font-semibold text-slate-700">Nota adicional (opcional)</label><textarea id="casa-nota" rows={3} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} placeholder="Condiciones o detalles de la oferta..." className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"/></>
                      :<><label htmlFor="casa-motivo" className="mt-4 block text-xs font-semibold text-slate-700">Motivo de rechazo *</label><textarea id="casa-motivo" required maxLength={2000} rows={4} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Explica al asesor por qué no se comprará esta propiedad..." className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"/></>}
                    <div className="mt-4 flex justify-end gap-3"><button type="button" onClick={()=>setDecision(null)} disabled={busy} className="rounded-xl border border-slate-300 px-4 py-2 text-sm">Cancelar</button><button type="submit" disabled={busy} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${decision==="oferta"?"bg-emerald-800":"bg-rose-700"}`}>{busy?"Guardando…":"Confirmar y enviar respuesta"}</button></div>
                  </form>:null}
                </div>:null}
                {history.length>0?<div className="border-t border-slate-100 pt-5"><h3 className="font-bold text-slate-900">Historial de decisiones</h3><ol className="mt-3 space-y-3">{history.map(h=><li key={h.id} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 pb-2 text-sm"><div><strong className="text-slate-800">{h.accion==="envio"?"Enviada a Admin":h.accion==="oferta"?"Oferta: "+pesos(h.monto_mxn):"Rechazada"}</strong>{h.nota?<p className="text-xs text-slate-500">{h.nota}</p>:null}</div><span className="text-xs text-slate-400">{fechaCasa(h.created_at)}</span></li>)}</ol></div>:null}
              </div>
            </div>}
        </section>
      </div>
    </div>
  </main>;
}
