"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useSessionRepo } from "@/domain/session";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  CASA_CAMPO_DETALLE,cargarFotosCasa,casaEstadoLabel,casaEstadoStyle,casaTitulo,fechaCasa,pesos,
  type CasaEvento,type CasaFotoConUrl,type CasaSolicitud,
} from "@/domain/casas/casas-client";

const VALID_MIME: Record<string,string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const LIMIT = 10 * 1024 * 1024;

export default function CasaDetalleAsesorPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id ?? "");
  const { currentUser } = useSessionRepo();
  const [casa,setCasa] = useState<CasaSolicitud|null>(null);
  const [photos,setPhotos] = useState<CasaFotoConUrl[]>([]);
  const [history,setHistory] = useState<CasaEvento[]>([]);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [notice,setNotice] = useState<string|null>(null);
  const [confirmSend,setConfirmSend] = useState(false);

  const reload = useCallback(async () => {
    const client = supabaseBrowser;
    if (!client) {setError("Supabase no está disponible.");setLoading(false);return;}
    const [a,b,c]=await Promise.all([
      client.from("casas_solicitudes").select("*").eq("id",id).maybeSingle(),
      cargarFotosCasa(client,id),
      client.from("casas_historial").select("*").eq("solicitud_id",id).order("created_at",{ascending:false}).limit(30),
    ]);
    if(a.error) setError("No se pudo consultar la casa: "+a.error.message);
    else setCasa((a.data ?? null) as CasaSolicitud|null);
    setPhotos(b);
    if(!c.error) setHistory((c.data ?? []) as CasaEvento[]);
    setLoading(false);
  },[id]);

  useEffect(()=>{
    if(currentUser?.role!=="asesor"){setLoading(false);return;}
    void reload().catch(e=>{setError(e instanceof Error?e.message:"Error al abrir la casa.");setLoading(false);});
  },[currentUser?.role,reload]);

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked=Array.from(event.currentTarget.files??[]);
    event.currentTarget.value="";
    if(!casa||casa.estado!=="borrador"||!supabaseBrowser||busy||picked.length===0)return;
    setError(null);setNotice(null);
    if(photos.length+picked.length>12){setError("Máximo 12 fotografías por inmueble.");return;}
    setBusy(true);
    try{
      const {data:{user},error:authError}=await supabaseBrowser.auth.getUser();
      if(authError||!user)throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
      for(const file of picked){
        const extension=VALID_MIME[file.type];
        if(!extension)throw new Error("Solo se permiten JPG, PNG y WEBP.");
        if(file.size===0||file.size>LIMIT)throw new Error("Cada imagen debe pesar menos de 10 MB.");
        const path=`${casa.organization_id}/${casa.id}/${crypto.randomUUID()}.${extension}`;
        const upload=await supabaseBrowser.storage.from("casas-fotos").upload(path,file,{
          contentType:file.type,cacheControl:"3600",upsert:false,
        });
        if(upload.error)throw new Error("No se pudo subir "+file.name+": "+upload.error.message);
        const insert=await supabaseBrowser.from("casas_fotos").insert({
          solicitud_id:casa.id,storage_path:path,nombre_archivo:file.name.slice(0,250),
          mime_type:file.type,size_bytes:file.size,uploaded_by:user.id,
        });
        if(insert.error){
          await supabaseBrowser.storage.from("casas-fotos").remove([path]);
          throw new Error("No se pudo registrar la foto: "+insert.error.message);
        }
      }
      setNotice("Fotografías guardadas correctamente.");
      await reload();
    }catch(err){setError(err instanceof Error?err.message:"No se pudieron subir las imágenes.");}
    finally{setBusy(false);}
  }

  async function removePhoto(photo:CasaFotoConUrl){
    if(!supabaseBrowser||!casa||casa.estado!=="borrador"||busy)return;
    setBusy(true);setError(null);
    try {
      const removed=await supabaseBrowser.storage.from("casas-fotos").remove([photo.storage_path]);
      if(removed.error)throw new Error(removed.error.message);
      const del=await supabaseBrowser.from("casas_fotos").delete().eq("id",photo.id).eq("solicitud_id",casa.id);
      if(del.error)throw new Error("Imagen borrada, pero no se pudo actualizar la lista: "+del.error.message);
      setNotice("Fotografía eliminada.");await reload();
    }catch(err){setError(err instanceof Error?err.message:"Error al eliminar fotografía.");}
    finally{setBusy(false);}
  }

  async function send() {
    if(!supabaseBrowser||!casa||casa.estado!=="borrador"||busy)return;
    setBusy(true);setError(null);setNotice(null);
    try {
      const {error:sendError}=await supabaseBrowser.rpc("casas_enviar",{p_solicitud_id:casa.id});
      if(sendError)throw new Error(sendError.message);
      setNotice("¡Casa enviada al administrador! Podrás consultar aquí la respuesta.");
      setConfirmSend(false);
      await reload();
    }catch(err){setError(err instanceof Error?err.message:"No se pudo enviar la propiedad.");}
    finally{setBusy(false);}
  }

  if(currentUser===undefined)return <main className="p-8 text-slate-500">Verificando sesión…</main>;
  if(!currentUser)return <main className="p-8">Inicia sesión. <Link className="text-emerald-700 underline" href="/login">Entrar</Link></main>;
  if(currentUser.role!=="asesor")return <main className="p-8">Acceso exclusivo para asesores.</main>;

  return <main className="min-h-screen bg-[#f6f8f6] pb-14">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6"><Link className="text-sm font-semibold text-emerald-800 hover:underline" href="/asesor/casas">← Volver a mis casas</Link><span className="text-sm font-semibold text-slate-700">ConCasa · Compra de casas</span></div></header>
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      {error?<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>:null}
      {notice?<div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</div>:null}
      {loading?<p className="p-8 text-center text-slate-500">Cargando casa…</p>
      :!casa?<div className="rounded-2xl border bg-white p-8"><h1 className="font-semibold">Casa no encontrada o sin permiso</h1><p className="mt-2 text-sm text-slate-500">Solo puedes consultar tus propiedades de ConCasa.</p></div>
      :<>
        <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-950 to-emerald-800 p-6 text-white shadow-sm sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-emerald-200">Expediente de compra de casa</p><h1 className="text-2xl font-bold sm:text-3xl">{casaTitulo(casa)}</h1><p className="mt-2 text-sm text-emerald-100">{fechaCasa(casa.created_at)} · {casa.municipio||"Municipio sin capturar"}</p></div>
            <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${casaEstadoStyle(casa.estado)}`}>{casaEstadoLabel(casa.estado)}</span>
          </div>
          <p className="mt-6 max-w-2xl text-sm text-emerald-100">Este trámite es independiente de Mejoravit. Se envía directamente al administrador y nunca pasa por Mesa de Control.</p>
        </section>

        {casa.estado==="ofertada"?<section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6"><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Oferta del administrador</p><p className="mt-2 text-3xl font-bold text-emerald-950">{pesos(casa.oferta_mxn)}</p>{casa.nota_admin?<p className="mt-3 text-sm text-emerald-900">{casa.nota_admin}</p>:null}<p className="mt-2 text-xs text-emerald-700">Respondida: {fechaCasa(casa.revisada_at)}</p></section>:null}
        {casa.estado==="rechazada"?<section className="rounded-2xl border border-rose-200 bg-rose-50 p-6"><h2 className="text-lg font-semibold text-rose-950">No se aprobó la compra</h2><p className="mt-2 text-sm text-rose-900">{casa.motivo_rechazo}</p><p className="mt-2 text-xs text-rose-700">Respondida: {fechaCasa(casa.revisada_at)}</p></section>:null}

        <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">Información de la propiedad</h2>
            <p className="mt-1 text-xs text-slate-500">Los datos no capturados se muestran como «Sin información».</p>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              {CASA_CAMPO_DETALLE.map(field=>{
                const raw=casa[field.key];
                return <div key={field.key} className={field.key==="comentarios"?"sm:col-span-2":""}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{field.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-slate-900">{raw==null||raw===""?"Sin información":field.money?pesos(Number(raw)):String(raw)}</dd>
                </div>;
              })}
            </dl>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-950">Fotografías</h2><p className="mt-1 text-xs text-slate-500">{photos.length} de 12 fotos · privadas</p></div>
              {casa.estado==="borrador"?<label className="cursor-pointer rounded-xl bg-emerald-800 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-900">{busy?"Guardando…":"+ Agregar fotos"}<input className="sr-only" aria-label="Subir fotografías" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>void addFiles(e)} /></label>:null}
            </div>
            {casa.estado==="borrador"?<p className="mt-3 text-xs text-slate-500">JPG, PNG o WEBP. Hasta 10 MB por imagen y 12 por propiedad. No necesitas subir fotos para enviar.</p>:null}
            {photos.length===0?<div className="mt-5 flex min-h-44 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-5 text-center"><span className="text-3xl">▧</span><p className="mt-2 text-sm text-slate-500">Todavía no hay fotos de esta propiedad.</p></div>
             :<div className="mt-5 grid grid-cols-2 gap-3">
               {photos.map(photo=><div key={photo.id} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                 {photo.url?<a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.nombre_archivo} className="aspect-square w-full object-cover" /></a>:<div className="flex aspect-square items-center justify-center text-xs text-slate-500">Vista no disponible</div>}
                 <div className="flex items-center justify-between gap-2 px-2 py-2"><span className="min-w-0 truncate text-xs text-slate-600">{photo.nombre_archivo}</span>{casa.estado==="borrador"?<button disabled={busy} title="Eliminar foto" aria-label={`Eliminar ${photo.nombre_archivo}`} onClick={()=>void removePhoto(photo)} className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50">Quitar</button>:null}</div>
               </div>)}
             </div>}
          </section>
        </div>
        {casa.estado==="borrador"?<section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-5"><div><h2 className="text-lg font-bold text-slate-950">Enviar al administrador</h2><p className="mt-1 max-w-xl text-sm text-slate-600">Una vez enviada, el formulario y las fotos quedan en consulta; podrás ver aquí si te ofrecen un monto o si rechazan la compra.</p></div><button disabled={busy} onClick={()=>setConfirmSend(true)} className="rounded-xl bg-emerald-800 px-5 py-3 text-sm font-bold text-white disabled:opacity-50 hover:bg-emerald-900">Enviar casa a Admin →</button></div></section>
        :<section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">La casa se envió a Admin el {fechaCasa(casa.enviada_at)}. {casa.estado==="enviada"?"Está pendiente de revisión.":"La decisión está registrada y puedes consultarla arriba."}</section>}

        {history.length>0?<section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="font-bold text-slate-900">Historial de respuestas</h2><ol className="mt-4 space-y-3">{history.map(item=><li key={item.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3 text-sm"><span className="font-medium text-slate-800">{item.accion==="envio"?"Enviada a administrador":item.accion==="oferta"?"Oferta: "+pesos(item.monto_mxn):"Rechazada"}{item.nota?<span className="block text-xs font-normal text-slate-500">{item.nota}</span>:null}</span><time className="text-xs text-slate-500">{fechaCasa(item.created_at)}</time></li>)}</ol></section>:null}
      </>}
    </div>
    {confirmSend?<div role="dialog" aria-modal="true" aria-labelledby="confirm-casa-envio" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 id="confirm-casa-envio" className="text-xl font-bold text-slate-950">¿Enviar esta propiedad?</h2><p className="mt-2 text-sm text-slate-600">Se notificará en la bandeja de Compra de casas del administrador. No va a Mesa. Después del envío podrás consultar la respuesta, pero no agregar fotos.</p><div className="mt-6 flex justify-end gap-3"><button onClick={()=>setConfirmSend(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm" disabled={busy}>Cancelar</button><button onClick={()=>void send()} disabled={busy} className="rounded-xl bg-emerald-800 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?"Enviando…":"Sí, enviar a Admin"}</button></div></div></div>:null}
  </main>;
}
