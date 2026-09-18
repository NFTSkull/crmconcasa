"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  fetchAdminExpedienteFullDetail,
  type AdminDetailRecord,
  type AdminExpedienteFullDetail,
} from "@/domain/admin-expediente-detail";
import { getAdminEtapaDisplayNombre } from "@/domain/admin-production/admin-visible-stages";
import {
  formatAdminTimelineDateTimeMx,
  labelAdminCorrectionRequestType,
  labelAdminMesaAction,
  labelAdminMesaTimelineEvent,
  sanitizeAdminMotivo,
  sanitizeAdminTimelineSummary,
  type AdminMesaTimelineEvent,
} from "@/domain/admin-production/mesa-seguimiento";
import {
  ExpedienteArchivosSupabaseError,
  useExpedienteArchivosRepo,
} from "@/domain/expediente-archivos";
import { useSessionRepo } from "@/domain/session";
import { formatMontoMX } from "@/lib/monto";

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function record(v: unknown): AdminDetailRecord {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as AdminDetailRecord)
    : {};
}

function records(v: unknown): AdminDetailRecord[] {
  return Array.isArray(v) ? v.map(record) : [];
}

function fmtDateTime(v: unknown): string {
  const s = str(v).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("es-MX", {
    timeZone: "America/Monterrey",
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function fmtDate(v: unknown): string {
  const s = str(v).trim();
  if (!s) return "—";
  const d = new Date(`${s.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("es-MX", { dateStyle: "medium" });
}

function fmtTime(v: unknown): string {
  const s = str(v).trim();
  return s ? s.slice(0, 5) : "—";
}

function labelKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-záéíóúñ])([A-Z])/g, "$1 $2")
    .replace(/^./, (x) => x.toUpperCase());
}

function scalar(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function actorLabel(v: unknown): string {
  const s = str(v).trim();
  switch (s) {
    case "asesor":
      return "Asesor";
    case "editor":
      return "Editor";
    case "mesa_admin":
    case "mesa_interno":
    case "mesa_externo":
      return "Mesa";
    case "super_admin":
      return "Super Admin";
    default:
      return s || "Sistema";
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case "expediente.create":
      return "Expediente creado";
    case "editor.decision.upsert":
      return "Precalificación resuelta";
    case "asesor.reprecalificacion.iniciar":
      return "Re-precalificación solicitada";
    case "editor.reprecalificacion.aprobar":
      return "Re-precalificación aprobada";
    case "editor.reprecalificacion.no_cumple":
      return "Re-precalificación: no cumple";
    case "cliente_datos.save":
      return "Datos Generales guardados";
    case "expediente.documento.register":
      return "Documento cargado";
    case "expediente.documento.replace":
      return "Documento reemplazado";
    default: {
      const mesa = labelAdminMesaAction(action);
      return mesa !== "Actividad" ? mesa : action.replaceAll(".", " · ");
    }
  }
}

const CORRECTION_TIMELINE_ACTIONS = new Set([
  "cliente_datos.revision.update",
  "documento.revision.update",
  "cliente_datos.save",
  "cliente_datos.correccion_post_mesa",
  "cliente_datos.actualizado_post_mesa",
  "expediente.documento.asesor_correccion",
  "expediente.documento.register",
  "expediente.documento.replace",
  "asesor.correccion.reenviada_a_mesa",
]);

function toAdminMesaTimelineEvent(raw: AdminDetailRecord): AdminMesaTimelineEvent {
  return {
    at: str(raw.at),
    action: str(raw.action),
    actorGeneral: str(raw.actor_general) || null,
    actorName: str(raw.actor_name) || null,
    actorRole: str(raw.actor_role) || null,
    summary: sanitizeAdminTimelineSummary(record(raw.summary)),
  };
}

function isCorrectionRequestEvent(ev: AdminMesaTimelineEvent): boolean {
  const estadoNuevo = str(ev.summary.estado_nuevo).trim();
  const estatusNuevo = str(ev.summary.estatus_nuevo).trim();
  return (
    (ev.action === "cliente_datos.revision.update" && estadoNuevo === "rechazado") ||
    (ev.action === "documento.revision.update" && estatusNuevo === "rechazado")
  );
}

function Card({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 break-words text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function JsonTable({ value }: { value: unknown }) {
  const obj = record(value);
  const entries = Object.entries(obj);
  if (entries.length === 0) return <p className="text-sm text-slate-500">Sin información.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-left text-sm">
        <tbody>
          {entries.map(([key, val]) => (
            <tr key={key} className="border-b border-slate-100 last:border-0">
              <th className="w-56 bg-slate-50 px-3 py-2 align-top font-medium text-slate-700">{labelKey(key)}</th>
              <td className="px-3 py-2 text-slate-900">
                {typeof val === "object" && val !== null ? (
                  <pre className="max-w-4xl whitespace-pre-wrap break-words text-xs leading-relaxed">{JSON.stringify(val, null, 2)}</pre>
                ) : scalar(val)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailsGrid({ details }: { details: AdminDetailRecord }) {
  const entries = Object.entries(details).filter(([, value]) => value != null && value !== "");
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <p key={key} className="text-xs text-slate-700">
          <span className="font-semibold">{labelKey(key)}:</span> {scalar(value)}
        </p>
      ))}
    </div>
  );
}

export default function AdminExpedienteTransparenciaPage() {
  const { id } = useParams<{ id: string }>();
  const { currentUser } = useSessionRepo();
  const archivosRepo = useExpedienteArchivosRepo();
  const [detail, setDetail] = useState<AdminExpedienteFullDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || currentUser?.role !== "super_admin") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchAdminExpedienteFullDetail(id)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "No se pudo cargar el expediente.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, currentUser?.role]);

  const expediente = detail?.expediente ?? {};
  const asesor = useMemo(() => record(expediente.asesor), [expediente.asesor]);
  const correctionTimeline = useMemo(() => {
    const timeline = (detail?.mesa_timeline ?? []).map(toAdminMesaTimelineEvent);
    const requestTimes = timeline
      .filter(isCorrectionRequestEvent)
      .map((ev) => Date.parse(ev.at))
      .filter((t) => Number.isFinite(t));
    if (requestTimes.length === 0) return [] as AdminMesaTimelineEvent[];
    const firstRequestAt = Math.min(...requestTimes);
    return timeline.filter((ev) => {
      if (!CORRECTION_TIMELINE_ACTIONS.has(ev.action)) return false;
      const at = Date.parse(ev.at);
      return Number.isFinite(at) && at >= firstRequestAt;
    });
  }, [detail?.mesa_timeline]);

  const openDocument = async (doc: AdminDetailRecord) => {
    const docId = str(doc.id).trim();
    if (!docId || doc.deleted_at) return;
    setOpeningDocId(docId);
    setDocError(null);
    const preview = window.open("about:blank", "_blank");
    if (preview) preview.opener = null;
    try {
      const blob = await archivosRepo.getArchivoBlob(docId);
      const url = URL.createObjectURL(blob);
      if (preview && !preview.closed) {
        preview.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      preview?.close();
      const message =
        err instanceof ExpedienteArchivosSupabaseError || err instanceof Error
          ? err.message
          : "No se pudo abrir el documento.";
      setDocError(message);
    } finally {
      setOpeningDocId(null);
    }
  };

  if (currentUser === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100">Cargando…</div>;
  }

  if (!currentUser || currentUser.role !== "super_admin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <Link href="/login" className="text-blue-700 underline">Inicia sesión como Super Admin</Link>
      </div>
    );
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100">Cargando expediente completo…</div>;
  }

  if (error || !detail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="text-center">
          <p className="text-red-700">{error || "Expediente no encontrado"}</p>
          <Link href="/admin/expedientes" className="mt-3 inline-block text-blue-700 underline">Volver a Expedientes</Link>
        </div>
      </div>
    );
  }

  const etapa = num(expediente.etapa_actual) ?? 1;
  const enviadoAMesa = Boolean(expediente.submitted_to_mesa) && Boolean(expediente.fecha_envio_mesa);
  const clienteDatos = detail.cliente_datos;
  const precal = detail.precalificacion;
  const refs = Array.isArray(clienteDatos?.referencias) ? clienteDatos?.referencias : [];
  const historialDesc = [...detail.historial].sort(
    (a, b) => Date.parse(str(b.at)) - Date.parse(str(a.at)),
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <Link href="/admin/expedientes" className="text-sm font-medium text-blue-700 underline underline-offset-2">← Volver a Expedientes</Link>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-950">{str(expediente.cliente_nombre) || "Expediente"}</h1>
              <p className="mt-1 text-sm text-slate-600">Vista completa de auditoría · solo lectura</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${enviadoAMesa ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
                {enviadoAMesa ? "Enviado a Mesa" : "No enviado a Mesa"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">{etapa}. {getAdminEtapaDisplayNombre(etapa)}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        <Section title="Resumen y envío a Mesa" description="Estado actual, identidad del expediente y hora exacta de envío.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="Expediente" value={str(expediente.id)} />
            <Card label="Asesor" value={str(asesor.nombre) || str(asesor.email) || "—"} />
            <Card label="Programa" value={str(expediente.programa) || "—"} />
            <Card label="NSS" value={str(expediente.nss) || "—"} />
            <Card label="Etapa actual" value={`${etapa}. ${getAdminEtapaDisplayNombre(etapa)}`} />
            <Card label="Subestado" value={str(expediente.subestado) || "—"} />
            <Card label="Ciclo" value={str(expediente.ciclo_estado) || "—"} />
            <Card label="Origen Mesa" value={str(expediente.origen_mesa) || "—"} />
            <Card label="Enviado a Mesa" value={enviadoAMesa ? "Sí" : "No"} />
            <Card label="Fecha y hora de envío" value={fmtDateTime(expediente.fecha_envio_mesa)} />
            <Card label="Creado" value={fmtDateTime(expediente.created_at)} />
            <Card label="Última actualización" value={fmtDateTime(expediente.updated_at)} />
            <Card label="Teléfono" value={str(expediente.telefono_cliente) || "—"} />
            <Card label="Teléfono casa" value={str(expediente.telefono_casa) || "—"} />
            <Card label="Pago ConCasa" value={str(expediente.pago_concasa_resultado) || "—"} />
            <Card label="Fecha pago" value={fmtDateTime(expediente.pago_concasa_at)} />
          </div>
          {str(expediente.direccion_opcional) ? (
            <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800"><span className="font-semibold">Dirección:</span> {str(expediente.direccion_opcional)}</p>
          ) : null}
        </Section>

        <Section title="Precalificación" description="Resultado vigente y datos guardados por Editor.">
          {precal ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card label="Decisión" value={str(precal.decision) || "—"} />
              <Card label="Monto aprobado" value={precal.monto_aprobado != null ? formatMontoMX(Number(precal.monto_aprobado)) : "—"} />
              <Card label="Monto al aprobar" value={precal.monto_aprobado_al_aprobar != null ? formatMontoMX(Number(precal.monto_aprobado_al_aprobar)) : "—"} />
              <Card label="Fecha aprobación" value={fmtDateTime(precal.aprobado_at)} />
              <Card label="Fecha no cumple" value={fmtDateTime(precal.no_cumple_at)} />
              <Card label="RFC Infonavit" value={str(precal.rfc_infonavit) || "—"} />
              <Card label="Registro patronal" value={str(precal.registro_patronal_infonavit) || "—"} />
              <Card label="Empresa Infonavit" value={str(precal.empresa_infonavit) || "—"} />
            </div>
          ) : <p className="text-sm text-slate-500">Sin precalificación registrada.</p>}
          {precal?.notas_revision ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><span className="font-semibold">Notas:</span> {str(precal.notas_revision)}</p> : null}
        </Section>

        <Section title="Datos Generales" description="Todo lo capturado actualmente para el cliente, incluyendo referencias.">
          {clienteDatos ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card label="Estado" value={str(clienteDatos.estado) || "—"} />
                <Card label="Método de pago" value={str(clienteDatos.metodo_pago) || "—"} />
                <Card label="Porcentaje cobro" value={scalar(clienteDatos.porcentaje_cobro)} />
                <Card label="Monto calculado" value={clienteDatos.monto_calculado != null ? formatMontoMX(Number(clienteDatos.monto_calculado)) : "—"} />
                <Card label="Validado" value={fmtDateTime(clienteDatos.validated_at)} />
                <Card label="Rechazado" value={fmtDateTime(clienteDatos.rejected_at)} />
                <Card label="Creado" value={fmtDateTime(clienteDatos.created_at)} />
                <Card label="Actualizado" value={fmtDateTime(clienteDatos.updated_at)} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Campos capturados</h3>
                <JsonTable value={clienteDatos.datos} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Referencias ({refs.length})</h3>
                {refs.length === 0 ? <p className="text-sm text-slate-500">Sin referencias registradas.</p> : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {refs.map((ref, index) => <JsonTable key={index} value={ref} />)}
                  </div>
                )}
              </div>
            </div>
          ) : <p className="text-sm text-slate-500">Todavía no hay Datos Generales guardados.</p>}
        </Section>

        <Section
          title={`Documentos (${detail.documentos.length} versiones)`}
          description="Incluye documentos actuales e históricos, quién los subió, hora exacta, revisión de Mesa y comentarios. Los activos pueden abrirse desde aquí."
        >
          {docError ? <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{docError}</div> : null}
          {detail.documentos.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
              {enviadoAMesa ? "No hay documentos registrados para este expediente." : "Este expediente todavía no se envía a Mesa y aún no tiene documentos registrados."}
            </div>
          ) : (
            <div className="space-y-3">
              {detail.documentos.map((doc, index) => {
                const deleted = Boolean(doc.deleted_at);
                const revisiones = records(doc.revisiones);
                const docId = str(doc.id);
                return (
                  <article key={docId || index} className={`rounded-lg border p-4 ${deleted ? "border-slate-200 bg-slate-50/70" : "border-blue-200 bg-blue-50/30"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-slate-950">{labelKey(str(doc.tipo_documento) || "Documento")}</h3>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${deleted ? "bg-slate-200 text-slate-700" : "bg-emerald-100 text-emerald-900"}`}>{deleted ? "Histórico" : "Activo"}</span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-700">v{scalar(doc.version)}</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-700">{str(doc.nombre_original) || "Sin nombre de archivo"}</p>
                      </div>
                      {!deleted ? (
                        <button
                          type="button"
                          disabled={openingDocId === docId}
                          onClick={() => void openDocument(doc)}
                          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                        >
                          {openingDocId === docId ? "Abriendo…" : "Ver documento"}
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <Card label="Subido" value={fmtDateTime(doc.created_at)} />
                      <Card label="Subido por" value={str(doc.uploaded_by_nombre) || actorLabel(doc.uploaded_by_role)} />
                      <Card label="Revisión actual" value={str(doc.estatus_revision) || "—"} />
                      <Card label="Tamaño" value={num(doc.size_bytes) != null ? `${(Number(doc.size_bytes) / 1024 / 1024).toFixed(2)} MB` : "—"} />
                    </div>
                    {str(doc.comentario_mesa) ? <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950"><span className="font-semibold">Comentario de Mesa:</span> {str(doc.comentario_mesa)}</p> : null}
                    {revisiones.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Historial de revisión</p>
                        <ol className="mt-2 space-y-2 border-l border-slate-300 pl-4">
                          {revisiones.map((rev, revIndex) => (
                            <li key={str(rev.id) || revIndex} className="text-sm text-slate-700">
                              <p><span className="font-medium text-slate-900">{fmtDateTime(rev.created_at)}</span> · {str(rev.estatus_anterior) || "—"} → {str(rev.estatus_nuevo) || "—"}</p>
                              <p className="text-xs text-slate-500">{str(rev.actor_nombre) || "Mesa"}{str(rev.comentario_mesa) ? ` · ${str(rev.comentario_mesa)}` : ""}</p>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </Section>

        <Section
          title={`Eventos de corrección (${correctionTimeline.length})`}
          description="Auditoría del ciclo: solicitud de Mesa, cambios del asesor, reenvío y revisión. Todas las horas se muestran en Monterrey."
        >
          {correctionTimeline.length === 0 ? (
            <p className="text-sm text-slate-500">
              No hay un ciclo de corrección solicitado por Mesa registrado.
            </p>
          ) : (
            <ol className="space-y-3 border-l border-amber-300 pl-5">
              {correctionTimeline.map((ev, index) => {
                const summary = ev.summary;
                const motivoRaw =
                  str(summary.comentario_rechazo).trim() ||
                  str(summary.comentario).trim() ||
                  str(summary.motivo).trim();
                const requestType = labelAdminCorrectionRequestType(
                  summary.request_type,
                );
                const estadoAnterior =
                  str(summary.estado_anterior).trim() ||
                  str(summary.estatus_anterior).trim();
                const estadoNuevo =
                  str(summary.estado_nuevo).trim() ||
                  str(summary.estatus_nuevo).trim();
                const actor =
                  ev.actorName && ev.actorGeneral
                    ? `${ev.actorName} · ${ev.actorGeneral}`
                    : ev.actorName || ev.actorGeneral || actorLabel(ev.actorRole);
                return (
                  <li key={`${ev.at}-${ev.action}-${index}`} className="relative rounded-lg border border-amber-100 bg-amber-50/40 p-3">
                    <span className="absolute -left-[1.58rem] top-5 h-2.5 w-2.5 rounded-full bg-amber-600" />
                    <p className="text-sm font-semibold text-slate-950">
                      {formatAdminTimelineDateTimeMx(ev.at)} · {labelAdminMesaTimelineEvent(ev)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">{actor}</p>
                    {motivoRaw ? (
                      <p className="mt-2 text-sm text-amber-950">
                        <span className="font-semibold">Motivo:</span>{" "}
                        {sanitizeAdminMotivo(motivoRaw)}
                      </p>
                    ) : null}
                    {str(summary.tipo_documento).trim() ? (
                      <p className="mt-1 text-xs text-slate-700">
                        <span className="font-semibold">Documento:</span>{" "}
                        {str(summary.tipo_documento)}
                      </p>
                    ) : null}
                    {estadoAnterior || estadoNuevo ? (
                      <p className="mt-1 text-xs text-slate-700">
                        <span className="font-semibold">Estado:</span>{" "}
                        {estadoAnterior || "—"} → {estadoNuevo || "—"}
                      </p>
                    ) : null}
                    {requestType ? (
                      <p className="mt-1 text-xs text-slate-700">
                        <span className="font-semibold">Tipo de solicitud:</span>{" "}
                        {requestType}
                      </p>
                    ) : null}
                    {str(summary.request_at).trim() ? (
                      <p className="mt-1 text-xs text-slate-700">
                        <span className="font-semibold">Solicitud de Mesa:</span>{" "}
                        {formatAdminTimelineDateTimeMx(summary.request_at)}
                      </p>
                    ) : null}
                    {str(summary.submitted_at).trim() ? (
                      <p className="mt-1 text-xs text-slate-700">
                        <span className="font-semibold">Reenvío del asesor:</span>{" "}
                        {formatAdminTimelineDateTimeMx(summary.submitted_at)}
                      </p>
                    ) : null}
                    {str(summary.copied_cambios).trim() ? (
                      <p className="mt-1 text-xs text-slate-700">
                        <span className="font-semibold">Cambios incluidos:</span>{" "}
                        {str(summary.copied_cambios)}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </Section>

        <Section title={`Lotes de respuesta del asesor (${detail.correcciones.length})`} description="Lotes creados por el asesor para responder a Mesa, sus cambios, reenvío y revisión.">
          {detail.correcciones.length === 0 ? <p className="text-sm text-slate-500">No se han solicitado correcciones.</p> : (
            <div className="space-y-3">
              {detail.correcciones.map((lote, index) => {
                const cambios = records(lote.cambios);
                return (
                  <article key={str(lote.id) || index} className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <Card label="Estado" value={str(lote.status) || "—"} />
                      <Card label="Lote creado" value={fmtDateTime(lote.created_at)} />
                      <Card label="Reenviada" value={fmtDateTime(lote.submitted_at)} />
                      <Card label="Revisada" value={fmtDateTime(lote.reviewed_at)} />
                    </div>
                    {str(lote.reviewed_by_nombre) ? <p className="mt-2 text-xs text-slate-600">Revisó: {str(lote.reviewed_by_nombre)}</p> : null}
                    {cambios.length === 0 ? <p className="mt-3 text-sm text-slate-500">Sin desglose de cambios registrado.</p> : (
                      <div className="mt-3 overflow-x-auto rounded-md border border-amber-200 bg-white">
                        <table className="min-w-[760px] w-full text-left text-sm">
                          <thead><tr className="border-b border-amber-100 bg-amber-50 text-xs uppercase text-amber-900"><th className="px-3 py-2">Cambio</th><th className="px-3 py-2">Documento / campo</th><th className="px-3 py-2">Anterior</th><th className="px-3 py-2">Nuevo</th><th className="px-3 py-2">Hora</th></tr></thead>
                          <tbody>
                            {cambios.map((cambio, cambioIndex) => (
                              <tr key={str(cambio.id) || cambioIndex} className="border-b border-slate-100 last:border-0">
                                <td className="px-3 py-2 font-medium text-slate-900">{str(cambio.label) || str(cambio.tipo) || "Corrección"}</td>
                                <td className="px-3 py-2 text-slate-700">{str(cambio.document_kind) || str(cambio.campo) || str(cambio.entidad) || "—"}</td>
                                <td className="px-3 py-2 text-slate-600">{scalar(cambio.valor_anterior)}</td>
                                <td className="px-3 py-2 text-slate-900">{scalar(cambio.valor_nuevo)}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDateTime(cambio.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </Section>

        <Section title={`Citas (${detail.citas.length})`} description="Citas vigentes e históricas, sede, hora, cancelaciones y validación Drive.">
          {detail.citas.length === 0 ? <p className="text-sm text-slate-500">Sin citas registradas.</p> : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-[900px] w-full text-left text-sm">
                <thead><tr className="border-b bg-slate-50 text-xs uppercase text-slate-500"><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Fecha / hora</th><th className="px-3 py-2">Sede</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Creada</th><th className="px-3 py-2">Cancelada</th><th className="px-3 py-2">Drive</th></tr></thead>
                <tbody>{detail.citas.map((cita, index) => <tr key={str(cita.id) || index} className="border-b last:border-0"><td className="px-3 py-2">{str(cita.kind) || "—"}</td><td className="px-3 py-2">{fmtDate(cita.booking_date)} · {fmtTime(cita.booking_time)}</td><td className="px-3 py-2">{str(cita.location_id) || "—"}</td><td className="px-3 py-2">{str(cita.status) || "—"}</td><td className="px-3 py-2">{fmtDateTime(cita.created_at)}</td><td className="px-3 py-2">{fmtDateTime(cita.cancelled_at)}</td><td className="px-3 py-2">{cita.drive_validated ? `Validado ${fmtDateTime(cita.drive_validated_at)}` : "Pendiente / no aplica"}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {detail.decisiones_cita.length > 0 ? (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Decisiones y reagendas</h3>
              <div className="space-y-2">{detail.decisiones_cita.map((decision, index) => <div key={str(decision.id) || index} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"><p className="font-medium text-slate-900">{str(decision.decision) || "Decisión"} · {str(decision.kind) || "cita"}</p><p className="mt-1 text-xs text-slate-600">{fmtDateTime(decision.decided_at)} · {str(decision.decidido_por_nombre) || "—"}{str(decision.motivo) ? ` · ${str(decision.motivo)}` : ""}</p><DetailsGrid details={decision} /></div>)}</div>
            </div>
          ) : null}
        </Section>

        <Section title="Rechazos y reactivaciones" description="Decisiones operativas registradas durante el flujo.">
          {detail.rechazos_operativos.length === 0 && detail.reactivaciones.length === 0 ? <p className="text-sm text-slate-500">Sin rechazos ni reactivaciones operativas.</p> : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div><h3 className="mb-2 text-sm font-semibold text-slate-900">Rechazos ({detail.rechazos_operativos.length})</h3><div className="space-y-2">{detail.rechazos_operativos.map((rechazo, index) => <div key={str(rechazo.id) || index} className="rounded-md border border-red-200 bg-red-50 p-3"><p className="text-sm font-medium text-red-950">{fmtDateTime(rechazo.created_at)} · Etapa {scalar(rechazo.etapa)}</p><p className="mt-1 text-sm text-red-900">{str(rechazo.motivo) || "Sin motivo"}</p>{str(rechazo.comentario) ? <p className="mt-1 text-xs text-red-800">{str(rechazo.comentario)}</p> : null}</div>)}</div></div>
              <div><h3 className="mb-2 text-sm font-semibold text-slate-900">Reactivaciones ({detail.reactivaciones.length})</h3><div className="space-y-2">{detail.reactivaciones.map((react, index) => <div key={str(react.id) || index} className="rounded-md border border-emerald-200 bg-emerald-50 p-3"><p className="text-sm font-medium text-emerald-950">{fmtDateTime(react.created_at)} · Etapa {scalar(react.etapa)}</p><p className="mt-1 text-xs text-emerald-800">{str(react.reactivado_por_nombre) || actorLabel(react.reactivado_por_rol)} · {str(react.subestado_anterior) || "—"} → {str(react.subestado_nuevo) || "—"}</p></div>)}</div></div>
            </div>
          )}
        </Section>

        <Section title="Retención" description="Opción y envío de retención asociados al expediente.">
          <JsonTable value={detail.retencion} />
        </Section>

        <Section title={`Historial completo (${historialDesc.length})`} description="Actividad registrada en el expediente, más reciente primero.">
          {historialDesc.length === 0 ? <p className="text-sm text-slate-500">Sin actividad registrada.</p> : (
            <ol className="space-y-3 border-l border-slate-300 pl-5">
              {historialDesc.map((event, index) => {
                const details = record(event.details);
                return (
                  <li key={str(event.id) || index} className="relative">
                    <span className="absolute -left-[1.48rem] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-600" />
                    <p className="text-sm font-semibold text-slate-900">{fmtDateTime(event.at)} · {actionLabel(str(event.action))}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{str(event.actor_nombre) || actorLabel(event.actor_role)}</p>
                    <DetailsGrid details={details} />
                  </li>
                );
              })}
            </ol>
          )}
        </Section>
      </main>
    </div>
  );
}
