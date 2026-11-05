"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";

import { supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  CASA_GRUPOS_DOCUMENTALES,
  cargarDocumentosCasa,
  documentosClavePresentes,
  TOTAL_TIPOS_DOCUMENTOS_CASA,
  type CasaDocumentoConUrl,
  type TipoDocumentoCasa,
} from "@/domain/casas/casas-documentos";

const EXT_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_BYTES = 12 * 1024 * 1024;

type Props = {
  solicitudId: string;
  organizationId: string;
  estado: "borrador" | "enviada" | "ofertada" | "rechazada";
  conyugeAplica: boolean | null;
  editable?: boolean;
  onChecklistChange?: (status: { ineTitular: boolean; ineConyuge: boolean; cargando: boolean }) => void;
  onConyugeChange?: (aplica: boolean | null) => void;
};

export function CasaChecklistDocumental({
  solicitudId,
  organizationId,
  estado,
  conyugeAplica,
  editable = false,
  onChecklistChange,
  onConyugeChange,
}: Props) {
  const [docs, setDocs] = useState<CasaDocumentoConUrl[]>([]);
  const [cargando, setCargando] = useState(true);
  const [fileBusy, setFileBusy] = useState<TipoDocumentoCasa | null>(null);
  const [conyugeBusy, setConyugeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const puedeSubir = editable && estado === "borrador";
  const clave = documentosClavePresentes(docs);
  const tiposPresentes = new Set(docs.map((doc) => doc.tipo_documento));
  const completados = CASA_GRUPOS_DOCUMENTALES.reduce(
    (acc, grupo) => acc + grupo.items.filter((item) => tiposPresentes.has(item.id)).length,
    0,
  );

  const refresh = useCallback(async () => {
    const client = supabaseBrowser;
    if (!client) { setError("No hay conexión con el almacenamiento de documentos."); setCargando(false); return; }
    setCargando(true);
    try {
      const next = await cargarDocumentosCasa(client, solicitudId);
      setDocs(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al consultar documentos.");
    } finally {
      setCargando(false);
    }
  }, [solicitudId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    onChecklistChange?.({ ...clave, cargando });
  }, [clave.ineTitular, clave.ineConyuge, cargando, onChecklistChange]);

  async function subir(tipo: TipoDocumentoCasa, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    const client = supabaseBrowser;
    if (!puedeSubir || !client || fileBusy || files.length === 0) return;
    const existentes = docs.filter((doc) => doc.tipo_documento === tipo).length;
    if (existentes + files.length > 4) {
      setError("Puedes adjuntar hasta 4 archivos por apartado (por ejemplo, ambos lados de la INE).");
      return;
    }
    setFileBusy(tipo);
    setError(null);
    try {
      const { data: { user }, error: loginError } = await client.auth.getUser();
      if (loginError || !user) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");

      for (const file of files) {
        const extension = EXT_POR_MIME[file.type];
        if (!extension) throw new Error("Solo se aceptan PDF, JPG, PNG o WEBP.");
        if (file.size <= 0 || file.size > MAX_BYTES) {
          throw new Error("Cada archivo debe pesar entre 1 byte y 12 MB.");
        }
        const path = [organizationId, solicitudId, crypto.randomUUID() + "." + extension].join("/");
        const upload = await client.storage.from("casas-documentos").upload(path, file, {
          contentType: file.type, upsert: false, cacheControl: "3600",
        });
        if (upload.error) throw new Error(file.name + ": " + upload.error.message);

        const result = await client.from("casas_documentos").insert({
          solicitud_id: solicitudId,
          tipo_documento: tipo,
          storage_path: path,
          nombre_archivo: file.name.slice(0, 220),
          mime_type: file.type,
          size_bytes: file.size,
          uploaded_by: user.id,
        });
        if (result.error) {
          await client.storage.from("casas-documentos").remove([path]);
          throw new Error("No se pudo registrar " + file.name + ": " + result.error.message);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cargar el documento.");
    } finally {
      await refresh();
      setFileBusy(null);
    }
  }

  async function eliminar(doc: CasaDocumentoConUrl) {
    const client = supabaseBrowser;
    if (!puedeSubir || !client || fileBusy) return;
    setFileBusy(doc.tipo_documento);
    setError(null);
    try {
      const removed = await client.storage.from("casas-documentos").remove([doc.storage_path]);
      if (removed.error) throw new Error(removed.error.message);
      const deleted = await client.from("casas_documentos")
        .delete().eq("id", doc.id).eq("solicitud_id", solicitudId);
      if (deleted.error) throw new Error("Archivo retirado, pero no se actualizó el registro: " + deleted.error.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el archivo.");
    } finally {
      await refresh();
      setFileBusy(null);
    }
  }

  async function cambiarConyuge(value: string) {
    const client = supabaseBrowser;
    if (!puedeSubir || !client || conyugeBusy) return;
    const newValue = value === "" ? null : value === "si";
    setConyugeBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await client.rpc("casas_configurar_conyuge", {
        p_solicitud_id: solicitudId, p_conyuge_aplica: newValue,
      });
      if (rpcError) throw new Error(rpcError.message);
      onConyugeChange?.(newValue);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la información del cónyuge.");
    } finally {
      setConyugeBusy(false);
    }
  }

  return (
    <section aria-labelledby="casas-checklist-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700">Documentación de compra</p>
          <h2 id="casas-checklist-title" className="mt-1 text-xl font-bold tracking-tight text-slate-950">Checklist documental</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Documentos clasificados por persona y tipo. Los apartados opcionales pueden quedar vacíos.
            La validación de INE tachada en el checklist original no se solicita.
          </p>
        </div>
        <span className="inline-flex rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
          {completados} de {TOTAL_TIPOS_DOCUMENTOS_CASA} tipos con archivos
        </span>
      </div>

      {error ? <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        {error} <button type="button" onClick={() => void refresh()} className="ml-2 font-semibold underline">Reintentar</button>
      </div> : null}

      {puedeSubir ? (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <strong>Antes de enviar al administrador:</strong> adjunta la INE del titular.
          Si participa un cónyuge, también se solicitará su INE. Puedes agregar los demás documentos cuando estén disponibles.
        </div>
      ) : null}

      <div className="mt-6 space-y-5">
        {CASA_GRUPOS_DOCUMENTALES.map((grupo, idx) => {
          const grupoDocs = grupo.items.filter((item) => tiposPresentes.has(item.id)).length;
          const noAplica = grupo.id === "conyuge" && conyugeAplica === false;
          return (
            <div key={grupo.id} className="overflow-hidden rounded-xl border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-100 bg-white text-sm font-bold text-emerald-800">{String(idx + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-950">{grupo.titulo}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">{grupo.descripcion}</p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-slate-500">{noAplica ? "No aplica" : grupoDocs + " / " + grupo.items.length + " adjuntos"}</span>
              </div>

              {grupo.id === "conyuge" ? (
                <div className="border-b border-slate-100 bg-white px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">¿Participa un cónyuge?</p>
                      <p className="mt-1 text-xs text-slate-500">La INE del cónyuge solo será requerida cuando marques «Sí».</p>
                    </div>
                    {puedeSubir ? (
                      <select aria-label="¿Participa un cónyuge?" value={conyugeAplica === null ? "" : conyugeAplica ? "si" : "no"}
                        disabled={conyugeBusy} onChange={(e) => void cambiarConyuge(e.target.value)}
                        className="min-w-[160px] rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 disabled:opacity-50">
                        <option value="">Por definir</option>
                        <option value="si">Sí, aplica</option>
                        <option value="no">No aplica</option>
                      </select>
                    ) : (
                      <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">
                        {conyugeAplica === null ? "Por definir" : conyugeAplica ? "Sí, aplica" : "No aplica"}
                      </span>
                    )}
                  </div>
                </div>
              ) : null}

              {noAplica ? (
                <p className="px-4 py-5 text-sm text-slate-500">El asesor indicó que no corresponde documentación de cónyuge.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {grupo.items.map((item) => {
                    const files = docs.filter((d) => d.tipo_documento === item.id);
                    const isRequired = item.prioridad && (grupo.id !== "conyuge" || conyugeAplica === true);
                    return (
                      <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                            {item.prioridad ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">{isRequired ? "Prioritario" : "Si aplica"}</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{item.nota || "Opcional"}</span>}
                          </div>
                          {cargando ? <p className="mt-2 text-xs text-slate-400">Consultando archivos…</p> : files.length === 0 ? (
                            <p className={"mt-1.5 text-xs " + (isRequired ? "font-medium text-amber-700" : "text-slate-400")}>
                              {isRequired ? "Pendiente por adjuntar" : "Sin documento adjunto"}
                            </p>
                          ) : (
                            <div className="mt-2 flex flex-col gap-1.5">
                              {files.map((file) => (
                                <div key={file.id} className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                                  <span aria-hidden="true" className="text-emerald-700">✓</span>
                                  {file.url ? (
                                    <a href={file.url} target="_blank" rel="noreferrer" className="max-w-[260px] truncate font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-950" title={file.nombre_archivo}>{file.nombre_archivo}</a>
                                  ) : <span className="text-rose-700">No se pudo generar enlace privado</span>}
                                  {puedeSubir ? (
                                    <button type="button" disabled={Boolean(fileBusy)} onClick={() => void eliminar(file)}
                                      className="ml-1 rounded px-2 py-1 font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50" aria-label={"Eliminar " + file.nombre_archivo}>
                                      Quitar
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {puedeSubir ? (
                          <label className={"inline-flex shrink-0 cursor-pointer items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 " + (fileBusy || files.length >= 4 ? "pointer-events-none opacity-50" : "")}>
                            {fileBusy === item.id ? "Subiendo…" : files.length ? "+ Adjuntar otro" : "+ Adjuntar"}
                            <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" className="sr-only"
                              disabled={Boolean(fileBusy) || files.length >= 4} aria-label={"Adjuntar " + item.label}
                              onChange={(e) => void subir(item.id, e)} />
                          </label>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-5 text-xs leading-5 text-slate-500">
        Los archivos PDF, JPG, PNG o WEBP se almacenan de forma privada en ConCasa.
        Cada archivo puede pesar hasta 12 MB y se admiten hasta cuatro por tipo (por ejemplo, ambos lados de la INE).
        {puedeSubir ? " Una vez enviada la casa al administrador, la documentación queda en consulta." : ""}
      </p>
    </section>
  );
}
