"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSessionRepo } from "@/domain/session";
import {
  fetchAdminExpedienteFullDetail,
  type AdminDetailRecord,
  type AdminExpedienteFullDetail,
} from "@/domain/admin-expediente-detail";
import { getAdminEtapaDisplayNombre } from "@/domain/admin-production/admin-visible-stages";
import { labelAdminMesaAction } from "@/domain/admin-production/mesa-seguimiento";
import { formatMontoMX } from "@/lib/monto";

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtDateTime(v: unknown): string {
  const s = str(v).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("es-MX", {
    timeZone: "America/Monterrey",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function fmtDate(v: unknown): string {
  const s = str(v).trim();
  if (!s) return "—";
  const parts = s.slice(0, 10).split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : s;
}

function fmtTime(v: unknown): string {
  const s = str(v).trim();
  return s ? s.slice(0, 5) : "—";
}

function titleCaseKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-záéíóúñ])([A-Z])/g, "$1 $2")
    .replace(/^./, (x) => x.toUpperCase());
}

function scalarText(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function actorLabel(value: unknown): string {
  const s = str(value).trim();
  if (!s) return "Sistema";
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
      return s;
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case "expediente.create":
      return "Expediente creado";
    case "editor.decision.upsert":
      return "Precalificación resuelta";
    case "asesor.reprecalificacion.iniciar":
      return "Reprecalificación solicitada";
    case "editor.reprecalificacion.aprobar":
      return "Reprecalificación aprobada";
    case "editor.reprecalificacion.no_cumple":
      return "Reprecalificación: no cumple";
    case "cliente_datos.save":
      return "Datos Generales guardados";
    case "expediente.telefono_casa.actualizado":
      return "Teléfono de casa actualizado";
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

function Card({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
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
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function JsonTable({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") {
    return <p className="text-sm text-slate-600">Sin información.</p>;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <p className="text-sm text-slate-600">Sin información.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-left text-sm">
        <tbody>
          {entries.map(([key, val]) => (
            <tr key={key} className="border-b border-slate-100 last:border-0">
              <th className="w-56 bg-slate-50 px-3 py-2 align-top font-medium text-slate-700">
                {titleCaseKey(key)}
              </th>
              <td className="px-3 py-2 text-slate-900">
                {typeof val === "object" && val !== null ? (
                  <pre className="max-w-3xl whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-800">
                    {JSON.stringify(val, null, 2)}
                  </pre>
                ) : (
                  scalarText(val)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailsGrid({ details }: { details: AdminDetailRecord }) {
  const entries = Object.entries(details).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <p key={k} className="text-xs text-slate-700">
          <span className="font-medium">{titleCaseKey(k)}:</span> {scalarText(v)}
        </p>
      ))}
    </div>
  );
}

export default function AdminExpedienteFullPage() {
  const { id } = useParams<{ id: string }>();
  const { currentUser } = useSessionRepo();
  const [detail, setDetail] = useState<AdminExpedienteFullDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudo cargar el expediente");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, currentUser?.role]);

  const expediente = detail?.expediente ?? {};
  const asesor = useMemo(() => {
    const raw = expediente.asesor;
    return raw && typeof raw === "object" ? (raw as AdminDetailRecord) : {};
  }, [expediente.asesor]);

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
          <Link href="/admin" className="mt-3 inline-block text-blue-700 underline">Volver al dashboard</Link>
        </div>
      </div>
    );
  }

  const etapa = num(expediente.etapa_actual) ?? 1;
  const clienteDatos = detail.cliente_datos;
  const datosRaw = clienteDatos?.datos;
  const datos = datosRaw && typeof datosRaw === "object" ? datosRaw : {};
  const referencias = clienteDatos?.referencias;
  const precal = detail.precalificacion;
  const retencion = detail.retencion;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link href="/admin" className="text-sm font-medium text-blue-700 underline">← Volver a Admin</Link>
              <h1 className="mt-2 text-2xl font-semibold text-slate-950">{str(expediente.cliente_nombre) || "Expediente"}</h1>
              <p className="mt-1 text-sm text-slate-600">Expediente completo · solo lectura</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-medium">
              <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-slate-800">
                {getAdminEtapaDisplayNombre(etapa)}
              </span>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-800">
                {str(expediente.subestado) || "sin subestado"}
              </span>
              <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-violet-800">
                {str(expediente.origen_mesa) || "sin origen"}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        <Section title="Resumen del expediente" description="Estado actual y datos principales del expediente.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="ID" value={str(expediente.id)} />
            <Card label="Asesor" value={str(asesor.nombre) || str(asesor.email) || "—"} />
            <Card label="Programa" value={str(expediente.programa) || "—"} />
            <Card label="Etapa actual" value={getAdminEtapaDisplayNombre(etapa)} />
            <Card label="NSS" value={str(expediente.nss) || "—"} />
            <Card label="Teléfono" value={str(expediente.telefono_cliente) || "—"} />
            <Card label="Teléfono casa" value={str(expediente.telefono_casa) || "—"} />
            <Card label="Origen Mesa" value={str(expediente.origen_mesa) || "—"} />
            <Card label="Ciclo" value={str(expediente.ciclo_estado) || "—"} />
            <Card label="Subestado" value={str(expediente.subestado) || "—"} />
            <Card label="Enviado a Mesa" value={expediente.submitted_to_mesa ? "Sí" : "No"} />
            <Card label="Fecha envío Mesa" value={fmtDateTime(expediente.fecha_envio_mesa)} />
            <Card label="Creado" value={fmtDateTime(expediente.created_at)} />
            <Card label="Última actualización" value={fmtDateTime(expediente.updated_at)} />
            <Card label="Pago ConCasa" value={str(expediente.pago_concasa_resultado) || "—"} />
            <Card label="Fecha pago" value={fmtDateTime(expediente.pago_concasa_at)} />
          </div>
          {str(expediente.direccion_opcional) ? (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
              <span className="font-medium">Dirección:</span> {str(expediente.direccion_opcional)}
            </div>
          ) : null}
        </Section>

        <Section title="Precalificación" description="Resultado vigente y datos de la decisión del editor.">
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
          ) : (
            <p className="text-sm text-slate-600">Sin precalificación registrada.</p>
          )}
          {precal?.notas_revision ? <p className="mt-3 text-sm text-slate-700"><span className="font-medium">Notas:</span> {str(precal.notas_revision)}</p> : null}
        </Section>

        <Section title="Datos Generales actuales" description="Registro actual guardado para el cliente. Los datos históricos aparecen más abajo en el timeline y en Correcciones.">
          {clienteDatos ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card label="Estado" value={str(clienteDatos.estado) || "—"} />
                <Card label="Método de pago" value={str(clienteDatos.metodo_pago) || "—"} />
                <Card label="Porcentaje cobro" value={clienteDatos.porcentaje_cobro != null ? `${scalarText(clienteDatos.porcentaje_cobro)}%` : "—"} />
                <Card label="Monto calculado" value={clienteDatos.monto_calculado != null ? formatMontoMX(Number(clienteDatos.monto_calculado)) : "—"} />
                <Card label="Monto Mejoravit actualizado" value={clienteDatos.monto_mejoravit_actualizado != null ? formatMontoMX(Number(clienteDatos.monto_mejoravit_actualizado)) : "—"} />
                <Card label="Actualizado" value={fmtDateTime(clienteDatos.updated_at)} />
                <Card label="Validado" value={fmtDateTime(clienteDatos.validated_at)} />
                <Card label="Rechazado" value={fmtDateTime(clienteDatos.rejected_at)} />
              </div>
              <details className="rounded-lg border border-slate-200 bg-slate-50 p-3" open>
                <summary className="cursor-pointer font-medium text-slate-900">Todos los campos guardados en Datos Generales</summary>
                <div className="mt-3"><JsonTable value={datos} /></div>
              </details>
              <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <summary className="cursor-pointer font-medium text-slate-900">Referencias guardadas</summary>
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-slate-800">{JSON.stringify(referencias ?? [], null, 2)}</pre>
              </details>
            </div>
          ) : (
            <p className="text-sm text-slate-600">Sin Datos Generales guardados.</p>
          )}
        </Section>

        <Section title={`Documentos (${detail.documentos.length})`} description="Incluye versiones activas e históricas, estado de revisión y revisiones de Mesa.">
          {detail.documentos.length === 0 ? (
            <p className="text-sm text-slate-600">Sin documentos registrados.</p>
          ) : (
            <div className="space-y-3">
              {detail.documentos.map((doc, index) => {
                const reviews = Array.isArray(doc.revisiones) ? (doc.revisiones as AdminDetailRecord[]) : [];
                return (
                  <article key={str(doc.id) || index} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">{str(doc.tipo_documento) || "Documento"}</p>
                        <p className="text-sm text-slate-600">{str(doc.nombre_original) || "Sin nombre original"}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{str(doc.estatus_revision) || "—"}</span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                      <p><b>Versión:</b> {scalarText(doc.version)}</p>
                      <p><b>Subido:</b> {fmtDateTime(doc.created_at)}</p>
                      <p><b>Por:</b> {str(doc.uploaded_by_nombre) || str(doc.uploaded_by_role) || "—"}</p>
                      <p><b>Eliminado/reemplazado:</b> {fmtDateTime(doc.deleted_at)}</p>
                    </div>
                    {str(doc.comentario_mesa) ? <p className="mt-2 text-sm text-slate-700"><b>Comentario Mesa:</b> {str(doc.comentario_mesa)}</p> : null}
                    {reviews.length > 0 ? (
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Historial de revisión</p>
                        <ol className="mt-2 space-y-2">
                          {reviews.map((r, ri) => (
                            <li key={str(r.id) || ri} className="text-sm text-slate-800">
                              {fmtDateTime(r.created_at)} · {str(r.estatus_anterior) || "—"} → <b>{str(r.estatus_nuevo) || "—"}</b>
                              {str(r.actor_nombre) ? ` · ${str(r.actor_nombre)}` : ""}
                              {str(r.comentario_mesa) ? <p className="text-xs text-slate-600">{str(r.comentario_mesa)}</p> : null}
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

        <Section title={`Citas y agenda (${detail.citas.length})`} description="Todas las reservas conservadas, incluyendo canceladas y reemplazadas. Los cambios de fecha también aparecen en el historial cronológico.">
          {detail.citas.length === 0 ? (
            <p className="text-sm text-slate-600">Este expediente todavía no tiene citas registradas.</p>
          ) : (
            <div className="space-y-3">
              {detail.citas.map((cita, index) => (
                <article key={str(cita.id) || index} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium text-slate-900">{str(cita.kind) || "Cita"}</p>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{str(cita.status) || "—"}</span>
                  </div>
                  <div className="mt-2 grid gap-1 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                    <p><b>Fecha:</b> {fmtDate(cita.booking_date)}</p>
                    <p><b>Hora:</b> {fmtTime(cita.booking_time)}</p>
                    <p><b>Ubicación:</b> {str(cita.location_id) || "—"}</p>
                    <p><b>Agendada:</b> {fmtDateTime(cita.created_at)}</p>
                    <p><b>Agendó:</b> {str(cita.created_by_nombre) || "—"}</p>
                    <p><b>Cancelada:</b> {fmtDateTime(cita.cancelled_at)}</p>
                    <p><b>Drive:</b> {cita.drive_validated ? "Validado" : "No validado"}</p>
                    <p><b>Validación Drive:</b> {fmtDateTime(cita.drive_validated_at)}</p>
                  </div>
                  {str(cita.note) ? <p className="mt-2 text-sm text-slate-700"><b>Nota:</b> {str(cita.note)}</p> : null}
                </article>
              ))}
            </div>
          )}

          {detail.decisiones_cita.length > 0 ? (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <h3 className="font-medium text-slate-900">Decisiones / reagendas registradas</h3>
              <div className="mt-3 space-y-2">
                {detail.decisiones_cita.map((d, index) => (
                  <div key={str(d.id) || index} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-800">
                    <p><b>{str(d.kind) || "Cita"} · {str(d.decision) || "decisión"}</b> · {fmtDateTime(d.decided_at)}</p>
                    <p className="mt-1 text-xs text-slate-700">
                      Anterior: {fmtDate(d.previous_booking_date)} {fmtTime(d.previous_booking_time)} · {str(d.previous_location_id) || "—"}
                    </p>
                    <p className="text-xs text-slate-700">
                      Nueva: {fmtDate(d.new_booking_date)} {fmtTime(d.new_booking_time)} · {str(d.new_location_id) || "—"}
                    </p>
                    {str(d.motivo) ? <p className="mt-1 text-xs text-slate-700">Motivo: {str(d.motivo)}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Section>

        <Section title={`Correcciones (${detail.correcciones.length})`} description="Lotes enviados por el asesor y cada cambio registrado con valor anterior y nuevo.">
          {detail.correcciones.length === 0 ? (
            <p className="text-sm text-slate-600">Sin ciclos de corrección registrados.</p>
          ) : (
            <div className="space-y-3">
              {detail.correcciones.map((lote, index) => {
                const cambios = Array.isArray(lote.cambios) ? (lote.cambios as AdminDetailRecord[]) : [];
                return (
                  <article key={str(lote.id) || index} className="rounded-lg border border-slate-200 p-3">
                    <p className="font-medium text-slate-900">{str(lote.status) || "Corrección"}</p>
                    <p className="mt-1 text-xs text-slate-600">Creada: {fmtDateTime(lote.created_at)} · Enviada: {fmtDateTime(lote.submitted_at)} · Revisada: {fmtDateTime(lote.reviewed_at)}</p>
                    {cambios.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {cambios.map((c, ci) => (
                          <div key={str(c.id) || ci} className="rounded-md bg-slate-50 p-2 text-sm text-slate-800">
                            <p className="font-medium">{str(c.label) || str(c.campo) || str(c.document_kind) || "Cambio"}</p>
                            <p className="mt-1 text-xs">Anterior: {scalarText(c.valor_anterior)}</p>
                            <p className="text-xs">Nuevo: {scalarText(c.valor_nuevo)}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Rechazos, reactivaciones y retención" description="Decisiones operativas históricas y estado de retención del expediente.">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Rechazos operativos ({detail.rechazos_operativos.length})</h3>
              <div className="mt-2 space-y-2">
                {detail.rechazos_operativos.length === 0 ? <p className="text-sm text-slate-600">Sin rechazos.</p> : detail.rechazos_operativos.map((r, i) => (
                  <div key={str(r.id) || i} className="rounded-lg bg-red-50 p-3 text-sm text-red-950">
                    <p><b>{fmtDateTime(r.created_at)}</b> · Etapa {scalarText(r.etapa)}</p>
                    <p className="mt-1">{str(r.motivo) || "Sin motivo"}</p>
                    {str(r.comentario) ? <p className="text-xs">{str(r.comentario)}</p> : null}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Reactivaciones ({detail.reactivaciones.length})</h3>
              <div className="mt-2 space-y-2">
                {detail.reactivaciones.length === 0 ? <p className="text-sm text-slate-600">Sin reactivaciones.</p> : detail.reactivaciones.map((r, i) => (
                  <div key={str(r.id) || i} className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950">
                    <p><b>{fmtDateTime(r.created_at)}</b> · Etapa {scalarText(r.etapa)}</p>
                    <p className="text-xs">{str(r.subestado_anterior) || "—"} → {str(r.subestado_nuevo) || "—"}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer font-medium text-slate-900">Retención</summary>
            <div className="mt-3"><JsonTable value={retencion} /></div>
          </details>
        </Section>

        <Section title={`Historial cronológico completo (${detail.historial.length})`} description="Eventos de negocio del expediente desde su creación. Se omite únicamente ruido técnico repetitivo de validación CURP/RFC mientras se captura.">
          {detail.historial.length === 0 ? (
            <p className="text-sm text-slate-600">Sin eventos registrados.</p>
          ) : (
            <ol className="relative ml-2 border-l border-slate-300 pl-5">
              {detail.historial.map((event, index) => {
                const detailsRaw = event.details;
                const details = detailsRaw && typeof detailsRaw === "object" ? (detailsRaw as AdminDetailRecord) : {};
                return (
                  <li key={str(event.id) || index} className="relative pb-5 last:pb-0">
                    <span className="absolute -left-[1.55rem] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-700" />
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium text-slate-900">{actionLabel(str(event.action))}</p>
                        <span className="text-xs text-slate-500">{fmtDateTime(event.at)}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        {str(event.actor_nombre) || actorLabel(event.actor_role)} · <code>{str(event.action)}</code>
                      </p>
                      <DetailsGrid details={details} />
                    </div>
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
