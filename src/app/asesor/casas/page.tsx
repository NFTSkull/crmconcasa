"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSessionRepo } from "@/domain/session";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  casaEstadoLabel, casaEstadoStyle, casaTitulo, fechaCasa, pesos,
  type CasaSolicitud,
} from "@/domain/casas/casas-client";

type CasaFormulario = {
  nombre_contacto: string; telefono_contacto: string;
  municipio: string; colonia: string; direccion: string;
  tipo_inmueble: string; situacion_inmueble: string;
  adeudo_tipo: string; adeudo_aproximado_mxn: string;
  precio_esperado_mxn: string; comentarios: string; conyuge_aplica: string;
};
const EMPTY: CasaFormulario = {
  nombre_contacto: "", telefono_contacto: "", municipio: "", colonia: "",
  direccion: "", tipo_inmueble: "", situacion_inmueble: "",
  adeudo_tipo: "", adeudo_aproximado_mxn: "",
  precio_esperado_mxn: "", comentarios: "", conyuge_aplica: "",
};
const textInput = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";
const label = "block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1.5";
const onlyText = (value: string) => value.trim() || null;
function parseMonto(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 999999999999.99) throw new Error("Revisa los montos: deben ser números positivos.");
  return Math.round(n * 100) / 100;
}

export default function CompraCasasAsesorPage() {
  const router = useRouter();
  const { currentUser } = useSessionRepo();
  const [form, setForm] = useState<CasaFormulario>(EMPTY);
  const [solicitudes, setSolicitudes] = useState<CasaSolicitud[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    const client = supabaseBrowser;
    if (!client) { setError("Supabase no está disponible."); setLoading(false); return; }
    setLoading(true);
    const { data, error: loadError } = await client.from("casas_solicitudes")
      .select("*").order("created_at", { ascending: false }).limit(150);
    if (loadError) setError("No se pudieron cargar las casas: " + loadError.message);
    else setSolicitudes((data ?? []) as CasaSolicitud[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (currentUser?.role !== "asesor") { setLoading(false); return; }
    void refresh();
  }, [currentUser?.role, refresh]);

  function change(key: keyof CasaFormulario, value: string) {
    setForm(prev => ({...prev, [key]: value}));
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabaseBrowser || saving) return;
    setSaving(true); setError(null);
    try {
      const { data: identity, error: authError } = await supabaseBrowser.auth.getUser();
      if (authError || !identity.user) throw new Error("Tu sesión expiró. Inicia sesión de nuevo.");
      const { data: profile, error: profileError } = await supabaseBrowser
        .from("profiles").select("organization_id,app_role,active")
        .eq("id",identity.user.id).single();
      if (profileError || !profile?.active || profile.app_role !== "asesor") {
        throw new Error("Tu cuenta no está habilitada para enviar propiedades.");
      }
      const { data, error: createError } = await supabaseBrowser
        .from("casas_solicitudes").insert({
          organization_id: profile.organization_id,
          asesor_id: identity.user.id,
          estado: "borrador",
          nombre_contacto: onlyText(form.nombre_contacto),
          telefono_contacto: onlyText(form.telefono_contacto),
          municipio: onlyText(form.municipio),
          colonia: onlyText(form.colonia),
          direccion: onlyText(form.direccion),
          tipo_inmueble: onlyText(form.tipo_inmueble),
          situacion_inmueble: onlyText(form.situacion_inmueble),
          adeudo_tipo: onlyText(form.adeudo_tipo),
          adeudo_aproximado_mxn: parseMonto(form.adeudo_aproximado_mxn),
          precio_esperado_mxn: parseMonto(form.precio_esperado_mxn),
          comentarios: onlyText(form.comentarios),
          conyuge_aplica: form.conyuge_aplica === "" ? null : form.conyuge_aplica === "si",
        }).select("id").single();
      if (createError || !data) throw new Error(createError?.message || "No se pudo crear la casa.");
      router.push("/asesor/casas/" + data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible guardar la propiedad.");
    } finally { setSaving(false); }
  }

  if (currentUser === undefined) return <main className="p-8 text-slate-500">Verificando sesión…</main>;
  if (!currentUser) return <main className="mx-auto max-w-xl p-8">Inicia sesión para continuar. <Link className="text-emerald-700 underline" href="/login">Ir a login</Link></main>;
  if (currentUser.role !== "asesor") return <main className="p-8">Esta sección está disponible para asesores de ConCasa.</main>;

  return (
    <main className="min-h-screen bg-[#f6f8f6] pb-16">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/asesor" className="text-sm font-medium text-slate-500 hover:text-emerald-800">← Mi CRM</Link>
            <div className="h-5 w-px bg-slate-200" />
            <span className="text-sm font-semibold text-slate-900">ConCasa · Compra de casas</span>
          </div>
          <button type="button" onClick={()=>{setShowForm(v=>!v);setError(null);}} className="rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-900">
            {showForm ? "Ver mis casas" : "+ Registrar una casa"}
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 pt-9 sm:px-6">
        <div className="mb-8">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">Módulo de propiedades</div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Compra de casas</h1>
          <p className="mt-2 max-w-2xl text-slate-600">Envía oportunidades de compra directamente al administrador. Todos los datos son opcionales; puedes añadir fotografías antes de enviarla y recibirás aquí la oferta o el motivo de rechazo.</p>
        </div>

        {error ? <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}

        {showForm ? (
          <form onSubmit={create} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-emerald-950 px-6 py-6 text-white">
              <h2 className="text-xl font-semibold">Nueva oportunidad de compra</h2>
              <p className="mt-1 text-sm text-emerald-100">Llena lo que tengas. No se exige ningún campo para registrar el borrador.</p>
            </div>
            <div className="space-y-8 p-5 sm:p-7">
              <section>
                <h3 className="mb-4 text-base font-semibold text-slate-900">01. Contacto</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><label htmlFor="casa-contacto" className={label}>Nombre del propietario o contacto (opcional)</label><input id="casa-contacto" className={textInput} maxLength={180} value={form.nombre_contacto} onChange={e=>change("nombre_contacto",e.target.value)} placeholder="¿Con quién hablamos?" /></div>
                  <div><label htmlFor="casa-telefono" className={label}>Teléfono (opcional)</label><input id="casa-telefono" type="tel" className={textInput} maxLength={30} value={form.telefono_contacto} onChange={e=>change("telefono_contacto",e.target.value)} placeholder="81..." /></div>
                </div>
              </section>
              <section>
                <h3 className="mb-4 text-base font-semibold text-slate-900">02. Ubicación y propiedad</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><label htmlFor="casa-municipio" className={label}>Municipio</label><input id="casa-municipio" className={textInput} maxLength={120} value={form.municipio} onChange={e=>change("municipio",e.target.value)} placeholder="Ej. Monterrey, Juárez, García..." /></div>
                  <div><label htmlFor="casa-colonia" className={label}>Colonia / fraccionamiento</label><input id="casa-colonia" className={textInput} maxLength={160} value={form.colonia} onChange={e=>change("colonia",e.target.value)} placeholder="Nombre de la colonia" /></div>
                  <div className="sm:col-span-2"><label htmlFor="casa-direccion" className={label}>Dirección o referencia</label><input id="casa-direccion" className={textInput} maxLength={300} value={form.direccion} onChange={e=>change("direccion",e.target.value)} placeholder="Calle, número o referencia" /></div>
                  <div><label htmlFor="casa-tipo" className={label}>Tipo de propiedad</label>
                    <select id="casa-tipo" className={textInput} value={form.tipo_inmueble} onChange={e=>change("tipo_inmueble",e.target.value)}>
                      <option value="">Sin especificar</option><option>Casa</option><option>Casa Infonavit</option><option>Departamento</option><option>Terreno con construcción</option><option>Otro</option>
                    </select>
                  </div>
                  <div><label htmlFor="casa-situacion" className={label}>Situación de la propiedad</label>
                    <select id="casa-situacion" className={textInput} value={form.situacion_inmueble} onChange={e=>change("situacion_inmueble",e.target.value)}>
                      <option value="">Sin especificar</option><option>Habitada</option><option>Deshabitada</option><option>Abandonada</option><option>Vandalizada</option><option>Intestada / herencia</option><option>Con daños</option><option>En buenas condiciones</option><option>Otro</option>
                    </select>
                  </div>
                </div>
              </section>
              <section>
                <h3 className="mb-4 text-base font-semibold text-slate-900">03. Adeudo y precio</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div><label htmlFor="casa-adeudo" className={label}>Adeudo o situación</label>
                    <select id="casa-adeudo" className={textInput} value={form.adeudo_tipo} onChange={e=>change("adeudo_tipo",e.target.value)}>
                      <option value="">No se sabe</option><option>Crédito Infonavit</option><option>Crédito bancario</option><option>Libre de gravamen</option><option>Intestada</option><option>Sin escrituras</option><option>Otro</option>
                    </select>
                  </div>
                  <div><label htmlFor="casa-monto-adeudo" className={label}>Adeudo aproximado (MXN)</label><input id="casa-monto-adeudo" type="number" min="0" step="0.01" className={textInput} value={form.adeudo_aproximado_mxn} onChange={e=>change("adeudo_aproximado_mxn",e.target.value)} placeholder="Opcional" /></div>
                  <div><label htmlFor="casa-precio" className={label}>Precio que solicita (MXN)</label><input id="casa-precio" type="number" min="0" step="0.01" className={textInput} value={form.precio_esperado_mxn} onChange={e=>change("precio_esperado_mxn",e.target.value)} placeholder="Opcional" /></div>
                </div>
              </section>
              <section>
                <h3 className="mb-4 text-base font-semibold text-slate-900">04. Titular y cónyuge</h3>
                <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
                  <label htmlFor="casa-conyuge" className={label}>¿Participa un cónyuge?</label>
                  <select id="casa-conyuge" className={textInput} value={form.conyuge_aplica} onChange={e=>change("conyuge_aplica",e.target.value)}>
                    <option value="">Por definir</option><option value="si">Sí, aplica</option><option value="no">No aplica</option>
                  </select>
                  <p className="mt-2 text-xs leading-5 text-amber-800">Para enviar la propiedad se solicitará la INE del titular y, si corresponde, la INE del cónyuge. Los demás documentos del checklist son opcionales.</p>
                </div>
              </section>
              <section>
                <h3 className="mb-4 text-base font-semibold text-slate-900">05. Observaciones</h3>
                <label htmlFor="casa-notas" className={label}>Detalles que conviene conocer</label>
                <textarea id="casa-notas" rows={4} maxLength={4000} className={textInput} value={form.comentarios} onChange={e=>change("comentarios",e.target.value)} placeholder="Por qué quiere vender, características, estado de papeles o cualquier dato útil..." />
              </section>
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-6">
                <p className="max-w-md text-xs text-slate-500">Se guardará como borrador. Después podrás adjuntar documentos organizados por titular, cónyuge, servicios y exención, además de 12 fotografías. El envío será únicamente al administrador, nunca a Mesa de Control.</p>
                <button type="submit" disabled={saving} className="rounded-xl bg-emerald-800 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50 hover:bg-emerald-900">{saving ? "Guardando casa..." : "Continuar a documentos →"}</button>
              </div>
            </div>
          </form>
        ) : (
          <section>
            <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold text-slate-900">Mis propiedades <span className="text-slate-400">({solicitudes.length})</span></h2><button type="button" onClick={()=>void refresh()} className="text-sm font-medium text-emerald-700 hover:underline">Actualizar</button></div>
            {loading ? <div className="rounded-2xl bg-white p-10 text-center text-slate-500">Cargando propiedades…</div>
              : solicitudes.length===0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><div className="text-4xl">⌂</div><h3 className="mt-3 font-semibold text-slate-900">Aún no has enviado casas</h3><p className="mt-1 text-sm text-slate-500">Tu primera oportunidad comienza con cualquier dato o fotografía disponible.</p><button onClick={()=>setShowForm(true)} className="mt-5 rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white">Registrar mi primera casa</button></div>
              : <div className="grid gap-4 md:grid-cols-2">
                {solicitudes.map(casa=>(
                  <Link key={casa.id} href={"/asesor/casas/"+casa.id} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${casaEstadoStyle(casa.estado)}`}>{casaEstadoLabel(casa.estado)}</span><span className="text-xs text-slate-400">{fechaCasa(casa.created_at)}</span></div>
                    <h3 className="text-lg font-semibold text-slate-950 group-hover:text-emerald-800">{casaTitulo(casa)}</h3>
                    <p className="mt-1 text-sm text-slate-500">{[casa.municipio,casa.nombre_contacto].filter(Boolean).join(" · ")||"Sin datos adicionales"}</p>
                    {casa.estado==="ofertada" ? <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">Oferta del administrador: <strong>{pesos(casa.oferta_mxn)}</strong></div> : null}
                    {casa.estado==="rechazada" ? <div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-900">Motivo: {casa.motivo_rechazo}</div> : null}
                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm font-semibold text-emerald-800"><span>{casa.estado==="borrador"?"Añadir fotos y enviar":"Ver detalles y respuesta"}</span><span>→</span></div>
                  </Link>
                ))}
              </div>}
          </section>
        )}
      </div>
    </main>
  );
}
